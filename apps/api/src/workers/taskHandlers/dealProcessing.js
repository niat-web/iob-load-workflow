import { config } from "../../config/env.js";
import { APPROVAL_GATE as GATE, JOB_STATUS as S, NOTIFICATION_TYPE, TASK_TYPE, loadGateFor } from "../../config/statuses.js";
import { Job, JobEligibleStudent, JobHubspotMapping } from "../../models/index.js";
import { waitForApproval } from "../../services/approvalService.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { applySubmittedInputs, mapDeal, missingRequiredFields } from "../../services/dealMapper.js";
import { latestSnapshot, saveSnapshot } from "../../services/dealSnapshotService.js";
import { companyLogoFor, usableLogo } from "../../services/companyLogoService.js";
import { findEligibleStudents } from "../../services/eligibilityService.js";
import { productGroupsForPlans } from "../../services/eligiblePoolService.js";
import { getSettings } from "../../services/settingsService.js";
import { integrations } from "../../services/integrations.js";
import { companyJdCount, transitionJob } from "../../services/jobService.js";
import {
  buildPortalPayload,
  isLoadedInto,
  jobUrlFor,
  loadInto,
  nextOrderNumber,
  prepareOrganisation,
} from "../../services/learningPortal/portalLoader.js";
import { notificationKey, sendBulk } from "../../services/notificationService.js";
import { enqueueTask } from "../../services/taskQueue.js";
import { now } from "../../utils/clock.js";
import { PermanentError } from "../../utils/errors.js";
import { chunk, formatDateTime, hoursFromNow } from "../../utils/helpers.js";
import { enqueueNext, isPast, proceed } from "./shared.js";

const DEAL_FIELDS = [
  "companyName", "companyWebsite", "companyLinkedin", "companyLogoUrl", "jobRole", "jobDescription", "skills",
  "eligibility", "batch", "campus", "program", "location", "ctc", "employmentType", "openings",
  "expectedPoolCount", "crmOwnerName", "crmOwnerEmail", "applicationDeadline", "importantInstructions", "jdCount",
  "jobType", "experienceType", "jobSource", "applicationMode", "internshipDuration", "enrollPlans",
];

export const pick = (mapped) => Object.fromEntries(DEAL_FIELDS.map((field) => [field, mapped[field] ?? null]));

async function requireSnapshot(job) {
  const snapshot = await latestSnapshot(job._id);
  if (!snapshot) throw new PermanentError("No HubSpot snapshot stored for this job; retry the deal fetch");
  return snapshot;
}

async function fetchDeal({ job }) {
  if (isPast(job, S.FETCHING_DEAL)) return proceed(job, GATE.DEAL_DETAILS, TASK_TYPE.CREATE_JOB);
  await transitionJob(job._id, S.FETCHING_DEAL, { from: [S.SUBMITTED, S.FETCHING_DEAL] });

  const bundle = await integrations.hubspot.fetchDealBundle(job.hubspotDealId);
  const mapped = applySubmittedInputs(mapDeal(bundle), job);
  const missing = missingRequiredFields(mapped);
  if (missing.length) {
    throw new PermanentError(`HubSpot deal ${job.hubspotDealId} is missing required fields: ${missing.join(", ")}`);
  }

  const [{ companyKey, jdCount }, companyLogoUrl] = await Promise.all([
    companyJdCount(job, mapped.companyName),
    companyLogoFor(job, mapped),
  ]);
  mapped.jdCount = jdCount;
  mapped.companyLogoUrl = companyLogoUrl;

  await saveSnapshot(job, mapped, bundle.deal.properties, "INITIAL", { company: bundle.company, owner: bundle.owner });
  await Job.updateOne({ _id: job._id }, { $set: { ...pick(mapped), companyKey } });
  await transitionJob(job._id, S.DEAL_FETCHED, { from: S.FETCHING_DEAL });
  await audit({
    action: AUDIT.DEAL_FETCHED,
    entityId: job._id,
    metadata: {
      hubspotDealId: job.hubspotDealId,
      companyName: mapped.companyName ?? null,
      jobRole: mapped.jobRole ?? null,
      fields: Object.keys(bundle.deal.properties ?? {}).length,
      jdCount,
      logo: Boolean(companyLogoUrl),
    },
  });
  await proceed(job, GATE.DEAL_DETAILS, TASK_TYPE.CREATE_JOB);
}

async function createJob({ job }) {
  if (isPast(job, S.JOB_CREATING)) return enqueueNext(job, TASK_TYPE.IDENTIFY_ELIGIBLE);
  if (await waitForApproval(job, GATE.DEAL_DETAILS)) return;
  await transitionJob(job._id, S.JOB_CREATING, { from: [S.DEAL_FETCHED, S.JOB_CREATING] });

  const snapshot = await requireSnapshot(job);
  const portal = integrations.learningPortal;
  const save = (set) => Job.findByIdAndUpdate(job._id, { $set: set }, { returnDocument: "after" });

  let current = await Job.findById(job._id);
  if (!current.learningPortalOrgId) {
    const organisation = await prepareOrganisation(current);
    current = await save({
      learningPortalOrgId: organisation.organisationId,
      companyLogoUrl: current.companyLogoUrl ?? (usableLogo(organisation.logoUrl) ? organisation.logoUrl : null),
    });
  }
  if (!current.learningPortalJobId) {
    current = await save({ learningPortalJobId: portal.newId() });
  }

  if (!current.learningPortalPayload) {
    const { timing } = await getSettings();
    const deadline = hoursFromNow(timing.applicationWindowHours, now());
    const payload = await buildPortalPayload(current, snapshot.rawProperties, { deadline, order: await nextOrderNumber() });
    current = await save({
      learningPortalPayload: payload,
      learningPortalDeadline: deadline,
      jobType: payload.job_details.job_type,
      enrollPlans: payload.job_details.enroll_plans ?? [],
    });
  }

  for (const env of portal.targets) {
    if (isLoadedInto(current, env)) continue;
    if (await waitForApproval(current, loadGateFor(env))) return;
    current = await loadInto(job._id, env);
  }
  const learningPortalJobUrl = jobUrlFor(current);
  await save({ learningPortalJobUrl });
  await JobHubspotMapping.updateOne({ jobId: job._id }, { $set: { learningPortalJobId: current.learningPortalJobId } });
  await transitionJob(job._id, S.JOB_CREATED, { from: S.JOB_CREATING });
  await audit({
    action: AUDIT.JOB_CREATED,
    entityId: job._id,
    metadata: {
      learningPortalJobId: current.learningPortalJobId,
      organisationId: current.learningPortalOrgId,
      environments: portal.targets.join(","),
    },
  });
  await Promise.all([
    enqueueNext(job, TASK_TYPE.HUBSPOT_WRITE_BACK),
    enqueueNext(job, TASK_TYPE.IDENTIFY_ELIGIBLE),
  ]);
}

async function identifyEligible({ job, heartbeat }) {
  if (isPast(job, S.ELIGIBILITY_PROCESSING)) return proceed(job, GATE.ELIGIBLE_STUDENTS, TASK_TYPE.GRANT_ACCESS);
  await transitionJob(job._id, S.ELIGIBILITY_PROCESSING, { from: [S.JOB_CREATED, S.ELIGIBILITY_PROCESSING] });

  const snapshot = await requireSnapshot(job);
  const current = await Job.findById(job._id).lean();
  const students = await findEligibleStudents(current, snapshot.rawProperties);
  if (!students.length) {
    throw new PermanentError("No eligible students were found for this deal's eligibility criteria");
  }

  for (const batch of chunk(students, 1000)) {
    await JobEligibleStudent.bulkWrite(
      batch.map((student) => ({
        updateOne: {
          filter: { jobId: job._id, studentId: student.studentId },
          update: {
            $set: {
              studentName: student.studentName ?? "",
              email: student.email ?? null,
              mobile: student.mobile ?? null,
              campus: student.campus ?? null,
              batch: student.batch ?? null,
              product: student.product ?? null,
              learningPortalJobId: current.learningPortalJobId ?? null,
            },
            $setOnInsert: { eligibleAt: now() },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await heartbeat();
  }

  const eligibleCount = await JobEligibleStudent.countDocuments({ jobId: job._id });
  await transitionJob(job._id, S.ELIGIBLE_STUDENTS_IDENTIFIED, {
    from: S.ELIGIBILITY_PROCESSING,
    set: { eligibleCount },
  });
  await audit({
    action: AUDIT.ELIGIBLE_IDENTIFIED,
    entityId: job._id,
    metadata: { eligibleCount, products: productGroupsForPlans(current.enrollPlans ?? []).join(",") },
  });
  await proceed(job, GATE.ELIGIBLE_STUDENTS, TASK_TYPE.GRANT_ACCESS);
}

async function grantAccess({ job, heartbeat }) {
  if (isPast(job, S.GRANTING_ACCESS)) return proceed(job, GATE.START_WINDOW, TASK_TYPE.SEND_INITIAL_NOTIFICATIONS);
  if (await waitForApproval(job, GATE.ELIGIBLE_STUDENTS)) return;
  await transitionJob(job._id, S.GRANTING_ACCESS, { from: [S.ELIGIBLE_STUDENTS_IDENTIFIED, S.GRANTING_ACCESS] });
  const current = await Job.findById(job._id).lean();

  const pending = await JobEligibleStudent.find(
    { jobId: job._id, accessGrantedAt: null, accessRejectedReason: null },
    { studentId: 1 },
  ).lean();

  let granted = 0;
  let rejected = 0;
  for (const batch of chunk(pending.map((row) => row.studentId), 1000)) {
    const result = await integrations.learningPortal.grantAccess(
      config.learningPortal.accessEnv,
      current.learningPortalJobId,
      batch,
    );
    if (result.granted.length) {
      await JobEligibleStudent.updateMany(
        { jobId: job._id, studentId: { $in: result.granted } },
        { $set: { accessGrantedAt: now() } },
      );
    }
    for (const { studentId, reason } of result.rejected) {
      await JobEligibleStudent.updateOne({ jobId: job._id, studentId }, { $set: { accessRejectedReason: reason } });
    }
    granted += result.granted.length;
    rejected += result.rejected.length;
    await heartbeat();
  }

  const totalGranted = await JobEligibleStudent.countDocuments({ jobId: job._id, accessGrantedAt: { $ne: null } });
  if (!totalGranted) throw new PermanentError("The Learning Portal did not grant access to any eligible student");
  await audit({ action: AUDIT.ACCESS_GRANTED, entityId: job._id, metadata: { granted, rejected, totalGranted } });
  await proceed(job, GATE.START_WINDOW, TASK_TYPE.SEND_INITIAL_NOTIFICATIONS);
}

export async function scheduleWindowTasks(job) {
  const start = job.applicationStartAt;
  const { countSyncMinutes } = config.workflow;
  const { reminderOneHours, reminderTwoHours } = (await getSettings()).timing;
  await Promise.all([
    enqueueNext(job, TASK_TYPE.REMINDER_10H, { scheduledFor: hoursFromNow(reminderOneHours, start) }),
    enqueueNext(job, TASK_TYPE.REMINDER_20H, { scheduledFor: hoursFromNow(reminderTwoHours, start) }),
    enqueueNext(job, TASK_TYPE.APPLICATION_CLOSE_21H, { scheduledFor: job.applicationEndAt }),
    enqueueTask({
      jobId: job._id,
      type: TASK_TYPE.APPLICATION_COUNT_SYNC,
      scheduledFor: new Date(start.getTime() + countSyncMinutes * 60 * 1000),
      payload: { index: 1 },
      dedupeKey: `${job._id}:APPLICATION_COUNT_SYNC:1`,
    }),
  ]);
}

async function sendInitialNotifications({ job, heartbeat }) {
  if (isPast(job, S.INITIAL_NOTIFICATION_SENDING)) return;
  if (await waitForApproval(job, GATE.START_WINDOW)) return;
  await transitionJob(job._id, S.INITIAL_NOTIFICATION_SENDING, {
    from: [S.GRANTING_ACCESS, S.INITIAL_NOTIFICATION_SENDING],
  });

  const loaded = await Job.findById(job._id).lean();
  const start = loaded.applicationStartAt ?? now();
  const end =
    loaded.learningPortalDeadline ?? hoursFromNow((await getSettings()).timing.applicationWindowHours, start);
  if (end <= now()) {
    throw new PermanentError(
      `The job closes on the Learning Portal at ${formatDateTime(end)} IST, which has already passed, so the application window cannot open.`,
    );
  }
  const current = await Job.findByIdAndUpdate(
    job._id,
    { $set: { applicationStartAt: start, applicationEndAt: end } },
    { returnDocument: "after" },
  );

  await scheduleWindowTasks(current);

  const type = NOTIFICATION_TYPE.INITIAL_JOB_EMAIL;
  const totals = { SENT: 0, SKIPPED: 0, FAILED: 0, RETRYING: 0, DUPLICATE: 0, OFF: 0 };
  const cursor = JobEligibleStudent.find({ jobId: job._id, accessGrantedAt: { $ne: null } }).lean().cursor();
  let batch = [];
  const flush = async () => {
    const counts = await sendBulk({
      job: current,
      type,
      recipients: batch,
      keyFor: (student) => notificationKey(job._id, type, student.studentId),
      onSent: (student) =>
        JobEligibleStudent.updateOne({ _id: student._id }, { $set: { initialEmailSentAt: now() } }),
    });
    for (const [key, value] of Object.entries(counts)) totals[key] += value;
    batch = [];
    await heartbeat();
  };
  for await (const student of cursor) {
    batch.push(student);
    if (batch.length >= 500) await flush();
  }
  if (batch.length) await flush();

  await audit({ action: AUDIT.INITIAL_EMAIL_SENT, entityId: job._id, metadata: totals });
  await transitionJob(job._id, S.APPLICATIONS_OPEN, { from: S.INITIAL_NOTIFICATION_SENDING });
  const opened = await Job.findById(job._id, { applicationEndAt: 1 }).lean();
  await audit({
    action: AUDIT.APPLICATIONS_OPENED,
    entityId: job._id,
    metadata: { closesAt: opened?.applicationEndAt ? new Date(opened.applicationEndAt).toISOString() : null },
  });
}

export const dealProcessingHandlers = {
  [TASK_TYPE.FETCH_DEAL]: { run: fetchDeal },
  [TASK_TYPE.CREATE_JOB]: { run: createJob },
  [TASK_TYPE.IDENTIFY_ELIGIBLE]: { run: identifyEligible },
  [TASK_TYPE.GRANT_ACCESS]: { run: grantAccess },
  [TASK_TYPE.SEND_INITIAL_NOTIFICATIONS]: { run: sendInitialNotifications },
};
