import { config } from "../../config/env.js";
import { JOB_STATUS as S, NOTIFICATION_TYPE, TASK_TYPE, WINDOW_STATUSES } from "../../config/statuses.js";
import { Job } from "../../models/index.js";
import { REMINDER_PRODUCT, reminderAudience } from "../../services/eligibilityService.js";
import { notificationKey, sendBulk } from "../../services/notificationService.js";
import { getSettings } from "../../services/settingsService.js";
import { syncApplicants } from "../../services/applicationService.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { runResultsSyncTask, startAiCalls } from "../../services/boostService.js";
import { dealCheckpoints } from "../../services/dealReminderService.js";
import { transitionJob } from "../../services/jobService.js";
import { enqueueTask } from "../../services/taskQueue.js";
import { now } from "../../utils/clock.js";
import { logger } from "../../utils/logger.js";
import { enqueueNext } from "./shared.js";

async function applicationCountSync({ task, job }) {
  if (!WINDOW_STATUSES.includes(job.status)) return;
  try {
    const previous = job.appliedCount ?? 0;
    const result = await syncApplicants(job);
    const appliedCount = result?.job?.appliedCount ?? previous;
    if (appliedCount !== previous) {
      await audit({ action: AUDIT.APPLIED_POOL_SYNCED, entityId: job._id, metadata: { previous, appliedCount } });
    }
  } catch (error) {
    logger.warn({ err: error, jobId: String(job._id) }, "Applied pool sync failed; it runs again at the next interval");
    await Job.updateOne(
      { _id: job._id },
      { $set: { applicationSyncError: String(error?.message ?? error).slice(0, 300), applicationSyncFailedAt: now() } },
    );
  }
  await enqueueTask({
    jobId: job._id,
    type: TASK_TYPE.HUBSPOT_DEAL_UPDATE,
    dedupeKey: `${job._id}:HUBSPOT_POLL:${task.payload?.index ?? 1}`,
  });
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
    emails: "firstEmails",
    calls: null,
  },
  [TASK_TYPE.REMINDER_20H]: {
    key: "r20h",
    processing: S.REMINDER_20H_PROCESSING,
    sent: S.REMINDER_20H_SENT,
    notification: NOTIFICATION_TYPE.REMINDER_20H,
    emails: "secondEmails",
    calls: "secondCalls",
  },
};

async function recordReminder(jobId, key, info) {
  await Job.updateOne({ _id: jobId }, { $set: { [`reminders.${key}`]: { at: now(), ...info } } });
}

async function checkpointSwitches(job) {
  const [{ checkpoints: admin }, deal] = await Promise.all([getSettings(), dealCheckpoints(job)]);
  return (key) => {
    if (!admin[key]) return "turned off by the admin in Settings";
    if (!deal[key]) return "turned off for this deal";
    return null;
  };
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
    await transitionJob(job._id, spec.processing, { from: WINDOW_STATUSES });
    const blockedBy = await checkpointSwitches(synced);
    const audience = await reminderAudience(synced);
    const academyNote = audience.othersWithAccess ? " (Academy students are not reminded)" : "";
    const parts = [];
    let emailCount = 0;
    let callCount = 0;

    if (!audience.niatWithAccess) {
      parts.push(
        `Skipped: checkpoint reminders${spec.calls ? " and AI calls" : ""} are for NIAT students only, and this deal has no NIAT students with access`,
      );
    } else {
      const emailsBlocked = blockedBy(spec.emails);
      if (emailsBlocked) {
        parts.push(`Reminder emails ${emailsBlocked}`);
      } else {
        const emails = await sendBulk({
          job: synced,
          type: spec.notification,
          recipients: audience.students,
          keyFor: (student) => notificationKey(job._id, spec.notification, student.studentId),
        });
        emailCount = emails.SENT;
        parts.push(
          emails.OFF
            ? "Reminder emails turned off by the admin in Settings"
            : `${emails.SENT} reminder email${emails.SENT === 1 ? "" : "s"} sent to NIAT students who have not applied${academyNote}`,
        );
      }

      if (spec.calls) {
        const callsBlocked = blockedBy(spec.calls);
        if (callsBlocked) {
          parts.push(`AI calls ${callsBlocked}`);
        } else {
          try {
            const run = await startAiCalls(synced, null);
            callCount = run.queued;
            parts.push(`${run.queued} AI call${run.queued === 1 ? "" : "s"} started to NIAT students who have not applied`);
          } catch (error) {
            parts.push(`AI calls not started: ${String(error?.message ?? error).slice(0, 200)}`);
          }
        }
      }
    }

    await recordReminder(job._id, spec.key, {
      status: emailCount > 0 || callCount > 0 ? "SENT" : "SKIPPED",
      emailCount,
      callCount,
      reason: parts.join("; "),
    });
    await audit({
      action: AUDIT.REMINDER_SENT,
      entityId: job._id,
      metadata: { reminder: type, emailCount, callCount, product: REMINDER_PRODUCT },
    });
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

async function callResultsSync({ job }) {
  await runResultsSyncTask(job);
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
  [TASK_TYPE.CALL_RESULTS_SYNC]: { run: callResultsSync },
  [TASK_TYPE.APPLICATION_CLOSE_21H]: { run: applicationClose },
};
