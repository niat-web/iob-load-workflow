import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import {
  AiCall,
  CompanySettings,
  EligiblePoolStudent,
  Job,
  JobApplication,
  JobEligibleStudent,
  NotificationLog,
  WorkflowTask,
} from "../src/models/index.js";
import { reminderEmail } from "../src/templates/email/index.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { XHR, advanceAndRun, loginAs, nowMs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const reminderLogs = (job, type) => NotificationLog.find({ jobId: job._id, type }).lean();
const notAppliedWithEmail = (job, product = "NIAT") =>
  JobEligibleStudent.find({
    jobId: job._id,
    product,
    applied: { $ne: true },
    accessGrantedAt: { $ne: null },
    email: { $nin: [null, ""] },
  }).lean();
const switchesOf = (overview) =>
  Object.fromEntries(overview.checkpoints.flatMap((checkpoint) => checkpoint.switches.map((item) => [item.key, item.on])));
const crmEmails = (job) =>
  NotificationLog.countDocuments({ jobId: job._id, email: "crm.user@example.com", type: { $nin: [NOTIFICATION_TYPE.POOL_TARGET_REACHED] } });

describe("10h / 20h checkpoints", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("each eligible student is saved with its product", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const products = await JobEligibleStudent.distinct("product", { jobId: job._id });
    assert.deepEqual(products.sort(), ["Academy", "NIAT"]);
  });

  test("at 10h only NIAT students who have not applied get a reminder: no Academy student, no CRM email and no AI calls", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r10h.status, "SENT");
    assert.equal(updated.status, JOB_STATUS.REMINDER_10H_SENT);
    assert.match(updated.reminders.r10h.reason, /reminder emails? sent to NIAT students who have not applied/);
    assert.match(updated.reminders.r10h.reason, /Academy students are not reminded/);

    const reminded = await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_10H);
    const expected = await notAppliedWithEmail(job);
    assert.ok(expected.length > 0);
    assert.deepEqual(reminded.map((log) => log.studentId).sort(), expected.map((s) => s.studentId).sort());
    assert.equal(updated.reminders.r10h.emailCount, expected.length);
    const academy = await notAppliedWithEmail(job, "Academy");
    assert.ok(academy.length > 0);
    const remindedIds = new Set(reminded.map((log) => log.studentId));
    assert.ok(!academy.some((student) => remindedIds.has(student.studentId)), "Academy students are never reminded");
    const applied = await JobApplication.distinct("studentId", { jobId: job._id });
    assert.ok(applied.length > 0);
    assert.ok(!reminded.some((log) => applied.includes(log.studentId)), "applied students are never reminded");

    assert.equal(await crmEmails(job), 0, "the CRM gets no checkpoint email");
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), 0, "no AI calls at the first checkpoint");

    const html = reminderEmail(updated, { studentName: "Asha Rao" }, "REMINDER_10H").html;
    assert.doesNotMatch(html, /href=/, "reminders carry no apply link");
    assert.match(html, /You have not applied yet/);
  });

  test("at 20h NIAT students who have not applied get a final reminder and AI calls start, still with no CRM email", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    await advanceAndRun({ hours: 10 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r20h.status, "SENT");
    assert.ok(updated.reminders.r20h.emailCount > 0);
    assert.ok(updated.reminders.r20h.callCount > 0, updated.reminders.r20h.reason);
    assert.match(updated.reminders.r20h.reason, /AI calls? started to NIAT students who have not applied/);
    assert.equal((await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_20H)).length, (await notAppliedWithEmail(job)).length);
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), updated.reminders.r20h.callCount);
    const academyIds = await JobEligibleStudent.distinct("studentId", { jobId: job._id, product: "Academy" });
    assert.equal(await AiCall.countDocuments({ jobId: job._id, studentId: { $in: academyIds } }), 0, "Academy students are never called");
    assert.equal(await crmEmails(job), 0);
  });

  test("a deal with no NIAT students skips both checkpoints and says why", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await JobEligibleStudent.updateMany({ jobId: job._id }, { $set: { product: "Academy" } });
    await advanceAndRun({ hours: 10, minutes: 1 });
    await advanceAndRun({ hours: 10 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r10h.status, "SKIPPED");
    assert.equal(updated.reminders.r20h.status, "SKIPPED");
    assert.match(updated.reminders.r10h.reason, /for NIAT students only/);
    assert.match(updated.reminders.r20h.reason, /reminders and AI calls are for NIAT students only/);
    assert.equal((await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_10H)).length, 0);
    assert.equal((await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_20H)).length, 0);
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), 0);
  });

  test("students saved before products were recorded get their product from the Eligible Pool", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const rows = await JobEligibleStudent.find({ jobId: job._id }).lean();
    await JobEligibleStudent.updateMany({ jobId: job._id }, { $unset: { product: "" } });
    const niatIds = rows.filter((_, index) => index % 2 === 0).map((row) => row.studentId);
    await EligiblePoolStudent.insertMany(
      rows.map((row) => ({
        studentId: row.studentId,
        productGroup: niatIds.includes(row.studentId) ? "NIAT" : "Academy",
        eligibilityStatus: "Eligible",
        syncedAt: new Date(nowMs()),
      })),
    );
    await advanceAndRun({ hours: 10, minutes: 1 });

    const reminded = (await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_10H)).map((log) => log.studentId);
    assert.ok(reminded.length > 0);
    assert.ok(reminded.every((id) => niatIds.includes(id)), "only students the pool marks NIAT are reminded");
    assert.equal(await JobEligibleStudent.countDocuments({ jobId: job._id, product: null }), 0);
  });

  test("a CRM can turn the checkpoint emails and AI calls off for one deal", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const url = `/api/crm/deals/${job._id}/reminders`;
    const shown = (await crm.get(url)).body;
    assert.deepEqual(switchesOf(shown), { firstEmails: true, secondEmails: true, secondCalls: true }, "on by default");
    assert.equal(shown.product, "NIAT");
    assert.ok(shown.checkpoints.every((checkpoint) => checkpoint.runsAt && !checkpoint.lockedReason && !checkpoint.result));

    const saved = await crm.patch(url).set(XHR).send({ checkpoints: { firstEmails: false, secondCalls: false } });
    assert.equal(saved.status, 200);
    assert.deepEqual(switchesOf(saved.body), { firstEmails: false, secondEmails: true, secondCalls: false });
    assert.deepEqual((await Job.findById(job._id)).checkpoints, { firstEmails: false, secondEmails: true, secondCalls: false });

    await advanceAndRun({ hours: 10, minutes: 1 });
    let updated = await Job.findById(job._id);
    assert.equal(updated.reminders.r10h.status, "SKIPPED");
    assert.match(updated.reminders.r10h.reason, /Reminder emails turned off for this deal/);
    assert.equal((await reminderLogs(job, NOTIFICATION_TYPE.REMINDER_10H)).length, 0);
    const locked = await crm.patch(url).set(XHR).send({ checkpoints: { firstEmails: true } });
    assert.equal(locked.status, 409, "a checkpoint that has already run cannot change");
    assert.match((await crm.get(url)).body.checkpoints[0].lockedReason, /already run/);

    await advanceAndRun({ hours: 10 });
    updated = await Job.findById(job._id);
    assert.ok(updated.reminders.r20h.emailCount > 0, "the second reminder is still on");
    assert.match(updated.reminders.r20h.reason, /AI calls turned off for this deal/);
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), 0);

    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.patch(url).set(XHR).send({ checkpoints: { secondEmails: false } })).status, 403);
  });

  test("a deal keeps its company's earlier switches until the deal gets its own", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await CompanySettings.create({ _id: job.companyKey, companyName: job.companyName, checkpoints: { firstEmails: false } });
    const url = `/api/crm/deals/${job._id}/reminders`;
    assert.deepEqual(switchesOf((await crm.get(url)).body), { firstEmails: false, secondEmails: true, secondCalls: true });

    await advanceAndRun({ hours: 10, minutes: 1 });
    assert.match((await Job.findById(job._id)).reminders.r10h.reason, /Reminder emails turned off for this deal/);
  });

  test("a stopped deal's reminder switches cannot change", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await crm.post(`/api/crm/deals/${job._id}/stop`).set(XHR);
    const url = `/api/crm/deals/${job._id}/reminders`;
    assert.ok((await crm.get(url)).body.checkpoints.every((checkpoint) => checkpoint.lockedReason === "This deal is stopped"));
    assert.equal((await crm.patch(url).set(XHR).send({ checkpoints: { secondEmails: false } })).status, 409);
  });

  test("the admin can turn the second-checkpoint AI calls off for every company", async () => {
    const admin = await loginAs("admin.user@example.com", "ADMIN");
    await admin.patch("/api/admin/settings").set(XHR).send({ checkpoints: { secondCalls: false } });
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 10, minutes: 1 });
    await advanceAndRun({ hours: 10 });
    const updated = await Job.findById(job._id);
    assert.match(updated.reminders.r20h.reason, /AI calls turned off by the admin in Settings/);
    assert.equal(await AiCall.countDocuments({ jobId: job._id }), 0);
    assert.equal((await crm.get("/api/crm/controls")).body.checkpoints.secondCalls, false);
  });

  test("when the expected pool is reached, the CRM gets one pool-reached email and students who have not applied are still reminded", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await Job.updateOne({ _id: job._id }, { $set: { expectedPoolCount: 1 } });
    await advanceAndRun({ hours: 10, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.poolTargetReached, true);
    assert.equal(updated.reminders.r10h.status, "SENT");
    const reachedMail = async () =>
      (await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.POOL_TARGET_REACHED }).lean()).map((log) => [log.email, log.status]);
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]]);
    await advanceAndRun({ hours: 10 });
    assert.deepEqual(await reachedMail(), [["crm.user@example.com", "SENT"]], "the email is sent once");
  });

  test("re-running a checkpoint does not email anyone twice", async () => {
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
  });

  test("the applied pool is saved every 30 minutes while the window is open, one record per student", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ minutes: 31 });
    const first = await Job.findById(job._id);
    await advanceAndRun({ hours: 5 });
    const later = await Job.findById(job._id);
    assert.ok(later.appliedCount >= first.appliedCount);
    assert.ok(later.lastApplicationSyncAt > first.lastApplicationSyncAt);
    const rows = await JobApplication.find({ jobId: job._id }).lean();
    assert.equal(rows.length, later.appliedCount);
    assert.equal(new Set(rows.map((row) => row.studentId)).size, rows.length, "no duplicates");
    assert.ok(rows.every((row) => row.learningPortalJobId === job.learningPortalJobId));
    const row = (await crm.get("/api/crm/deals")).body.items[0];
    assert.equal(row.progressPercent, Math.min(100, Math.round((later.appliedCount / later.expectedPoolCount) * 100)));
  });
});
