import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import { AiCall, Job, JobEligibleStudent, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { advanceAndRun, loginAs, nowMs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const crmAlerts = (job) =>
  NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.APPLICATIONS_BELOW_TARGET }).sort({ createdAt: 1 }).lean();

describe("10h / 20h checkpoints", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("at 10h with the target not reached, the CRM who added the deal gets a boost link; students get nothing automatically", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.poolTargetReached, false);
    assert.equal(updated.reminders.r10h.status, "SENT");
    assert.equal(updated.status, JOB_STATUS.REMINDER_10H_SENT);
    assert.match(updated.reminders.r10h.reason, /asked to boost applications/);

    const alerts = await crmAlerts(job);
    assert.deepEqual(alerts.map((log) => [log.email, log.status]), [["crm.user@example.com", "SENT"]]);
    assert.equal(alerts[0].payload.link, `http://localhost:5173/crm/deals/${job._id}/boost`);

    const notApplied = await JobEligibleStudent.countDocuments({ jobId: job._id, applied: { $ne: true }, accessGrantedAt: { $ne: null } });
    assert.equal(updated.boost.crmAlerts.length, 1);
    assert.equal(updated.boost.crmAlerts[0].notApplied, notApplied);
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_10H }), 0);
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), 0, "no AI call is placed without the CRM");
  });

  test("when the expected pool is already reached, the checkpoint is skipped and only the pool-reached email goes out", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await Job.updateOne({ _id: job._id }, { $set: { expectedPoolCount: 1 } });
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.poolTargetReached, true);
    assert.ok(updated.poolTargetReachedAt);
    assert.equal(updated.reminders.r10h.status, "SKIPPED");
    assert.equal(updated.status, JOB_STATUS.APPLICATIONS_OPEN, "window stays open when the target is reached");
    assert.equal((await crmAlerts(job)).length, 0);
    const reachedMail = async () =>
      (await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.POOL_TARGET_REACHED }).lean()).map((log) => [log.email, log.status]);
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]], "only the CRM who added the deal is emailed");

    await advanceAndRun({ hours: 10 });
    const later = await Job.findById(job._id);
    assert.equal(later.reminders.r20h.status, "SKIPPED");
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]], "the email is sent once");
  });

  test("the 20h checkpoint sends a second, separate alert to the CRM", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    await advanceAndRun({ hours: 10 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r20h.status, "SENT");
    assert.equal((await crmAlerts(job)).length, 2);
    assert.deepEqual(updated.boost.crmAlerts.map((alert) => alert.reminder), [TASK_TYPE.REMINDER_10H, TASK_TYPE.REMINDER_20H]);
  });

  test("re-running a checkpoint does not email the CRM twice", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    const emails = await NotificationLog.countDocuments({ jobId: job._id });

    await Job.updateOne({ _id: job._id }, { $set: { "reminders.r10h": null, status: JOB_STATUS.APPLICATIONS_OPEN } });
    await WorkflowTask.updateOne(
      { jobId: job._id, type: TASK_TYPE.REMINDER_10H },
      { $set: { status: "PENDING", scheduledFor: new Date(nowMs()) } },
    );
    await runDueTasks();

    assert.equal(await NotificationLog.countDocuments({ jobId: job._id }), emails);
    assert.equal((await crmAlerts(job)).length, 1);
  });

  test("application count sync updates progress during the window", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ minutes: 31 });
    const first = await Job.findById(job._id);
    await advanceAndRun({ hours: 5 });
    const later = await Job.findById(job._id);
    assert.ok(later.appliedCount >= first.appliedCount);
    assert.ok(later.lastApplicationSyncAt > first.lastApplicationSyncAt);
    const row = (await crm.get("/api/crm/deals")).body.items[0];
    assert.equal(row.progressPercent, Math.min(100, Math.round((later.appliedCount / later.expectedPoolCount) * 100)));
  });
});
