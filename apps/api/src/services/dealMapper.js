import { config } from "../config/env.js";
import { REQUIRED_FIELDS, TRACKED_FIELDS, FIELD_LABELS, hubspotFields } from "../config/hubspotFields.js";
import { hashObject } from "../utils/crypto.js";
import { findHubspotOwner } from "./hubspotOwners.js";
import { splitList, toInt, toNumber } from "../utils/helpers.js";

const clean = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text.toUpperCase() !== "NA" ? text : null;
};

function formatCtc(min, max) {
  const low = toNumber(min);
  const high = toNumber(max);
  if (low === null && high === null) return null;
  if (low !== null && high !== null && high > low) return `${low}–${high} LPA`;
  return `${low ?? high} LPA`;
}

export function mapDeal({ deal, company, owner }) {
  const props = deal.properties ?? {};
  const read = (field) => (hubspotFields[field] ? props[hubspotFields[field]] : undefined);

  const mockPool = config.modes.hubspot === "mock" ? toInt(props.expected_application_pool) : null;
  const expectedPoolCount = mockPool > 0 ? mockPool : null;

  const locations = [read("location"), props.deal_location].flatMap(splitList);
  const domain = clean(company?.domain);
  const dealOwner = owner?.email ? owner : (findHubspotOwner(read("crmOwnerId")) ?? owner);

  return {
    hubspotDealId: String(deal.id),
    companyName: clean(read("companyName")) ?? clean(company?.name) ?? clean(props.dealname),
    companyWebsite: domain ? (domain.startsWith("http") ? domain : `https://www.${domain}`) : null,
    companyLinkedin: clean(props.company_linkedin_profile) ?? clean(company?.linkedin),
    companyLogoUrl: clean(props.company_logo_link) ?? clean(company?.logo),
    jobRole: clean(read("jobRole")) ?? clean(props.dealname),
    jobDescription: clean(read("jobDescription")),
    skills: splitList(read("skills")),
    eligibility: clean(read("eligibility")),
    batch: splitList(read("batch")).join(", ") || null,
    campus: splitList(read("campus")).join(", ") || null,
    program: clean(read("program")),
    location: [...new Set(locations)].join(", ") || null,
    ctc: formatCtc(read("ctc"), read("ctcMax")),
    employmentType: clean(read("employmentType")),
    openings: toInt(read("openings")),
    expectedPoolCount,
    crmOwnerName: clean(read("crmOwnerName")) ?? clean(dealOwner?.name),
    crmOwnerEmail: (clean(read("crmOwnerEmail")) ?? clean(dealOwner?.email))?.toLowerCase() ?? null,
    applicationDeadline: clean(read("applicationDeadline")),
    importantInstructions: clean(read("importantInstructions")),
  };
}

export function applySubmittedInputs(mapped, job) {
  const next = { ...mapped };
  if (job?.expectedPoolCount > 0) next.expectedPoolCount = job.expectedPoolCount;
  const inputs = job?.submittedInputs;
  if (!inputs) return next;
  const crmOwner = findHubspotOwner(inputs.crmOwnerId);
  if (crmOwner) {
    next.crmOwnerName = crmOwner.name;
    next.crmOwnerEmail = (inputs.crmOwnerEmail ?? crmOwner.email ?? next.crmOwnerEmail)?.toLowerCase() ?? null;
  }
  return next;
}

export function missingRequiredFields(mapped) {
  return REQUIRED_FIELDS.filter((field) => {
    const value = mapped[field];
    return value === null || value === undefined || value === "" || (typeof value === "number" && value <= 0);
  }).map((field) => FIELD_LABELS[field] ?? field);
}

const comparable = (value) => {
  if (Array.isArray(value)) return [...value].map((item) => String(item).toLowerCase()).sort().join("|");
  if (value === null || value === undefined) return "";
  return String(value).trim();
};

export function diffTrackedFields(previous, next) {
  return TRACKED_FIELDS.filter((field) => comparable(previous?.[field]) !== comparable(next?.[field])).map(
    (field) => ({
      field,
      label: FIELD_LABELS[field] ?? field,
      oldValue: previous?.[field] ?? null,
      newValue: next?.[field] ?? null,
    }),
  );
}

export function trackedHash(mapped) {
  return hashObject(Object.fromEntries(TRACKED_FIELDS.map((field) => [field, comparable(mapped[field])])));
}

export function fullHash(mapped) {
  return hashObject(mapped);
}

export function displayValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
