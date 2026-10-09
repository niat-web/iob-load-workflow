import mongoose from "mongoose";
import { CandidateAnalysis, JobApplication, JobEligibleStudent, SharedSheet } from "../models/index.js";
import { now } from "../utils/clock.js";
import { badRequest, notFound } from "../utils/errors.js";

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

export const sharedColumnView = (column) => ({
  key: column.key,
  label: column.label,
  type: column.options ? "select" : (column.type ?? "text"),
  options: column.options ?? [],
  custom: false,
  editable: Boolean(column.options),
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

export async function sharedSheetView(job) {
  const sheet = await ensureSheet(job);
  const rows = sheet.rows.filter((row) => row.source === "PSM");
  const details = await studentDetailsByRef(job, rows.map((row) => row.ref).filter(Boolean));
  return {
    companyName: job.companyName,
    jobRole: job.jobRole,
    columns: SHARED_COLUMNS.map(sharedColumnView),
    rows: rows.map((row) => {
      const student = details.get(row.ref);
      const statuses = Object.fromEntries([...STATUS_COLUMNS.keys()].map((key) => [key, asText(row.values?.[key])]));
      return {
        id: String(row._id),
        resumeRef: student?.hasResume ? row.ref : null,
        values: { ...(student?.values ?? {}), ...statuses },
      };
    }),
    updatedAt: sheet.updatedAt ? new Date(sheet.updatedAt).toISOString() : null,
  };
}

const rowObjectId = (rowId) => {
  if (!mongoose.isValidObjectId(rowId)) throw notFound("This row no longer exists");
  return new mongoose.Types.ObjectId(rowId);
};

export async function updateSharedCell(job, rowId, key, value) {
  const column = STATUS_COLUMNS.get(key);
  if (!column) throw badRequest("This column cannot be edited");
  const next = String(value ?? "").trim();
  if (next && !column.options.includes(next)) throw badRequest(`Pick one of: ${column.options.join(", ")}`);
  await ensureSheet(job);
  const result = await SharedSheet.updateOne(
    { jobId: job._id, rows: { $elemMatch: { _id: rowObjectId(rowId), source: "PSM" } } },
    { $set: { [`rows.$.values.${key}`]: next } },
  );
  if (!result.matchedCount) throw notFound("This row no longer exists");
}
