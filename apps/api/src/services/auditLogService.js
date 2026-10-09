import mongoose from "mongoose";
import { APPROVAL_GATE_LABELS } from "../config/statuses.js";
import { AuditLog, Job, User } from "../models/index.js";
import { escapeRegex, formatDateTime } from "../utils/helpers.js";
import { AUDIT } from "./auditService.js";

const ROLE_LABELS = { ADMIN: "Admin", CRM: "CRM", PSM: "PSM", POOL_MANAGER: "Pool Manager", SYSTEM: "System" };
const ENV_LABELS = { beta: "Beta", prod: "Prod" };
const LOGIN_METHODS = { google: "Google", email_code: "an email code", dev: "the test login" };
const TASK_LABELS = {
  FETCH_DEAL: "Fetch deal",
  CREATE_JOB: "Prepare and load job",
  IDENTIFY_ELIGIBLE: "Find eligible students",
  GRANT_ACCESS: "Give job access",
  SEND_INITIAL_NOTIFICATIONS: "Start application window",
  APPLICATION_COUNT_SYNC: "Applied pool sync",
  REMINDER_10H: "First checkpoint",
  REMINDER_20H: "Second checkpoint",
  APPLICATION_CLOSE_21H: "Close window",
  FETCH_FINAL_POOL: "Final applicants",
  AI_ANALYSIS: "AI resume analysis",
  PRIORITY_GENERATION: "Priority ranking",
  CRM_NOTIFICATION: "CRM email",
  RETRY_NOTIFICATION: "Retry email",
  CALL_RESULTS_SYNC: "AI call results",
  HUBSPOT_DEAL_UPDATE: "HubSpot changes",
  HUBSPOT_WRITE_BACK: "Write to HubSpot",
  POOL_TARGET_EMAIL: "Expected pool email",
};
const POOL_FIELD_LABELS = {
  studentName: "name",
  niatId: "NIAT ID",
  email: "email",
  mobile: "mobile",
  productGroup: "product",
  campus: "campus",
  batch: "pass-out year",
  eligibilityStatus: "status",
  remarks: "remarks",
};

export const ACTION_LABELS = Object.freeze({
  [AUDIT.DEAL_SUBMITTED]: "Deal submitted",
  [AUDIT.DEAL_FETCHED]: "Deal fetched from HubSpot",
  [AUDIT.ORG_REUSED]: "Organisation reused",
  [AUDIT.ORG_CREATED]: "Organisation created",
  [AUDIT.JOB_LOADED]: "Job loaded to portal",
  [AUDIT.JOB_CREATED]: "Job ready",
  [AUDIT.HUBSPOT_JOB_ID_WRITTEN]: "Job ID written to HubSpot",
  [AUDIT.ELIGIBLE_IDENTIFIED]: "Eligible students found",
  [AUDIT.ACCESS_GRANTED]: "Job access given",
  [AUDIT.ELIGIBLE_ADDED]: "New eligible students added",
  [AUDIT.INITIAL_EMAIL_SENT]: "Job emails sent",
  [AUDIT.APPLICATIONS_OPENED]: "Application window opened",
  [AUDIT.APPLIED_POOL_SYNCED]: "Applied pool updated",
  [AUDIT.REMINDER_SENT]: "Checkpoint run",
  [AUDIT.AI_CALLS_TRIGGERED]: "AI calls started",
  [AUDIT.BOOST_EMAILS_SENT]: "Boost emails sent",
  [AUDIT.CALL_AGENT_CREATED]: "Call agent set up",
  [AUDIT.HUBSPOT_UPDATE_RECEIVED]: "HubSpot change detected",
  [AUDIT.HUBSPOT_UPDATE_APPLIED]: "HubSpot change applied",
  [AUDIT.JOB_UPDATE_RESPONSE]: "Job update answered",
  [AUDIT.APPLICATIONS_CLOSED]: "Application window closed",
  [AUDIT.AI_ANALYSIS_STARTED]: "AI analysis started",
  [AUDIT.AI_ANALYSIS_COMPLETED]: "AI analysis done",
  [AUDIT.PRIORITY_GENERATED]: "Priority ranking done",
  [AUDIT.PSM_REVIEW_STARTED]: "PSM review started",
  [AUDIT.PSM_CHANGED_CANDIDATE]: "Candidate changed",
  [AUDIT.PSM_SUBMITTED_POOL]: "Candidate pool submitted",
  [AUDIT.PUBLIC_LINK_GENERATED]: "Shared link created",
  [AUDIT.CRM_NOTIFIED]: "CRM emailed",
  [AUDIT.CRM_NOTIFICATION_SKIPPED]: "CRM email skipped",
  [AUDIT.POOL_TARGET_EMAILED]: "Expected pool reached",
  [AUDIT.STEP_FAILED]: "Step failed",
  [AUDIT.STEP_RETRIED]: "Step retried",
  [AUDIT.APPROVAL_REQUESTED]: "Waiting for approval",
  [AUDIT.STEP_APPROVED]: "Step approved",
  [AUDIT.PLANS_CHANGED]: "Course plans changed",
  [AUDIT.DEAL_STOPPED]: "Deal stopped",
  [AUDIT.DEAL_DELETED]: "Deal deleted",
  [AUDIT.LOGIN]: "Signed in",
  [AUDIT.LOGIN_CODE_SENT]: "Sign-in code sent",
  [AUDIT.USER_ADDED]: "User added",
  [AUDIT.USER_UPDATED]: "User changed",
  [AUDIT.POOL_SYNCED]: "Eligible Pool synced",
  [AUDIT.POOL_STUDENT_ADDED]: "Pool student added",
  [AUDIT.POOL_STUDENT_UPDATED]: "Pool student edited",
  [AUDIT.POOL_STUDENT_DELETED]: "Pool student deleted",
  [AUDIT.BIGQUERY_VIEWED]: "BigQuery table viewed",
  [AUDIT.SETTINGS_UPDATED]: "Settings changed",
  [AUDIT.COMPANY_CONTROLS_UPDATED]: "Company switches changed",
  [AUDIT.INTERVIEW_MEET_SCHEDULED]: "Meet created",
  [AUDIT.INTERVIEW_MEET_UPDATED]: "Meet moved",
  [AUDIT.INTERVIEWERS_UPDATED]: "Interviewer emails saved",
  [AUDIT.GOOGLE_CONNECTED]: "Google connected",
  [AUDIT.GOOGLE_DISCONNECTED]: "Google disconnected",
});

const humanize = (action) =>
  String(action ?? "")
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .join(" ")
    .replace(/^./, (letter) => letter.toUpperCase());

export const actionLabel = (action) => ACTION_LABELS[action] ?? humanize(action);

const number = (value) => Number(value ?? 0).toLocaleString("en-IN");
const shortId = (value) => (value ? String(value).slice(0, 8) : "");
const plural = (count, word) => `${number(count)} ${word}${Number(count) === 1 ? "" : "s"}`;
const list = (value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);

function emailCounts(meta) {
  const parts = [];
  if (meta.SENT) parts.push(`${number(meta.SENT)} sent`);
  if (meta.OFF) parts.push(`${number(meta.OFF)} not sent (turned off)`);
  if (meta.FAILED) parts.push(`${number(meta.FAILED)} failed`);
  if (meta.SKIPPED) parts.push(`${number(meta.SKIPPED)} skipped`);
  if (meta.DUPLICATE) parts.push(`${number(meta.DUPLICATE)} already sent`);
  return parts.length ? parts.join(", ") : "nobody to email";
}

function poolChanges(meta) {
  const changes = meta.changes && typeof meta.changes === "object" ? Object.entries(meta.changes) : [];
  if (changes.length) {
    return changes
      .map(([key, { from, to }]) => `${POOL_FIELD_LABELS[key] ?? key} ${from ?? "empty"} → ${to ?? "empty"}`)
      .join(", ");
  }
  return list(meta.fields).map((key) => POOL_FIELD_LABELS[key] ?? key).join(", ") || "no change";
}

const studentText = (log, meta) =>
  `${log.entityId}${meta.studentName ? ` (${meta.studentName}${meta.product ? `, ${meta.product}` : ""})` : ""}`;

const DESCRIBERS = {
  [AUDIT.DEAL_SUBMITTED]: (meta) => `Submitted HubSpot deal ${meta.hubspotDealId ?? ""}`.trim(),
  [AUDIT.DEAL_FETCHED]: (meta) =>
    `Fetched the deal from HubSpot: ${plural(meta.fields, "field")}, JD ${meta.jdCount ?? 1}, ${meta.logo ? "logo found" : "no logo found"}`,
  [AUDIT.ORG_REUSED]: (meta) =>
    `Reused organisation ${shortId(meta.organisationId)} (${meta.source === "SHEET" ? "found in the old tool's sheet" : "already used by this app"})`,
  [AUDIT.ORG_CREATED]: (meta) => `Created a new organisation ${shortId(meta.organisationId)} for ${meta.company ?? "the company"}`,
  [AUDIT.JOB_LOADED]: (meta) =>
    `Loaded job ${shortId(meta.learningPortalJobId)} to the Learning Portal ${ENV_LABELS[meta.environment] ?? meta.environment ?? ""}`.trim(),
  [AUDIT.JOB_CREATED]: (meta) =>
    `Job ${shortId(meta.learningPortalJobId)} is ready on ${list(meta.environments).map((env) => ENV_LABELS[env] ?? env).join(" and ") || "the portal"}`,
  [AUDIT.HUBSPOT_JOB_ID_WRITTEN]: (meta) => `Wrote the job ID to HubSpot deal ${meta.dealIds ?? ""}`.trim(),
  [AUDIT.ELIGIBLE_IDENTIFIED]: (meta) =>
    `Found ${plural(meta.eligibleCount, "eligible student")}${meta.products ? ` (${list(meta.products).join(", ")})` : ""}`,
  [AUDIT.ACCESS_GRANTED]: (meta, log, job) =>
    `Job access given to ${plural(meta.totalGranted ?? meta.granted, "student")} for job ${shortId(job?.learningPortalJobId)}${meta.rejected ? ` (${number(meta.rejected)} refused by the portal)` : ""}`,
  [AUDIT.ELIGIBLE_ADDED]: (meta) =>
    `Added ${plural(meta.added, "new eligible student")}${
      meta.accessNow
        ? `: job access given to ${number(meta.granted)}${meta.rejected ? `, ${number(meta.rejected)} refused by the portal` : ""}`
        : ", who get access when job access is approved"
    }`,
  [AUDIT.INITIAL_EMAIL_SENT]: (meta) => `Job email to students: ${emailCounts(meta)}`,
  [AUDIT.APPLICATIONS_OPENED]: (meta) =>
    `Application window opened${meta.closesAt ? `, closes ${formatDateTime(meta.closesAt)} IST` : ""}`,
  [AUDIT.APPLIED_POOL_SYNCED]: (meta) => `Applied pool updated: ${number(meta.previous)} → ${plural(meta.appliedCount, "student")} applied`,
  [AUDIT.REMINDER_SENT]: (meta) =>
    `${meta.reminder === "REMINDER_10H" ? "First" : "Second"} checkpoint: ${plural(meta.emailCount, "reminder email")}, ${plural(meta.callCount, "AI call")}${meta.product ? ` (${meta.product} students only)` : ""}`,
  [AUDIT.AI_CALLS_TRIGGERED]: (meta) =>
    `Started AI calls to ${plural(meta.queued, `${meta.product ? `${meta.product} ` : ""}student`)}${meta.skippedNoPhone ? ` (${number(meta.skippedNoPhone)} without a mobile)` : ""}`,
  [AUDIT.BOOST_EMAILS_SENT]: (meta) =>
    `Boost reminder emails${meta.product ? ` to ${meta.product} students` : ""}: ${emailCounts(meta)}`,
  [AUDIT.CALL_AGENT_CREATED]: (meta) => `Set up the NxtDial call agent ${meta.agentName ?? meta.agentId ?? ""}`.trim(),
  [AUDIT.HUBSPOT_UPDATE_RECEIVED]: (meta) =>
    meta.ignored ? `HubSpot change ignored: ${meta.reason ?? "outside the application window"}` : "HubSpot change detected",
  [AUDIT.HUBSPOT_UPDATE_APPLIED]: (meta) =>
    meta.studentFacing
      ? `HubSpot change applied (${list(meta.fields).join(", ") || "fields"}); job updated and ${plural(meta.SENT, "applied student")} emailed`
      : "HubSpot change saved (nothing students see changed)",
  [AUDIT.JOB_UPDATE_RESPONSE]: (meta) =>
    `Student ${meta.studentId ?? ""} answered the job update: ${meta.interested ? "still interested" : "not interested"}`,
  [AUDIT.APPLICATIONS_CLOSED]: (meta) =>
    meta.warning ? `Application window closed: ${meta.warning}` : `Application window closed with ${plural(meta.appliedCount, "applicant")}`,
  [AUDIT.AI_ANALYSIS_STARTED]: () => "AI resume analysis started",
  [AUDIT.AI_ANALYSIS_COMPLETED]: (meta) =>
    `AI resume analysis done: ${number(meta.analysed)} of ${number(meta.total)} analysed${meta.failed ? `, ${number(meta.failed)} failed` : ""}`,
  [AUDIT.PRIORITY_GENERATED]: (meta) => `Priority ranking done for ${plural(meta.candidates, "candidate")}`,
  [AUDIT.PSM_REVIEW_STARTED]: () => "Started the PSM review",
  [AUDIT.PSM_CHANGED_CANDIDATE]: (meta) =>
    `Changed candidate ${meta.studentId ?? ""} (${list(meta.fields).join(", ")})${meta.swappedWith ? `, swapped priority with ${meta.swappedWith}` : ""}`,
  [AUDIT.PSM_SUBMITTED_POOL]: () => "Submitted the final candidate pool",
  [AUDIT.PUBLIC_LINK_GENERATED]: () => "Created the shared profiles link",
  [AUDIT.CRM_NOTIFIED]: (meta) => `Emailed the shared profiles link to ${meta.to ?? "the CRM"}`,
  [AUDIT.CRM_NOTIFICATION_SKIPPED]: (meta) => `CRM email not sent: ${meta.reason ?? "turned off"}`,
  [AUDIT.POOL_TARGET_EMAILED]: (meta) =>
    `Expected pool reached (${number(meta.appliedCount)} of ${number(meta.expectedPoolCount)}); emailed ${meta.to ?? "the CRM"}`,
  [AUDIT.STEP_FAILED]: (meta) => `Step "${TASK_LABELS[meta.task] ?? meta.task ?? "unknown"}" failed: ${meta.error ?? ""}`.trim(),
  [AUDIT.STEP_RETRIED]: (meta) => `Retried the step "${TASK_LABELS[meta.task] ?? meta.task ?? "unknown"}"`,
  [AUDIT.APPROVAL_REQUESTED]: (meta) => `Waiting for approval: ${APPROVAL_GATE_LABELS[meta.gate] ?? meta.gate ?? ""}`,
  [AUDIT.STEP_APPROVED]: (meta) =>
    `Approved: ${APPROVAL_GATE_LABELS[meta.gate] ?? meta.gate ?? ""}${meta.note ? ` (${meta.note})` : ""}`,
  [AUDIT.PLANS_CHANGED]: (meta) => `Changed the course plans to ${list(meta.enrollPlans).join(", ") || "none"}`,
  [AUDIT.DEAL_STOPPED]: () => "Stopped the deal",
  [AUDIT.DEAL_DELETED]: (meta) =>
    `Deleted deal ${meta.hubspotDealId ?? ""}${meta.companyName ? ` (${meta.companyName}${meta.jobRole ? ` – ${meta.jobRole}` : ""})` : ""}`,
  [AUDIT.LOGIN]: (meta) => `Signed in with ${LOGIN_METHODS[meta.method] ?? meta.method ?? "Google"}`,
  [AUDIT.LOGIN_CODE_SENT]: (meta, log) => `Emailed a sign-in code to ${log.entityId}`,
  [AUDIT.USER_ADDED]: (meta, log) =>
    `Added user ${log.entityId} as ${ROLE_LABELS[meta.role] ?? meta.role ?? ""}${meta.products?.length ? ` (${[].concat(meta.products).join(", ")})` : ""}`,
  [AUDIT.USER_UPDATED]: (meta, log) => {
    const parts = [];
    if (meta.role) parts.push(`role ${ROLE_LABELS[meta.role] ?? meta.role}`);
    if (meta.products) parts.push(`products ${[].concat(meta.products).join(", ") || "none"}`);
    if (meta.isActive !== undefined) parts.push(meta.isActive ? "access turned on" : "access removed");
    if (meta.name !== undefined) parts.push("name");
    if (meta.hubspotOwnerId !== undefined) parts.push("HubSpot owner");
    return `Changed user ${log.entityId}${parts.length ? `: ${parts.join(", ")}` : ""}`;
  },
  [AUDIT.POOL_SYNCED]: (meta) =>
    `Synced the Eligible Pool from BigQuery: ${plural(meta.rowsRead, "row")} read${meta.removed ? `, ${number(meta.removed)} removed` : ""}`,
  [AUDIT.POOL_STUDENT_ADDED]: (meta, log) => `Added student ${studentText(log, meta)} to the Eligible Pool`,
  [AUDIT.POOL_STUDENT_UPDATED]: (meta, log) => `Edited student ${studentText(log, meta)}: ${poolChanges(meta)}`,
  [AUDIT.POOL_STUDENT_DELETED]: (meta, log) => `Deleted student ${studentText(log, meta)} from the Eligible Pool`,
  [AUDIT.BIGQUERY_VIEWED]: (meta, log) => `Viewed the BigQuery table ${log.entityId}`,
  [AUDIT.SETTINGS_UPDATED]: (meta) => `Changed settings: ${list(meta.changed).join(", ") || "no change"}`,
  [AUDIT.COMPANY_CONTROLS_UPDATED]: (meta) => {
    const switches = Object.entries(meta).filter(([key]) => key !== "company");
    return `Changed checkpoint switches for ${meta.company ?? "a company"}: ${switches.map(([key, value]) => `${key} ${value ? "on" : "off"}`).join(", ")}`;
  },
  [AUDIT.INTERVIEW_MEET_SCHEDULED]: (meta) =>
    `Created a Google Meet${meta.startAt ? ` for ${formatDateTime(meta.startAt)} IST` : ""} with ${plural(meta.guests, "guest")}, recording ${meta.recording === "ON" ? "on" : "not on"}`,
  [AUDIT.INTERVIEW_MEET_UPDATED]: (meta) =>
    `Moved a Google Meet${meta.startAt ? ` to ${formatDateTime(meta.startAt)} IST` : ""} (${plural(meta.guests, "guest")})`,
  [AUDIT.INTERVIEWERS_UPDATED]: (meta) => `Saved ${plural(meta.count, "interviewer email")} for ${meta.company ?? "the company"}`,
  [AUDIT.GOOGLE_CONNECTED]: (meta) => `Connected the Google account ${meta.email ?? ""} for Meets`.trim(),
  [AUDIT.GOOGLE_DISCONNECTED]: (meta) => `Disconnected the Google account ${meta.email ?? ""}`.trim(),
};

export function describeAudit(log, job) {
  const meta = log.metadata && typeof log.metadata === "object" ? log.metadata : {};
  const describe = DESCRIBERS[log.action];
  if (describe) {
    try {
      return describe(meta, log, job);
    } catch {
      return actionLabel(log.action);
    }
  }
  return actionLabel(log.action);
}

const isJobId = (value) => mongoose.isValidObjectId(value) && String(value).length === 24;

async function jobFilterIds(term) {
  const pattern = new RegExp(escapeRegex(term), "i");
  const jobs = await Job.find(
    { $or: [{ companyName: pattern }, { jobRole: pattern }, { hubspotDealId: pattern }, { learningPortalJobId: pattern }] },
    { _id: 1 },
  )
    .limit(500)
    .lean();
  return jobs.map((job) => String(job._id));
}

function dayRange(from, to) {
  const range = {};
  if (from) range.$gte = new Date(`${from}T00:00:00+05:30`);
  if (to) range.$lte = new Date(`${to}T23:59:59.999+05:30`);
  return Object.keys(range).length ? range : null;
}

export async function listAuditLogs({ search, actor, action, from, to, page, limit }) {
  const filter = {};
  const actors = [].concat(actor ?? []).filter(Boolean);
  const actions = [].concat(action ?? []).filter(Boolean);
  if (actors.length) filter.actorEmail = { $in: actors };
  if (actions.length) filter.action = { $in: actions };
  const range = dayRange(from, to);
  if (range) filter.createdAt = range;
  const term = search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    const jobIds = await jobFilterIds(term);
    filter.$or = [
      { entityId: pattern },
      { actorEmail: pattern },
      { action: pattern },
      { "metadata.hubspotDealId": pattern },
      { "metadata.companyName": pattern },
      { "metadata.studentName": pattern },
      ...(jobIds.length ? [{ entityType: "Job", entityId: { $in: jobIds } }] : []),
    ];
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);

  const jobIds = [...new Set(logs.filter((log) => log.entityType === "Job" && isJobId(log.entityId)).map((log) => log.entityId))];
  const emails = [...new Set(logs.map((log) => log.actorEmail).filter((email) => email && email !== "system"))];
  const [jobs, users] = await Promise.all([
    jobIds.length
      ? Job.find(
          { _id: { $in: jobIds } },
          { companyName: 1, jobRole: 1, hubspotDealId: 1, learningPortalJobId: 1 },
        ).lean()
      : [],
    emails.length ? User.find({ email: { $in: emails } }, { email: 1, name: 1 }).lean() : [],
  ]);
  const jobsById = new Map(jobs.map((job) => [String(job._id), job]));
  const namesByEmail = new Map(users.map((user) => [user.email, user.name]));

  return {
    items: logs.map((log) => {
      const job = log.entityType === "Job" ? jobsById.get(String(log.entityId)) : null;
      const meta = log.metadata && typeof log.metadata === "object" ? log.metadata : {};
      const system = !log.actorEmail || log.actorEmail === "system";
      return {
        id: String(log._id),
        at: new Date(log.createdAt).toISOString(),
        actor: system
          ? { email: null, name: "System", role: "SYSTEM", roleLabel: ROLE_LABELS.SYSTEM }
          : {
              email: log.actorEmail,
              name: namesByEmail.get(log.actorEmail) || log.actorEmail.split("@")[0],
              role: log.actorRole,
              roleLabel: ROLE_LABELS[log.actorRole] ?? log.actorRole,
            },
        action: log.action,
        label: actionLabel(log.action),
        text: describeAudit(log, job),
        entityType: log.entityType,
        entityId: log.entityId,
        deal:
          log.entityType === "Job"
            ? {
                jobId: String(log.entityId),
                hubspotDealId: job?.hubspotDealId ?? meta.hubspotDealId ?? null,
                companyName: job?.companyName ?? meta.companyName ?? null,
                jobRole: job?.jobRole ?? meta.jobRole ?? null,
                learningPortalJobId: job?.learningPortalJobId ?? null,
                deleted: !job,
              }
            : null,
        metadata: meta,
        ip: log.ip ?? null,
      };
    }),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function auditLogFilters() {
  const [emails, actions, users] = await Promise.all([
    AuditLog.distinct("actorEmail"),
    AuditLog.distinct("action"),
    User.find({}, { email: 1, name: 1, role: 1 }).lean(),
  ]);
  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  return {
    actors: [
      { value: "system", label: "System" },
      ...emails
        .filter((email) => email && email !== "system")
        .sort()
        .map((email) => ({ value: email, label: usersByEmail.get(email)?.name ? `${usersByEmail.get(email).name} (${email})` : email })),
    ],
    actions: actions
      .filter(Boolean)
      .map((value) => ({ value, label: actionLabel(value) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}
