import mongoose from "mongoose";
import { config, missingIntegrationSettings } from "../config/env.js";
import { CandidateAnalysis, CompanySettings, InterviewMeet, Job, PublicLink, SharedSheet } from "../models/index.js";
import { now } from "../utils/clock.js";
import { randomToken } from "../utils/crypto.js";
import { AppError, IntegrationError, badRequest, conflict, notFound } from "../utils/errors.js";
import { normalizeCompanyName } from "../utils/helpers.js";
import { AUDIT, audit } from "./auditService.js";
import { connectedOrganizer, googleConnectionProblem, meetAuthMode } from "./googleConnectionService.js";
import { integrations } from "./integrations.js";
import { sharedProfilesUrl } from "./publicLinkService.js";
import { getSettings } from "./settingsService.js";
import { ensureSheet, sharedSheetView, updateSharedCell } from "./sharedSheetService.js";

export const INTERVIEW_COLUMNS = [
  { key: "studentEmail", label: "Student Email" },
  { key: "meetLink", label: "Meet Link" },
  { key: "meetTime", label: "Meet Time" },
  { key: "recording", label: "Auto-recording", editable: false },
];

const INTERVIEW_KEYS = new Set(INTERVIEW_COLUMNS.map((column) => column.key));
const INTERNAL_KEY = /^i_[A-Za-z0-9_-]{6,20}$/;
const MAX_INTERNAL_COLUMNS = 30;
export const MAX_INTERVIEWERS = 20;
const MAX_GUESTS = 50;
const BUSY_MS = 2 * 60 * 1000;
const PAST_GRACE_MS = 5 * 60 * 1000;

const asText = (value) => (value === null || value === undefined ? "" : String(value));
const iso = (value) => (value ? new Date(value).toISOString() : null);
const companyKeyOf = (job) => job.companyKey || normalizeCompanyName(job.companyName) || null;
const isInternalKey = (key) => INTERVIEW_KEYS.has(key) || INTERNAL_KEY.test(key);
const uniqueEmails = (list) => [...new Set((list ?? []).map((email) => String(email).trim().toLowerCase()).filter(Boolean))];

function linkState(link) {
  if (!link.isActive) return "INACTIVE";
  return new Date(link.expiresAt).getTime() <= now().getTime() ? "EXPIRED" : "ACTIVE";
}

function cleanLabel(label) {
  const text = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) throw badRequest("Enter a column name");
  return text;
}

const rowObjectId = (rowId) => {
  if (!mongoose.isValidObjectId(rowId)) throw notFound("This row no longer exists");
  return new mongoose.Types.ObjectId(rowId);
};

export async function meetSetupProblem() {
  const missing = missingIntegrationSettings().meet;
  if (missing?.length) return `Google Meet is not set up yet: add ${missing.join(", ")} to apps/api/.env and restart the API`;
  return googleConnectionProblem();
}

async function displayOrganizer() {
  if (meetAuthMode() === "oauth") return (await connectedOrganizer()) ?? config.meet.organizerEmail ?? null;
  return config.meet.organizerEmail ?? null;
}

async function organizerFor(meet, crmEmail) {
  if (meetAuthMode() === "oauth") return connectedOrganizer();
  return meet.calendarEventId ? meet.organizerEmail : (config.meet.organizerEmail ?? crmEmail);
}

export async function interviewJob(jobId) {
  const [job, link] = await Promise.all([Job.findById(jobId).lean(), PublicLink.findOne({ jobId }).lean()]);
  if (!job || !link) throw notFound("This deal has no shared profiles link yet");
  return { job, link };
}

export async function interviewCompanies() {
  const links = await PublicLink.find({}).sort({ createdAt: -1 }).limit(2000).lean();
  const jobIds = links.map((link) => link.jobId);
  const [jobs, sheets, meets] = await Promise.all([
    Job.find(
      { _id: { $in: jobIds } },
      { companyName: 1, companyKey: 1, jobRole: 1, companyLogoUrl: 1, submittedBy: 1, crmOwnerEmail: 1 },
    ).lean(),
    SharedSheet.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      { $project: { jobId: 1, rows: { $size: { $filter: { input: "$rows", cond: { $eq: ["$$this.source", "PSM"] } } } } } },
    ]),
    InterviewMeet.aggregate([
      { $match: { jobId: { $in: jobIds }, meetUrl: { $ne: null } } },
      { $group: { _id: "$jobId", count: { $sum: 1 } } },
    ]),
  ]);
  const rowsByJob = new Map(sheets.map((sheet) => [String(sheet.jobId), sheet.rows]));
  const withoutSheet = jobIds.filter((id) => !rowsByJob.has(String(id)));
  if (withoutSheet.length) {
    const counts = await CandidateAnalysis.aggregate([
      { $match: { jobId: { $in: withoutSheet } } },
      { $group: { _id: "$jobId", count: { $sum: 1 } } },
    ]);
    for (const item of counts) rowsByJob.set(String(item._id), item.count);
  }
  const meetsByJob = new Map(meets.map((item) => [String(item._id), item.count]));
  const jobsById = new Map(jobs.map((job) => [String(job._id), job]));
  const keys = [...new Set(jobs.map(companyKeyOf).filter(Boolean))];
  const companies = keys.length ? await CompanySettings.find({ _id: { $in: keys } }, { interviewerEmails: 1 }).lean() : [];
  const interviewersByKey = new Map(companies.map((company) => [company._id, company.interviewerEmails ?? []]));

  return links
    .filter((link) => jobsById.has(String(link.jobId)))
    .map((link) => {
      const job = jobsById.get(String(link.jobId));
      const id = String(job._id);
      return {
        jobId: id,
        learningPortalJobId: link.learningPortalJobId,
        companyName: job.companyName ?? "",
        jobRole: job.jobRole ?? "",
        companyLogoUrl: job.companyLogoUrl ?? null,
        crmEmail: job.submittedBy ?? job.crmOwnerEmail ?? null,
        url: sharedProfilesUrl(link.learningPortalJobId, job.companyName),
        linkStatus: linkState(link),
        createdAt: iso(link.createdAt),
        expiresAt: iso(link.expiresAt),
        profiles: rowsByJob.get(id) ?? 0,
        meets: meetsByJob.get(id) ?? 0,
        interviewers: (interviewersByKey.get(companyKeyOf(job)) ?? []).length,
      };
    });
}

export async function companyInterviewers(job) {
  const key = companyKeyOf(job);
  if (!key) return [];
  const company = await CompanySettings.findById(key, { interviewerEmails: 1 }).lean();
  return company?.interviewerEmails ?? [];
}

export async function saveInterviewers(job, emails, actor) {
  const key = companyKeyOf(job);
  if (!key) throw badRequest("This deal has no company name");
  const next = uniqueEmails(emails);
  if (next.length > MAX_INTERVIEWERS) throw badRequest(`Add at most ${MAX_INTERVIEWERS} interviewer emails`);
  const current = await companyInterviewers(job);
  if (current.length === next.length && current.every((email, index) => email === next[index])) return next;
  await CompanySettings.updateOne(
    { _id: key },
    {
      $set: { interviewerEmails: next, updatedBy: actor?.email ?? null, updatedAt: now() },
      $setOnInsert: { companyName: job.companyName ?? "" },
    },
    { upsert: true },
  );
  await audit({
    actor,
    action: AUDIT.INTERVIEWERS_UPDATED,
    entityType: "Company",
    entityId: key,
    metadata: { company: job.companyName ?? "", count: next.length },
  });
  return next;
}

function meetView(meet) {
  if (!meet?.meetUrl) return null;
  return {
    meetUrl: meet.meetUrl,
    eventLink: meet.calendarEventLink ?? null,
    eventName: meet.eventName ?? "",
    description: meet.description ?? "",
    startAt: iso(meet.startAt),
    durationMinutes: meet.durationMinutes ?? null,
    timeZone: meet.timeZone ?? null,
    organizerEmail: meet.organizerEmail ?? null,
    crmEmail: meet.crmEmail ?? null,
    studentEmail: meet.studentEmail ?? null,
    interviewerEmails: meet.interviewerEmails ?? [],
    otherEmails: meet.otherEmails ?? [],
    recording: {
      status: meet.recording?.status ?? "PENDING",
      transcript: Boolean(meet.recording?.transcript),
      error: meet.recording?.error ?? null,
    },
    scheduledBy: meet.scheduledBy ?? null,
    updatedAt: iso(meet.updatedAt),
  };
}

export async function interviewSheet(job, link) {
  const shared = await sharedSheetView(job);
  const [sheet, meets, interviewerEmails, settings, meetProblem, organizerEmail] = await Promise.all([
    SharedSheet.findOne({ jobId: job._id }, { rows: 1, internalColumns: 1 }).lean(),
    InterviewMeet.find({ jobId: job._id }).lean(),
    companyInterviewers(job),
    getSettings(),
    meetSetupProblem(),
    displayOrganizer(),
  ]);
  const rowsById = new Map((sheet?.rows ?? []).map((row) => [String(row._id), row]));
  const meetsByRow = new Map(meets.map((meet) => [meet.rowId, meet]));
  const internalColumn = (column, custom) => ({
    key: column.key,
    label: column.label,
    type: "text",
    options: [],
    custom,
    editable: column.editable !== false,
    internal: true,
  });
  const internalColumns = [
    ...INTERVIEW_COLUMNS.map((column) => internalColumn(column, false)),
    ...(sheet?.internalColumns ?? []).map((column) => internalColumn(column, true)),
  ];

  return {
    jobId: String(job._id),
    learningPortalJobId: link.learningPortalJobId,
    companyName: job.companyName ?? "",
    jobRole: job.jobRole ?? "",
    companyLogoUrl: job.companyLogoUrl ?? null,
    url: sharedProfilesUrl(link.learningPortalJobId, job.companyName),
    linkStatus: linkState(link),
    totalApplied: job.appliedCount ?? 0,
    interviewerEmails,
    meetEnabled: settings.interviews.googleMeet,
    meetProblem,
    organizerEmail,
    columns: [...shared.columns.map((column) => ({ ...column, internal: false })), ...internalColumns],
    rows: shared.rows.map((row) => {
      const stored = rowsById.get(row.id);
      const internal = stored?.internal ?? {};
      const defaults = { studentEmail: row.values.email ?? "" };
      return {
        ...row,
        studentName: asText(row.values.fullName),
        values: {
          ...row.values,
          ...Object.fromEntries(
            internalColumns.map((column) => [column.key, asText(internal[column.key] ?? defaults[column.key])]),
          ),
        },
        meet: meetView(meetsByRow.get(row.id)),
      };
    }),
    updatedAt: shared.updatedAt,
  };
}

export async function updateInterviewCell(job, rowId, key, value) {
  if (!isInternalKey(key)) return updateSharedCell(job, rowId, key, value);
  if (key === "recording") throw badRequest("This column is filled in by Google Meet");
  const sheet = await ensureSheet(job);
  if (INTERNAL_KEY.test(key) && !(sheet.internalColumns ?? []).some((column) => column.key === key)) {
    throw notFound("This column no longer exists");
  }
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "rows._id": rowObjectId(rowId) },
    { $set: { [`rows.$.internal.${key}`]: String(value ?? "").slice(0, 2000) } },
  );
  if (!result.matchedCount) throw notFound("This row no longer exists");
}

export async function addInterviewColumn(job, label) {
  const sheet = await ensureSheet(job);
  if ((sheet.internalColumns ?? []).length >= MAX_INTERNAL_COLUMNS) {
    throw conflict(`This page can have at most ${MAX_INTERNAL_COLUMNS} added columns`, "TOO_MANY_COLUMNS");
  }
  const column = { key: `i_${randomToken(6)}`, label: cleanLabel(label) };
  await SharedSheet.updateOne({ jobId: job._id }, { $push: { internalColumns: column } });
  return { ...column, custom: true, editable: true, internal: true };
}

export async function renameInterviewColumn(job, key, label) {
  if (!INTERNAL_KEY.test(key)) throw badRequest("Only added columns can be renamed");
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "internalColumns.key": key },
    { $set: { "internalColumns.$.label": cleanLabel(label) } },
  );
  if (!result.matchedCount) throw notFound("This column no longer exists");
}

export async function deleteInterviewColumn(job, key) {
  if (!INTERNAL_KEY.test(key)) throw badRequest("Only added columns can be deleted");
  const result = await SharedSheet.updateOne(
    { jobId: job._id, "internalColumns.key": key },
    { $pull: { internalColumns: { key } }, $unset: { [`rows.$[].internal.${key}`]: "" } },
  );
  if (!result.matchedCount) throw notFound("This column no longer exists");
}

function meetTimeText(startAt, timeZone, durationMinutes) {
  const text = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(startAt);
  return `${text} (${durationMinutes} min)`;
}

function recordingText(recording) {
  if (recording.status === "ON") return recording.transcript ? "On, with transcript" : "On";
  if (recording.status === "FAILED") return `Not on: ${recording.error}`;
  return "";
}

async function lockMeet(job, rowId) {
  const stale = new Date(now().getTime() - BUSY_MS);
  try {
    return await InterviewMeet.findOneAndUpdate(
      { jobId: job._id, rowId, $or: [{ busyAt: null }, { busyAt: { $lt: stale } }] },
      { $set: { busyAt: now() }, $setOnInsert: { companyKey: companyKeyOf(job), companyName: job.companyName ?? null } },
      { upsert: true, returnDocument: "after" },
    ).lean();
  } catch (error) {
    if (error?.code === 11000) throw conflict("A Meet for this student is already being set up. Please wait a moment.", "MEET_BUSY");
    throw error;
  }
}

export async function scheduleMeet(job, rowId, input, actor) {
  const settings = await getSettings();
  if (!settings.interviews.googleMeet) {
    throw conflict("Google Meet interviews are turned off by the admin in Settings", "MEET_OFF");
  }
  const problem = await meetSetupProblem();
  if (problem) throw new AppError(503, "MEET_NOT_SET_UP", problem);

  const sheet = await ensureSheet(job);
  const row = sheet.rows.find((item) => String(item._id) === rowId);
  if (!row) throw notFound("This row no longer exists");

  const startAt = new Date(input.startAt);
  if (startAt.getTime() < now().getTime() - PAST_GRACE_MS) throw badRequest("Pick a date and time in the future");
  const endAt = new Date(startAt.getTime() + input.durationMinutes * 60 * 1000);
  const crmEmail = actor.email.toLowerCase();
  const studentEmail = input.studentEmail.toLowerCase();
  const interviewerEmails = uniqueEmails(input.interviewerEmails);
  const otherEmails = uniqueEmails(input.otherEmails);
  const attendees = uniqueEmails([crmEmail, studentEmail, ...interviewerEmails, ...otherEmails]);
  if (attendees.length > MAX_GUESTS) throw badRequest(`A Meet can have at most ${MAX_GUESTS} guests`);
  if (input.saveInterviewers) await saveInterviewers(job, interviewerEmails, actor);

  const meet = await lockMeet(job, rowId);
  const organizer = await organizerFor(meet, crmEmail);
  const updating = Boolean(meet.calendarEventId) && meet.organizerEmail === organizer;
  const details = {
    summary: input.eventName,
    description: input.description,
    startAt,
    endAt,
    timeZone: input.timeZone,
    attendees,
  };

  try {
    const client = integrations.meet;
    const meeting = updating
      ? await client.updateMeeting({ organizer, eventId: meet.calendarEventId, ...details })
      : await client.createMeeting({ organizer, eventId: `jf${String(meet._id)}`, ...details });

    let recording = meet.recording?.status === "ON" && meet.meetingCode === meeting.meetingCode ? meet.recording : null;
    let spaceName = meet.spaceName ?? null;
    if (!recording) {
      try {
        const result = await client.enableRecording({ organizer, meetingCode: meeting.meetingCode });
        recording = { status: "ON", transcript: Boolean(result.transcript), error: null };
        spaceName = result.spaceName ?? null;
      } catch (error) {
        recording = { status: "FAILED", transcript: false, error: String(error?.message ?? "unknown error").slice(0, 500) };
      }
    }

    const saved = await InterviewMeet.findOneAndUpdate(
      { _id: meet._id },
      {
        $set: {
          eventName: input.eventName,
          description: input.description,
          startAt,
          durationMinutes: input.durationMinutes,
          timeZone: input.timeZone,
          organizerEmail: organizer,
          crmEmail,
          studentEmail,
          interviewerEmails,
          otherEmails,
          calendarEventId: meeting.eventId,
          calendarEventLink: meeting.eventLink,
          meetUrl: meeting.meetUrl,
          meetingCode: meeting.meetingCode,
          spaceName,
          recording,
          busyAt: null,
          scheduledBy: crmEmail,
        },
        $inc: { scheduleCount: 1 },
      },
      { returnDocument: "after" },
    ).lean();

    const values = {
      studentEmail,
      meetLink: meeting.meetUrl,
      meetTime: meetTimeText(startAt, input.timeZone, input.durationMinutes),
      recording: recordingText(recording),
    };
    await SharedSheet.updateOne(
      { jobId: job._id, "rows._id": row._id },
      { $set: Object.fromEntries(Object.entries(values).map(([key, value]) => [`rows.$.internal.${key}`, value])) },
    );
    await audit({
      actor,
      action: updating ? AUDIT.INTERVIEW_MEET_UPDATED : AUDIT.INTERVIEW_MEET_SCHEDULED,
      entityId: job._id,
      metadata: { rowId, startAt: startAt.toISOString(), guests: attendees.length, recording: recording.status },
    });
    return { meet: meetView(saved), values };
  } catch (error) {
    await InterviewMeet.updateOne({ _id: meet._id }, { $set: { busyAt: null } });
    if (error instanceof IntegrationError) throw new AppError(502, "MEET_FAILED", error.message);
    throw error;
  }
}
