import {
  APPROVAL_GATE_LABELS,
  CRM_STATUS_FILTERS,
  JOB_STATUS,
  PSM_FILTER_OPTIONS,
  PSM_VISIBLE_STATUSES,
  SUBMITTED_STATUSES,
  WINDOW_STATUSES,
  crmDisplay,
  isActiveStatus,
  psmChips,
  psmFilterQuery,
  statusesForDisplayKey,
  stepLabel,
} from "../config/statuses.js";
import { config } from "../config/env.js";
import { Job } from "../models/index.js";
import { now } from "../utils/clock.js";
import { escapeRegex } from "../utils/helpers.js";
import { canDelete, canStop } from "./dealControlService.js";
import { hubspotRecordUrl } from "./dealMapper.js";
import { publicLinkUrlsForJobs } from "./publicLinkService.js";

const S = JOB_STATUS;

export async function transitionJob(jobId, to, { from, set = {}, note } = {}) {
  const filter = { _id: jobId, status: from ? { $in: [].concat(from) } : { $ne: S.CANCELLED } };
  return Job.findOneAndUpdate(
    filter,
    {
      $set: { status: to, currentStep: stepLabel(to), ...set },
      $push: { statusHistory: { $each: [{ status: to, at: now(), note }], $slice: -200 } },
    },
    { returnDocument: "after" },
  );
}

export async function failJob(jobId, taskType, error) {
  const job = await Job.findById(jobId);
  if (!job || job.status === S.FAILED || job.status === S.CANCELLED) return job;
  const message = String(error?.message ?? error).slice(0, 1000);
  return Job.findOneAndUpdate(
    { _id: jobId, status: job.status },
    {
      $set: {
        status: S.FAILED,
        failedStep: job.status,
        failedTaskType: taskType,
        lastError: message,
        currentStep: `${stepLabel(job.status)} (failed)`,
      },
      $push: { statusHistory: { $each: [{ status: S.FAILED, at: now(), note: message }], $slice: -200 } },
    },
    { returnDocument: "after" },
  );
}

export async function restoreFailedJob(job) {
  return transitionJob(job._id, job.failedStep ?? S.SUBMITTED, {
    from: S.FAILED,
    set: { failedStep: null, failedTaskType: null, lastError: null },
    note: "Retry requested",
  });
}

export function progressPercent(job) {
  if (!job.expectedPoolCount || job.expectedPoolCount <= 0) return 0;
  return Math.min(100, Math.round((job.appliedCount / job.expectedPoolCount) * 100));
}

function waitingFor(job) {
  const gate = job.awaitingApproval?.gate;
  if (!gate || job.status === S.FAILED || job.status === S.CANCELLED) return null;
  return {
    gate,
    label: APPROVAL_GATE_LABELS[gate] ?? gate,
    requestedAt: job.awaitingApproval.requestedAt ? new Date(job.awaitingApproval.requestedAt).toISOString() : null,
  };
}

export function toCrmRow(job, publicLinkUrl = null) {
  const { displayStatus, currentStep } = crmDisplay(job);
  return {
    id: String(job._id),
    hubspotDealId: job.hubspotDealId,
    companyName: job.companyName,
    jobRole: job.jobRole,
    expectedPoolCount: job.expectedPoolCount,
    appliedCount: job.appliedCount ?? 0,
    progressPercent: progressPercent(job),
    status: job.status,
    displayStatus,
    currentStep,
    publicLinkUrl,
    flowMode: job.flowMode ?? "AUTOMATIC",
    awaitingApproval: waitingFor(job),
    isActive: isActiveStatus(job.status) && !waitingFor(job),
    canRetry: job.status === S.FAILED,
    canStop: canStop(job),
    canDelete: canDelete(job),
    lastError: job.lastError ?? null,
    updatedAt: job.updatedAt?.toISOString?.() ?? job.updatedAt,
  };
}

const iso = (date) => (date ? new Date(date).toISOString() : null);

function reminderInfo(reminder) {
  if (!reminder?.status) return null;
  return {
    status: reminder.status,
    at: iso(reminder.at),
    emailCount: reminder.emailCount ?? 0,
    callCount: reminder.callCount ?? 0,
    reason: reminder.reason ?? null,
  };
}

function learningPortalInfo(job) {
  const environments = config.learningPortal.targets.map((name) => ({
    name,
    loadedAt: iso(job.learningPortalLoads?.[name]?.loadedAt),
  }));
  return {
    jobId: job.learningPortalJobId ?? null,
    organisationId: job.learningPortalOrgId ?? null,
    order: job.learningPortalPayload?.job_details?.order ?? null,
    environments,
    hubspotWriteBack: job.hubspotWriteBack?.status ?? "PENDING",
  };
}

function firstLoadedAt(job) {
  const dates = config.learningPortal.targets
    .map((name) => job.learningPortalLoads?.[name]?.loadedAt)
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  return dates.length ? new Date(Math.min(...dates)) : null;
}

function dealFields(job) {
  const details = job.learningPortalPayload?.job_details ?? {};
  const plans = details.enroll_plans ?? job.enrollPlans ?? [];
  return {
    hubspotRecordUrl: hubspotRecordUrl(job),
    ingestedAt: iso(firstLoadedAt(job) ?? job.createdAt),
    companyWebsite: job.companyWebsite ?? null,
    companyLinkedin: job.companyLinkedin ?? null,
    companyLogoUrl: job.companyLogoUrl ?? null,
    jdCount: job.jdCount ?? null,
    jobType: details.job_type ?? job.jobType ?? null,
    experienceType: job.experienceType ?? null,
    jobSource: details.job_source ?? job.jobSource ?? null,
    applicationMode: job.applicationMode ?? null,
    internshipDuration: job.internshipDuration ?? null,
    enrollPlans: [...plans],
    eligibility: job.eligibility ?? null,
    compensationDescription: job.importantInstructions ?? null,
    deadline: iso(job.applicationEndAt ?? job.learningPortalDeadline) ?? job.applicationDeadline ?? null,
  };
}

export function toCrmDetail(job, publicLinkUrl = null) {
  return {
    ...dealFields(job),
    ...toCrmRow(job, publicLinkUrl),
    approvals: Object.entries(job.approvals ?? {})
      .map(([gate, approval]) => ({ gate, label: APPROVAL_GATE_LABELS[gate] ?? gate, by: approval?.by ?? null, at: iso(approval?.at) }))
      .sort((a, b) => String(a.at).localeCompare(String(b.at))),
    cancelledBy: job.cancelledBy ?? null,
    cancelledAt: iso(job.cancelledAt),
    learningPortal: learningPortalInfo(job),
    learningPortalJobUrl: job.learningPortalJobUrl,
    location: job.location,
    ctc: job.ctc,
    employmentType: job.employmentType,
    openings: job.openings,
    skills: job.skills ?? [],
    batch: job.batch,
    campus: job.campus,
    program: job.program,
    crmOwnerId: job.crmOwnerId ?? null,
    crmOwnerName: job.crmOwnerName,
    crmOwnerEmail: job.crmOwnerEmail,
    profilingPoc: job.profilingPoc?.name ? { id: job.profilingPoc.id, name: job.profilingPoc.name, email: job.profilingPoc.email } : null,
    ise: job.ise?.name ? { id: job.ise.id, name: job.ise.name, email: job.ise.email } : null,
    eligibleCount: job.eligibleCount ?? 0,
    applicationStartAt: iso(job.applicationStartAt),
    applicationEndAt: iso(job.applicationEndAt),
    poolTargetReached: Boolean(job.poolTargetReached),
    reminders: { r10h: reminderInfo(job.reminders?.r10h), r20h: reminderInfo(job.reminders?.r20h) },
    timeline: (job.statusHistory ?? []).map((entry) => ({
      status: entry.status,
      label: entry.status === S.FAILED ? `Failed: ${entry.note ?? ""}`.trim() : stepLabel(entry.status),
      at: iso(entry.at),
    })),
    createdAt: iso(job.createdAt),
  };
}

export function toPsmRow(job) {
  const chips = psmChips(job);
  return {
    id: String(job._id),
    hubspotDealId: job.hubspotDealId,
    companyName: job.companyName,
    jobRole: job.jobRole,
    expectedPoolCount: job.expectedPoolCount,
    appliedCount: job.appliedCount ?? 0,
    applicationWindow: chips.applicationWindow,
    aiStatus: chips.aiStatus,
    priorityStatus: chips.priorityStatus,
    psmStatus: chips.psmStatus,
    crmShareStatus: chips.crmShareStatus,
    action: chips.action,
    updatedAt: iso(job.updatedAt),
  };
}

export function isReviewSubmitted(job) {
  const current = job.status === S.FAILED ? job.failedStep : job.status;
  return SUBMITTED_STATUSES.includes(current) || Boolean(job.reviewSubmittedAt);
}

export function toPsmDetail(job, { candidateCount, publicLinkUrl }) {
  const current = job.status === S.FAILED ? job.failedStep : job.status;
  return {
    ...toPsmRow(job),
    status: job.status,
    applicationStatus: WINDOW_STATUSES.includes(current) ? "Open" : "Closed",
    candidateCount,
    isSubmitted: isReviewSubmitted(job),
    submittedAt: iso(job.reviewSubmittedAt),
    reviewedBy: job.reviewedBy ?? null,
    publicLinkUrl,
  };
}

const SORTS = {
  "updatedAt:desc": { updatedAt: -1 },
  "updatedAt:asc": { updatedAt: 1 },
  "companyName:asc": { companyName: 1, updatedAt: -1 },
  "companyName:desc": { companyName: -1, updatedAt: -1 },
  "progressPercent:desc": { appliedCount: -1, updatedAt: -1 },
};

function searchFilter(search) {
  if (!search) return null;
  const pattern = new RegExp(escapeRegex(search.trim()), "i");
  return { $or: [{ companyName: pattern }, { jobRole: pattern }, { hubspotDealId: pattern }] };
}

async function paginate(filter, { page, limit, sort }) {
  const [items, total] = await Promise.all([
    Job.find(filter)
      .sort(SORTS[sort] ?? SORTS["updatedAt:desc"])
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Job.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function listCrmJobs({ search, status, company, page, limit, sort }) {
  const and = [];
  const text = searchFilter(search);
  if (text) and.push(text);
  if (status === "WAITING") {
    and.push({ "awaitingApproval.gate": { $exists: true }, status: { $nin: [S.FAILED, S.CANCELLED] } });
  } else if (status) {
    and.push({ status: { $in: statusesForDisplayKey(status) } });
    if (!["FAILED", "CANCELLED"].includes(status)) and.push({ "awaitingApproval.gate": { $exists: false } });
  }
  if (company) and.push({ companyName: company });
  const result = await paginate(and.length ? { $and: and } : {}, { page, limit, sort });
  const links = await publicLinkUrlsForJobs(result.items);
  return { ...result, items: result.items.map((job) => toCrmRow(job, links.get(String(job._id)) ?? null)) };
}

export async function crmFilterOptions() {
  const companies = await Job.distinct("companyName", { companyName: { $ne: null } });
  return { companies: companies.sort((a, b) => a.localeCompare(b)), statuses: CRM_STATUS_FILTERS };
}

const FINISHED_STATUSES = [S.CRM_NOTIFICATION_SENT, S.COMPLETED];

export async function crmCompanySummary() {
  const waiting = {
    $and: [
      { $ne: [{ $ifNull: ["$awaitingApproval.gate", null] }, null] },
      { $not: [{ $in: ["$status", [S.FAILED, S.CANCELLED]] }] },
    ],
  };
  const rows = await Job.aggregate([
    { $match: { companyName: { $nin: [null, ""] } } },
    {
      $group: {
        _id: "$companyName",
        deals: { $sum: 1 },
        waiting: { $sum: { $cond: [waiting, 1, 0] } },
        completed: { $sum: { $cond: [{ $in: ["$status", FINISHED_STATUSES] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ["$status", S.FAILED] }, 1, 0] } },
        stopped: { $sum: { $cond: [{ $eq: ["$status", S.CANCELLED] }, 1, 0] } },
        lastUpdated: { $max: "$updatedAt" },
      },
    },
    { $sort: { _id: 1 } },
    { $limit: 2000 },
  ]);
  return {
    items: rows.map((row) => ({
      name: row._id,
      deals: row.deals,
      inProgress: row.deals - row.waiting - row.completed - row.failed - row.stopped,
      waiting: row.waiting,
      completed: row.completed,
      failed: row.failed,
      stopped: row.stopped,
      lastUpdated: row.lastUpdated ? new Date(row.lastUpdated).toISOString() : null,
    })),
  };
}

const psmBaseFilter = () => ({
  $or: [{ status: { $in: PSM_VISIBLE_STATUSES } }, { status: S.FAILED, failedStep: { $in: PSM_VISIBLE_STATUSES } }],
});

export async function listPsmJobs({ search, company, psmStatus, priorityStatus, aiStatus, page, limit, sort }) {
  const and = [psmBaseFilter()];
  const text = searchFilter(search);
  if (text) and.push(text);
  const companies = Array.isArray(company) ? company : company ? [company] : [];
  if (companies.length) and.push({ companyName: { $in: companies } });
  const chipFilter = psmFilterQuery({ psmStatus, priorityStatus, aiStatus });
  if (chipFilter.$and) and.push(...chipFilter.$and);
  const result = await paginate({ $and: and }, { page, limit, sort });
  return { ...result, items: result.items.map(toPsmRow) };
}

export async function psmFilterOptions() {
  const companies = await Job.distinct("companyName", { ...psmBaseFilter(), companyName: { $ne: null } });
  return { companies: companies.sort((a, b) => a.localeCompare(b)), ...PSM_FILTER_OPTIONS };
}
