import { z } from "zod";
import { config } from "../config/env.js";
import {
  APPROVAL_GATE,
  DISPLAY_STATUS,
  FLOW_MODE,
  JOB_STATUS as S,
  TASK_TYPE,
  loadGateFor,
  stepLabel,
} from "../config/statuses.js";
import {
  AiCall,
  AuditLog,
  Job,
  JobHubspotMapping,
  NotificationLog,
  WorkflowTask,
} from "../models/index.js";
import { approvalPreview, canEditPlans } from "../services/approvalPreview.js";
import { approveGate } from "../services/approvalService.js";
import { boostOverview, sendBoostEmails, startAiCalls, syncCallResults } from "../services/boostService.js";
import { AUDIT, audit } from "../services/auditService.js";
import { canDelete, canStop, deleteDeal as removeDeal, stepStillRunning, stopDeal as haltDeal } from "../services/dealControlService.js";
import { latestSnapshot } from "../services/dealSnapshotService.js";
import { findHubspotOwner, hubspotOwnerForUser, listHubspotOwners } from "../services/hubspotOwners.js";
import { ALL_ENROLL_PLANS } from "../services/learningPortal/nkbPayload.js";
import { buildPortalPayload } from "../services/learningPortal/portalLoader.js";
import {
  crmCompanySummary,
  crmFilterOptions,
  listCrmJobs,
  restoreFailedJob,
  toCrmDetail,
  toCrmRow,
} from "../services/jobService.js";
import { publicLinkUrlForJob } from "../services/publicLinkService.js";
import { enqueueTask } from "../services/taskQueue.js";
import { now } from "../utils/clock.js";
import { AppError, badRequest, conflict, isDuplicateKeyError, notFound } from "../utils/errors.js";

const hubspotOwnerId = z
  .string()
  .trim()
  .refine((id) => Boolean(findHubspotOwner(id)), "Choose a HubSpot owner from the list");

export const processDealSchema = z.object({
  dealId: z.string().trim().min(1).max(500),
  flowMode: z.enum(Object.values(FLOW_MODE)).default(FLOW_MODE.AUTOMATIC),
  expectedPoolCount: z.coerce
    .number()
    .int("Expected pool must be a whole number")
    .min(1, "Expected pool must be at least 1")
    .max(100000, "Expected pool is too large")
    .optional(),
  jdCount: z.coerce
    .number()
    .int("JD count must be a whole number")
    .min(1, "JD count must be at least 1")
    .max(1000, "JD count is too large")
    .optional(),
  crmOwnerId: hubspotOwnerId.optional(),
  profilingPocId: hubspotOwnerId.optional(),
  iseId: hubspotOwnerId.optional(),
});

const ownerRef = (id) => findHubspotOwner(id);

export function hubspotOwners(req, res) {
  res.json({ owners: listHubspotOwners(), defaultOwnerId: hubspotOwnerForUser(req.user)?.id ?? null });
}

export const approveSchema = z.object({ gate: z.enum(Object.values(APPROVAL_GATE)) });

export const plansSchema = z.object({
  enrollPlans: z.array(z.enum(ALL_ENROLL_PLANS)).min(1, "Choose at least one course plan").max(ALL_ENROLL_PLANS.length),
});

export const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(Object.keys(DISPLAY_STATUS)).optional(),
  company: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(["updatedAt:desc", "updatedAt:asc", "companyName:asc", "companyName:desc", "progressPercent:desc"]).default("updatedAt:desc"),
});

export const jobIdParams = z.object({ jobId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid job id") });

export function extractDealId(input) {
  const value = input.trim().replace(/^HS-/i, "");
  if (/^\d{1,20}$/.test(value)) return value;
  const fromUrl = /(?:\/0-3\/|\/deals?\/)(\d{1,20})(?:[/?#]|$)/i.exec(value);
  if (fromUrl) return fromUrl[1];
  throw badRequest("Enter a valid HubSpot Deal ID (numbers only) or deal URL", undefined, "INVALID_DEAL_ID");
}

function dealUrlFrom(input) {
  try {
    const url = new URL(input.trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

async function queueFirstStep(jobId, dealId) {
  await JobHubspotMapping.create({ jobId, hubspotDealId: dealId }).catch((error) => {
    if (!isDuplicateKeyError(error)) throw error;
  });
  await enqueueTask({ jobId, type: TASK_TYPE.FETCH_DEAL, dedupeKey: `${jobId}:${TASK_TYPE.FETCH_DEAL}` });
}

export async function processDeal(req, res) {
  const dealId = extractDealId(req.valid.body.dealId);

  const existing = await Job.findOne({ hubspotDealId: dealId });
  if (existing) {
    if (existing.status === S.SUBMITTED) await queueFirstStep(existing._id, dealId);
    return res.status(200).json({ job: toCrmRow(existing, await publicLinkUrlForJob(existing)), duplicate: true });
  }

  const { expectedPoolCount, jdCount, crmOwnerId, profilingPocId, iseId } = req.valid.body;
  const crmOwner = ownerRef(crmOwnerId);
  const crmOwnerEmail = crmOwner
    ? (hubspotOwnerForUser(req.user)?.id === crmOwner.id ? req.user.email : crmOwner.email)
    : null;

  let job;
  try {
    job = await Job.create({
      hubspotDealId: dealId,
      hubspotDealUrl: dealUrlFrom(req.valid.body.dealId),
      flowMode: req.valid.body.flowMode,
      submittedBy: req.user.email,
      expectedPoolCount: expectedPoolCount ?? null,
      jdCount: jdCount ?? null,
      crmOwnerId: crmOwner?.id ?? null,
      crmOwnerName: crmOwner?.name ?? null,
      crmOwnerEmail,
      profilingPoc: ownerRef(profilingPocId),
      ise: ownerRef(iseId),
      submittedInputs: {
        expectedPoolCount: expectedPoolCount ?? null,
        jdCount: jdCount ?? null,
        crmOwnerId: crmOwner?.id ?? null,
        crmOwnerEmail,
        profilingPocId: ownerRef(profilingPocId)?.id ?? null,
        iseId: ownerRef(iseId)?.id ?? null,
      },
      statusHistory: [{ status: S.SUBMITTED, at: now() }],
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const raced = await Job.findOne({ hubspotDealId: dealId });
    return res.status(200).json({ job: toCrmRow(raced, await publicLinkUrlForJob(raced)), duplicate: true });
  }

  await queueFirstStep(job._id, dealId);
  await audit({
    actor: req.user,
    action: AUDIT.DEAL_SUBMITTED,
    entityId: job._id,
    metadata: { hubspotDealId: dealId },
    ip: req.ip,
  });
  res.status(202).json({ job: toCrmRow(job), duplicate: false });
}

export async function listDeals(req, res) {
  res.json(await listCrmJobs(req.valid.query));
}

export async function dealFilters(req, res) {
  res.json(await crmFilterOptions());
}

export async function listCompanies(req, res) {
  res.json(await crmCompanySummary());
}

async function loadJob(jobId) {
  const job = await Job.findById(jobId);
  if (!job) throw notFound("Deal not found");
  return job;
}

export async function dealDetail(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  res.json(toCrmDetail(job, await publicLinkUrlForJob(job)));
}

export async function dealLogs(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  const items = [];

  for (const entry of job.statusHistory ?? []) {
    items.push({
      at: entry.at,
      level: entry.status === S.FAILED ? "error" : "info",
      type: "status",
      message: entry.status === S.FAILED ? `Failed: ${entry.note ?? "unknown error"}` : `${stepLabel(entry.status)}${entry.note ? ` (${entry.note})` : ""}`,
    });
  }

  const tasks = await WorkflowTask.find({ jobId: job._id, attempts: { $gt: 0 } }).sort({ updatedAt: -1 }).limit(100).lean();
  for (const task of tasks) {
    const retrying = task.status === "PENDING" && task.lastError;
    items.push({
      at: task.completedAt ?? task.updatedAt,
      level: task.status === "FAILED" ? "error" : retrying ? "warn" : "info",
      type: "task",
      message: `${task.type} ${retrying ? `retry scheduled (attempt ${task.attempts}/${task.maxAttempts})` : task.status.toLowerCase()}${task.lastError ? `: ${task.lastError}` : ""}`,
    });
  }

  const notifications = await NotificationLog.aggregate([
    { $match: { jobId: job._id } },
    { $group: { _id: { type: "$type", status: "$status" }, count: { $sum: 1 }, at: { $max: "$updatedAt" } } },
  ]);
  for (const row of notifications) {
    items.push({
      at: row.at,
      level: row._id.status === "FAILED" ? "warn" : "info",
      type: "notification",
      message: `${row._id.type}: ${row.count} ${row._id.status.toLowerCase()}`,
    });
  }

  const calls = await AiCall.aggregate([
    { $match: { jobId: job._id } },
    { $group: { _id: { batchId: "$batchId", status: "$status" }, count: { $sum: 1 }, at: { $max: "$updatedAt" } } },
  ]);
  for (const row of calls) {
    items.push({
      at: row.at,
      level: row._id.status === "FAILED" ? "warn" : "info",
      type: "call",
      message: `AI calls (batch ${row._id.batchId}): ${row.count} ${row._id.status.toLowerCase().replaceAll("_", " ")}`,
    });
  }

  const audits = await AuditLog.find({ entityType: "Job", entityId: String(job._id) }).sort({ createdAt: -1 }).limit(100).lean();
  for (const entry of audits) {
    const details = Object.entries(entry.metadata ?? {})
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    items.push({
      at: entry.createdAt,
      level: entry.action === AUDIT.STEP_FAILED ? "error" : "info",
      type: "audit",
      message: `${entry.action.replaceAll("_", " ").toLowerCase()} by ${entry.actorEmail}${details ? ` (${details})` : ""}`,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  res.json({ items: items.slice(0, 200).map((item) => ({ ...item, at: new Date(item.at).toISOString() })) });
}

const TASK_FOR_STEP = {
  [S.SUBMITTED]: TASK_TYPE.FETCH_DEAL,
  [S.FETCHING_DEAL]: TASK_TYPE.FETCH_DEAL,
  [S.DEAL_FETCHED]: TASK_TYPE.CREATE_JOB,
  [S.JOB_CREATING]: TASK_TYPE.CREATE_JOB,
  [S.JOB_CREATED]: TASK_TYPE.IDENTIFY_ELIGIBLE,
  [S.ELIGIBILITY_PROCESSING]: TASK_TYPE.IDENTIFY_ELIGIBLE,
  [S.ELIGIBLE_STUDENTS_IDENTIFIED]: TASK_TYPE.GRANT_ACCESS,
  [S.GRANTING_ACCESS]: TASK_TYPE.GRANT_ACCESS,
  [S.INITIAL_NOTIFICATION_SENDING]: TASK_TYPE.SEND_INITIAL_NOTIFICATIONS,
  [S.APPLICATIONS_CLOSED]: TASK_TYPE.FETCH_FINAL_POOL,
  [S.FETCHING_APPLIED_POOL]: TASK_TYPE.FETCH_FINAL_POOL,
  [S.APPLIED_POOL_READY]: TASK_TYPE.AI_ANALYSIS,
  [S.AI_ANALYSIS]: TASK_TYPE.AI_ANALYSIS,
  [S.PRIORITY_GENERATING]: TASK_TYPE.PRIORITY_GENERATION,
  [S.PUBLIC_LINK_GENERATED]: TASK_TYPE.CRM_NOTIFICATION,
};

export async function retryDeal(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  if (job.status !== S.FAILED) throw conflict("Only failed deals can be retried", "NOT_RETRYABLE");

  const type = job.failedTaskType ?? TASK_FOR_STEP[job.failedStep];
  if (!type) throw new AppError(409, "NOT_RETRYABLE", `No retry is available for step ${job.failedStep}`);

  const payload = type === TASK_TYPE.AI_ANALYSIS ? { retryFailed: true } : {};
  if (type === TASK_TYPE.CRM_NOTIFICATION) {
    await NotificationLog.updateMany({ jobId: job._id, type: "CRM_POOL_READY", status: "FAILED" }, { $set: { status: "PENDING" } });
    await Job.updateOne({ _id: job._id }, { $set: { "crmShare.status": "LINK_GENERATED", "crmShare.error": null } });
  }

  const restored = await restoreFailedJob(job);
  const dedupeKey = `${job._id}:${type}`;
  const reset = await WorkflowTask.findOneAndUpdate(
    { dedupeKey, status: { $ne: "PROCESSING" } },
    {
      $set: {
        status: "PENDING",
        attempts: 0,
        scheduledFor: now(),
        lockedAt: null,
        lockedBy: null,
        ...Object.fromEntries(Object.entries(payload).map(([key, value]) => [`payload.${key}`, value])),
      },
    },
    { returnDocument: "after" },
  );
  if (!reset) await enqueueTask({ jobId: job._id, type, payload, dedupeKey });

  await audit({ actor: req.user, action: AUDIT.STEP_RETRIED, entityId: job._id, metadata: { task: type }, ip: req.ip });
  res.json({ job: toCrmRow(restored ?? job, await publicLinkUrlForJob(restored ?? job)) });
}

function requireWaiting(job) {
  if (!job.awaitingApproval?.gate) throw conflict("This deal is not waiting for approval", "NOT_WAITING");
}

export async function approvalDetail(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  requireWaiting(job);
  res.json({ approval: await approvalPreview(job) });
}

export async function approveStep(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  requireWaiting(job);
  if (job.awaitingApproval.gate !== req.valid.body.gate) {
    throw conflict("This step has already moved on. Refresh to see the current step.", "NOT_WAITING");
  }
  const updated = await approveGate(job, req.valid.body.gate, req.user);
  if (!updated) throw conflict("This step has already been approved", "NOT_WAITING");
  res.json({ job: toCrmRow(updated, await publicLinkUrlForJob(updated)) });
}

export async function updateApprovalPlans(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  requireWaiting(job);
  if (!canEditPlans(job)) {
    throw conflict("Course plans can only be changed before the job is loaded into the first portal", "PLANS_LOCKED");
  }
  const snapshot = await latestSnapshot(job._id);
  if (!snapshot || !job.learningPortalPayload) throw conflict("The job is not prepared yet", "NOT_WAITING");
  const enrollPlans = [...new Set(req.valid.body.enrollPlans)];
  const payload = await buildPortalPayload(job, snapshot.rawProperties, {
    deadline: job.learningPortalDeadline,
    order: job.learningPortalPayload.job_details?.order,
    enrollPlans,
  });
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, "awaitingApproval.gate": loadGateFor(config.learningPortal.targets[0]) },
    { $set: { learningPortalPayload: payload, enrollPlans: payload.job_details.enroll_plans ?? enrollPlans } },
    { returnDocument: "after" },
  );
  if (!updated) throw conflict("This step has already moved on. Refresh to see the current step.", "NOT_WAITING");
  await audit({ actor: req.user, action: AUDIT.PLANS_CHANGED, entityId: job._id, metadata: { enrollPlans: enrollPlans.join(",") }, ip: req.ip });
  res.json({ approval: await approvalPreview(updated) });
}

export async function stopDeal(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  if (job.status === S.CANCELLED) throw conflict("This deal is already stopped", "NOT_STOPPABLE");
  if (!canStop(job)) throw conflict("This deal is finished and cannot be stopped", "NOT_STOPPABLE");
  const updated = await haltDeal(job, req.user);
  if (!updated) throw conflict("This deal has just moved on and cannot be stopped. Refresh and try again.", "NOT_STOPPABLE");
  res.json({ job: toCrmRow(updated, await publicLinkUrlForJob(updated)) });
}

export async function deleteDeal(req, res) {
  const job = await loadJob(req.valid.params.jobId);
  if (!canDelete(job)) {
    const finished = job.status !== S.CANCELLED && job.status !== S.FAILED && !canStop(job);
    throw conflict(
      finished ? "Finished deals cannot be deleted" : "Stop this deal before deleting it",
      "NOT_DELETABLE",
    );
  }
  if (await stepStillRunning(job._id)) {
    throw conflict("A step for this deal is still finishing. Try again in a minute.", "NOT_DELETABLE");
  }
  if (!(await removeDeal(job, req.user))) throw conflict("This deal has just changed. Refresh and try again.", "NOT_DELETABLE");
  res.status(204).end();
}

export async function boostDetail(req, res) {
  res.json(await boostOverview(await loadJob(req.valid.params.jobId)));
}

export async function boostEmails(req, res) {
  const run = await sendBoostEmails(await loadJob(req.valid.params.jobId), req.user);
  res.json({ run, boost: await boostOverview(await loadJob(req.valid.params.jobId)) });
}

export async function boostCalls(req, res) {
  const run = await startAiCalls(await loadJob(req.valid.params.jobId), req.user);
  res.status(202).json({ run, boost: await boostOverview(await loadJob(req.valid.params.jobId)) });
}

export async function boostCallsSync(req, res) {
  await syncCallResults(await loadJob(req.valid.params.jobId));
  res.json({ boost: await boostOverview(await loadJob(req.valid.params.jobId)) });
}
