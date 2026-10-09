import { z } from "zod";
import { CANDIDATE_STATUS, JOB_STATUS as S, PSM_VISIBLE_STATUSES, TASK_TYPE, WINDOW_STATUSES } from "../config/statuses.js";
import { CandidateAnalysis, CandidatePriorityHistory, Job, JobApplication } from "../models/index.js";
import { AUDIT, audit } from "../services/auditService.js";
import {
  isReviewSubmitted,
  listPsmJobs,
  psmFilterOptions,
  toPsmDetail,
  transitionJob,
} from "../services/jobService.js";
import { createPublicLinkForJob, publicLinkUrlForJob } from "../services/publicLinkService.js";
import { downloadResume } from "../services/resumeFetcher.js";
import { enqueueTask } from "../services/taskQueue.js";
import { now } from "../utils/clock.js";
import { randomToken } from "../utils/crypto.js";
import { AppError, conflict, notFound } from "../utils/errors.js";
import { escapeRegex } from "../utils/helpers.js";
import { listOf } from "../utils/queryList.js";
import { latestInterestByStudent } from "../services/jobUpdateService.js";

const priorityPattern = /^P([1-9]\d{0,4})$/;

export const PSM_EXTRA_COLUMNS = [
  "interest",
  "appliedAt",
  "userId",
  "jobId",
  "product",
  "gender",
  "name",
  "phone",
  "email",
  "district",
  "state",
  "highestEducation",
  "highestEducationInstitute",
  "mastersCourse",
  "mastersDepartment",
  "mastersYear",
  "mastersPercentage",
  "bachelorsCourse",
  "bachelorsDepartment",
  "bachelorsYear",
  "bachelorsPercentage",
  "intermediatePercentage",
  "tenthPercentage",
  "resumeLink",
];

export const psmListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  company: listOf(z.string().max(200)),
  psmStatus: listOf(z.enum(["READY", "UNDER_REVIEW", "COMPLETED"])),
  priorityStatus: listOf(z.enum(["PENDING", "GENERATED"])),
  aiStatus: listOf(z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"])),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(["updatedAt:desc", "updatedAt:asc", "companyName:asc", "companyName:desc"]).default("updatedAt:desc"),
});

export const candidateListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  aiPriority: z.string().regex(priorityPattern).optional(),
  finalPriority: z.string().regex(priorityPattern).optional(),
  status: z.enum(CANDIDATE_STATUS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.enum(["finalRank:asc", "aiRank:asc", "overallScore:desc"]).default("finalRank:asc"),
});

export const candidateParams = z.object({
  jobId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid job id"),
  studentId: z.string().min(1).max(100),
});

export const candidateUpdateSchema = z
  .object({
    finalPriority: z.string().regex(priorityPattern, "Priority must look like P1, P2 …").optional(),
    psmRemarks: z.string().max(1000).optional(),
    candidateStatus: z.enum(CANDIDATE_STATUS).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

const EDITABLE = [S.READY_FOR_PSM, S.PSM_REVIEW_IN_PROGRESS];

async function loadPsmJob(jobId) {
  const job = await Job.findById(jobId);
  const visible = job && (PSM_VISIBLE_STATUSES.includes(job.status) || PSM_VISIBLE_STATUSES.includes(job.failedStep));
  if (!visible) throw notFound("Candidate pool not found");
  return job;
}

async function detailFor(job) {
  const candidateCount = await CandidateAnalysis.countDocuments({ jobId: job._id });
  return toPsmDetail(job, { candidateCount, publicLinkUrl: await publicLinkUrlForJob(job) });
}

export function serializeCandidate(candidate) {
  return {
    studentId: candidate.studentId,
    studentName: candidate.studentName,
    campus: candidate.campus ?? null,
    hasResume: Boolean(candidate.resumeUrl),
    resumeScore: candidate.resumeScore ?? null,
    gritScore: candidate.gritScore ?? null,
    assessmentScore: candidate.assessmentScore ?? null,
    interviewScore: candidate.interviewScore ?? null,
    overallScore: candidate.overallScore ?? null,
    aiPriority: candidate.aiPriority,
    aiRank: candidate.aiRank,
    finalPriority: candidate.finalPriority,
    finalRank: candidate.finalRank,
    resumeReason: candidate.resumeReason ?? candidate.analysisError ?? null,
    matchedSkills: candidate.matchedSkills ?? [],
    missingSkills: candidate.missingSkills ?? [],
    candidateStatus: candidate.candidateStatus ?? null,
    psmRemarks: candidate.psmRemarks ?? "",
    analysisStatus: candidate.analysisStatus,
  };
}

const iso = (value) => (value ? new Date(value).toISOString() : null);
const text = (value) => (value === null || value === undefined || value === "" ? null : String(value));

function candidateDetails(candidate, application, job) {
  const profile = application?.profile ?? {};
  return {
    appliedAt: iso(application?.appliedAt),
    userId: candidate.studentId,
    jobId: job.learningPortalJobId ?? null,
    product: text(profile.product ?? candidate.product),
    gender: text(profile.gender),
    name: text(application?.studentName),
    phone: text(application?.mobile),
    email: text(application?.email),
    district: text(profile.district),
    state: text(profile.state),
    highestEducation: text(profile.highestEducation),
    highestEducationInstitute: text(profile.highestEducationInstitute),
    mastersCourse: text(profile.mastersCourse),
    mastersDepartment: text(profile.mastersDepartment),
    mastersYear: text(profile.mastersYear),
    mastersPercentage: text(profile.mastersPercentage),
    bachelorsCourse: text(profile.bachelorsCourse),
    bachelorsDepartment: text(profile.bachelorsDepartment),
    bachelorsYear: text(profile.bachelorsYear),
    bachelorsPercentage: text(profile.bachelorsPercentage),
    intermediatePercentage: text(profile.intermediatePercentage),
    tenthPercentage: text(profile.tenthPercentage),
    resumeLink: text(application?.resumeUrl ?? candidate.resumeUrl),
  };
}

export const psmColumnsSchema = z.object({
  columns: z.array(z.enum(PSM_EXTRA_COLUMNS)).max(PSM_EXTRA_COLUMNS.length),
});

export async function updatePsmColumns(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  const psmColumns = PSM_EXTRA_COLUMNS.filter((key) => req.valid.body.columns.includes(key));
  await Job.updateOne({ _id: job._id }, { $set: { psmColumns } });
  res.json({ psmColumns });
}

export const applicantListSchema = z.object({
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export const applicantParams = z.object({
  jobId: z.string().regex(/^[a-f0-9]{24}$/i, "Invalid job id"),
  studentId: z.string().min(1).max(100),
});

function applicantRow(application) {
  return {
    studentId: application.studentId,
    studentName: application.studentName ?? "",
    product: text(application.profile?.product),
    campus: text(application.campus),
    batch: text(application.batch),
    email: text(application.email),
    mobile: text(application.mobile),
    appliedAt: iso(application.appliedAt),
    hasResume: Boolean(application.resumeUrl),
  };
}

export async function listApplicants(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  const { search, page, limit } = req.valid.query;
  const filter = { jobId: job._id };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ studentName: pattern }, { studentId: pattern }, { email: pattern }];
  }
  const [items, total] = await Promise.all([
    JobApplication.find(filter).sort({ appliedAt: -1, studentId: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    JobApplication.countDocuments(filter),
  ]);
  const current = job.status === S.FAILED ? job.failedStep : job.status;
  res.json({
    items: items.map(applicantRow),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    appliedCount: job.appliedCount ?? 0,
    windowOpen: WINDOW_STATUSES.includes(current),
    applicationEndAt: iso(job.applicationEndAt),
    lastSyncedAt: iso(job.lastApplicationSyncAt),
    syncError: job.applicationSyncError ?? null,
  });
}

export async function applicantResume(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  const application = await JobApplication.findOne({ jobId: job._id, studentId: req.valid.params.studentId }).lean();
  if (!application?.resumeUrl) throw notFound("No resume for this applicant");
  await sendResume(
    res,
    application.resumeUrl,
    { studentId: application.studentId, studentName: application.studentName, jobSkills: job.skills },
    `${application.studentName || application.studentId}-resume`,
  );
}

export async function listJobs(req, res) {
  res.json(await listPsmJobs(req.valid.query));
}

export async function jobFilters(req, res) {
  res.json(await psmFilterOptions());
}

export async function jobDetail(req, res) {
  res.json(await detailFor(await loadPsmJob(req.valid.params.jobId)));
}

export async function startReview(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  let current = job;
  if (job.status === S.READY_FOR_PSM) {
    current =
      (await transitionJob(job._id, S.PSM_REVIEW_IN_PROGRESS, {
        from: S.READY_FOR_PSM,
        set: { "psm.startedAt": now(), "psm.startedBy": req.user.email },
      })) ?? (await Job.findById(job._id));
    await audit({ actor: req.user, action: AUDIT.PSM_REVIEW_STARTED, entityId: job._id, ip: req.ip });
  }
  res.json({ job: await detailFor(current) });
}

const CANDIDATE_SORTS = {
  "finalRank:asc": { finalRank: 1, studentId: 1 },
  "aiRank:asc": { aiRank: 1, studentId: 1 },
  "overallScore:desc": { overallScore: -1, finalRank: 1 },
};

export async function listCandidates(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  const { search, aiPriority, finalPriority, status, page, limit, sort } = req.valid.query;
  const filter = { jobId: job._id };
  if (search) {
    const pattern = new RegExp(escapeRegex(search), "i");
    filter.$or = [{ studentName: pattern }, { studentId: pattern }];
  }
  if (aiPriority) filter.aiPriority = aiPriority;
  if (finalPriority) filter.finalPriority = finalPriority;
  if (status) filter.candidateStatus = status;

  const [items, total] = await Promise.all([
    CandidateAnalysis.find(filter).sort(CANDIDATE_SORTS[sort]).skip((page - 1) * limit).limit(limit).lean(),
    CandidateAnalysis.countDocuments(filter),
  ]);
  const studentIds = items.map((item) => item.studentId);
  const [interest, applications] = await Promise.all([
    latestInterestByStudent(job._id, studentIds),
    JobApplication.find({ jobId: job._id, studentId: { $in: studentIds } }).lean(),
  ]);
  const applicationOf = new Map(applications.map((application) => [application.studentId, application]));
  res.json({
    items: items.map((item) => ({
      ...serializeCandidate(item),
      interest: interest.get(item.studentId) ?? null,
      details: candidateDetails(item, applicationOf.get(item.studentId), job),
    })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  });
}

async function recordHistory({ jobId, before, after, actor, reason = "PSM_EDIT" }) {
  await CandidatePriorityHistory.create({
    jobId,
    studentId: before.studentId,
    previousPriority: before.finalPriority,
    newPriority: after.finalPriority,
    previousStatus: before.candidateStatus,
    newStatus: after.candidateStatus,
    previousRemarks: before.psmRemarks,
    newRemarks: after.psmRemarks,
    reason,
    changedByEmail: actor.email,
    changedAt: now(),
  });
}

export async function updateCandidate(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  if (isReviewSubmitted(job)) throw new AppError(409, "REVIEW_FROZEN", "This candidate pool has already been submitted");
  if (!EDITABLE.includes(job.status)) throw conflict("This candidate pool is not ready for review yet");

  const { studentId } = req.valid.params;
  const body = req.valid.body;
  const before = await CandidateAnalysis.findOne({ jobId: job._id, studentId }).lean();
  if (!before) throw notFound("Candidate not found");

  const set = { psmEdited: true };
  if (body.psmRemarks !== undefined) set.psmRemarks = body.psmRemarks.trim();
  if (body.candidateStatus !== undefined) set.candidateStatus = body.candidateStatus;

  let swappedWith = null;
  if (body.finalPriority !== undefined && body.finalPriority !== before.finalPriority) {
    const newRank = Number(priorityPattern.exec(body.finalPriority)[1]);
    const count = await CandidateAnalysis.countDocuments({ jobId: job._id });
    if (newRank > count) throw new AppError(400, "VALIDATION_ERROR", `Priority must be between P1 and P${count}`);

    const holder = await CandidateAnalysis.findOne({ jobId: job._id, finalRank: newRank, studentId: { $ne: studentId } }).lean();
    if (holder) {
      const swapSet = { finalRank: before.finalRank, finalPriority: before.finalPriority, psmEdited: true };
      await CandidateAnalysis.updateOne({ _id: holder._id }, { $set: swapSet });
      await recordHistory({ jobId: job._id, before: holder, after: { ...holder, ...swapSet }, actor: req.user, reason: "PRIORITY_SWAP" });
      swappedWith = { studentId: holder.studentId, finalPriority: before.finalPriority };
    }
    set.finalRank = newRank;
    set.finalPriority = body.finalPriority;
  }

  const after = await CandidateAnalysis.findOneAndUpdate({ _id: before._id }, { $set: set }, { returnDocument: "after" }).lean();
  await recordHistory({ jobId: job._id, before, after, actor: req.user });
  await audit({
    actor: req.user,
    action: AUDIT.PSM_CHANGED_CANDIDATE,
    entityId: job._id,
    metadata: { studentId, fields: Object.keys(body).join(","), swappedWith: swappedWith?.studentId ?? null },
    ip: req.ip,
  });
  if (job.status === S.READY_FOR_PSM) {
    await transitionJob(job._id, S.PSM_REVIEW_IN_PROGRESS, {
      from: S.READY_FOR_PSM,
      set: { "psm.startedAt": now(), "psm.startedBy": req.user.email },
    });
  }
  res.json({ candidate: serializeCandidate(after), swappedWith });
}

export async function submitPool(req, res) {
  let job = await loadPsmJob(req.valid.params.jobId);

  if (EDITABLE.includes(job.status)) {
    const frozen = await transitionJob(job._id, S.PSM_REVIEW_COMPLETED, {
      from: EDITABLE,
      set: { reviewedBy: req.user.email, reviewSubmittedAt: now() },
    });
    if (frozen) {
      job = frozen;
      await audit({ actor: req.user, action: AUDIT.PSM_SUBMITTED_POOL, entityId: job._id, ip: req.ip });
    } else {
      job = await Job.findById(job._id);
    }
  } else if (!isReviewSubmitted(job)) {
    throw conflict("This candidate pool is not ready to be submitted");
  }

  if (job.status === S.PSM_REVIEW_COMPLETED) {
    const unreferenced = await CandidateAnalysis.find({ jobId: job._id, publicRef: { $exists: false } }, { _id: 1 }).lean();
    if (unreferenced.length) {
      await CandidateAnalysis.bulkWrite(
        unreferenced.map((candidate) => ({
          updateOne: { filter: { _id: candidate._id }, update: { $set: { publicRef: randomToken(12) } } },
        })),
      );
    }
    const { link } = await createPublicLinkForJob(job._id, job.reviewedBy ?? req.user.email);
    job =
      (await transitionJob(job._id, S.PUBLIC_LINK_GENERATED, {
        from: S.PSM_REVIEW_COMPLETED,
        set: { publicLinkId: link._id, "crmShare.status": "LINK_GENERATED" },
      })) ?? (await Job.findById(job._id));
    await audit({ actor: req.user, action: AUDIT.PUBLIC_LINK_GENERATED, entityId: job._id, ip: req.ip });
  }

  if (job.status === S.PUBLIC_LINK_GENERATED) {
    await enqueueTask({ jobId: job._id, type: TASK_TYPE.CRM_NOTIFICATION, dedupeKey: `${job._id}:${TASK_TYPE.CRM_NOTIFICATION}` });
  }

  const detail = await detailFor(job);
  res.json({ job: detail, publicLinkUrl: detail.publicLinkUrl });
}

export async function sendResume(res, url, context, filenameBase) {
  const file = await downloadResume(url, context);
  const extension = { pdf: "pdf", docx: "docx", text: "txt" }[file.kind] ?? "bin";
  const safeName = String(filenameBase || "resume").replace(/[^\w.-]+/g, "_").slice(0, 80);
  res.set({
    "Content-Type": file.contentType,
    "Content-Disposition": `${file.kind === "unknown" ? "attachment" : "inline"}; filename="${safeName}.${extension}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  });
  res.send(file.buffer);
}

export async function candidateResume(req, res) {
  const job = await loadPsmJob(req.valid.params.jobId);
  const candidate = await CandidateAnalysis.findOne({ jobId: job._id, studentId: req.valid.params.studentId }).lean();
  if (!candidate?.resumeUrl) throw notFound("No resume for this candidate");
  await sendResume(
    res,
    candidate.resumeUrl,
    { studentId: candidate.studentId, studentName: candidate.studentName, jobSkills: job.skills },
    `${candidate.studentName}-resume`,
  );
}
