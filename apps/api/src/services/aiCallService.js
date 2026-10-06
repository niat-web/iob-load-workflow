import { config } from "../config/env.js";
import { TASK_TYPE } from "../config/statuses.js";
import { AiCallLog, ApiUsage } from "../models/index.js";
import { now } from "../utils/clock.js";
import { isRetryable } from "../utils/errors.js";
import { backoffDelayMs, chunk, formatDateTime, normalizePhone } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { integrations } from "./integrations.js";
import { enqueueTask } from "./taskQueue.js";

const dayKey = () => now().toISOString().slice(0, 10);

async function reserveRequest() {
  const usage = await ApiUsage.findOneAndUpdate(
    { provider: "nxtdial", day: dayKey() },
    { $inc: { count: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  if (usage.count > config.nxtdial.dailyRequestLimit) {
    await ApiUsage.updateOne({ _id: usage._id }, { $inc: { count: -1 } });
    return false;
  }
  return true;
}

async function setStatus(ids, set, inc = true) {
  if (!ids.length) return;
  await AiCallLog.updateMany({ _id: { $in: ids } }, { $set: set, ...(inc ? { $inc: { attemptCount: 1 } } : {}) });
}

export async function triggerReminderCalls({ job, students, reminderType, retry = false }) {
  const summary = { queued: 0, skipped: 0, failed: 0, deferred: 0 };

  if (!retry) {
    const rows = students.map((student) => {
      const phone = normalizePhone(student.mobile);
      return {
        jobId: job._id,
        studentId: student.studentId,
        name: student.studentName ?? "",
        phone: phone ?? String(student.mobile ?? "missing"),
        reminderType,
        status: phone ? "PENDING" : "SKIPPED",
        error: phone ? null : "Missing or invalid phone number",
      };
    });
    if (rows.length) {
      await AiCallLog.insertMany(rows, { ordered: false }).catch((error) => {
        if (error?.code !== 11000 && !error?.writeErrors?.every?.((writeError) => writeError.code === 11000)) throw error;
      });
    }
  }

  const statuses = retry ? ["RATE_LIMITED", "RETRYING"] : ["PENDING"];
  const logs = await AiCallLog.find({
    jobId: job._id,
    reminderType,
    studentId: { $in: students.map((student) => student.studentId) },
    status: { $in: statuses },
  }).lean();
  summary.skipped = retry ? 0 : await AiCallLog.countDocuments({ jobId: job._id, reminderType, status: "SKIPPED" });

  const variables = {
    company: job.companyName,
    role: job.jobRole,
    deadline: job.applicationEndAt ? `${formatDateTime(job.applicationEndAt)} IST` : "",
  };

  const batches = chunk(logs, config.nxtdial.chunkSize);
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index];
    const ids = batch.map((log) => log._id);

    if (!(await reserveRequest())) {
      const remaining = batches.slice(index).flat().map((log) => log._id);
      await setStatus(remaining, { status: "SKIPPED", error: "Daily NxtDial request limit reached" }, false);
      summary.skipped += remaining.length;
      logger.warn({ jobId: String(job._id) }, "NxtDial daily request limit reached; remaining calls skipped");
      break;
    }

    try {
      const { callIds } = await integrations.nxtdial.alert({
        phones: batch.map((log) => ({ name: log.name, phone: log.phone })),
        variables,
      });
      await Promise.all(
        batch.map((log) =>
          AiCallLog.updateOne(
            { _id: log._id },
            { $set: { status: "QUEUED", nxtDialCallId: callIds.get(log.phone) ?? null, error: null }, $inc: { attemptCount: 1 } },
          ),
        ),
      );
      summary.queued += batch.length;
    } catch (error) {
      const attempt = Math.max(...batch.map((log) => log.attemptCount ?? 0)) + 1;
      if (error.status === 429) {
        const remaining = batches.slice(index).flat();
        await setStatus(remaining.map((log) => log._id), { status: "RATE_LIMITED", error: error.message });
        await scheduleRetry(job, reminderType, remaining, error.retryAfterMs, attempt);
        summary.deferred += remaining.length;
        break;
      }
      if (isRetryable(error) && attempt < config.workflow.maxAttempts) {
        await setStatus(ids, { status: "RETRYING", error: error.message });
        await scheduleRetry(job, reminderType, batch, backoffDelayMs(attempt), attempt);
        summary.deferred += batch.length;
        continue;
      }
      const remaining = batches.slice(index).flat().map((log) => log._id);
      await setStatus(remaining, { status: "FAILED", error: error.message });
      summary.failed += remaining.length;
      logger.error({ err: error, jobId: String(job._id) }, "NxtDial calls failed permanently");
      break;
    }
  }
  return summary;
}

async function scheduleRetry(job, reminderType, logs, delayMs, attempt) {
  const studentIds = logs.map((log) => log.studentId);
  await enqueueTask({
    jobId: job._id,
    type: TASK_TYPE.RETRY_AI_CALLS,
    scheduledFor: new Date(now().getTime() + (delayMs ?? 60_000)),
    payload: { reminderType, studentIds },
    dedupeKey: `ai-call-retry:${job._id}:${reminderType}:${attempt}:${studentIds[0]}`,
  });
}
