import { config } from "../../config/env.js";
import { normalizeCompanyName } from "../../utils/helpers.js";
import { logger } from "../../utils/logger.js";
import { integrations } from "../integrations.js";

const COMPANY_NAME_HEADER = "Company Name";
const ORG_ID_HEADER = "Org ID";
const TEMPLATES_WORKSHEET = "Eligibility Templates";

function toRecords(rows) {
  if (!rows.length) return [];
  const seen = new Map();
  const headers = rows[0].map((raw, index) => {
    const header = String(raw ?? "").trim() || `EMPTY_COL_${index + 1}`;
    const count = (seen.get(header) ?? 0) + 1;
    seen.set(header, count);
    return count > 1 ? `${header}_${count}` : header;
  });
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export async function findOrgInSheet(companyName) {
  const { sheets } = integrations;
  if (!sheets.enabled) return null;
  const records = toRecords(await sheets.getRows(config.jobLoadingSheet.orgWorksheet));
  const target = normalizeCompanyName(companyName);
  const near = [];
  for (const record of records) {
    const name = String(record[COMPANY_NAME_HEADER] ?? "").trim();
    if (!name) continue;
    const normalized = normalizeCompanyName(name);
    const organisationId = String(record[ORG_ID_HEADER] ?? "").trim();
    if (normalized === target) return { status: "exact", organisationId };
    if (target && (normalized.includes(target) || target.includes(normalized))) near.push({ name, organisationId });
  }
  return near.length ? { status: "near", candidates: near } : { status: "none" };
}

export async function lastOrderInSheet() {
  const { sheets } = integrations;
  if (!sheets.enabled) return null;
  const rows = await sheets.getRows(config.jobLoadingSheet.trackerWorksheet);
  const column = (rows[0] ?? []).map((header) => String(header).trim()).indexOf("Order");
  if (column < 0) return null;
  const orders = rows
    .slice(1)
    .map((row) => String(row[column] ?? "").trim().replaceAll(",", ""))
    .filter((value) => /^\d+$/.test(value))
    .map(Number);
  return orders.length ? orders.at(-1) : null;
}

export async function sheetEligibilityTemplates() {
  const { sheets } = integrations;
  if (!sheets.enabled) return {};
  try {
    const rows = await sheets.getRows(TEMPLATES_WORKSHEET);
    return Object.fromEntries(
      rows
        .slice(1)
        .map(([key, text]) => [String(key ?? "").trim().toLowerCase(), String(text ?? "").trim()])
        .filter(([key, text]) => key && text),
    );
  } catch (error) {
    logger.warn({ err: error }, "Could not read the Eligibility Templates worksheet; using the built-in templates");
    return {};
  }
}

export const TRACKER_HEADERS = [
  "Date", "Job Deal ID", "HubSpot Link", "Job ID", "Experience", "Job Type", "Job Source",
  "Organization ID", "Company Name", "Company Website URL", "Company Logo URL", "Company LinkedIn URL",
  "Job Title", "Location", "Skills", "Number of Positions Available", "Order", "Mode of Applying",
  "Max Internship Duration", "Compensation Description", "Deadline", "CRM", "Profiling Done By",
  "Min CTC/Stipend", "Max CTC/Stipend", "Min Internship Duration", "Enroll Plans",
  "Internal Student List Link", "Max Update datetime",
];

export async function appendTrackerRow(values) {
  const { sheets } = integrations;
  if (!sheets.enabled) return false;
  const worksheet = config.jobLoadingSheet.trackerWorksheet;
  let headers = ((await sheets.getRows(worksheet))[0] ?? []).map((header) => String(header ?? "").trim());
  if (!headers.some(Boolean)) {
    headers = TRACKER_HEADERS;
    await sheets.appendRow(worksheet, headers);
  }
  const byLowerName = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  await sheets.appendRow(
    worksheet,
    headers.map((header) => (header ? String(byLowerName.get(header.toLowerCase()) ?? "") : "")),
  );
  return true;
}
