import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { reportMissingSettings } from "../src/config/startupReport.js";
import { JOB_STATUS, NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import { resetIntegrations } from "../src/services/integrations.js";
import { Job, JobEligibleStudent, JobHubspotMapping, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { runDueTasks, runTask } from "../src/workers/workflowWorker.js";
import { claimNextTask } from "../src/services/taskQueue.js";
import {
  XHR,
  advance,
  loginAs,
  nowMs,
  openApplicationWindow,
  resetDb,
  startTestDb,
  stopTestDb,
  submitDeal,
} from "./helpers.js";

const HOUR = 3600 * 1000;

describe("CRM deal processing", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("a valid Deal ID creates one job and returns immediately with SUBMITTED", async () => {
    const response = await submitDeal(crm, "12345");
    assert.equal(response.status, 202);
    assert.equal(response.body.duplicate, false);
    assert.equal(response.body.job.status, JOB_STATUS.SUBMITTED);
    assert.equal(response.body.job.displayStatus.label, "Pending");
    assert.equal(await Job.countDocuments(), 1);
    assert.equal(await JobHubspotMapping.countDocuments({ hubspotDealId: "12345" }), 1);

    const list = await crm.get("/api/crm/deals");
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].hubspotDealId, "12345");
    assert.equal(list.body.pagination.total, 1);
  });

  test("the background pipeline opens a 21-hour window and notifies eligible students", async () => {
    const job = await openApplicationWindow(crm, "12345");
    assert.ok(job.learningPortalJobId);
    assert.ok(job.learningPortalJobUrl);
    assert.equal(job.companyName !== null, true);
    assert.equal(job.crmOwnerEmail, "owner.crm@example.com");
    assert.equal(job.applicationEndAt.getTime() - job.applicationStartAt.getTime(), 21 * HOUR);

    const eligible = await JobEligibleStudent.countDocuments({ jobId: job._id });
    assert.equal(job.eligibleCount, eligible);
    assert.equal(await JobEligibleStudent.countDocuments({ jobId: job._id, accessGrantedAt: null }), 0);
    const emails = await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.INITIAL_JOB_EMAIL, status: "SENT" });
    assert.equal(emails, eligible);

    const reminder10 = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.REMINDER_10H });
    const reminder20 = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.REMINDER_20H });
    const close = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.APPLICATION_CLOSE_21H });
    assert.equal(reminder10.scheduledFor.getTime() - job.applicationStartAt.getTime(), 10 * HOUR);
    assert.equal(reminder20.scheduledFor.getTime() - job.applicationStartAt.getTime(), 20 * HOUR);
    assert.equal(close.scheduledFor.getTime(), job.applicationEndAt.getTime());

    const row = (await crm.get("/api/crm/deals")).body.items[0];
    assert.equal(row.currentStep, "Application Window");
    assert.equal(row.displayStatus.key, "IN_PROGRESS");
    assert.equal(row.isActive, true);
  });

  test("a duplicate Deal ID does not create another job (also under concurrent submits)", async () => {
    const [a, b, c] = await Promise.all([submitDeal(crm, "777"), submitDeal(crm, "777"), submitDeal(crm, "777")]);
    const created = [a, b, c].filter((response) => response.status === 202);
    const duplicates = [a, b, c].filter((response) => response.status === 200 && response.body.duplicate);
    assert.equal(created.length, 1);
    assert.equal(duplicates.length, 2);
    assert.equal(await Job.countDocuments({ hubspotDealId: "777" }), 1);

    await runDueTasks();
    const again = await submitDeal(crm, "https://app.hubspot.com/contacts/1234/record/0-3/777");
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(await Job.countDocuments(), 1);
    assert.equal(await WorkflowTask.countDocuments({ type: TASK_TYPE.CREATE_JOB }), 1);
  });

  test("an invalid Deal ID is rejected before anything is created", async () => {
    const response = await crm.post("/api/crm/deals/process").set(XHR).send({ dealId: "not-a-deal" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_DEAL_ID");
    assert.equal(await Job.countDocuments(), 0);
  });

  test("a deal HubSpot cannot find fails cleanly and can be retried", async () => {
    const response = await submitDeal(crm, "404");
    await runDueTasks();
    const job = await Job.findById(response.body.job.id);
    assert.equal(job.status, JOB_STATUS.FAILED);
    assert.equal(job.failedStep, JOB_STATUS.FETCHING_DEAL);
    assert.match(job.lastError, /not found/i);

    const task = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.FETCH_DEAL });
    assert.equal(task.status, "FAILED");
    assert.equal(task.attempts, 1, "permanent errors are not retried automatically");

    const row = (await crm.get("/api/crm/deals")).body.items[0];
    assert.equal(row.displayStatus.key, "FAILED");
    assert.equal(row.canRetry, true);

    const retry = await crm.post(`/api/crm/deals/${job._id}/retry`).set(XHR);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.job.status, JOB_STATUS.FETCHING_DEAL);
    assert.equal((await WorkflowTask.findById(task._id)).status, "PENDING");
  });

  test("a deal cut off before its first step was queued starts when the Deal ID is submitted again", async () => {
    const id = (await submitDeal(crm, "12345")).body.job.id;
    await WorkflowTask.deleteMany({ jobId: id });
    await runDueTasks();
    assert.equal((await Job.findById(id)).status, JOB_STATUS.SUBMITTED);

    const again = await submitDeal(crm, "12345");
    assert.equal(again.body.duplicate, true);
    assert.equal(await WorkflowTask.countDocuments({ jobId: id, type: TASK_TYPE.FETCH_DEAL }), 1);
    await submitDeal(crm, "12345");
    assert.equal(await WorkflowTask.countDocuments({ jobId: id }), 1, "submitting again never queues a second fetch");
    await runDueTasks();
    assert.notEqual((await Job.findById(id)).status, JOB_STATUS.SUBMITTED);
  });

  test("the companies page counts each company's deals by state", async () => {
    const first = (await submitDeal(crm, "12345")).body.job.id;
    await submitDeal(crm, "12346");
    await runDueTasks();
    await crm.post(`/api/crm/deals/${first}/stop`).set(XHR);

    const response = await crm.get("/api/crm/companies");
    assert.equal(response.status, 200);
    const { items } = response.body;
    assert.equal(items.reduce((sum, item) => sum + item.deals, 0), 2);
    for (const item of items) {
      assert.ok(item.name);
      assert.equal(item.inProgress + item.waiting + item.completed + item.failed + item.stopped, item.deals);
      assert.ok(Date.parse(item.lastUpdated));
    }
    const stoppedCompany = (await Job.findById(first)).companyName;
    assert.equal(items.find((item) => item.name === stoppedCompany).stopped, 1);

    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get("/api/crm/companies")).status, 403);
  });

  test("a missing key never stops the API; only the step that needs it fails, with what to add", async () => {
    const saved = { mode: config.modes.hubspot, url: config.hubspot.dealWebhook.url };
    Object.assign(config.modes, { hubspot: "live" });
    config.hubspot.dealWebhook.url = undefined;
    resetIntegrations();
    try {
      const problems = reportMissingSettings();
      assert.ok(problems.includes("HubSpot is not set up: add HUBSPOT_DEAL_WEBHOOK_URL"));
      assert.equal((await crm.get("/api/crm/deals")).status, 200);

      const id = (await submitDeal(crm, "12345")).body.job.id;
      await runDueTasks();
      const job = await Job.findById(id);
      assert.equal(job.status, JOB_STATUS.FAILED);
      assert.equal(job.failedStep, JOB_STATUS.FETCHING_DEAL);
      assert.match(job.lastError, /HubSpot is not set up yet: add HUBSPOT_DEAL_WEBHOOK_URL to apps\/api\/\.env/);
      assert.equal((await WorkflowTask.findOne({ jobId: id })).attempts, 1, "no pointless retries");
      assert.equal((await crm.get("/api/crm/deals")).body.items[0].canRetry, true);
    } finally {
      Object.assign(config.modes, { hubspot: saved.mode });
      config.hubspot.dealWebhook.url = saved.url;
      resetIntegrations();
    }
  });

  test("the CRM fills expected pool, CRM owner, profiling POC and ISE, which reach the portal job", async () => {
    const me = await loginAs("asha.verma@example.com", "CRM");
    assert.equal((await me.get("/api/auth/me")).body.user.hubspotOwner.id, "1000001");
    const owners = (await me.get("/api/crm/hubspot-owners")).body;
    assert.equal(owners.defaultOwnerId, "1000001");
    assert.ok(owners.owners.some((owner) => owner.id === "1000002" && owner.name === "Ravi Kumar"));

    const response = await me
      .post("/api/crm/deals/process")
      .set(XHR)
      .send({ dealId: "12345", expectedPoolCount: 70, crmOwnerId: "1000001", profilingPocId: "1000002", iseId: "1000003" });
    assert.equal(response.status, 202);
    assert.equal(response.body.job.expectedPoolCount, 70);
    await runDueTasks();

    const job = await Job.findById(response.body.job.id);
    assert.equal(job.expectedPoolCount, 70);
    assert.equal(job.crmOwnerName, "Asha Verma");
    assert.equal(job.crmOwnerEmail, "asha.verma@example.com");
    assert.equal(job.profilingPoc.name, "Ravi Kumar");
    assert.equal(job.ise.name, "Neha Sharma");
    assert.deepEqual(
      { crm: job.learningPortalPayload.job_extra_details.crm, profiling: job.learningPortalPayload.job_extra_details.profiling_poc, ise: job.learningPortalPayload.job_extra_details.ise },
      { crm: "Asha Verma", profiling: "Ravi Kumar", ise: "Neha Sharma" },
    );
  });

  test("unknown HubSpot owners and an expected pool below 1 are refused", async () => {
    const unknownOwner = await crm.post("/api/crm/deals/process").set(XHR).send({ dealId: "12345", crmOwnerId: "123" });
    assert.equal(unknownOwner.status, 400);
    assert.equal(unknownOwner.body.error.code, "VALIDATION_ERROR");
    const zeroPool = await crm.post("/api/crm/deals/process").set(XHR).send({ dealId: "12345", expectedPoolCount: 0 });
    assert.equal(zeroPool.status, 400);
    assert.equal(await Job.countDocuments(), 0);
  });

  test("retry is refused for a job that has not failed", async () => {
    const response = await submitDeal(crm, "12345");
    const retry = await crm.post(`/api/crm/deals/${response.body.job.id}/retry`).set(XHR);
    assert.equal(retry.status, 409);
    assert.equal(retry.body.error.code, "NOT_RETRYABLE");
  });

  test("re-running the notification step after a crash does not send duplicate emails", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const before = await NotificationLog.countDocuments({ jobId: job._id });

    await Job.updateOne({ _id: job._id }, { $set: { status: JOB_STATUS.INITIAL_NOTIFICATION_SENDING } });
    await WorkflowTask.updateOne(
      { jobId: job._id, type: TASK_TYPE.SEND_INITIAL_NOTIFICATIONS },
      { $set: { status: "PENDING", scheduledFor: new Date(nowMs()) } },
    );
    const task = await claimNextTask("test-worker");
    assert.equal(task.type, TASK_TYPE.SEND_INITIAL_NOTIFICATIONS);
    await runTask(task, "test-worker");

    assert.equal(await NotificationLog.countDocuments({ jobId: job._id }), before);
    assert.equal((await Job.findById(job._id)).status, JOB_STATUS.APPLICATIONS_OPEN);
  });

  test("a crashed worker's task is reclaimed after the lock times out", async () => {
    await submitDeal(crm, "12345");
    const stuck = await claimNextTask("crashed-worker");
    assert.equal(stuck.type, TASK_TYPE.FETCH_DEAL);
    assert.equal(await claimNextTask("healthy-worker"), null);

    advance({ minutes: 16 });
    const reclaimed = await claimNextTask("healthy-worker");
    assert.equal(String(reclaimed._id), String(stuck._id));
  });
});
