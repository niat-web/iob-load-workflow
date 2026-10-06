import "./setup.js";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { TASK_TYPE } from "../src/config/statuses.js";
import { AiCallLog, Job, WorkflowTask } from "../src/models/index.js";
import { triggerReminderCalls } from "../src/services/aiCallService.js";
import { overrideIntegration } from "../src/services/integrations.js";
import { LiveNxtDialClient } from "../src/services/nxtDialClient.js";
import { nowMs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const students = (count, { withPhone = true } = {}) =>
  Array.from({ length: count }, (_, i) => ({
    studentId: `S${i + 1}`,
    studentName: `Student ${i + 1}`,
    mobile: withPhone ? `98765${String(10000 + i).slice(-5)}` : "12",
  }));

function respond(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

describe("NxtDial reminder calls", () => {
  let job;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    overrideIntegration("nxtdial", new LiveNxtDialClient());
    job = await Job.create({
      hubspotDealId: "555",
      companyName: "TCS",
      jobRole: "Software Engineer",
      applicationEndAt: new Date(nowMs() + 11 * 3600 * 1000),
    });
  });
  afterEach(() => mock.restoreAll());

  test("sends multi-number requests in chunks with the documented payload", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => respond(200, { id: "alert-1" }));
    const summary = await triggerReminderCalls({ job, students: students(12), reminderType: "REMINDER_10H" });

    assert.equal(summary.queued, 12);
    assert.equal(fetchMock.mock.callCount(), 3, "12 students in chunks of 5");
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, "https://nxtdial.test/api/alert");
    assert.match(init.headers.Authorization, /^Bearer /);
    const body = JSON.parse(init.body);
    assert.equal(body.phones.length, 5);
    assert.deepEqual(body.phones[0], { name: "Student 1", phone: "+919876510000" });
    assert.equal(body.variables.company, "TCS");
    assert.equal(body.variables.role, "Software Engineer");
    assert.ok(body.variables.deadline);
    assert.equal(await AiCallLog.countDocuments({ status: "QUEUED", nxtDialCallId: "alert-1" }), 12);
  });

  test("invalid or missing phone numbers are never called", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => respond(200, {}));
    const summary = await triggerReminderCalls({ job, students: students(3, { withPhone: false }), reminderType: "REMINDER_10H" });
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.equal(summary.skipped, 3);
  });

  test("429 honours Retry-After and schedules a retry instead of hammering the API", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => respond(429, { message: "slow down" }, { "Retry-After": "120" }));
    const summary = await triggerReminderCalls({ job, students: students(12), reminderType: "REMINDER_10H" });

    assert.equal(fetchMock.mock.callCount(), 1, "stops at the first 429");
    assert.equal(summary.deferred, 12);
    assert.equal(await AiCallLog.countDocuments({ status: "RATE_LIMITED" }), 12);
    const retry = await WorkflowTask.findOne({ type: TASK_TYPE.RETRY_AI_CALLS });
    assert.equal(retry.scheduledFor.getTime(), nowMs() + 120_000);
    assert.equal(retry.payload.studentIds.length, 12);

    mock.restoreAll();
    const okMock = mock.method(globalThis, "fetch", async () => respond(200, { id: "alert-2" }));
    const retried = await triggerReminderCalls({ job, students: students(12), reminderType: "REMINDER_10H", retry: true });
    assert.equal(retried.queued, 12);
    assert.equal(okMock.mock.callCount(), 3);
  });

  test("401 is a permanent failure: no retry is scheduled", async () => {
    mock.method(globalThis, "fetch", async () => respond(401, { message: "bad key" }));
    const summary = await triggerReminderCalls({ job, students: students(7), reminderType: "REMINDER_20H" });
    assert.equal(summary.failed, 7);
    assert.equal(await WorkflowTask.countDocuments({ type: TASK_TYPE.RETRY_AI_CALLS }), 0);
    assert.equal(await AiCallLog.countDocuments({ status: "FAILED" }), 7);
  });

  test("5xx is retried with backoff", async () => {
    mock.method(globalThis, "fetch", async () => respond(503, { message: "down" }));
    const summary = await triggerReminderCalls({ job, students: students(4), reminderType: "REMINDER_10H" });
    assert.equal(summary.deferred, 4);
    assert.equal(await AiCallLog.countDocuments({ status: "RETRYING" }), 4);
    assert.equal(await WorkflowTask.countDocuments({ type: TASK_TYPE.RETRY_AI_CALLS }), 1);
  });

  test("a student is never called twice for the same reminder", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => respond(200, { id: "alert-3" }));
    await triggerReminderCalls({ job, students: students(3), reminderType: "REMINDER_10H" });
    await triggerReminderCalls({ job, students: students(3), reminderType: "REMINDER_10H" });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(await AiCallLog.countDocuments({ jobId: new mongoose.Types.ObjectId(job._id) }), 3);
  });
});
