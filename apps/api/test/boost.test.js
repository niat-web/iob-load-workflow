import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { JOB_STATUS, NOTIFICATION_TYPE } from "../src/config/statuses.js";
import { AiCall, Job, JobEligibleStudent, NotificationLog } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { normalizePhone } from "../src/utils/helpers.js";
import { XHR, advanceAndRun, loginAs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

async function notApplied(job) {
  return JobEligibleStudent.find({ jobId: job._id, applied: { $ne: true }, accessGrantedAt: { $ne: null } }).lean();
}

describe("boost applications (CRM page)", () => {
  let crm;
  let job;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
    job = await openApplicationWindow(crm, "12345");
  });

  test("the page shows who has not applied, with email and mobile counts", async () => {
    const response = await crm.get(`/api/crm/deals/${job._id}/boost`);
    assert.equal(response.status, 200);
    const students = await notApplied(job);
    assert.equal(response.body.notApplied.total, students.length);
    assert.equal(response.body.notApplied.withEmail, students.filter((s) => s.email).length);
    assert.equal(response.body.notApplied.withPhone, students.filter((s) => normalizePhone(s.mobile)).length);
    assert.equal(response.body.deal.windowOpen, true);
    assert.equal(response.body.calls.setupProblem, null);
  });

  test("reminder emails go only to students who have not applied, with a cooldown before the next send", async () => {
    const sent = await crm.post(`/api/crm/deals/${job._id}/boost/emails`).set(XHR);
    assert.equal(sent.status, 200);
    const students = (await notApplied(job)).filter((s) => s.email);
    assert.equal(sent.body.run.sent, students.length);
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.BOOST_REMINDER }), students.length);
    assert.ok(sent.body.boost.emails.availableAt);

    const again = await crm.post(`/api/crm/deals/${job._id}/boost/emails`).set(XHR);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "EMAIL_COOLDOWN");
  });

  test("AI calls create the job's agent once, call each non-applicant with a mobile, and sync results back", async () => {
    const started = await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR);
    assert.equal(started.status, 202);
    const callable = (await notApplied(job)).filter((s) => normalizePhone(s.mobile));
    assert.equal(started.body.run.queued, callable.length);
    assert.equal(await AiCall.countDocuments({ jobId: job._id, status: "QUEUED" }), callable.length);

    const nxtdial = integrations.nxtdial;
    assert.equal(nxtdial.agents.length, 1);
    assert.equal(nxtdial.agents[0].callTimeoutSeconds, 120);
    assert.ok(nxtdial.agents[0].prompt.includes("{jd}"));
    assert.equal(nxtdial.templates.length, 1);
    const [batch] = [...nxtdial.batches.values()];
    assert.equal(batch.items.length, callable.length);
    assert.ok(batch.items.every((item) => item.metadata.jd && item.metadata.deadline && item.phone.startsWith("+91")));
    assert.equal((await Job.findById(job._id)).boost.callAgentId, nxtdial.agents[0].id);

    const busy = await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR);
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, "CALLS_RUNNING");

    await advanceAndRun({ minutes: 4 });
    const calls = await AiCall.find({ jobId: job._id }).lean();
    assert.equal(calls.filter((call) => ["QUEUED", "CALLING"].includes(call.status)).length, 0);
    const completed = calls.filter((call) => call.status === "COMPLETED");
    assert.ok(completed.length > 0);
    assert.ok(completed.every((call) => ["Yes", "No"].includes(call.interested) && call.durationSeconds > 0 && call.recordingUrl));
    assert.ok(calls.some((call) => call.status === "NO_ANSWER"));

    const page = (await crm.get(`/api/crm/deals/${job._id}/boost`)).body;
    assert.equal(page.calls.active, false);
    assert.equal(page.calls.counts.COMPLETED, completed.length);
    assert.equal(page.calls.interested, completed.filter((call) => call.interested === "Yes").length);
    assert.equal(page.calls.items.length, calls.length);

    const second = await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR);
    assert.equal(second.status, 202);
    assert.equal(second.body.run.queued, callable.length - completed.length, "students already reached are not called again");
    assert.equal(nxtdial.agents.length, 1, "the same agent is reused");
  });

  test("with one shared agent, no agent is created and the job summary is kept for the page", async () => {
    const shared = config.nxtdial.agentId;
    config.nxtdial.agentId = "shared-agent-1";
    try {
      assert.equal((await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR)).status, 202);
      const nxtdial = integrations.nxtdial;
      assert.equal(nxtdial.agents.length, 0);
      assert.equal(nxtdial.templates.length, 0);
      const [batch] = [...nxtdial.batches.values()];
      assert.equal(batch.agentId, "shared-agent-1");
      const item = batch.items[0];
      assert.ok(item.metadata.company && item.metadata.role && item.metadata.jd && item.metadata.deadline);
      const page = (await crm.get(`/api/crm/deals/${job._id}/boost`)).body;
      assert.equal(page.calls.agentId, "shared-agent-1");
      assert.equal(page.calls.spokenJd, item.metadata.jd);
    } finally {
      config.nxtdial.agentId = shared;
    }
  });

  test("nothing can be sent after the application window closes", async () => {
    await Job.updateOne({ _id: job._id }, { $set: { status: JOB_STATUS.APPLICATIONS_CLOSED } });
    const emails = await crm.post(`/api/crm/deals/${job._id}/boost/emails`).set(XHR);
    const calls = await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR);
    assert.equal(emails.status, 409);
    assert.equal(calls.status, 409);
    assert.equal(calls.body.error.code, "WINDOW_CLOSED");
  });

  test("PSM users cannot open or trigger the boost page", async () => {
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get(`/api/crm/deals/${job._id}/boost`)).status, 403);
    assert.equal((await psm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR)).status, 403);
  });
});
