import { JOB_STATUS as S, NOTIFICATION_TYPE, TASK_TYPE, statusRank } from "../../config/statuses.js";
import { Job, JobChangeHistory, JobEligibleStudent } from "../../models/index.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { applySubmittedInputs, diffTrackedFields, fullHash, mapDeal } from "../../services/dealMapper.js";
import { latestSnapshot, saveSnapshot } from "../../services/dealSnapshotService.js";
import { integrations } from "../../services/integrations.js";
import { buildPortalPayload, resendToTargets } from "../../services/learningPortal/portalLoader.js";
import { notificationKey, sendBulk } from "../../services/notificationService.js";
import { now } from "../../utils/clock.js";
import { pick } from "./dealProcessing.js";

async function sendPendingUpdate(job) {
  const { version, changes } = job.pendingUpdate;
  const type = NOTIFICATION_TYPE.JOB_UPDATED;
  const recipients = await JobEligibleStudent.find({ jobId: job._id, accessGrantedAt: { $ne: null } }).lean();
  const counts = await sendBulk({
    job,
    type,
    recipients,
    payload: { changes },
    keyFor: (student) => notificationKey(job._id, type, student.studentId, `v${version}`),
  });
  const notified = counts.SENT + counts.DUPLICATE;
  await JobChangeHistory.updateMany(
    { jobId: job._id, jobVersion: version },
    { $set: { studentsNotified: true, notificationCount: notified } },
  );
  await Job.updateOne({ _id: job._id, "pendingUpdate.version": version }, { $set: { pendingUpdate: null } });
  return counts;
}

async function hubspotDealUpdate({ job }) {
  if (job.pendingUpdate) await sendPendingUpdate(job);

  const withinWindow =
    job.learningPortalJobId &&
    statusRank(job.status) >= statusRank(S.JOB_CREATED) &&
    statusRank(job.status) < statusRank(S.APPLICATIONS_CLOSED);
  if (!withinWindow) {
    await audit({
      action: AUDIT.HUBSPOT_UPDATE_RECEIVED,
      entityId: job._id,
      metadata: { ignored: true, reason: `Job status ${job.status} is outside the application window` },
    });
    return;
  }

  const bundle = await integrations.hubspot.fetchDealBundle(job.hubspotDealId);
  const mapped = applySubmittedInputs(mapDeal(bundle), job);
  const previous = await latestSnapshot(job._id);
  if (previous && previous.payloadHash === fullHash(mapped)) return;

  const changes = diffTrackedFields(previous?.mappedFields ?? {}, mapped);
  const fields = pick(mapped);
  delete fields.expectedPoolCount;
  if (job.learningPortalPayload) {
    delete fields.enrollPlans;
    delete fields.jobType;
  }
  if (!fields.crmOwnerEmail) delete fields.crmOwnerEmail;

  if (!changes.length) {
    await saveSnapshot(job, mapped, bundle.deal.properties, "WEBHOOK");
    await Job.updateOne({ _id: job._id }, { $set: fields });
    await audit({ action: AUDIT.HUBSPOT_UPDATE_APPLIED, entityId: job._id, metadata: { studentFacing: false } });
    return;
  }

  const version = (job.version ?? 1) + 1;
  const updatedJob = { ...job.toObject(), ...fields };
  const portalPayload = await buildPortalPayload(updatedJob, bundle.deal.properties, {
    deadline: job.applicationEndAt ?? job.learningPortalDeadline,
    order: job.learningPortalPayload?.job_details?.order,
  });
  await resendToTargets(updatedJob, portalPayload);

  await saveSnapshot(job, mapped, bundle.deal.properties, "WEBHOOK");
  const changedAt = now();
  await JobChangeHistory.insertMany(
    changes.map((change) => ({
      jobId: job._id,
      hubspotDealId: job.hubspotDealId,
      jobVersion: version,
      field: change.field,
      oldValue: change.oldValue,
      newValue: change.newValue,
      changedAt,
    })),
  );
  const saved = await Job.findByIdAndUpdate(
    job._id,
    { $set: { ...fields, version, pendingUpdate: { version, changes }, learningPortalPayload: portalPayload } },
    { returnDocument: "after" },
  );
  const counts = await sendPendingUpdate(saved);
  await audit({
    action: AUDIT.HUBSPOT_UPDATE_APPLIED,
    entityId: job._id,
    metadata: { studentFacing: true, version, fields: changes.map((change) => change.field), ...counts },
  });
}

export const hubspotUpdateHandlers = {
  [TASK_TYPE.HUBSPOT_DEAL_UPDATE]: { run: hubspotDealUpdate },
};
