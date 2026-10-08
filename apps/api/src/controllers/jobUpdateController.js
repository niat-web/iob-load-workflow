import { z } from "zod";
import { INTEREST_REASONS } from "../models/index.js";
import { jobUpdateForm, submitJobUpdateForm } from "../services/jobUpdateService.js";

export const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/, "Invalid link") });

const userId = z.string().trim().min(1, "The link has no student").max(100);

export const formQuery = z.object({
  user_id: userId,
  job_id: z.string().trim().max(100).optional(),
});

export const submitSchema = z.object({
  userId,
  jobId: z.string().trim().max(100).optional(),
  interested: z.boolean(),
  reason: z.enum(INTEREST_REASONS).nullable().optional(),
  comments: z.string().trim().max(1000).optional(),
});

export async function getForm(req, res) {
  const { user_id: id, job_id: jobId } = req.valid.query;
  res.json(await jobUpdateForm({ token: req.valid.params.token, jobId, userId: id }));
}

export async function submitForm(req, res) {
  const body = req.valid.body;
  res.json(await submitJobUpdateForm({ ...body, token: req.valid.params.token }, req.ip));
}
