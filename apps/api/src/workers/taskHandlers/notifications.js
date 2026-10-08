import { JOB_STATUS as S, NOTIFICATION_TYPE, TASK_TYPE } from "../../config/statuses.js";
import { Job, NotificationLog, User } from "../../models/index.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { transitionJob } from "../../services/jobService.js";
import { notificationKey, sendEmail } from "../../services/notificationService.js";
import { publicLinkUrlForJob } from "../../services/publicLinkService.js";
import { getSettings, TURNED_OFF, turnedOff } from "../../services/settingsService.js";
import { now } from "../../utils/clock.js";
import { PermanentError } from "../../utils/errors.js";

async function crmNotification({ job }) {
  if ([S.CRM_NOTIFICATION_SENT, S.COMPLETED].includes(job.status)) return;
  if (job.status !== S.PUBLIC_LINK_GENERATED) return;
  if (!(await getSettings()).crmEmails.candidatePool) {
    await Job.updateOne({ _id: job._id }, { $set: { "crmShare.error": turnedOff("The candidate pool email to the CRM") } });
    await audit({ action: AUDIT.CRM_NOTIFICATION_SKIPPED, entityId: job._id, metadata: { reason: TURNED_OFF } });
    await transitionJob(job._id, S.COMPLETED, { from: S.PUBLIC_LINK_GENERATED });
    return;
  }
  const recipient = job.submittedBy || job.crmOwnerEmail;
  if (!recipient) throw new PermanentError("The deal has no CRM email to notify");
  const crmUser = await User.findOne({ email: recipient }).lean();

  const publicLink = await publicLinkUrlForJob(job);
  if (!publicLink) throw new PermanentError("No active public link exists for this job");

  const type = NOTIFICATION_TYPE.CRM_POOL_READY;
  const idempotencyKey = notificationKey(job._id, type, recipient);
  const outcome = await sendEmail({
    job,
    type,
    recipient: { email: recipient, studentName: crmUser?.name || job.crmOwnerName || recipient.split("@")[0] },
    idempotencyKey,
    payload: { publicLink, psmEmail: job.reviewedBy },
    scheduleRetry: false,
  });
  if (outcome === "DUPLICATE") {
    const log = await NotificationLog.findOne({ idempotencyKey }).lean();
    if (log?.status !== "SENT") throw new PermanentError(`CRM email is ${log?.status ?? "missing"}: ${log?.error ?? ""}`);
  } else if (outcome !== "SENT") {
    throw new PermanentError(`CRM email could not be sent (${outcome})`);
  }

  await Job.updateOne({ _id: job._id }, { $set: { "crmShare.status": "SHARED", "crmShare.sentAt": now(), "crmShare.error": null } });
  await transitionJob(job._id, S.CRM_NOTIFICATION_SENT, { from: S.PUBLIC_LINK_GENERATED });
  await audit({ action: AUDIT.CRM_NOTIFIED, entityId: job._id, metadata: { to: recipient } });
  await transitionJob(job._id, S.COMPLETED, { from: S.CRM_NOTIFICATION_SENT });
}

async function poolTargetEmail({ job }) {
  if (!job.poolTargetReached || !job.submittedBy) return;
  const creator = await User.findOne({ email: job.submittedBy }).lean();
  const type = NOTIFICATION_TYPE.POOL_TARGET_REACHED;
  const outcome = await sendEmail({
    job,
    type,
    recipient: { email: job.submittedBy, studentName: creator?.name || job.submittedBy.split("@")[0] },
    idempotencyKey: notificationKey(job._id, type, job.submittedBy),
    payload: { appliedCount: job.appliedCount, expectedPoolCount: job.expectedPoolCount },
    scheduleRetry: false,
  });
  if (outcome === "SENT") {
    await audit({
      action: AUDIT.POOL_TARGET_EMAILED,
      entityId: job._id,
      metadata: { to: job.submittedBy, appliedCount: job.appliedCount, expectedPoolCount: job.expectedPoolCount },
    });
  }
}

async function crmNotificationFailed({ job, error }) {
  await Job.updateOne({ _id: job._id }, { $set: { "crmShare.status": "FAILED", "crmShare.error": String(error?.message ?? error) } });
}

async function retryNotification({ task, job }) {
  const log = await NotificationLog.findById(task.payload?.notificationLogId).lean();
  if (!log || log.status !== "RETRYING") return;
  await sendEmail({
    job,
    type: log.type,
    recipient: task.payload.recipient ?? { email: log.email, studentId: log.studentId },
    idempotencyKey: log.idempotencyKey,
    payload: log.payload,
    fromRetry: true,
  });
}

export const notificationHandlers = {
  [TASK_TYPE.CRM_NOTIFICATION]: { run: crmNotification, onPermanentFailure: crmNotificationFailed },
  [TASK_TYPE.RETRY_NOTIFICATION]: { run: retryNotification },
  [TASK_TYPE.POOL_TARGET_EMAIL]: { run: poolTargetEmail },
};
