import { config } from "../../config/env.js";
import { JOB_STATUS as S, NOTIFICATION_TYPE, TASK_TYPE, WINDOW_STATUSES } from "../../config/statuses.js";
import { AiCallLog, Job, JobEligibleStudent } from "../../models/index.js";
import { triggerReminderCalls } from "../../services/aiCallService.js";
import { recordAppliedCount, syncApplicants } from "../../services/applicationService.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { integrations } from "../../services/integrations.js";
import { transitionJob } from "../../services/jobService.js";
import { notificationKey, sendBulk } from "../../services/notificationService.js";
import { enqueueTask } from "../../services/taskQueue.js";
import { now } from "../../utils/clock.js";
import { logger } from "../../utils/logger.js";
import { enqueueNext } from "./shared.js";

async function applicationCountSync({ task, job }) {
  if (!WINDOW_STATUSES.includes(job.status)) return;
  try {
    const count = await integrations.bigquery.getApplicationCount(job.learningPortalJobId);
    await recordAppliedCount(job, count);
  } catch (error) {
    logger.warn({ err: error, jobId: String(job._id) }, "Application count sync failed");
  }
  const index = (task.payload?.index ?? 1) + 1;
  const next = new Date(now().getTime() + config.workflow.countSyncMinutes * 60 * 1000);
  if (job.applicationEndAt && next < job.applicationEndAt) {
    await enqueueTask({
      jobId: job._id,
      type: TASK_TYPE.APPLICATION_COUNT_SYNC,
      scheduledFor: next,
      payload: { index },
      dedupeKey: `${job._id}:APPLICATION_COUNT_SYNC:${index}`,
    });
  }
}

const REMINDERS = {
  [TASK_TYPE.REMINDER_10H]: {
    key: "r10h",
    processing: S.REMINDER_10H_PROCESSING,
    sent: S.REMINDER_10H_SENT,
    notification: NOTIFICATION_TYPE.REMINDER_10H,
  },
  [TASK_TYPE.REMINDER_20H]: {
    key: "r20h",
    processing: S.REMINDER_20H_PROCESSING,
    sent: S.REMINDER_20H_SENT,
    notification: NOTIFICATION_TYPE.REMINDER_20H,
  },
};

async function recordReminder(jobId, key, info) {
  await Job.updateOne({ _id: jobId }, { $set: { [`reminders.${key}`]: { at: now(), ...info } } });
}

function reminderHandler(type) {
  const spec = REMINDERS[type];
  return async ({ job }) => {
    if (job.reminders?.[spec.key]?.status) return;
    if (!WINDOW_STATUSES.includes(job.status)) {
      await recordReminder(job._id, spec.key, { status: "SKIPPED", reason: "Job is not in its application window" });
      return;
    }

    const { job: synced } = await syncApplicants(job);
    if (synced.poolTargetReached) {
      await recordReminder(job._id, spec.key, {
        status: "SKIPPED",
        reason: `Expected pool reached (${synced.appliedCount}/${synced.expectedPoolCount})`,
      });
      await audit({ action: AUDIT.REMINDER_SKIPPED, entityId: job._id, metadata: { reminder: type, appliedCount: synced.appliedCount } });
      return;
    }

    await transitionJob(job._id, spec.processing, { from: WINDOW_STATUSES });
    const nonApplicants = await JobEligibleStudent.find({
      jobId: job._id,
      applied: false,
      accessGrantedAt: { $ne: null },
    }).lean();

    const emailCounts = await sendBulk({
      job: synced,
      type: spec.notification,
      recipients: nonApplicants,
      keyFor: (student) => notificationKey(job._id, spec.notification, student.studentId),
    });
    const calls = await triggerReminderCalls({ job: synced, students: nonApplicants, reminderType: type });

    await recordReminder(job._id, spec.key, {
      status: "SENT",
      emailCount: emailCounts.SENT,
      callCount: calls.queued,
      reason: `${nonApplicants.length} non-applicants; ${calls.skipped} without a valid phone; ${calls.deferred} calls deferred`,
    });
    await audit({ action: AUDIT.REMINDER_EMAILS_SENT, entityId: job._id, metadata: { reminder: type, ...emailCounts } });
    await audit({ action: AUDIT.AI_CALLS_TRIGGERED, entityId: job._id, metadata: { reminder: type, ...calls } });
    await transitionJob(job._id, spec.sent, { from: spec.processing });
  };
}

function reminderFailure(type) {
  const spec = REMINDERS[type];
  return async ({ job, error }) => {
    await recordReminder(job._id, spec.key, { status: "FAILED", reason: String(error?.message ?? error).slice(0, 300) });
    await transitionJob(job._id, S.APPLICATIONS_OPEN, { from: spec.processing, note: "Reminder failed" });
  };
}

async function retryAiCalls({ task, job }) {
  if (!WINDOW_STATUSES.includes(job.status)) return;
  const { reminderType, studentIds = [] } = task.payload ?? {};
  const students = await JobEligibleStudent.find({ jobId: job._id, studentId: { $in: studentIds } }).lean();
  const applied = students.filter((student) => student.applied).map((student) => student.studentId);
  if (applied.length) {
    await AiCallLog.updateMany(
      { jobId: job._id, reminderType, studentId: { $in: applied }, status: { $in: ["RATE_LIMITED", "RETRYING"] } },
      { $set: { status: "SKIPPED", error: "Student applied before the retry" } },
    );
  }
  await triggerReminderCalls({
    job,
    students: students.filter((student) => !student.applied),
    reminderType,
    retry: true,
  });
}

async function applicationClose({ job }) {
  if (!WINDOW_STATUSES.includes(job.status)) {
    if (job.status === S.APPLICATIONS_CLOSED) await enqueueNext(job, TASK_TYPE.FETCH_FINAL_POOL, { maxAttempts: 10 });
    return;
  }
  await transitionJob(job._id, S.APPLICATIONS_CLOSED, { from: WINDOW_STATUSES });
  await audit({ action: AUDIT.APPLICATIONS_CLOSED, entityId: job._id, metadata: { appliedCount: job.appliedCount } });
  await enqueueNext(job, TASK_TYPE.FETCH_FINAL_POOL, { maxAttempts: 10 });
}

export const applicationWindowHandlers = {
  [TASK_TYPE.APPLICATION_COUNT_SYNC]: { run: applicationCountSync },
  [TASK_TYPE.REMINDER_10H]: { run: reminderHandler(TASK_TYPE.REMINDER_10H), onPermanentFailure: reminderFailure(TASK_TYPE.REMINDER_10H) },
  [TASK_TYPE.REMINDER_20H]: { run: reminderHandler(TASK_TYPE.REMINDER_20H), onPermanentFailure: reminderFailure(TASK_TYPE.REMINDER_20H) },
  [TASK_TYPE.RETRY_AI_CALLS]: { run: retryAiCalls },
  [TASK_TYPE.APPLICATION_CLOSE_21H]: { run: applicationClose },
};
