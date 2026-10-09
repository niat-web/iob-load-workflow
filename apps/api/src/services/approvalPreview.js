import { config } from "../config/env.js";
import { LOGO_SOURCE_LABELS } from "../config/logoSources.js";
import { APPROVAL_GATE as GATE, APPROVAL_GATE_LABELS, loadGateFor } from "../config/statuses.js";
import { JobEligibleStudent, LearningPortalOrganisation } from "../models/index.js";
import { now } from "../utils/clock.js";
import { hoursFromNow } from "../utils/helpers.js";
import { hubspotRecordUrl } from "./dealMapper.js";
import { ALL_ENROLL_PLANS, payloadForEnvironment, testUsersFor } from "./learningPortal/nkbPayload.js";
import { getSettings } from "./settingsService.js";

const DESCRIPTIONS = {
  [GATE.DEAL_DETAILS]:
    "Check the deal details read from HubSpot. Approving prepares the job for the Learning Portal; nothing is sent to the portal yet.",
  [GATE.LOAD_BETA]:
    "Approving creates the organisation in Beta if it is new, loads this job into Beta and gives the Beta test accounts access.",
  [GATE.LOAD_PROD]:
    "Check the job on Beta first. Approving loads the same job, with the same job ID, into Prod and gives the Prod test accounts access.",
  [GATE.ELIGIBLE_STUDENTS]:
    "Approving gives these students access to apply for the job. The Learning Portal emails them about the job when they get access.",
  [GATE.START_WINDOW]:
    "Approving starts the application window. The window closes at the job's deadline on the Learning Portal, set when the job was prepared, so time spent waiting here comes out of the window. The reminders and the closing then run automatically.",
};

const iso = (date) => (date ? new Date(date).toISOString() : null);
const text = (value) => (value === null || value === undefined || value === "" ? null : String(value));
const list = (values) => (values?.length ? values.join(", ") : null);

function htmlToText(html) {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const loadedTargets = (job) => config.learningPortal.targets.filter((env) => job.learningPortalLoads?.[env]?.loadedAt);

export const canEditPlans = (job) =>
  job.awaitingApproval?.gate === loadGateFor(config.learningPortal.targets[0]) && loadedTargets(job).length === 0;

const link = (label, url) => ({ label, value: url ? String(url) : null, href: url ? String(url) : undefined });

function jdCountText(job) {
  if (!job.jdCount) return null;
  const earlier = job.jdCount - 1;
  if (!earlier) return `${job.jdCount} (first deal for this company)`;
  return `${job.jdCount} (${earlier} earlier deal${earlier === 1 ? "" : "s"} for ${job.companyName ?? "this company"})`;
}

function dealPreview(job, windowHours) {
  const owner = [job.crmOwnerName, job.crmOwnerEmail].filter(Boolean).join(" · ");
  return [
    { label: "Company", value: text(job.companyName) },
    link("Website", job.companyWebsite),
    link("LinkedIn", job.companyLinkedin),
    { ...link("Company logo", job.companyLogoUrl), image: Boolean(job.companyLogoUrl) },
    {
      label: "Logo source",
      value: job.companyLogoUrl
        ? (LOGO_SOURCE_LABELS[job.companyLogoSource]?.replace(/^./, (letter) => letter.toUpperCase()) ?? null)
        : "No logo could be confirmed. Add one on the deal page before approving, or the organisation is created without a logo.",
    },
    link("HubSpot record", hubspotRecordUrl(job)),
    { label: "Job role", value: text(job.jobRole) },
    { label: "JD count", value: jdCountText(job) },
    { label: "Job type", value: text(job.jobType) },
    { label: "Experience type", value: text(job.experienceType) },
    { label: "Job source", value: text(job.jobSource) },
    { label: "Application mode", value: text(job.applicationMode) },
    { label: "Internship duration", value: text(job.internshipDuration) },
    { label: "Target enroll plans", value: list(job.enrollPlans) },
    { label: "Skills", value: list(job.skills) },
    { label: "Eligibility", value: text(job.eligibility) },
    { label: "Batch", value: text(job.batch) },
    { label: "Program", value: text(job.program) },
    { label: "Location", value: text(job.location) },
    { label: "CTC", value: text(job.ctc) },
    { label: "Employment type", value: text(job.employmentType) },
    { label: "Openings", value: text(job.openings) },
    { label: "Expected pool", value: text(job.expectedPoolCount) },
    { label: "CRM owner", value: text(owner) },
    { label: "Profiling POC", value: text(job.profilingPoc?.name) },
    { label: "ISE", value: text(job.ise?.name) },
    { label: "Deadline", value: `${windowHours} hours after the job is prepared` },
    { label: "Deadline in HubSpot", value: text(job.applicationDeadline) },
    { label: "Compensation description", value: text(job.importantInstructions), wide: true },
  ];
}

function eligibilityGroups(details) {
  let criteria = {};
  try {
    criteria = JSON.parse(details.eligibility_criteria?.content?.[0] ?? "{}");
  } catch {
    criteria = {};
  }
  const groups = new Map();
  for (const [plan, value] of Object.entries(criteria)) {
    if (!value || value === "NA") continue;
    groups.set(value, [...(groups.get(value) ?? []), plan]);
  }
  return [...groups.entries()].map(([criteriaText, plans]) => ({ plans, text: criteriaText }));
}

async function loadPreview(job, env) {
  const payload = job.learningPortalPayload ?? { job_details: {} };
  const details = payload.job_details ?? {};
  const settings = config.learningPortal.environments[env];
  const organisation = await LearningPortalOrganisation.findOne({ organisationId: job.learningPortalOrgId }).lean();
  const plans = details.enroll_plans ?? [];
  return {
    environment: env,
    canEditPlans: canEditPlans(job),
    planOptions: ALL_ENROLL_PLANS,
    enrollPlans: plans,
    jobId: job.learningPortalJobId,
    organisation: {
      id: job.learningPortalOrgId,
      name: organisation?.name ?? job.companyName,
      existsInPortal: Boolean(organisation?.createdIn?.includes(env)),
      source: organisation?.source ?? null,
    },
    applyLink: settings ? payloadForEnvironment(payload, settings, { companyName: job.companyName }).job_details.link_to_apply : null,
    testAccounts: settings ? testUsersFor(settings, plans).length : 0,
    loadedIn: loadedTargets(job).map((name) => ({ name, loadedAt: iso(job.learningPortalLoads[name].loadedAt) })),
    details: [
      { label: "Job title", value: text(details.job_title) },
      { label: "Job type", value: text(details.job_type) },
      { label: "Locations", value: list(details.locations) },
      { label: "Skills", value: list(details.skills_required) },
      { label: "Min CTC / stipend", value: text(details.min_ctc) },
      { label: "Max CTC / stipend", value: text(details.max_ctc) },
      { label: "Positions", value: text(details.no_of_positions_available) },
      { label: "Apply by (IST)", value: text(details.apply_by) },
      { label: "Order", value: text(details.order) },
      { label: "Service agreement (months)", value: text(details.service_agreement_in_months) },
    ],
    eligibility: eligibilityGroups(details),
    disclaimer: htmlToText(details.disclaimer?.content?.[0]),
    organisationDescription: htmlToText(details.organisation_description?.content?.[0]),
  };
}

async function studentsPreview(job) {
  const filter = { jobId: job._id };
  const [total, withEmail, withPhone] = await Promise.all([
    JobEligibleStudent.countDocuments(filter),
    JobEligibleStudent.countDocuments({ ...filter, email: { $ne: null } }),
    JobEligibleStudent.countDocuments({ ...filter, mobile: { $ne: null } }),
  ]);
  return { total, withEmail, withPhone, accessEnvironment: config.learningPortal.accessEnv };
}

async function windowPreview(job, settings) {
  const filter = { jobId: job._id };
  const [granted, rejected] = await Promise.all([
    JobEligibleStudent.countDocuments({ ...filter, accessGrantedAt: { $ne: null } }),
    JobEligibleStudent.countDocuments({ ...filter, accessRejectedReason: { $ne: null } }),
  ]);
  const { reminderOneHours, reminderTwoHours } = settings.timing;
  const plannedWindowHours = job.windowHours ?? settings.timing.applicationWindowHours;
  const closesAt = job.learningPortalDeadline ?? hoursFromNow(plannedWindowHours, now());
  const hoursLeft = (new Date(closesAt).getTime() - now().getTime()) / (60 * 60 * 1000);
  return {
    granted,
    rejected,
    windowHours: Math.max(0, Math.round(hoursLeft * 10) / 10),
    plannedWindowHours,
    reminderHours: [reminderOneHours, reminderTwoHours],
    closesAt: iso(closesAt),
    closed: hoursLeft <= 0,
  };
}

export async function approvalPreview(job) {
  const gate = job.awaitingApproval?.gate;
  if (!gate) return null;
  const base = {
    gate,
    label: APPROVAL_GATE_LABELS[gate] ?? gate,
    description: DESCRIPTIONS[gate] ?? "",
    requestedAt: iso(job.awaitingApproval.requestedAt),
  };
  const settings = await getSettings();
  if (gate === GATE.DEAL_DETAILS) {
    return { ...base, deal: dealPreview(job, job.windowHours ?? settings.timing.applicationWindowHours) };
  }
  if (gate.startsWith("LOAD_")) return { ...base, load: await loadPreview(job, gate.slice("LOAD_".length).toLowerCase()) };
  if (gate === GATE.ELIGIBLE_STUDENTS) return { ...base, students: await studentsPreview(job) };
  if (gate === GATE.START_WINDOW) return { ...base, window: await windowPreview(job, settings) };
  return base;
}
