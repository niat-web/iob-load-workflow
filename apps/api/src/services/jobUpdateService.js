import { config } from "../config/env.js";
import { JobApplication, JobUpdateNotice, JobUpdateResponse } from "../models/index.js";
import { now } from "../utils/clock.js";
import { randomToken } from "../utils/crypto.js";
import { notFound } from "../utils/errors.js";
import { AUDIT, audit } from "./auditService.js";
import { displayValue } from "./dealMapper.js";

export async function noticeFor(job, version, changes) {
  return JobUpdateNotice.findOneAndUpdate(
    { jobId: job._id, version },
    {
      $setOnInsert: {
        token: randomToken(32),
        learningPortalJobId: job.learningPortalJobId ?? null,
        companyKey: job.companyKey ?? null,
        companyName: job.companyName ?? "",
        jobRole: job.jobRole ?? "",
        changes,
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();
}

export const formLinkBase = (notice) =>
  `${config.frontendUrl}/job-update/${encodeURIComponent(notice.learningPortalJobId ?? "job")}/${notice.token}`;

export const formLink = (base, studentId) => `${base}?user_id=${encodeURIComponent(studentId)}`;

async function loadNotice(token, jobId, userId) {
  const notice = await JobUpdateNotice.findOne({ token }).lean();
  if (!notice || (jobId && notice.learningPortalJobId && notice.learningPortalJobId !== jobId)) {
    throw notFound("This link is not valid any more.");
  }
  const applicant = await JobApplication.findOne({ jobId: notice.jobId, studentId: userId }).lean();
  if (!applicant) throw notFound("This link is not valid for this student.");
  return { notice, applicant };
}

const toResponse = (response) =>
  response
    ? {
        interested: response.interested,
        reason: response.reason ?? null,
        comments: response.comments ?? "",
        submittedAt: response.submittedAt ? new Date(response.submittedAt).toISOString() : null,
      }
    : null;

export async function jobUpdateForm({ token, jobId, userId }) {
  const { notice, applicant } = await loadNotice(token, jobId, userId);
  const response = await JobUpdateResponse.findOne({ noticeId: notice._id, studentId: userId }).lean();
  return {
    companyName: notice.companyName,
    jobRole: notice.jobRole,
    jobId: notice.learningPortalJobId,
    updatedAt: new Date(notice.createdAt).toISOString(),
    studentName: applicant.studentName ?? "",
    changes: (notice.changes ?? []).map((change) => ({
      label: change.label ?? change.field,
      oldValue: displayValue(change.oldValue),
      newValue: displayValue(change.newValue),
    })),
    response: toResponse(response),
  };
}

export async function submitJobUpdateForm({ token, jobId, userId, interested, reason, comments }, ip) {
  const { notice, applicant } = await loadNotice(token, jobId, userId);
  const saved = await JobUpdateResponse.findOneAndUpdate(
    { noticeId: notice._id, studentId: userId },
    {
      $set: {
        jobId: notice.jobId,
        version: notice.version,
        learningPortalJobId: notice.learningPortalJobId,
        companyKey: notice.companyKey,
        companyName: notice.companyName,
        jobRole: notice.jobRole,
        studentName: applicant.studentName ?? "",
        email: applicant.email ?? null,
        interested,
        reason: interested ? null : (reason ?? null),
        comments: comments ?? "",
        submittedAt: now(),
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();
  await audit({
    actor: { email: applicant.email ?? userId, role: "STUDENT" },
    action: AUDIT.JOB_UPDATE_RESPONSE,
    entityId: notice.jobId,
    metadata: { studentId: userId, version: notice.version, interested },
    ip,
  });
  return { response: toResponse(saved) };
}

export async function latestInterestByStudent(jobId, studentIds) {
  if (!studentIds.length) return new Map();
  const rows = await JobUpdateResponse.aggregate([
    { $match: { jobId, studentId: { $in: studentIds } } },
    { $sort: { submittedAt: -1 } },
    { $group: { _id: "$studentId", interested: { $first: "$interested" }, reason: { $first: "$reason" }, comments: { $first: "$comments" }, submittedAt: { $first: "$submittedAt" } } },
  ]);
  return new Map(
    rows.map((row) => [
      row._id,
      { interested: row.interested, reason: row.reason ?? null, comments: row.comments ?? "", submittedAt: new Date(row.submittedAt).toISOString() },
    ]),
  );
}
