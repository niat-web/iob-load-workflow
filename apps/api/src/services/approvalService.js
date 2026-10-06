import { FLOW_MODE, TASK_TYPE } from "../config/statuses.js";
import { Job } from "../models/index.js";
import { now } from "../utils/clock.js";
import { AUDIT, audit } from "./auditService.js";
import { enqueueTask } from "./taskQueue.js";

const NEXT_TASK = {
  DEAL_DETAILS: TASK_TYPE.CREATE_JOB,
  LOAD_BETA: TASK_TYPE.CREATE_JOB,
  LOAD_PROD: TASK_TYPE.CREATE_JOB,
  ELIGIBLE_STUDENTS: TASK_TYPE.GRANT_ACCESS,
  START_WINDOW: TASK_TYPE.SEND_INITIAL_NOTIFICATIONS,
};

export const isStepByStep = (job) => job.flowMode === FLOW_MODE.STEP_BY_STEP;

export const isApproved = (job, gate) => Boolean(job.approvals?.[gate]);

export async function waitForApproval(job, gate) {
  if (!isStepByStep(job) || isApproved(job, gate)) return false;
  const result = await Job.updateOne(
    { _id: job._id, $or: [{ awaitingApproval: null }, { "awaitingApproval.gate": { $ne: gate } }] },
    { $set: { awaitingApproval: { gate, requestedAt: now() } } },
  );
  if (result.modifiedCount) {
    await audit({ action: AUDIT.APPROVAL_REQUESTED, entityId: job._id, metadata: { gate } });
  }
  return true;
}

export async function approveGate(job, gate, actor) {
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, "awaitingApproval.gate": gate },
    { $set: { [`approvals.${gate}`]: { by: actor.email, at: now() }, awaitingApproval: null } },
    { returnDocument: "after" },
  );
  if (!updated) return null;
  const type = NEXT_TASK[gate];
  await enqueueTask({ jobId: job._id, type, dedupeKey: `${job._id}:${type}:approved:${gate}` });
  await audit({ actor, action: AUDIT.STEP_APPROVED, entityId: job._id, metadata: { gate } });
  return updated;
}
