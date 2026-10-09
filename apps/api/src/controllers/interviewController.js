import { z } from "zod";
import { config } from "../config/env.js";
import {
  disconnectGoogle,
  finishGoogleConnect,
  googleConnectUrl,
  googleConnectionStatus,
} from "../services/googleConnectionService.js";
import {
  MAX_INTERVIEWERS,
  addInterviewColumn,
  deleteInterviewColumn,
  interviewCompanies,
  interviewJob,
  interviewSheet,
  renameInterviewColumn,
  saveInterviewers,
  scheduleMeet,
  meetSetupProblem,
  updateInterviewCell,
} from "../services/interviewService.js";
import { randomToken, timingSafeEqualStrings } from "../utils/crypto.js";
import { logger } from "../utils/logger.js";

const jobId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid job id");
const rowId = z.string().regex(/^[a-f0-9]{24}$/i, "This row no longer exists");
const columnKey = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, "Unknown column");
const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);
const emails = (max, what) => z.array(email).max(max, `Add at most ${max} ${what}`);

const validTimeZone = (value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const RETURN_PATH = /^\/crm\/interviews(\/[a-f0-9]{24})?$/;
const STATE_COOKIE = "jf_google_state";
const stateCookieOptions = () => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: "lax",
  path: "/api/interviews/google",
});

export const connectQuery = z.object({ returnTo: z.string().regex(RETURN_PATH).optional() });
export const jobParams = z.object({ jobId });
export const rowParams = z.object({ jobId, rowId });
export const columnParams = z.object({ jobId, key: columnKey });
export const cellSchema = z.object({ key: columnKey, value: z.string().max(2000) });
export const columnSchema = z.object({ label: z.string().trim().min(1, "Enter a column name").max(60) });
export const interviewersSchema = z.object({ emails: emails(MAX_INTERVIEWERS, "interviewer emails") });
export const meetSchema = z.object({
  eventName: z.string().trim().min(1, "Enter an event name").max(200),
  description: z.string().trim().max(4000).default(""),
  startAt: z.iso.datetime({ offset: true, error: "Pick a date and time" }),
  durationMinutes: z.number().int().min(15, "A Meet must be at least 15 minutes").max(480, "A Meet can be at most 8 hours"),
  timeZone: z.string().trim().min(1).max(64).refine(validTimeZone, "Unknown time zone").default("Asia/Kolkata"),
  studentEmail: email,
  interviewerEmails: emails(MAX_INTERVIEWERS, "interviewer emails").default([]),
  otherEmails: emails(20, "other guests").default([]),
  saveInterviewers: z.boolean().default(true),
});

export async function listCompanies(req, res) {
  res.json({ items: await interviewCompanies() });
}

export async function sheet(req, res) {
  const { job, link } = await interviewJob(req.valid.params.jobId);
  res.set("Cache-Control", "private, no-store");
  res.json(await interviewSheet(job, link));
}

export async function updateInterviewers(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  res.json({ interviewerEmails: await saveInterviewers(job, req.valid.body.emails, req.user) });
}

export async function updateCell(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  await updateInterviewCell(job, req.valid.params.rowId, req.valid.body.key, req.valid.body.value);
  res.status(204).end();
}

export async function addColumn(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  res.status(201).json({ column: await addInterviewColumn(job, req.valid.body.label) });
}

export async function renameColumn(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  await renameInterviewColumn(job, req.valid.params.key, req.valid.body.label);
  res.status(204).end();
}

export async function deleteColumn(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  await deleteInterviewColumn(job, req.valid.params.key);
  res.status(204).end();
}

export async function createMeet(req, res) {
  const { job } = await interviewJob(req.valid.params.jobId);
  res.json(await scheduleMeet(job, req.valid.params.rowId, req.valid.body, req.user));
}

export async function googleStatus(req, res) {
  res.json({ ...(await googleConnectionStatus()), problem: await meetSetupProblem() });
}

export async function googleConnect(req, res) {
  const returnTo = req.valid.query.returnTo ?? "/crm/interviews";
  const status = await googleConnectionStatus();
  if (!status.configured) return res.redirect(`${config.frontendUrl}${returnTo}?google=setup`);
  const state = randomToken(24);
  res.cookie(STATE_COOKIE, { state, returnTo }, { ...stateCookieOptions(), maxAge: 10 * 60 * 1000 });
  res.redirect(googleConnectUrl(state));
}

export async function googleCallback(req, res) {
  const saved = req.cookies?.[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, stateCookieOptions());
  const returnTo = typeof saved?.returnTo === "string" && RETURN_PATH.test(saved.returnTo) ? saved.returnTo : "/crm/interviews";
  const back = (result) => res.redirect(`${config.frontendUrl}${returnTo}?google=${result}`);
  if (req.query.error) return back(req.query.error === "access_denied" ? "denied" : "failed");
  if (typeof saved?.state !== "string" || !timingSafeEqualStrings(saved.state, String(req.query.state ?? ""))) return back("state");
  if (typeof req.query.code !== "string" || !req.query.code) return back("failed");
  try {
    await finishGoogleConnect(req.query.code, req.user);
    return back("connected");
  } catch (error) {
    const reason = error?.details?.reason;
    if (!reason) logger.error({ err: error }, "Connect Google failed");
    return back(reason ?? "failed");
  }
}

export async function googleDisconnect(req, res) {
  await disconnectGoogle(req.user);
  res.status(204).end();
}
