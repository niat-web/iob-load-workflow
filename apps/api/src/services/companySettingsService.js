import { CompanySettings } from "../models/index.js";
import { now } from "../utils/clock.js";
import { badRequest } from "../utils/errors.js";
import { normalizeCompanyName } from "../utils/helpers.js";
import { AUDIT, audit } from "./auditService.js";

export const CHECKPOINT_SWITCHES = ["firstEmails", "secondEmails", "secondCalls"];

function mergeCheckpoints(stored) {
  return Object.fromEntries(
    CHECKPOINT_SWITCHES.map((key) => [key, typeof stored?.[key] === "boolean" ? stored[key] : true]),
  );
}

export async function companyCheckpoints(companyKey) {
  const stored = companyKey ? await CompanySettings.findById(companyKey).lean() : null;
  return mergeCheckpoints(stored?.checkpoints);
}

export async function companyCheckpointsFor(companyKeys) {
  const keys = [...new Set(companyKeys.filter(Boolean))];
  const stored = keys.length ? await CompanySettings.find({ _id: { $in: keys } }).lean() : [];
  const byKey = new Map(stored.map((doc) => [doc._id, doc.checkpoints]));
  return (key) => mergeCheckpoints(byKey.get(key));
}

export async function updateCompanyCheckpoints(companyName, patch, actor) {
  const companyKey = normalizeCompanyName(companyName);
  if (!companyKey) throw badRequest("Choose a company");
  const current = await companyCheckpoints(companyKey);
  const next = mergeCheckpoints({ ...current, ...patch });
  const changed = CHECKPOINT_SWITCHES.filter((key) => current[key] !== next[key]);
  await CompanySettings.updateOne(
    { _id: companyKey },
    { $set: { companyName, checkpoints: next, updatedBy: actor?.email ?? null, updatedAt: now() } },
    { upsert: true },
  );
  if (changed.length) {
    await audit({
      actor,
      action: AUDIT.COMPANY_CONTROLS_UPDATED,
      entityType: "Company",
      entityId: companyKey,
      metadata: { company: companyName, ...Object.fromEntries(changed.map((key) => [key, next[key]])) },
    });
  }
  return { companyKey, checkpoints: next };
}
