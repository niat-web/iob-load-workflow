import { Queue, Worker } from "bullmq";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { analyseQueuedCandidate } from "./resumeAnalysisService.js";

const QUEUE_NAME = "resume-analysis";
const ATTEMPTS = 3;

const usesRedis = () => config.modes.redis === "live";

function connection() {
  if (!config.redis.url) {
    throw new IntegrationError("REDIS_URL is not set: add the Redis Cloud connection URL to apps/api/.env", {
      integration: "redis",
      retryable: false,
    });
  }
  return { url: config.redis.url, maxRetriesPerRequest: null };
}

let queue = null;

function resumeQueue() {
  queue ??= new Queue(QUEUE_NAME, { connection: connection() });
  return queue;
}

export async function queueResumeAnalyses(jobId, studentIds) {
  if (!studentIds.length) return;
  if (!usesRedis()) {
    for (const studentId of studentIds) await analyseQueuedCandidate({ jobId, studentId });
    return;
  }
  const id = String(jobId);
  await resumeQueue().addBulk(
    studentIds.map((studentId) => ({
      name: "analyse",
      data: { jobId: id, studentId },
      opts: {
        jobId: `${id}-${studentId}`,
        attempts: ATTEMPTS,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    })),
  );
}

export function startResumeWorker() {
  if (!usesRedis()) return null;
  if (!config.redis.url) {
    logger.warn("REDIS_URL is not set, so resumes cannot be analysed until it is added to apps/api/.env");
    return null;
  }
  const worker = new Worker(
    QUEUE_NAME,
    (job) => analyseQueuedCandidate(job.data, { finalAttempt: job.attemptsMade + 1 >= ATTEMPTS }),
    { connection: connection(), concurrency: 1 },
  );
  worker.on("failed", (job, error) => logger.warn({ err: error, data: job?.data }, "Resume analysis attempt failed"));
  worker.on("error", (error) => logger.error({ err: error }, "Resume analysis queue error"));
  logger.info("Resume analysis queue started: one resume at a time");
  return {
    stop: async () => {
      await worker.close();
      await queue?.close();
    },
  };
}
