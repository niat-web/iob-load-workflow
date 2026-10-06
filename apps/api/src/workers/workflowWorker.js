import crypto from "node:crypto";
import os from "node:os";
import { config } from "../config/env.js";
import { CRITICAL_TASKS, JOB_STATUS } from "../config/statuses.js";
import { Job, WorkerHeartbeat } from "../models/index.js";
import { AUDIT, audit } from "../services/auditService.js";
import { failJob } from "../services/jobService.js";
import { claimNextTask, completeTask, failTask, heartbeatTask, releaseTask } from "../services/taskQueue.js";
import { now } from "../utils/clock.js";
import { sleep } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { taskHandlers } from "./taskHandlers/index.js";

const LOCK_HEARTBEAT_MS = 60_000;
const WORKER_HEARTBEAT_MS = 30_000;

export async function runTask(task, workerId) {
  const log = logger.child({ taskId: String(task._id), type: task.type, jobId: String(task.jobId), attempt: task.attempts });
  const handler = taskHandlers[task.type];
  const job = task.jobId ? await Job.findById(task.jobId) : null;
  if (job?.status === JOB_STATUS.CANCELLED) {
    log.info("Deal was cancelled; dropping task");
    await completeTask(task, workerId);
    return;
  }
  if (!handler || (task.jobId && !job)) {
    log.warn(handler ? "Job no longer exists; dropping task" : "No handler for task type");
    await completeTask(task, workerId);
    return;
  }

  const lockBeat = setInterval(() => heartbeatTask(task, workerId).catch(() => {}), LOCK_HEARTBEAT_MS);
  lockBeat.unref();
  try {
    log.debug("Task started");
    await handler.run({ task, job, heartbeat: () => heartbeatTask(task, workerId) });
    await completeTask(task, workerId);
    log.debug("Task completed");
  } catch (error) {
    const permanent = await failTask(task, workerId, error);
    log[permanent ? "error" : "warn"]({ err: error, permanent }, permanent ? "Task failed permanently" : "Task failed; retry scheduled");
    if (permanent) {
      if (handler.onPermanentFailure) {
        await handler.onPermanentFailure({ task, job, error }).catch((hookError) => log.error({ err: hookError }, "Failure hook crashed"));
      }
      if (CRITICAL_TASKS.has(task.type) && job) {
        await failJob(job._id, task.type, error);
        await audit({ action: AUDIT.STEP_FAILED, entityId: job._id, metadata: { task: task.type, error: error.message } });
      }
    }
  } finally {
    clearInterval(lockBeat);
  }
}

export function startWorker({ workerId = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}` } = {}) {
  const inFlight = new Map();
  let running = true;
  const startedAt = now();

  const beat = async () => {
    await WorkerHeartbeat.updateOne(
      { workerId },
      { $set: { lastSeenAt: now() }, $setOnInsert: { startedAt } },
      { upsert: true },
    ).catch((error) => logger.warn({ err: error }, "Worker heartbeat failed"));
  };
  beat();
  const heartbeat = setInterval(beat, WORKER_HEARTBEAT_MS);
  heartbeat.unref();

  const loop = (async () => {
    logger.info({ workerId, concurrency: config.workflow.workerConcurrency }, "Workflow worker started");
    while (running) {
      let claimed = false;
      try {
        while (running && inFlight.size < config.workflow.workerConcurrency) {
          const task = await claimNextTask(workerId);
          if (!task) break;
          claimed = true;
          const promise = runTask(task, workerId).finally(() => inFlight.delete(String(task._id)));
          inFlight.set(String(task._id), { task, promise });
        }
      } catch (error) {
        logger.error({ err: error }, "Worker could not claim tasks");
      }
      if (inFlight.size >= config.workflow.workerConcurrency) {
        await Promise.race([...inFlight.values()].map((entry) => entry.promise));
      } else if (!claimed) {
        await sleep(config.workflow.workerPollMs);
      }
    }
  })();

  return {
    workerId,
    async stop({ timeoutMs = 20_000 } = {}) {
      running = false;
      clearInterval(heartbeat);
      await Promise.race([loop, sleep(timeoutMs)]);
      await Promise.race([Promise.allSettled([...inFlight.values()].map((entry) => entry.promise)), sleep(timeoutMs)]);
      for (const { task } of inFlight.values()) await releaseTask(task, workerId).catch(() => {});
      await WorkerHeartbeat.deleteOne({ workerId }).catch(() => {});
      logger.info({ workerId }, "Workflow worker stopped");
    },
  };
}

export async function runDueTasks({ workerId = "inline-runner", maxTasks = 5000 } = {}) {
  let count = 0;
  while (count < maxTasks) {
    const task = await claimNextTask(workerId);
    if (!task) break;
    await runTask(task, workerId);
    count += 1;
  }
  return count;
}
