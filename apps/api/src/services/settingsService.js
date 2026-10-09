import { config } from "../config/env.js";
import { APPROVAL_GATE, APPROVAL_GATE_LABELS, FLOW_MODE, NOTIFICATION_TYPE } from "../config/statuses.js";
import { AppSettings, NotificationLog } from "../models/index.js";
import { now } from "../utils/clock.js";
import { badRequest } from "../utils/errors.js";
import { AUDIT, audit } from "./auditService.js";

const SETTINGS_ID = "app";
export const APPROVAL_STEPS = Object.values(APPROVAL_GATE);
export const TURNED_OFF = "Turned off by the admin in Settings";
export const turnedOff = (what) => `${what} is turned off by the admin in Settings`;

const EMAIL_SWITCHES = Object.freeze({
  [NOTIFICATION_TYPE.JOB_UPDATED]: ["studentEmails", "jobUpdates"],
  [NOTIFICATION_TYPE.BOOST_REMINDER]: ["studentEmails", "boostReminder"],
  [NOTIFICATION_TYPE.REMINDER_10H]: ["checkpoints", "firstEmails"],
  [NOTIFICATION_TYPE.REMINDER_20H]: ["checkpoints", "secondEmails"],
  [NOTIFICATION_TYPE.POOL_TARGET_REACHED]: ["crmEmails", "poolReached"],
  [NOTIFICATION_TYPE.CRM_POOL_READY]: ["crmEmails", "candidatePool"],
});

export function defaultSettings() {
  return {
    flow: {
      mode: FLOW_MODE.AUTOMATIC,
      crmOptions: { [FLOW_MODE.AUTOMATIC]: true, [FLOW_MODE.STEP_BY_STEP]: true },
      approvals: Object.fromEntries(APPROVAL_STEPS.map((gate) => [gate, true])),
    },
    studentEmails: { jobUpdates: true, boostReminder: true },
    checkpoints: { firstEmails: true, secondEmails: true, secondCalls: true },
    crmEmails: { poolReached: true, candidatePool: true },
    aiCalls: { enabled: true },
    interviews: { googleMeet: true },
    automation: {
      aiJobContent: true,
      aiResumeAnalysis: true,
      hubspotWriteBack: config.hubspot.writeJobId,
    },
    timing: {
      applicationWindowHours: config.workflow.applicationWindowHours,
      reminderOneHours: config.workflow.reminderOneHours,
      reminderTwoHours: config.workflow.reminderTwoHours,
      boostEmailCooldownMinutes: config.nxtdial.boostEmailCooldownMinutes,
    },
  };
}

function mergeKnown(base, incoming) {
  const result = {};
  for (const [key, value] of Object.entries(base)) {
    const next = incoming && typeof incoming === "object" ? incoming[key] : undefined;
    if (value && typeof value === "object") result[key] = mergeKnown(value, next);
    else result[key] = typeof next === typeof value ? next : value;
  }
  return result;
}

function changedPaths(before, after, prefix = "") {
  return Object.keys(after).flatMap((key) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (after[key] && typeof after[key] === "object") return changedPaths(before[key], after[key], path);
    return before[key] === after[key] ? [] : [path];
  });
}

export async function getSettings() {
  const stored = await AppSettings.findById(SETTINGS_ID).lean();
  return mergeKnown(defaultSettings(), stored?.values);
}

export async function settingsRecord() {
  const stored = await AppSettings.findById(SETTINGS_ID).lean();
  return {
    settings: mergeKnown(defaultSettings(), stored?.values),
    updatedBy: stored?.updatedBy ?? null,
    updatedAt: stored?.updatedAt ? new Date(stored.updatedAt).toISOString() : null,
  };
}

export async function updateSettings(patch, actor) {
  const current = await getSettings();
  const next = mergeKnown(current, patch);
  if (stepByStepPossible(next) && !APPROVAL_STEPS.some((gate) => next.flow.approvals[gate])) {
    throw badRequest("Turn on at least one step that needs approval, or stop using the Step by step flow.");
  }
  const { applicationWindowHours, reminderOneHours, reminderTwoHours } = next.timing;
  if (!(reminderOneHours < reminderTwoHours && reminderTwoHours < applicationWindowHours)) {
    throw badRequest("The first checkpoint must come before the second, and both before the application window closes.");
  }
  const changed = changedPaths(current, next);
  await AppSettings.updateOne(
    { _id: SETTINGS_ID },
    { $set: { values: next, updatedBy: actor?.email ?? null, updatedAt: now() } },
    { upsert: true },
  );
  if (changed.length) {
    await audit({
      actor,
      action: AUDIT.SETTINGS_UPDATED,
      entityType: "Settings",
      entityId: SETTINGS_ID,
      metadata: { changed: changed.join(",") },
    });
  }
  return { settings: next, changed };
}

export function crmFlowOptions(settings) {
  return Object.values(FLOW_MODE).filter((mode) => settings.flow.crmOptions[mode] === true);
}

export function defaultFlowMode(settings) {
  const options = crmFlowOptions(settings);
  return options.length === 1 ? options[0] : settings.flow.mode;
}

function stepByStepPossible(settings) {
  const options = crmFlowOptions(settings);
  return options.length ? options.includes(FLOW_MODE.STEP_BY_STEP) : settings.flow.mode === FLOW_MODE.STEP_BY_STEP;
}

const FLOW_LABELS = { [FLOW_MODE.AUTOMATIC]: "Automatic", [FLOW_MODE.STEP_BY_STEP]: "Step by step" };

export function resolveFlowMode(settings, requested) {
  const options = crmFlowOptions(settings);
  if (!requested || !options.length) return defaultFlowMode(settings);
  if (!options.includes(requested)) {
    throw badRequest(`The ${FLOW_LABELS[requested]} flow is turned off by the admin. Refresh the page and submit again.`);
  }
  return requested;
}

export function needsApproval(settings, gate, job) {
  return job?.flowMode === FLOW_MODE.STEP_BY_STEP && settings.flow.approvals[gate] === true;
}

export function emailOn(settings, type) {
  const path = EMAIL_SWITCHES[type];
  return !path || settings[path[0]][path[1]] !== false;
}

export async function emailAllowed(type, idempotencyKey) {
  if (emailOn(await getSettings(), type)) return true;
  if (idempotencyKey) {
    await NotificationLog.updateOne(
      { idempotencyKey, status: { $in: ["PENDING", "RETRYING"] } },
      { $set: { status: "SKIPPED", error: TURNED_OFF } },
    );
  }
  return false;
}

export function crmControls(settings) {
  return {
    flow: {
      options: crmFlowOptions(settings),
      defaultMode: defaultFlowMode(settings),
      approvalSteps: APPROVAL_STEPS.filter((gate) => settings.flow.approvals[gate]).map((gate) => ({
        gate,
        label: APPROVAL_GATE_LABELS[gate] ?? gate,
      })),
    },
    reminderEmails: settings.studentEmails.boostReminder,
    aiCalls: settings.aiCalls.enabled,
    checkpoints: settings.checkpoints,
  };
}
