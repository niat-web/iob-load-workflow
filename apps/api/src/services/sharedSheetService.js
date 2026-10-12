import mongoose from "mongoose";
import { CandidateAnalysis, JobApplication, JobEligibleStudent, SharedSheet } from "../models/index.js";
import { now } from "../utils/clock.js";
import { randomToken } from "../utils/crypto.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";

const SHORTLIST_OPTIONS = ["Selected", "Rejected", "On Hold"];
const ROUND_OPTIONS = ["Yet to Schedule", "Scheduled", "Selected", "Rejected", "Hold", "No Show"];

export const SHARED_COLUMNS = [
  { key: "fullName", label: "Full Name" },
  { key: "mobile", label: "Mobile Number" },
  { key: "email", label: "Email Id" },
  { key: "bachelorsCourse", label: "Bachelors Course Name" },
  { key: "bachelorsDepartment", label: "Bachelors Department Name" },
  { key: "bachelorsYear", label: "Bachelors Year of Completion" },
  { key: "bachelorsPercentage", label: "Bachelors Percentage" },
  { key: "resume", label: "Resume", type: "resume" },
  { key: "resumeShortlisting", label: "Resume Shortlisting", options: SHORTLIST_OPTIONS },
  { key: "trRound1", label: "TR Round 1", options: ROUND_OPTIONS },
  { key: "trRound2", label: "TR Round 2", options: ROUND_OPTIONS },
  { key: "hrRound", label: "HR Round", options: ROUND_OPTIONS },
  { key: "mrRound", label: "MR Round", options: ROUND_OPTIONS },
  { key: "finalStatus", label: "Final Status", options: ROUND_OPTIONS },
];

const STATUS_COLUMNS = new Map(SHARED_COLUMNS.filter((column) => column.options).map((column) => [column.key, column]));
const DETAIL_KEYS = new Set(SHARED_COLUMNS.filter((column) => !column.options && column.type !== "resume").map((column) => column.key));
const CUSTOM_KEY = /^c_[A-Za-z0-9_-]{6,20}$/;
const MAX_CUSTOM_COLUMNS = 30;
const MAX_ROWS = 2000;
const MAX_TEXT = 2000;

export const sharedColumnView = (column) => ({
  key: column.key,
  label: column.label,
  type: column.options ? "select" : (column.type ?? "text"),
  options: column.options ?? [],
  custom: false,
  editable: Boolean(column.options),
});

const customColumnView = (column) => ({
  key: column.key,
  label: column.label,
  type: "text",
  options: [],
  custom: true,
  editable: true,
});

const asText = (value) => (value === null || value === undefined ? "" : String(value));
const firstText = (...values) => asText(values.find((value) => asText(value).trim() !== "")).trim();

export async function ensureSheet(job) {
  const existing = await SharedSheet.findOne({ jobId: job._id }).lean();
  if (existing) return existing;
  const candidates = await CandidateAnalysis.find({ jobId: job._id }, { publicRef: 1 }).sort({ finalRank: 1 }).lean();
  try {
    await SharedSheet.create({
      jobId: job._id,
      learningPortalJobId: job.learningPortalJobId ?? null,
      rows: candidates.map((candidate) => ({ ref: candidate.publicRef ?? null, source: "PSM", values: {}, createdAt: now() })),
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }
  return SharedSheet.findOne({ jobId: job._id }).lean();
}

async function studentDetailsByRef(job, refs) {
  if (!refs.length) return new Map();
  const candidates = await CandidateAnalysis.find(
    { jobId: job._id, publicRef: { $in: refs } },
    { publicRef: 1, studentId: 1, studentName: 1, resumeUrl: 1 },
  ).lean();
  const studentIds = candidates.map((candidate) => candidate.studentId);
  const [applications, eligible] = await Promise.all([
    JobApplication.find(
      { jobId: job._id, studentId: { $in: studentIds } },
      { studentId: 1, studentName: 1, email: 1, mobile: 1, profile: 1 },
    ).lean(),
    JobEligibleStudent.find(
      { jobId: job._id, studentId: { $in: studentIds } },
      { studentId: 1, studentName: 1, email: 1, mobile: 1 },
    ).lean(),
  ]);
  const applicationOf = new Map(applications.map((row) => [row.studentId, row]));
  const eligibleOf = new Map(eligible.map((row) => [row.studentId, row]));
  return new Map(
    candidates.map((candidate) => {
      const application = applicationOf.get(candidate.studentId) ?? {};
      const student = eligibleOf.get(candidate.studentId) ?? {};
      const profile = application.profile ?? {};
      return [
        candidate.publicRef,
        {
          hasResume: Boolean(candidate.resumeUrl),
          values: {
            fullName: firstText(application.studentName, candidate.studentName, student.studentName),
            mobile: firstText(application.mobile, student.mobile),
            email: firstText(application.email, student.email),
            bachelorsCourse: firstText(profile.bachelorsCourse),
            bachelorsDepartment: firstText(profile.bachelorsDepartment),
            bachelorsYear: firstText(profile.bachelorsYear),
            bachelorsPercentage: firstText(profile.bachelorsPercentage),
          },
        },
      ];
    }),
  );
}

const SHARED_STATUS = "RECOMMENDED";

async function recommendedOrder(job) {
  const recommended = await CandidateAnalysis.find(
    { jobId: job._id, candidateStatus: SHARED_STATUS, publicRef: { $nin: [null, ""] } },
    { publicRef: 1 },
  )
    .sort({ finalRank: 1, studentId: 1 })
    .lean();
  return new Map(recommended.map((candidate, index) => [candidate.publicRef, index]));
}

async function visibleSheet(job) {
  let sheet = await ensureSheet(job);
  const order = await recommendedOrder(job);
  const present = new Set(sheet.rows.filter((row) => row.source === "PSM").map((row) => row.ref));
  const missing = [...order.keys()].filter((ref) => !present.has(ref));
  if (missing.length) {
    for (const ref of missing) {
      await SharedSheet.updateOne(
        { jobId: job._id, rows: { $not: { $elemMatch: { source: "PSM", ref } } } },
        { $push: { rows: { ref, source: "PSM", values: {}, createdAt: now() } } },
      );
    }
    sheet = await SharedSheet.findOne({ jobId: job._id }).lean();
  }
  const shared = sheet.rows
    .filter((row) => row.source === "PSM" && order.has(row.ref))
    .sort((a, b) => order.get(a.ref) - order.get(b.ref));
  const added = sheet.rows.filter((row) => row.source === "ADDED");
  return { sheet, rows: [...shared, ...added] };
}

export async function sharedSheetView(job) {
  const { sheet, rows } = await visibleSheet(job);
  const customColumns = sheet.customColumns ?? [];
  const details = await studentDetailsByRef(
    job,
    rows.filter((row) => row.source === "PSM" && row.ref).map((row) => row.ref),
  );
  const editableKeys = [...STATUS_COLUMNS.keys(), ...customColumns.map((column) => column.key)];
  return {
    companyName: job.companyName,
    jobRole: job.jobRole,
    columns: [...SHARED_COLUMNS.map(sharedColumnView), ...customColumns.map(customColumnView)],
    rows: rows.map((row) => {
      const added = row.source === "ADDED";
      const student = added ? null : details.get(row.ref);
      const stored = Object.fromEntries(editableKeys.map((key) => [key, asText(row.values?.[key])]));
      const base = added
        ? Object.fromEntries([...DETAIL_KEYS].map((key) => [key, asText(row.values?.[key])]))
        : (student?.values ?? {});
      return {
        id: String(row._id),
        source: row.source,
        resumeRef: student?.hasResume ? row.ref : null,
        values: { ...base, ...stored },
      };
    }),
    updatedAt: sheet.updatedAt ? new Date(sheet.updatedAt).toISOString() : null,
  };
}

const rowObjectId = (rowId) => {
  if (!mongoose.isValidObjectId(rowId)) throw notFound("This row no longer exists");
  return new mongoose.Types.ObjectId(rowId);
};

function cleanValue(sheet, row, key, value) {
  const status = STATUS_COLUMNS.get(key);
  if (status) {
    const next = String(value ?? "").trim();
    if (next && !status.options.includes(next)) throw badRequest(`Pick one of: ${status.options.join(", ")}`);
    return next;
  }
  if (CUSTOM_KEY.test(key)) {
    if (!(sheet.customColumns ?? []).some((column) => column.key === key)) throw notFound("This column no longer exists");
    return String(value ?? "").slice(0, MAX_TEXT);
  }
  if (DETAIL_KEYS.has(key) && row.source === "ADDED") return String(value ?? "").slice(0, MAX_TEXT);
  throw badRequest("This column cannot be edited");
}

export async function updateSharedCell(job, rowId, key, value) {
  const sheet = await ensureSheet(job);
  const id = rowObjectId(rowId);
  const row = sheet.rows.find((item) => String(item._id) === String(id));
  if (!row) throw notFound("This row no longer exists");
  if (row.source === "PSM" && !(await recommendedOrder(job)).has(row.ref)) {
    throw notFound("This profile is no longer shared");
  }
  const next = cleanValue(sheet, row, key, value);
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "rows._id": id },
    { $set: { [`rows.$.values.${key}`]: next } },
  );
  if (!result.matchedCount) throw notFound("This row no longer exists");
}

export async function addSharedRow(job) {
  const sheet = await ensureSheet(job);
  if (sheet.rows.length >= MAX_ROWS) throw conflict(`A sheet can have at most ${MAX_ROWS} rows`, "TOO_MANY_ROWS");
  const row = { _id: new mongoose.Types.ObjectId(), ref: null, source: "ADDED", values: {}, createdAt: now() };
  await SharedSheet.updateOne({ jobId: job._id }, { $push: { rows: row } });
  const keys = [...DETAIL_KEYS, ...STATUS_COLUMNS.keys(), ...(sheet.customColumns ?? []).map((column) => column.key)];
  return { id: String(row._id), source: row.source, resumeRef: null, values: Object.fromEntries(keys.map((key) => [key, ""])) };
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
  if ((sheet.customColumns ?? []).length >= MAX_CUSTOM_COLUMNS) {
    throw conflict(`A sheet can have at most ${MAX_CUSTOM_COLUMNS} added columns`, "TOO_MANY_COLUMNS");
  }
  const column = { key: `c_${randomToken(6)}`, label: cleanLabel(label) };
  await SharedSheet.updateOne({ jobId: job._id }, { $push: { customColumns: column } });
  return customColumnView(column);
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
