import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import { AiCallLog, Job, JobApplication, JobEligibleStudent, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { advanceAndRun, loginAs, nowMs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

describe("10h / 20h reminders", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("at 10h with the target not reached, only non-applicants get an email and an AI call", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.poolTargetReached, false);
    assert.equal(updated.reminders.r10h.status, "SENT");
    assert.equal(updated.status, JOB_STATUS.REMINDER_10H_SENT);

    const appliedIds = (await JobApplication.find({ jobId: job._id })).map((a) => a.studentId);
    assert.ok(appliedIds.length > 0, "some students applied");
    const nonApplicants = await JobEligibleStudent.find({ jobId: job._id, applied: false });
    assert.equal(nonApplicants.length, updated.eligibleCount - appliedIds.length);

    const reminderEmails = await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_10H });
    assert.equal(reminderEmails.length, nonApplicants.length);
    assert.equal(reminderEmails.filter((log) => appliedIds.includes(log.studentId)).length, 0, "applied students get no reminder email");

    const calls = await AiCallLog.find({ jobId: job._id, reminderType: "REMINDER_10H" });
    assert.equal(calls.length, nonApplicants.length);
    assert.equal(calls.filter((call) => appliedIds.includes(call.studentId)).length, 0, "applied students get no call");
    const queued = calls.filter((call) => call.status === "QUEUED");
    const skipped = calls.filter((call) => call.status === "SKIPPED");
    assert.ok(queued.length > 0);
    assert.ok(skipped.every((call) => /phone/i.test(call.error)), "only students without a phone are skipped");
    assert.equal(updated.reminders.r10h.callCount, queued.length);

    assert.equal(integrations.nxtdial.requests.length, Math.ceil(queued.length / 5));
  });

  test("when the expected pool is already reached, the reminder is skipped entirely", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await Job.updateOne({ _id: job._id }, { $set: { expectedPoolCount: 1 } });
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.poolTargetReached, true);
    assert.ok(updated.poolTargetReachedAt);
    assert.equal(updated.reminders.r10h.status, "SKIPPED");
    assert.equal(updated.status, JOB_STATUS.APPLICATIONS_OPEN, "window stays open when the target is reached");
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_10H }), 0);
    assert.equal(await AiCallLog.countDocuments({ jobId: job._id }), 0);
    const reachedMail = async () =>
      (await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.POOL_TARGET_REACHED }).lean()).map((log) => [log.email, log.status]);
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]], "only the CRM who added the deal is emailed");

    await advanceAndRun({ hours: 10 });
    const later = await Job.findById(job._id);
    assert.equal(later.reminders.r20h.status, "SKIPPED");
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_20H }), 0);
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]], "the email is sent once");
  });

  test("the 20h reminder only reaches students who still have not applied", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    await advanceAndRun({ hours: 10 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r20h.status, "SENT");
    const appliedIds = (await JobApplication.find({ jobId: job._id })).map((a) => a.studentId);
    const reminder20 = await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_20H });
    assert.equal(reminder20.filter((log) => appliedIds.includes(log.studentId)).length, 0);
    const reminder10 = await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.REMINDER_10H });
    assert.ok(reminder20.length < reminder10, "more students applied between 10h and 20h");
  });

  test("re-running a reminder does not send duplicate emails or calls", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    const emails = await NotificationLog.countDocuments({ jobId: job._id });
    const calls = await AiCallLog.countDocuments({ jobId: job._id });
    const requests = integrations.nxtdial.requests.length;

    await Job.updateOne({ _id: job._id }, { $set: { "reminders.r10h": null, status: JOB_STATUS.APPLICATIONS_OPEN } });
    await WorkflowTask.updateOne(
      { jobId: job._id, type: TASK_TYPE.REMINDER_10H },
      { $set: { status: "PENDING", scheduledFor: new Date(nowMs()) } },
    );
    await runDueTasks();

    assert.equal(await NotificationLog.countDocuments({ jobId: job._id }), emails);
    assert.equal(await AiCallLog.countDocuments({ jobId: job._id }), calls);
    assert.equal(integrations.nxtdial.requests.length, requests);
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
