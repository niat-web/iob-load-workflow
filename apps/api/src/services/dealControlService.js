import { config } from "../config/env.js";
import { APPROVAL_GATE_LABELS, JOB_STATUS as S, SUBMITTED_STATUSES, effectiveStatus, stepLabel } from "../config/statuses.js";
import {
  AiCall,
  ApplicationSnapshot,
  CandidateAnalysis,
  CandidatePriorityHistory,
  Job,
  JobApplication,
  JobChangeHistory,
  JobDealSnapshot,
  JobEligibleStudent,
  JobHubspotMapping,
  NotificationLog,
  PublicLink,
  WorkflowTask,
} from "../models/index.js";
import { now } from "../utils/clock.js";
import { AUDIT, audit } from "./auditService.js";

const DELETABLE = [S.CANCELLED, S.FAILED];
const JOB_RECORDS = [
  WorkflowTask,
  JobHubspotMapping,
  JobDealSnapshot,
  JobChangeHistory,
  JobEligibleStudent,
  JobApplication,
  ApplicationSnapshot,
  CandidateAnalysis,
  CandidatePriorityHistory,
  NotificationLog,
  AiCall,
  PublicLink,
];

const poolSubmitted = (job) => SUBMITTED_STATUSES.includes(effectiveStatus(job));

export const canStop = (job) => job.status !== S.CANCELLED && !poolSubmitted(job);

export const canDelete = (job) => DELETABLE.includes(job.status) && !poolSubmitted(job);

export async function stopDeal(job, actor) {
  const gate = job.awaitingApproval?.gate;
  const where = gate ? ` at "${APPROVAL_GATE_LABELS[gate] ?? gate}"` : ` at "${stepLabel(effectiveStatus(job))}"`;
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: { $nin: [S.CANCELLED, ...SUBMITTED_STATUSES] } },
    {
      $set: {
        status: S.CANCELLED,
        currentStep: stepLabel(S.CANCELLED),
        awaitingApproval: null,
        cancelledBy: actor.email,
        cancelledAt: now(),
      },
      $push: {
        statusHistory: {
          $each: [{ status: S.CANCELLED, at: now(), note: `Stopped${where} by ${actor.email}` }],
          $slice: -200,
        },
      },
    },
    { returnDocument: "after" },
  );
  if (updated) {
    await audit({ actor, action: AUDIT.DEAL_STOPPED, entityId: job._id, metadata: { status: job.status, gate: gate ?? null } });
  }
  return updated;
}

export async function stepStillRunning(jobId) {
  const staleBefore = new Date(now().getTime() - config.workflow.lockTimeoutMs);
  return Boolean(await WorkflowTask.exists({ jobId, status: "PROCESSING", lockedAt: { $gte: staleBefore } }));
}

export async function deleteDeal(job, actor) {
  const removed = await Job.deleteOne({ _id: job._id, status: { $in: DELETABLE } });
  if (!removed.deletedCount) return false;
  await Promise.all(JOB_RECORDS.map((Model) => Model.deleteMany({ jobId: job._id })));
  await audit({
    actor,
    action: AUDIT.DEAL_DELETED,
    entityId: job._id,
    metadata: {
      hubspotDealId: job.hubspotDealId,
      companyName: job.companyName ?? null,
      jobRole: job.jobRole ?? null,
      status: job.status,
    },
  });
  return true;
}
