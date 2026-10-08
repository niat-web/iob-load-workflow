import mongoose from "mongoose";
import { CandidateAnalysis, Job, Preference, SharedSheet } from "../models/index.js";
import { now } from "../utils/clock.js";
import { randomToken } from "../utils/crypto.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { latestInterestByStudent } from "./jobUpdateService.js";

export const SHARED_COLUMNS = [
  { key: "finalPriority", label: "Final Priority" },
  { key: "studentName", label: "Student Name" },
  { key: "campus", label: "Campus" },
  { key: "resume", label: "Resume", editable: false },
  { key: "relevantSkills", label: "Relevant Skills" },
  { key: "resumeScore", label: "AI Resume Score" },
  { key: "gritScore", label: "GRIT Score" },
  { key: "assessmentScore", label: "Assessment Score" },
  { key: "interviewScore", label: "Interview Score" },
  { key: "overallScore", label: "Overall Score" },
  { key: "candidateStatus", label: "Candidate Status" },
  { key: "interested", label: "Interested" },
  { key: "psmRemarks", label: "PSM Remarks" },
];

const DEFAULT_COLUMNS = [
  "finalPriority", "studentName", "resume", "relevantSkills", "resumeScore", "gritScore",
  "assessmentScore", "interviewScore", "overallScore", "candidateStatus",
];
const PREFERENCE_ID = "sharedProfileColumns";
const CUSTOM_KEY = /^c_[A-Za-z0-9_-]{6,20}$/;
const MAX_CUSTOM_COLUMNS = 30;
const MAX_ROWS = 2000;
const STATUS_LABELS = { RECOMMENDED: "Recommended", CONSIDER: "Consider", NOT_RECOMMENDED: "Not Recommended" };

const cleanColumns = (keys) => SHARED_COLUMNS.map((column) => column.key).filter((key) => keys.includes(key));

export async function defaultSharedColumns() {
  const stored = await Preference.findById(PREFERENCE_ID).lean();
  return Array.isArray(stored?.value) ? cleanColumns(stored.value) : DEFAULT_COLUMNS;
}

export async function sharedColumnsFor(job) {
  return Array.isArray(job.sharedColumns) && job.sharedColumns.length ? cleanColumns(job.sharedColumns) : defaultSharedColumns();
}

export async function saveSharedColumns(job, keys, actor) {
  const columns = cleanColumns(keys);
  if (!columns.length) throw badRequest("Keep at least one column on the company page");
  await Job.updateOne({ _id: job._id }, { $set: { sharedColumns: columns } });
  await Preference.updateOne(
    { _id: PREFERENCE_ID },
    { $set: { value: columns, updatedBy: actor?.email ?? null } },
    { upsert: true },
  );
  return columns;
}

const asText = (value) => (value === null || value === undefined ? "" : String(value));

function rowFromCandidate(candidate, interest) {
  return {
    ref: candidate.publicRef ?? null,
    source: "PSM",
    createdAt: now(),
    values: {
      finalPriority: asText(candidate.finalPriority),
      studentName: asText(candidate.studentName),
      campus: asText(candidate.campus),
      relevantSkills: (candidate.matchedSkills ?? []).join(", "),
      resumeScore: asText(candidate.resumeScore),
      gritScore: asText(candidate.gritScore),
      assessmentScore: asText(candidate.assessmentScore),
      interviewScore: asText(candidate.interviewScore),
      overallScore: asText(candidate.overallScore),
      candidateStatus: STATUS_LABELS[candidate.candidateStatus] ?? "",
      interested: interest ? (interest.interested ? "Yes" : "No") : "",
      psmRemarks: asText(candidate.psmRemarks),
    },
  };
}

export async function ensureSheet(job) {
  const existing = await SharedSheet.findOne({ jobId: job._id }).lean();
  if (existing) return existing;
  const candidates = await CandidateAnalysis.find({ jobId: job._id }).sort({ finalRank: 1 }).lean();
  const interest = await latestInterestByStudent(
    job._id,
    candidates.map((candidate) => candidate.studentId),
  );
  try {
    await SharedSheet.create({
      jobId: job._id,
      learningPortalJobId: job.learningPortalJobId ?? null,
      rows: candidates.map((candidate) => rowFromCandidate(candidate, interest.get(candidate.studentId))),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return SharedSheet.findOne({ jobId: job._id }).lean();
}

export async function sharedSheetView(job) {
  const sheet = await ensureSheet(job);
  const visible = await sharedColumnsFor(job);
  const columns = [
    ...SHARED_COLUMNS.filter((column) => visible.includes(column.key)).map((column) => ({
      key: column.key,
      label: column.label,
      custom: false,
      editable: column.editable !== false,
    })),
    ...sheet.customColumns.map((column) => ({ key: column.key, label: column.label, custom: true, editable: true })),
  ];
  return {
    companyName: job.companyName,
    jobRole: job.jobRole,
    jobId: job.learningPortalJobId,
    totalApplied: job.appliedCount ?? 0,
    columns,
    rows: sheet.rows.map((row) => ({
      id: String(row._id),
      source: row.source,
      resumeRef: row.ref && row.source === "PSM" && visible.includes("resume") ? row.ref : null,
      values: Object.fromEntries(
        columns.filter((column) => column.key !== "resume").map((column) => [column.key, row.values?.[column.key] ?? ""]),
      ),
    })),
    updatedAt: sheet.updatedAt ? new Date(sheet.updatedAt).toISOString() : null,
  };
}

async function editableKey(job, sheet, key) {
  if (CUSTOM_KEY.test(key)) {
    if (!sheet.customColumns.some((column) => column.key === key)) throw notFound("This column no longer exists");
    return key;
  }
  const column = SHARED_COLUMNS.find((item) => item.key === key);
  if (!column || column.editable === false || !(await sharedColumnsFor(job)).includes(key)) {
    throw badRequest("This column cannot be edited");
  }
  return key;
}

const rowObjectId = (rowId) => {
  if (!mongoose.isValidObjectId(rowId)) throw notFound("This row no longer exists");
  return new mongoose.Types.ObjectId(rowId);
};

export async function updateSharedCell(job, rowId, key, value) {
  const sheet = await ensureSheet(job);
  const field = await editableKey(job, sheet, key);
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "rows._id": rowObjectId(rowId) },
    { $set: { [`rows.$.values.${field}`]: String(value ?? "").slice(0, 2000) } },
  );
  if (!result.matchedCount) throw notFound("This row no longer exists");
}

export async function addSharedRow(job, values = {}) {
  const sheet = await ensureSheet(job);
  if (sheet.rows.length >= MAX_ROWS) throw conflict(`A sheet can have at most ${MAX_ROWS} rows`, "TOO_MANY_ROWS");
  const allowed = new Set([...(await sharedColumnsFor(job)), ...sheet.customColumns.map((column) => column.key)]);
  const clean = Object.fromEntries(
    Object.entries(values)
      .filter(([key]) => allowed.has(key) && key !== "resume")
      .map(([key, value]) => [key, String(value ?? "").slice(0, 2000)]),
  );
  const row = { _id: new mongoose.Types.ObjectId(), ref: null, source: "ADDED", values: clean, createdAt: now() };
  await SharedSheet.updateOne({ jobId: job._id }, { $push: { rows: row } });
  return { id: String(row._id), source: row.source, resumeRef: null, values: clean };
}

export async function deleteSharedRow(job, rowId) {
  await ensureSheet(job);
  const id = rowObjectId(rowId);
  const result = await SharedSheet.collection.updateOne(
    { jobId: job._id, rows: { $elemMatch: { _id: id, source: "ADDED" } } },
    { $pull: { rows: { _id: id, source: "ADDED" } }, $set: { updatedAt: now() } },
  );
  if (!result.modifiedCount) throw conflict("Only rows added on this page can be deleted", "ROW_LOCKED");
}

const cleanLabel = (label) => {
  const text = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) throw badRequest("Enter a column name");
  return text;
};

export async function addSharedColumn(job, label) {
  const sheet = await ensureSheet(job);
  if (sheet.customColumns.length >= MAX_CUSTOM_COLUMNS) {
    throw conflict(`A sheet can have at most ${MAX_CUSTOM_COLUMNS} added columns`, "TOO_MANY_COLUMNS");
  }
  const column = { key: `c_${randomToken(6)}`, label: cleanLabel(label) };
  await SharedSheet.updateOne({ jobId: job._id }, { $push: { customColumns: column } });
  return { ...column, custom: true, editable: true };
}

export async function renameSharedColumn(job, key, label) {
  if (!CUSTOM_KEY.test(key)) throw badRequest("Only added columns can be renamed");
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "customColumns.key": key },
    { $set: { "customColumns.$.label": cleanLabel(label) } },
  );
  if (!result.matchedCount) throw notFound("This column no longer exists");
}

export async function deleteSharedColumn(job, key) {
  if (!CUSTOM_KEY.test(key)) throw badRequest("Only added columns can be deleted");
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "customColumns.key": key },
    { $pull: { customColumns: { key } }, $unset: { [`rows.$[].values.${key}`]: "" } },
  );
  if (!result.matchedCount) throw notFound("This column no longer exists");
}
