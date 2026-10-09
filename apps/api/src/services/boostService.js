import { config, missingIntegrationSettings } from "../config/env.js";
import { NOTIFICATION_TYPE, TASK_TYPE, WINDOW_STATUSES } from "../config/statuses.js";
import { AI_CALL_FINAL, AiCall, Job, JobEligibleStudent } from "../models/index.js";
import { now } from "../utils/clock.js";
import { AppError, conflict } from "../utils/errors.js";
import { formatDateTime, normalizePhone } from "../utils/helpers.js";
import { AUDIT, audit } from "./auditService.js";
import { ensureCallAgent } from "./callAgentService.js";
import { REMINDER_PRODUCT, reminderAudience } from "./eligibilityService.js";
import { integrations } from "./integrations.js";
import { notificationKey, sendBulk } from "./notificationService.js";
import { getSettings } from "./settingsService.js";
import { enqueueTask } from "./taskQueue.js";

const LOCK_MS = 2 * 60 * 1000;
const SYNC_HORIZON_MS = 12 * 60 * 60 * 1000;
const RATING_WAIT_MS = 30 * 60 * 1000;
const ACTIVE_STATUSES = ["QUEUED", "CALLING"];


const windowOpen = (job) => WINDOW_STATUSES.includes(job.status);
const iso = (date) => (date ? new Date(date).toISOString() : null);

async function niatNotApplied(job) {
  const audience = await reminderAudience(job);
  if (!audience.niatWithAccess) {
    throw conflict(
      "Reminders and AI calls are for NIAT students only, and this deal has no NIAT students with access.",
      "NO_NIAT_STUDENTS",
    );
  }
  return audience.students;
}

const headerKey = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function cellValue(cells, header) {
  const name = Object.keys(cells ?? {}).find((key) => headerKey(key) === headerKey(header));
  const value = name ? cells[name]?.value : undefined;
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text || null;
}

const PROVIDER_STATUS = {
  completed: "COMPLETED",
  timeout: "COMPLETED",
  "silence-timeout": "COMPLETED",
  disconnected: "COMPLETED",
  "no-answer": "NO_ANSWER",
  noanswer: "NO_ANSWER",
  voicemail: "NO_ANSWER",
  busy: "BUSY",
  failed: "FAILED",
  error: "FAILED",
  canceled: "CANCELLED",
  cancelled: "CANCELLED",
  queued: "QUEUED",
  pending: "QUEUED",
  scheduled: "QUEUED",
  initiated: "CALLING",
  ringing: "CALLING",
  "in-progress": "CALLING",
  answered: "CALLING",
};

export const mapProviderStatus = (status) => PROVIDER_STATUS[String(status ?? "").toLowerCase()] ?? "CALLING";

function toCallRow(call) {
  return {
    id: String(call._id),
    batchId: call.batchId,
    studentId: call.studentId,
    name: call.name,
    phone: call.phone,
    status: call.status,
    durationSeconds: call.durationSeconds,
    interested: call.interested,
    willApply: call.willApply,
    reason: call.reason,
    questions: call.questions,
    callBack: call.callBack,
    overallRating: call.overallRating,
    remarks: call.remarks,
    summary: call.summary,
    recordingUrl: call.recordingUrl,
    error: call.error,
    calledAt: iso(call.startedAt ?? call.createdAt),
    endedAt: iso(call.endedAt),
  };
}

async function takeLock(job, field) {
  const stale = new Date(now().getTime() - LOCK_MS);
  const locked = await Job.findOneAndUpdate(
    { _id: job._id, $or: [{ [`boost.${field}`]: null }, { [`boost.${field}`]: { $lt: stale } }] },
    { $set: { [`boost.${field}`]: now() } },
  );
  if (!locked) throw conflict("This action is already running. Please wait a moment.", "BOOST_BUSY");
}

const releaseLock = (job, field) => Job.updateOne({ _id: job._id }, { $set: { [`boost.${field}`]: null } });

function nxtDialProblem() {
  const missing = missingIntegrationSettings().nxtdial;
  return missing?.length ? `NxtDial is not set up yet: add ${missing.join(", ")} to apps/api/.env` : null;
}

export async function boostOverview(job) {
  const [audience, eligibleCount, calls] = await Promise.all([
    reminderAudience(job),
    JobEligibleStudent.countDocuments({ jobId: job._id, accessGrantedAt: { $ne: null } }),
    AiCall.find({ jobId: job._id }).sort({ createdAt: -1 }).limit(2000).lean(),
  ]);
  const students = audience.students;
  const counts = Object.fromEntries(["QUEUED", "CALLING", ...AI_CALL_FINAL].map((status) => [status, 0]));
  for (const call of calls) counts[call.status] = (counts[call.status] ?? 0) + 1;
  const settings = await getSettings();
  const lastEmail = job.boost?.emailRuns?.at(-1)?.at;
  const cooldownMs = settings.timing.boostEmailCooldownMinutes * 60 * 1000;
  const emailAvailableAt = lastEmail ? new Date(new Date(lastEmail).getTime() + cooldownMs) : null;

  return {
    deal: {
      id: String(job._id),
      hubspotDealId: job.hubspotDealId,
      companyName: job.companyName,
      jobRole: job.jobRole,
      expectedPoolCount: job.expectedPoolCount ?? null,
      appliedCount: job.appliedCount ?? 0,
      eligibleCount,
      applicationEndAt: iso(job.applicationEndAt),
      windowOpen: windowOpen(job),
      poolTargetReached: Boolean(job.poolTargetReached),
    },
    notApplied: {
      product: REMINDER_PRODUCT,
      total: students.length,
      withEmail: students.filter((student) => student.email).length,
      withPhone: students.filter((student) => normalizePhone(student.mobile)).length,
      niatWithAccess: audience.niatWithAccess,
      othersWithAccess: audience.othersWithAccess,
    },
    emails: {
      availableAt: emailAvailableAt && emailAvailableAt > now() ? iso(emailAvailableAt) : null,
      runs: (job.boost?.emailRuns ?? []).map((run) => ({ ...run, at: iso(run.at) })).reverse(),
    },
    calls: {
      setupProblem: nxtDialProblem(),
      agentId: config.nxtdial.agentId || job.boost?.callAgentId || null,
      agentCreatedAt: iso(job.boost?.callAgentCreatedAt),
      spokenJd: job.boost?.spokenJd ?? null,
      active: counts.QUEUED + counts.CALLING > 0,
      counts,
      interested: calls.filter((call) => call.interested?.toLowerCase() === "yes").length,
      willApply: calls.filter((call) => call.willApply?.toLowerCase() === "yes").length,
      runs: (job.boost?.callRuns ?? []).map((run) => ({ ...run, at: iso(run.at) })).reverse(),
      lastSyncedAt: iso(job.boost?.lastCallSyncAt),
      items: calls.map(toCallRow),
    },
    controls: { reminderEmails: settings.studentEmails.boostReminder, aiCalls: settings.aiCalls.enabled },
  };
}

export async function sendBoostEmails(job, actor) {
  const { studentEmails, timing } = await getSettings();
  if (!studentEmails.boostReminder) {
    throw conflict("Reminder emails to students are turned off by the admin in Settings.", "STUDENT_EMAILS_OFF");
  }
  if (!windowOpen(job)) throw conflict("The application window is closed.", "WINDOW_CLOSED");
  const lastEmail = job.boost?.emailRuns?.at(-1)?.at;
  const cooldownMs = timing.boostEmailCooldownMinutes * 60 * 1000;
  if (lastEmail && now().getTime() - new Date(lastEmail).getTime() < cooldownMs) {
    throw conflict(
      `Reminder emails were sent at ${formatDateTime(lastEmail)}. You can send again after ${timing.boostEmailCooldownMinutes} minutes.`,
      "EMAIL_COOLDOWN",
    );
  }
  await takeLock(job, "emailLockAt");
  try {
    const recipients = await niatNotApplied(job);
    const withEmail = recipients.filter((student) => student.email);
    if (!withEmail.length) throw conflict("No NIAT student who has not applied has an email address.", "NO_RECIPIENTS");
    const run = (job.boost?.emailRuns?.length ?? 0) + 1;
    const type = NOTIFICATION_TYPE.BOOST_REMINDER;
    const counts = await sendBulk({
      job,
      type,
      recipients: withEmail,
      keyFor: (student) => notificationKey(job._id, type, student.studentId, `run${run}`),
    });
    const entry = {
      at: now(),
      by: actor?.email ?? null,
      recipients: withEmail.length,
      sent: counts.SENT,
      skipped: counts.SKIPPED + counts.DUPLICATE + counts.OFF,
      failed: counts.FAILED + counts.RETRYING,
    };
    await Job.updateOne({ _id: job._id }, { $push: { "boost.emailRuns": entry } });
    await audit({
      actor,
      action: AUDIT.BOOST_EMAILS_SENT,
      entityId: job._id,
      metadata: { run, ...counts, product: REMINDER_PRODUCT },
    });
    return { ...entry, at: iso(entry.at) };
  } finally {
    await releaseLock(job, "emailLockAt");
  }
}

export async function startAiCalls(job, actor) {
  if (!(await getSettings()).aiCalls.enabled) throw conflict("AI calls are turned off by the admin in Settings.", "AI_CALLS_OFF");
  if (!windowOpen(job)) throw conflict("The application window is closed.", "WINDOW_CLOSED");
  const problem = nxtDialProblem();
  if (problem) throw new AppError(503, "NXTDIAL_NOT_CONFIGURED", problem);
  if (await AiCall.exists({ jobId: job._id, status: { $in: ACTIVE_STATUSES } })) {
    throw conflict("AI calls for this deal are still in progress. Wait until they finish.", "CALLS_RUNNING");
  }
  await takeLock(job, "callLockAt");
  try {
    const reached = new Set(await AiCall.distinct("studentId", { jobId: job._id, status: "COMPLETED" }));
    const students = await niatNotApplied(job);
    const callable = [];
    let skippedNoPhone = 0;
    const seen = new Set();
    for (const student of students) {
      if (reached.has(student.studentId)) continue;
      const phone = normalizePhone(student.mobile);
      if (!phone) {
        skippedNoPhone += 1;
        continue;
      }
      if (seen.has(phone)) continue;
      seen.add(phone);
      callable.push({ ...student, phone });
    }
    if (!callable.length) {
      throw conflict(
        skippedNoPhone
          ? `None of the ${skippedNoPhone} NIAT students who have not applied has a valid mobile number.`
          : "Every NIAT student who has not applied has already been reached by an AI call.",
        "NO_RECIPIENTS",
      );
    }

    const fresh = await Job.findById(job._id).lean();
    const { agentId, spokenJd } = await ensureCallAgent(fresh, actor);
    const deadline = fresh.applicationEndAt ? `${formatDateTime(fresh.applicationEndAt)} IST` : "the deadline on the portal";
    const batch = await integrations.nxtdial.createBatch({
      name: `${fresh.companyName} · ${fresh.jobRole} · ${formatDateTime(now())}`.slice(0, 120),
      agentId,
      fromNumber: config.nxtdial.fromNumber,
    });
    await integrations.nxtdial.startBatch(
      batch.id,
      callable.map((student) => ({
        name: student.studentName || "there",
        phone: student.phone,
        ...(student.email ? { email: student.email } : {}),
        metadata: { jd: spokenJd, deadline, company: fresh.companyName ?? "", role: fresh.jobRole ?? "" },
      })),
    );
    await AiCall.insertMany(
      callable.map((student) => ({
        jobId: job._id,
        batchId: batch.id,
        studentId: student.studentId,
        name: student.studentName ?? "",
        phone: student.phone,
        status: "QUEUED",
        requestedBy: actor?.email ?? null,
      })),
      { ordered: false },
    );
    const run = { batchId: batch.id, at: now(), by: actor?.email ?? null, agentId, queued: callable.length, skippedNoPhone };
    await Job.updateOne({ _id: job._id }, { $push: { "boost.callRuns": run } });
    await audit({
      actor,
      action: AUDIT.AI_CALLS_TRIGGERED,
      entityId: job._id,
      metadata: { batchId: batch.id, agentId, queued: callable.length, skippedNoPhone, product: REMINDER_PRODUCT },
    });
    await scheduleResultsSync(job);
    return { ...run, at: iso(run.at) };
  } finally {
    await releaseLock(job, "callLockAt");
  }
}

export async function scheduleResultsSync(job, delayMinutes = config.nxtdial.resultsSyncMinutes) {
  const at = new Date(now().getTime() + delayMinutes * 60 * 1000);
  await enqueueTask({
    jobId: job._id,
    type: TASK_TYPE.CALL_RESULTS_SYNC,
    scheduledFor: at,
    dedupeKey: `${job._id}:${TASK_TYPE.CALL_RESULTS_SYNC}:${at.getTime()}`,
  });
}

function pickResult(results) {
  const byPhone = new Map();
  for (const result of results) {
    const phone = normalizePhone(result.phone);
    if (!phone) continue;
    const current = byPhone.get(phone);
    const better =
      !current ||
      mapProviderStatus(result.status) === "COMPLETED" ||
      mapProviderStatus(current.status) !== "COMPLETED";
    if (better) byPhone.set(phone, result);
  }
  return byPhone;
}

export async function syncCallResults(job) {
  const pending = await AiCall.find({
    jobId: job._id,
    $or: [{ status: { $in: ACTIVE_STATUSES } }, { status: "COMPLETED", ratingStatus: { $nin: ["rated", "failed", "skipped"] } }],
  }).lean();
  const batchIds = [...new Set(pending.map((call) => call.batchId))];
  for (const batchId of batchIds) {
    const { calls } = await integrations.nxtdial.getBatchResults(batchId);
    const results = pickResult(calls);
    const rows = pending.filter((call) => call.batchId === batchId);
    await Promise.all(
      rows.map((row) => {
        const result = results.get(row.phone);
        if (!result) return null;
        const cells = result.rating?.cells ?? null;
        return AiCall.updateOne(
          { _id: row._id },
          {
            $set: {
              nxtDialCallId: result.callId ?? row.nxtDialCallId,
              status: mapProviderStatus(result.status),
              providerStatus: result.status ?? null,
              durationSeconds: result.durationSeconds ?? null,
              startedAt: result.answeredAt ?? result.startedAt ?? null,
              endedAt: result.endedAt ?? null,
              recordingUrl: result.recordingUrl ?? null,
              summary: result.summary ?? null,
              ratingStatus: result.ratingStatus ?? null,
              overallRating: result.rating?.overallRating ?? null,
              remarks: result.rating?.remarks ?? null,
              cells,
              interested: cellValue(cells, "Interested"),
              willApply: cellValue(cells, "Will Apply"),
              reason: cellValue(cells, "Reason Not Applied"),
              questions: cellValue(cells, "Questions Asked"),
              callBack: cellValue(cells, "Call Back Requested") ?? (result.rating?.callBack || null),
              error: result.errorMessage ?? null,
            },
          },
        );
      }),
    );
  }
  await Job.updateOne({ _id: job._id }, { $set: { "boost.lastCallSyncAt": now() } });

  const waitingSince = new Date(now().getTime() - RATING_WAIT_MS);
  const stillActive = await AiCall.exists({
    jobId: job._id,
    $or: [
      { status: { $in: ACTIVE_STATUSES } },
      { status: "COMPLETED", ratingStatus: { $nin: ["rated", "failed", "skipped"] }, updatedAt: { $gt: waitingSince } },
    ],
  });
  return { active: Boolean(stillActive), batches: batchIds.length };
}

export async function runResultsSyncTask(job) {
  const lastRun = job.boost?.callRuns?.at(-1)?.at;
  const { active } = await syncCallResults(job);
  const withinHorizon = lastRun && now().getTime() - new Date(lastRun).getTime() < SYNC_HORIZON_MS;
  if (active && withinHorizon) await scheduleResultsSync(job);
}
