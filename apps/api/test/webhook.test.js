import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import { Job, JobApplication, JobChangeHistory, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { advanceAndRun, api, hubspotHeaders, loginAs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

function sendWebhook(events, { timestamp = Date.now(), headers } = {}) {
  const raw = JSON.stringify(events);
  return api()
    .post("/api/webhooks/hubspot")
    .set(headers ?? hubspotHeaders(raw, undefined, timestamp))
    .send(raw);
}

const propertyChange = (dealId, eventId, propertyName = "location") => ({
  eventId,
  subscriptionType: "deal.propertyChange",
  objectId: Number(dealId),
  propertyName,
  occurredAt: Date.now(),
});

const portalUpserts = (from) =>
  integrations.learningPortal.calls
    .slice(from)
    .filter((call) => call.op === "upsertJob")
    .map((call) => [call.env, call.payload.job_id, call.payload.job_details.locations]);

describe("HubSpot webhook updates", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("unsigned or stale webhooks are rejected", async () => {
    const unsigned = await api().post("/api/webhooks/hubspot").set("Content-Type", "application/json").send("[]");
    assert.equal(unsigned.status, 401);
    const stale = await sendWebhook([propertyChange("12345", 1)], { timestamp: Date.now() - 10 * 60 * 1000 });
    assert.equal(stale.status, 401);
    const tampered = await api()
      .post("/api/webhooks/hubspot")
      .set(hubspotHeaders(JSON.stringify([propertyChange("12345", 1)])))
      .send(JSON.stringify([propertyChange("12345", 2)]));
    assert.equal(tampered.status, 401);
  });

  test("a student-facing change updates the same portal job and emails the students who applied", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 3 });
    const callsBefore = integrations.learningPortal.calls.length;
    const oldLocation = job.location;
    await integrations.hubspot.setOverride("12345", { location: "Mumbai" });

    const response = await sendWebhook([propertyChange("12345", 101)]);
    assert.equal(response.status, 200);
    assert.equal(response.body.queued, 1);
    await runDueTasks();

    const updated = await Job.findById(job._id);
    assert.equal(updated.location, "Mumbai");
    assert.equal(updated.version, 2);
    assert.equal(updated.learningPortalJobId, job.learningPortalJobId, "same Learning Portal job");
    assert.deepEqual(
      portalUpserts(callsBefore),
      [
        ["beta", job.learningPortalJobId, ["Mumbai"]],
        ["prod", job.learningPortalJobId, ["Mumbai"]],
      ],
      "the same job is updated in beta and prod",
    );
    assert.deepEqual(updated.learningPortalPayload.job_details.locations, ["Mumbai"], "stored payload follows the change");

    const change = await JobChangeHistory.findOne({ jobId: job._id, field: "location" });
    assert.equal(change.oldValue, oldLocation);
    assert.equal(change.newValue, "Mumbai");
    assert.equal(change.studentsNotified, true);

    const applied = await JobApplication.find({ jobId: job._id, email: { $nin: [null, ""] } }).lean();
    assert.ok(applied.length > 0);
    const updateEmails = await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.JOB_UPDATED, status: "SENT" }).lean();
    assert.deepEqual(updateEmails.map((log) => log.studentId).sort(), applied.map((row) => row.studentId).sort(), "only students who applied");
    assert.equal(change.notificationCount, applied.length);
  });

  test("an irrelevant field change sends no student email", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const callsBefore = integrations.learningPortal.calls.length;
    await integrations.hubspot.setOverride("12345", { expected_application_pool: "3", dealstage: "closedwon" });
    await sendWebhook([propertyChange("12345", 201, "dealstage")]);
    await runDueTasks();

    const updated = await Job.findById(job._id);
    assert.equal(updated.expectedPoolCount, job.expectedPoolCount, "the expected pool is controlled in the app, never by HubSpot");
    assert.equal(updated.version, 1);
    assert.equal(portalUpserts(callsBefore).length, 0);
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.JOB_UPDATED }), 0);
  });

  test("a duplicate webhook event does not cause duplicate processing or emails", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await integrations.hubspot.setOverride("12345", { technologies_required: "React JS;Typescript" });

    await sendWebhook([propertyChange("12345", 301, "technologies_required")]);
    await runDueTasks();
    const emails = await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.JOB_UPDATED });

    const duplicate = await sendWebhook([propertyChange("12345", 301, "technologies_required")]);
    assert.equal(duplicate.body.duplicates, 1);
    assert.equal(duplicate.body.queued, 0);
    await runDueTasks();

    await sendWebhook([propertyChange("12345", 302, "technologies_required")]);
    await runDueTasks();

    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.JOB_UPDATED }), emails);
    assert.equal((await Job.findById(job._id)).version, 2);
    assert.equal(await WorkflowTask.countDocuments({ jobId: job._id, type: TASK_TYPE.HUBSPOT_DEAL_UPDATE }), 2);
  });

  test("webhooks for unknown deals are acknowledged and ignored", async () => {
    const response = await sendWebhook([propertyChange("99999", 401)]);
    assert.equal(response.status, 200);
    assert.equal(response.body.queued, 0);
  });
});
