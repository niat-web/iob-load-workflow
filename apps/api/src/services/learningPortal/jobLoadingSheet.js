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
  if (!target) return { status: "none" };
  for (const record of records) {
    const name = String(record[COMPANY_NAME_HEADER] ?? "").trim();
    if (name && normalizeCompanyName(name) === target) {
      return { status: "exact", organisationId: String(record[ORG_ID_HEADER] ?? "").trim() };
    }
  }
  return { status: "none" };
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
