import { statusRank } from "../../config/statuses.js";
import { waitForApproval } from "../../services/approvalService.js";
import { enqueueTask } from "../../services/taskQueue.js";

export function isPast(job, status) {
  return statusRank(job.status) > statusRank(status);
}

export function enqueueNext(job, type, options = {}) {
  return enqueueTask({ jobId: job._id, type, dedupeKey: `${job._id}:${type}`, ...options });
}

export async function proceed(job, gate, type, options) {
  if (await waitForApproval(job, gate)) return null;
  return enqueueNext(job, type, options);
}
