import { JOB_STATUS as S, TASK_TYPE, statusRank } from "../config/statuses.js";
import { Job, WorkflowTask } from "../models/index.js";
import { conflict } from "../utils/errors.js";
import { AUDIT, audit } from "./auditService.js";
import { CHECKPOINT_SWITCHES, companyCheckpoints, mergeCheckpoints } from "./companySettingsService.js";
import { REMINDER_PRODUCT } from "./eligibilityService.js";
import { reminderInfo } from "./jobService.js";
import { TURNED_OFF, getSettings } from "./settingsService.js";

const CHECKPOINTS = [
  {
    key: "r10h",
    task: TASK_TYPE.REMINDER_10H,
    processing: S.REMINDER_10H_PROCESSING,
    label: "First checkpoint",
    hours: "reminderOneHours",
    switches: ["firstEmails"],
  },
  {
    key: "r20h",
    task: TASK_TYPE.REMINDER_20H,
    processing: S.REMINDER_20H_PROCESSING,
    label: "Second checkpoint",
    hours: "reminderTwoHours",
    switches: ["secondEmails", "secondCalls"],
  },
];

const SWITCH_LABELS = { firstEmails: "Reminder emails", secondEmails: "Reminder emails", secondCalls: "AI calls" };

const HOUR_MS = 60 * 60 * 1000;
const iso = (date) => (date ? new Date(date).toISOString() : null);

export async function dealCheckpoints(job) {
  return mergeCheckpoints(job.checkpoints, await companyCheckpoints(job.companyKey));
}

function windowOver(job) {
  if (job.status === S.CANCELLED) return "This deal is stopped";
  const current = job.status === S.FAILED ? job.failedStep : job.status;
  if (current && statusRank(current) >= statusRank(S.APPLICATIONS_CLOSED)) return "The application window has closed";
  return null;
}

function lockReason(job, checkpoint) {
  if (job.reminders?.[checkpoint.key]?.status) return `The ${checkpoint.label.toLowerCase()} has already run`;
  if (job.status === checkpoint.processing) return `The ${checkpoint.label.toLowerCase()} is running now`;
  return windowOver(job);
}

function adminReasons(settings) {
  return {
    firstEmails: settings.checkpoints.firstEmails ? null : TURNED_OFF,
    secondEmails: settings.checkpoints.secondEmails ? null : TURNED_OFF,
    secondCalls: !settings.checkpoints.secondCalls
      ? TURNED_OFF
      : settings.aiCalls.enabled
        ? null
        : "AI calls are turned off by the admin in Settings",
  };
}

function checkpointHours(job, runsAt, fallback) {
  if (!runsAt || !job.applicationStartAt) return fallback;
  return Math.round(((new Date(runsAt).getTime() - new Date(job.applicationStartAt).getTime()) / HOUR_MS) * 10) / 10;
}

export async function dealReminders(job) {
  const [settings, switches, tasks] = await Promise.all([
    getSettings(),
    dealCheckpoints(job),
    WorkflowTask.find({ jobId: job._id, type: { $in: CHECKPOINTS.map((checkpoint) => checkpoint.task) } }, { type: 1, scheduledFor: 1 }).lean(),
  ]);
  const admin = adminReasons(settings);
  const runsAtByTask = new Map(tasks.map((task) => [task.type, task.scheduledFor]));
  return {
    product: REMINDER_PRODUCT,
    windowStartAt: iso(job.applicationStartAt),
    windowEndAt: iso(job.applicationEndAt),
    checkpoints: CHECKPOINTS.map((checkpoint) => {
      const runsAt = runsAtByTask.get(checkpoint.task) ?? null;
      return {
        key: checkpoint.key,
        label: checkpoint.label,
        hours: checkpointHours(job, runsAt, settings.timing[checkpoint.hours]),
        runsAt: iso(runsAt),
        result: reminderInfo(job.reminders?.[checkpoint.key]),
        lockedReason: lockReason(job, checkpoint),
        switches: checkpoint.switches.map((key) => ({
          key,
          label: SWITCH_LABELS[key],
          on: switches[key],
          adminOffReason: admin[key],
        })),
      };
    }),
  };
}

export async function updateDealCheckpoints(job, patch, actor, ip = null) {
  for (const checkpoint of CHECKPOINTS) {
    if (!checkpoint.switches.some((key) => key in patch)) continue;
    const locked = lockReason(job, checkpoint);
    if (locked) throw conflict(`${locked}, so its switches can no longer be changed.`, "REMINDER_LOCKED");
  }
  const current = await dealCheckpoints(job);
  const next = mergeCheckpoints({ ...current, ...patch });
  const changed = CHECKPOINT_SWITCHES.filter((key) => current[key] !== next[key]);
  const updated = await Job.findOneAndUpdate(
    { _id: job._id, status: job.status },
    { $set: { checkpoints: next } },
    { returnDocument: "after" },
  );
  if (!updated) throw conflict("This deal has just moved on. Refresh and try again.", "REMINDER_LOCKED");
  if (changed.length) {
    await audit({
      actor,
      action: AUDIT.DEAL_REMINDERS_UPDATED,
      entityId: job._id,
      metadata: Object.fromEntries(changed.map((key) => [key, next[key]])),
      ip,
    });
  }
  return dealReminders(updated);
}
