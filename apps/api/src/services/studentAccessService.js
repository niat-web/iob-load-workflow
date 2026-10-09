import { config } from "../config/env.js";
import { APPROVAL_GATE as GATE, WINDOW_STATUSES } from "../config/statuses.js";
import { Job, JobEligibleStudent } from "../models/index.js";
import { now } from "../utils/clock.js";
import { csvCell } from "../utils/csv.js";
import { PermanentError, conflict } from "../utils/errors.js";
import { chunk, escapeRegex, formatDateTime } from "../utils/helpers.js";
import { AUDIT, audit } from "./auditService.js";
import { latestSnapshot } from "./dealSnapshotService.js";
import { findEligibleStudents } from "./eligibilityService.js";
import { integrations } from "./integrations.js";

const LOCK_MS = 2 * 60 * 1000;
const PREVIEW_LIMIT = 200;
const noop = async () => {};

export async function saveEligibleStudents(job, students, heartbeat = noop) {
  for (const batch of chunk(students, 1000)) {
    await JobEligibleStudent.bulkWrite(
      batch.map((student) => ({
        updateOne: {
          filter: { jobId: job._id, studentId: student.studentId },
          update: {
            $set: {
              studentName: student.studentName ?? "",
              email: student.email ?? null,
              mobile: student.mobile ?? null,
              campus: student.campus ?? null,
              batch: student.batch ?? null,
              product: student.product ?? null,
              learningPortalJobId: job.learningPortalJobId ?? null,
            },
            $setOnInsert: { eligibleAt: now() },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await heartbeat();
  }
}

export async function grantStudentAccess(job, studentIds, heartbeat = noop) {
  let granted = 0;
  let rejected = 0;
  for (const batch of chunk(studentIds, 1000)) {
    const result = await integrations.learningPortal.grantAccess(config.learningPortal.accessEnv, job.learningPortalJobId, batch);
    if (result.granted.length) {
      await JobEligibleStudent.updateMany(
        { jobId: job._id, studentId: { $in: result.granted } },
        { $set: { accessGrantedAt: now() } },
      );
    }
    for (const { studentId, reason } of result.rejected) {
      await JobEligibleStudent.updateOne({ jobId: job._id, studentId }, { $set: { accessRejectedReason: reason } });
    }
    granted += result.granted.length;
    rejected += result.rejected.length;
    await heartbeat();
  }
  return { granted, rejected };
}

export function topUpState(job) {
  const denied = (reason) => ({ allowed: false, accessNow: false, reason });
  if (!job.learningPortalJobId || !job.learningPortalLoads?.[config.learningPortal.accessEnv]?.loadedAt) {
    return denied("New students can be added once the job is live on the Learning Portal.");
  }
  const closesAt = job.applicationEndAt ?? job.learningPortalDeadline;
  if (closesAt && new Date(closesAt) <= now()) return denied("The application window has closed, so new students can no longer apply.");
  const gate = job.awaitingApproval?.gate;
  if (gate === GATE.ELIGIBLE_STUDENTS) return { allowed: true, accessNow: false, reason: null };
  if (gate === GATE.START_WINDOW || WINDOW_STATUSES.includes(job.status)) return { allowed: true, accessNow: true, reason: null };
  return denied(
    "New students can be added while the deal waits to give job access or to start the window, or while the application window is open.",
  );
}

async function findNewStudents(job) {
  const snapshot = await latestSnapshot(job._id);
  let students;
  try {
    students = await findEligibleStudents(job, snapshot?.rawProperties ?? {});
  } catch (error) {
    if (error instanceof PermanentError) throw conflict(error.message, "NO_ELIGIBLE_STUDENTS");
    throw error;
  }
  const existing = new Set(await JobEligibleStudent.distinct("studentId", { jobId: job._id }));
  return students.filter((student) => !existing.has(student.studentId));
}

const previewStudent = (student) => ({
  studentId: student.studentId,
  studentName: student.studentName ?? "",
  campus: student.campus ?? null,
  batch: student.batch ?? null,
  product: student.product ?? null,
  hasEmail: Boolean(student.email),
  hasMobile: Boolean(student.mobile),
});

export async function newEligiblePreview(job) {
  const state = topUpState(job);
  if (!state.allowed) throw conflict(state.reason, "TOP_UP_NOT_ALLOWED");
  const students = await findNewStudents(job);
  return {
    ...state,
    total: students.length,
    withEmail: students.filter((student) => student.email).length,
    withMobile: students.filter((student) => student.mobile).length,
    students: students.slice(0, PREVIEW_LIMIT).map(previewStudent),
  };
}

async function takeLock(job) {
  const stale = new Date(now().getTime() - LOCK_MS);
  const locked = await Job.findOneAndUpdate(
    { _id: job._id, $or: [{ eligibleTopUpLockAt: null }, { eligibleTopUpLockAt: { $lt: stale } }] },
    { $set: { eligibleTopUpLockAt: now() } },
  );
  if (!locked) throw conflict("New students are already being added to this deal. Please wait a moment.", "TOP_UP_BUSY");
}

export async function addNewEligibleStudents(job, actor) {
  const state = topUpState(job);
  if (!state.allowed) throw conflict(state.reason, "TOP_UP_NOT_ALLOWED");
  await takeLock(job);
  try {
    const students = await findNewStudents(job);
    if (!students.length) throw conflict("There are no new eligible students to add to this deal.", "NO_NEW_STUDENTS");
    await saveEligibleStudents(job, students);
    const access = state.accessNow
      ? await grantStudentAccess(job, students.map((student) => student.studentId))
      : { granted: 0, rejected: 0 };
    const eligibleCount = await JobEligibleStudent.countDocuments({ jobId: job._id });
    await Job.updateOne({ _id: job._id }, { $set: { eligibleCount } });
    const result = { added: students.length, accessNow: state.accessNow, ...access, eligibleCount };
    await audit({ actor, action: AUDIT.ELIGIBLE_ADDED, entityId: job._id, metadata: result });
    return result;
  } finally {
    await Job.updateOne({ _id: job._id }, { $set: { eligibleTopUpLockAt: null } });
  }
}

export const STUDENT_ACCESS_FILTERS = ["ACCESS", "REFUSED", "WAITING", "APPLIED", "NOT_APPLIED"];

const ACCESS_CONDITIONS = {
  ACCESS: { accessGrantedAt: { $ne: null } },
  REFUSED: { accessRejectedReason: { $ne: null } },
  WAITING: { accessGrantedAt: null, accessRejectedReason: null },
  APPLIED: { applied: true },
  NOT_APPLIED: { accessGrantedAt: { $ne: null }, applied: { $ne: true } },
};

function studentsFilter(job, { search, access = [], product = [] }) {
  const and = [{ jobId: job._id }];
  if (access.length) and.push({ $or: access.map((key) => ACCESS_CONDITIONS[key]) });
  if (product.length) and.push({ product: { $in: product } });
  const term = search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    and.push({ $or: [{ studentId: pattern }, { studentName: pattern }, { email: pattern }, { mobile: pattern }, { campus: pattern }] });
  }
  return { $and: and };
}

const iso = (date) => (date ? new Date(date).toISOString() : null);

function accessStatus(row) {
  if (row.accessGrantedAt) return "ACCESS";
  if (row.accessRejectedReason) return "REFUSED";
  return "WAITING";
}

const studentRow = (row) => ({
  studentId: row.studentId,
  studentName: row.studentName ?? "",
  product: row.product ?? null,
  campus: row.campus ?? null,
  batch: row.batch ?? null,
  email: row.email ?? null,
  mobile: row.mobile ?? null,
  eligibleAt: iso(row.eligibleAt),
  accessGrantedAt: iso(row.accessGrantedAt),
  accessRejectedReason: row.accessRejectedReason ?? null,
  applied: Boolean(row.applied),
  appliedAt: iso(row.appliedAt),
  status: accessStatus(row),
});

async function studentsSummary(job) {
  const count = (condition = {}) => JobEligibleStudent.countDocuments({ jobId: job._id, ...condition });
  const [total, access, refused, applied, byProduct] = await Promise.all([
    count(),
    count(ACCESS_CONDITIONS.ACCESS),
    count(ACCESS_CONDITIONS.REFUSED),
    count(ACCESS_CONDITIONS.APPLIED),
    JobEligibleStudent.aggregate([{ $match: { jobId: job._id } }, { $group: { _id: "$product", count: { $sum: 1 } } }]),
  ]);
  return {
    total,
    access,
    refused,
    waiting: Math.max(0, total - access - refused),
    applied,
    products: Object.fromEntries(byProduct.map((row) => [row._id ?? "Unknown", row.count])),
  };
}

export async function listDealStudents(job, { page, limit, ...query }) {
  const filter = studentsFilter(job, query);
  const [rows, total, summary] = await Promise.all([
    JobEligibleStudent.find(filter)
      .sort({ eligibleAt: -1, studentName: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    JobEligibleStudent.countDocuments(filter),
    studentsSummary(job),
  ]);
  return {
    items: rows.map(studentRow),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    summary,
  };
}

const ACCESS_LABELS = { ACCESS: "Access given", REFUSED: "Refused by the portal", WAITING: "Waiting for access" };
const istTime = (value) => (value ? `${formatDateTime(value)} IST` : "");

const CSV_COLUMNS = [
  ["User ID", (row) => row.studentId],
  ["Name", (row) => row.studentName],
  ["Product", (row) => row.product],
  ["Campus", (row) => row.campus],
  ["Batch", (row) => row.batch],
  ["Email", (row) => row.email],
  ["Mobile", (row) => row.mobile],
  ["Access", (row) => ACCESS_LABELS[row.status]],
  ["Access given at", (row) => istTime(row.accessGrantedAt)],
  ["Refused reason", (row) => row.accessRejectedReason],
  ["Applied", (row) => (row.applied ? "Yes" : "No")],
  ["Applied at", (row) => istTime(row.appliedAt)],
  ["Added to deal at", (row) => istTime(row.eligibleAt)],
];

export async function dealStudentsCsv(job, query) {
  const rows = (await JobEligibleStudent.find(studentsFilter(job, query)).sort({ eligibleAt: -1, studentName: 1 }).lean()).map(
    studentRow,
  );
  const lines = [
    CSV_COLUMNS.map(([heading]) => csvCell(heading)).join(","),
    ...rows.map((row) => CSV_COLUMNS.map(([, value]) => csvCell(value(row))).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}
