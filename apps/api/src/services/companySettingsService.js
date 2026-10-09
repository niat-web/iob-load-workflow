import { CompanySettings } from "../models/index.js";

export const CHECKPOINT_SWITCHES = ["firstEmails", "secondEmails", "secondCalls"];

export function mergeCheckpoints(stored, fallback = {}) {
  return Object.fromEntries(
    CHECKPOINT_SWITCHES.map((key) => [
      key,
      typeof stored?.[key] === "boolean" ? stored[key] : typeof fallback[key] === "boolean" ? fallback[key] : true,
    ]),
  );
}

export async function companyCheckpoints(companyKey) {
  const stored = companyKey ? await CompanySettings.findById(companyKey).lean() : null;
  return mergeCheckpoints(stored?.checkpoints);
}
