import { z } from "zod";
import { CandidateAnalysis } from "../models/index.js";
import { JOB_ID_PATTERN, resolveSharedLink } from "../services/publicLinkService.js";
import {
  addSharedColumn,
  addSharedRow,
  deleteSharedColumn,
  deleteSharedRow,
  renameSharedColumn,
  sharedSheetView,
  updateSharedCell,
} from "../services/sharedSheetService.js";
import { notFound } from "../utils/errors.js";
import { sendResume } from "./psmController.js";

const jobId = z.string().regex(JOB_ID_PATTERN, "This link is not valid");
const columnKey = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Unknown column");

export const jobParams = z.object({ jobId });
export const rowParams = z.object({ jobId, rowId: z.string().min(1).max(40) });
export const columnParams = z.object({ jobId, key: columnKey });
export const resumeParams = z.object({ jobId, ref: z.string().min(8).max(40) });
export const cellSchema = z.object({ key: columnKey, value: z.string().max(2000) });
export const rowSchema = z.object({ values: z.record(z.string(), z.string().max(2000)).optional() });
export const columnSchema = z.object({ label: z.string().trim().min(1, "Enter a column name").max(60) });

async function sharedJob(req) {
  const { job } = await resolveSharedLink(req.valid.params.jobId);
  return job;
}

export async function sharedProfiles(req, res) {
  const job = await sharedJob(req);
  res.set("Cache-Control", "private, no-store");
  res.json(await sharedSheetView(job));
}

export async function updateCell(req, res) {
  const job = await sharedJob(req);
  await updateSharedCell(job, req.valid.params.rowId, req.valid.body.key, req.valid.body.value);
  res.status(204).end();
}

export async function addRow(req, res) {
  const job = await sharedJob(req);
  res.status(201).json({ row: await addSharedRow(job, req.valid.body.values ?? {}) });
}

export async function deleteRow(req, res) {
  const job = await sharedJob(req);
  await deleteSharedRow(job, req.valid.params.rowId);
  res.status(204).end();
}

export async function addColumn(req, res) {
  const job = await sharedJob(req);
  res.status(201).json({ column: await addSharedColumn(job, req.valid.body.label) });
}

export async function renameColumn(req, res) {
  const job = await sharedJob(req);
  await renameSharedColumn(job, req.valid.params.key, req.valid.body.label);
  res.status(204).end();
}

export async function deleteColumn(req, res) {
  const job = await sharedJob(req);
  await deleteSharedColumn(job, req.valid.params.key);
  res.status(204).end();
}

export async function sharedResume(req, res) {
  const job = await sharedJob(req);
  const candidate = await CandidateAnalysis.findOne({ jobId: job._id, publicRef: req.valid.params.ref }).lean();
  if (!candidate?.resumeUrl) throw notFound("Resume not found");
  await sendResume(
    res,
    candidate.resumeUrl,
    { studentId: candidate.studentId, studentName: candidate.studentName, jobSkills: job.skills ?? [] },
    `${candidate.studentName}-resume`,
  );
}
