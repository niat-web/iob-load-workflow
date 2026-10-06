import { config } from "../config/env.js";
import { WorkflowTask } from "../models/index.js";
import { now } from "../utils/clock.js";
import { backoffDelayMs } from "../utils/helpers.js";
import { isDuplicateKeyError, isRetryable } from "../utils/errors.js";

export async function enqueueTask({
  jobId,
  type,
  scheduledFor = now(),
  payload = {},
  dedupeKey,
  maxAttempts = config.workflow.maxAttempts,
  releaseDedupeOnStart = false,
}) {
  try {
    return await WorkflowTask.create({
      jobId,
      type,
      scheduledFor,
      payload,
      dedupeKey,
      maxAttempts,
      releaseDedupeOnStart,
    });
  } catch (error) {
    if (dedupeKey && isDuplicateKeyError(error)) return WorkflowTask.findOne({ dedupeKey });
    throw error;
  }
}

export async function claimNextTask(workerId) {
  const current = now();
  const staleBefore = new Date(current.getTime() - config.workflow.lockTimeoutMs);
  const task = await WorkflowTask.findOneAndUpdate(
    {
      $or: [
        { status: "PENDING", scheduledFor: { $lte: current } },
        { status: "PROCESSING", lockedAt: { $lt: staleBefore } },
      ],
    },
    {
      $set: { status: "PROCESSING", lockedAt: current, lockedBy: workerId, startedAt: current },
      $inc: { attempts: 1 },
    },
    { sort: { scheduledFor: 1 }, returnDocument: "after" },
  );
  if (task?.releaseDedupeOnStart && task.dedupeKey) {
    await WorkflowTask.updateOne({ _id: task._id }, { $unset: { dedupeKey: 1 } });
    task.dedupeKey = undefined;
  }
  return task;
}

export async function heartbeatTask(task, workerId) {
  await WorkflowTask.updateOne({ _id: task._id, lockedBy: workerId }, { $set: { lockedAt: now() } });
}

export async function completeTask(task, workerId) {
  await WorkflowTask.updateOne(
    { _id: task._id, lockedBy: workerId },
    { $set: { status: "COMPLETED", completedAt: now(), lockedAt: null, lockedBy: null, lastError: null } },
  );
}

export async function failTask(task, workerId, error) {
  const message = error?.message ?? String(error);
  const exhausted = task.attempts >= task.maxAttempts;
  if (isRetryable(error) && !exhausted) {
    const delay = error?.retryAfterMs ?? backoffDelayMs(task.attempts);
    await WorkflowTask.updateOne(
      { _id: task._id, lockedBy: workerId },
      {
        $set: {
          status: "PENDING",
          scheduledFor: new Date(now().getTime() + delay),
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      },
    );
    return false;
  }
  await WorkflowTask.updateOne(
    { _id: task._id, lockedBy: workerId },
    { $set: { status: "FAILED", completedAt: now(), lockedAt: null, lockedBy: null, lastError: message } },
  );
  return true;
}

export async function releaseTask(task, workerId) {
  await WorkflowTask.updateOne(
    { _id: task._id, lockedBy: workerId, status: "PROCESSING" },
    { $set: { status: "PENDING", lockedAt: null, lockedBy: null }, $inc: { attempts: -1 } },
  );
}

export async function resetFailedTask(taskId, payloadPatch = {}) {
  const set = { status: "PENDING", attempts: 0, scheduledFor: now(), lockedAt: null, lockedBy: null };
  for (const [key, value] of Object.entries(payloadPatch)) set[`payload.${key}`] = value;
  return WorkflowTask.findOneAndUpdate({ _id: taskId, status: "FAILED" }, { $set: set }, { returnDocument: "after" });
}
