import { config } from "../config/env.js";
import { NOTIFICATION_TYPE, TASK_TYPE } from "../config/statuses.js";
import { NotificationLog } from "../models/index.js";
import {
  crmPoolReadyEmail,
  initialJobEmail,
  jobUpdatedEmail,
  poolTargetReachedEmail,
  reminderEmail,
} from "../templates/email/index.js";
import { now } from "../utils/clock.js";
import { isDuplicateKeyError, isRetryable } from "../utils/errors.js";
import { backoffDelayMs, mapLimit } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { integrations } from "./integrations.js";
import { emailAllowed } from "./settingsService.js";
import { enqueueTask } from "./taskQueue.js";

const T = NOTIFICATION_TYPE;

function render(type, job, recipient, payload) {
  switch (type) {
    case T.INITIAL_JOB_EMAIL:
      return initialJobEmail(job, recipient);
    case T.REMINDER_10H:
    case T.REMINDER_20H:
      return reminderEmail(job, recipient, type);
    case T.JOB_UPDATED:
      return jobUpdatedEmail(job, recipient, payload.changes ?? [], payload.formUrl);
    case T.CRM_POOL_READY:
      return crmPoolReadyEmail(job, payload, recipient);
    case T.POOL_TARGET_REACHED:
      return poolTargetReachedEmail(job, recipient);
    case T.BOOST_REMINDER:
      return reminderEmail(job, recipient, type);
    default:
      throw new Error(`Unknown notification type ${type}`);
  }
}

export async function sendEmail({
  job,
  type,
  recipient,
  idempotencyKey,
  payload = {},
  fromRetry = false,
  scheduleRetry = true,
}) {
  if (!(await emailAllowed(type, fromRetry ? idempotencyKey : null))) return "OFF";
  const email = recipient.email?.trim().toLowerCase();
  let log;
  try {
    log = await NotificationLog.create({
      jobId: job._id,
      studentId: recipient.studentId ?? null,
      email: email || "missing",
      type,
      idempotencyKey,
      payload,
      status: email ? "PENDING" : "SKIPPED",
      error: email ? null : "No email address",
    });
    if (!email) return "SKIPPED";
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    log = await NotificationLog.findOne({ idempotencyKey });
    const resumable = log.status === "PENDING" || (fromRetry && log.status === "RETRYING");
    if (!resumable) return "DUPLICATE";
  }

  const message = render(type, job, recipient, log.payload ?? payload);
  try {
    const { messageId } = await integrations.ses.send({ to: log.email, ...message });
    await NotificationLog.updateOne(
      { _id: log._id },
      { $set: { status: "SENT", providerMessageId: messageId, sentAt: now(), error: null }, $inc: { attemptCount: 1 } },
    );
    return "SENT";
  } catch (error) {
    const attemptCount = (log.attemptCount ?? 0) + 1;
    if (!scheduleRetry) {
      const transient = isRetryable(error);
      await NotificationLog.updateOne(
        { _id: log._id },
        { $set: { status: transient ? "PENDING" : "FAILED", error: error.message?.slice(0, 500) }, $inc: { attemptCount: 1 } },
      );
      throw error;
    }
    const retry = isRetryable(error) && attemptCount < config.workflow.maxAttempts;
    await NotificationLog.updateOne(
      { _id: log._id },
      { $set: { status: retry ? "RETRYING" : "FAILED", error: error.message?.slice(0, 500) }, $inc: { attemptCount: 1 } },
    );
    if (retry) {
      await enqueueTask({
        jobId: job._id,
        type: TASK_TYPE.RETRY_NOTIFICATION,
        scheduledFor: new Date(now().getTime() + (error.retryAfterMs ?? backoffDelayMs(attemptCount))),
        payload: { notificationLogId: String(log._id), recipient: { ...recipient, email: log.email } },
        dedupeKey: `notification-retry:${log._id}:${attemptCount}`,
      });
      return "RETRYING";
    }
    logger.warn({ err: error, email: log.email, type }, "Email permanently failed");
    return "FAILED";
  }
}

export async function sendBulk({ job, type, recipients, keyFor, payload = {}, onSent }) {
  const counts = { SENT: 0, SKIPPED: 0, FAILED: 0, RETRYING: 0, DUPLICATE: 0, OFF: 0 };
  if (!(await emailAllowed(type))) {
    counts.OFF = recipients.length;
    return counts;
  }
  const results = await mapLimit(recipients, 10, async (recipient) => {
    const outcome = await sendEmail({ job, type, recipient, idempotencyKey: keyFor(recipient), payload });
    if (outcome === "SENT" && onSent) await onSent(recipient);
    return outcome;
  });
  for (const result of results) {
    if (result.status === "fulfilled") counts[result.value] += 1;
    else {
      counts.FAILED += 1;
      logger.error({ err: result.reason, type }, "Notification send crashed");
    }
  }
  return counts;
}

export const notificationKey = (jobId, type, recipientKey, suffix) =>
  [String(jobId), type, suffix, recipientKey].filter((part) => part !== undefined && part !== null).join(":");
