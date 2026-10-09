import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TYPE, TASK_TYPE } from "../src/config/statuses.js";
import { AuditLog, CandidateAnalysis, Job, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { integrations, overrideIntegration } from "../src/services/integrations.js";
import {
  XHR,
  loginAs,
  openApplicationWindow,
  resetDb,
  runDueTasks,
  runToPsmReview,
  startTestDb,
  stopTestDb,
} from "./helpers.js";

const HOUR = 60 * 60 * 1000;
const ALL_OFF = { DEAL_DETAILS: false, LOAD_BETA: false, LOAD_PROD: false, ELIGIBLE_STUDENTS: false, START_WINDOW: false };

describe("admin controls in Settings → Config", () => {
  let admin;
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs("admin.user@example.com", "ADMIN");
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  const save = (body) => admin.patch("/api/admin/settings").set(XHR).send(body);

  test("defaults keep everything on and the flow automatic; only admins can change them", async () => {
    const current = await admin.get("/api/admin/settings");
    assert.equal(current.status, 200);
    const { settings } = current.body;
    assert.equal(settings.flow.mode, "AUTOMATIC");
    assert.deepEqual(settings.flow.crmOptions, { AUTOMATIC: true, STEP_BY_STEP: true });
    assert.deepEqual(Object.values(settings.flow.approvals), [true, true, true, true, true]);
    assert.deepEqual(settings.studentEmails, { jobUpdates: true, boostReminder: true });
    assert.deepEqual(settings.checkpoints, { firstEmails: true, secondEmails: true, secondCalls: true });
    assert.deepEqual(settings.crmEmails, { poolReached: true, candidatePool: true });
    assert.equal(settings.aiCalls.enabled, true);
    assert.deepEqual(settings.timing, {
      applicationWindowHours: 21,
      reminderOneHours: 10,
      reminderTwoHours: 20,
      boostEmailCooldownMinutes: 60,
    });

    assert.equal((await crm.get("/api/admin/settings")).status, 403);
    assert.equal((await crm.patch("/api/admin/settings").set(XHR).send({ aiCalls: { enabled: false } })).status, 403);
    const controls = await crm.get("/api/crm/controls");
    assert.deepEqual(controls.body.flow.options, ["AUTOMATIC", "STEP_BY_STEP"]);
    assert.equal(controls.body.flow.defaultMode, "AUTOMATIC");
    assert.equal(controls.body.flow.approvalSteps.length, 5);
    assert.equal(controls.body.reminderEmails, true);
    assert.equal(controls.body.aiCalls, true);
    assert.equal((await save({ timing: { callMaxSeconds: 90 } })).status, 400, "call length is set in NxtDial, not here");
  });

  test("bad settings are refused and changes are recorded", async () => {
    assert.equal((await save({ flow: { mode: "STEP_BY_STEP", approvals: ALL_OFF } })).status, 400);
    assert.equal((await save({ timing: { reminderOneHours: 20, reminderTwoHours: 10 } })).status, 400);
    assert.equal((await save({ timing: { reminderTwoHours: 30 } })).status, 400, "checkpoints must be inside the window");
    assert.equal((await save({ studentEmails: { unknown: true } })).status, 400);
    assert.equal((await save({ aiCalls: { enabled: "no" } })).status, 400);

    const saved = await save({ flow: { mode: "STEP_BY_STEP", approvals: { LOAD_PROD: false } }, crmEmails: { poolReached: false } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.settings.flow.approvals.LOAD_PROD, false);
    assert.equal(saved.body.settings.flow.approvals.LOAD_BETA, true);
    assert.equal(saved.body.updatedBy, "admin.user@example.com");
    const log = await AuditLog.findOne({ action: "SETTINGS_UPDATED" }).lean();
    assert.equal(log.metadata.changed, "flow.mode,flow.approvals.LOAD_PROD,crmEmails.poolReached");

    const controls = (await crm.get("/api/crm/controls")).body;
    assert.equal(controls.flow.defaultMode, "STEP_BY_STEP");
    assert.deepEqual(
      controls.flow.approvalSteps.map((step) => step.gate),
      ["DEAL_DETAILS", "LOAD_BETA", "ELIGIBLE_STUDENTS", "START_WINDOW"],
    );
  });

  test("the window opens without a job email: the Learning Portal emails students when they get access", async () => {
    assert.equal((await save({ studentEmails: { jobEmail: false } })).status, 400, "the job email setting no longer exists");
    const job = await openApplicationWindow(crm, "12345");
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id }), 0);
    assert.equal(integrations.ses.sent.length, 0);
    assert.equal(await AuditLog.countDocuments({ action: "INITIAL_EMAIL_SENT", entityId: String(job._id) }), 0);
    assert.ok(await AuditLog.findOne({ action: "APPLICATIONS_OPENED", entityId: String(job._id) }).lean());
  });

  test("the Boost page buttons follow the student email and AI call switches", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await save({ studentEmails: { boostReminder: false }, aiCalls: { enabled: false } });

    const overview = (await crm.get(`/api/crm/deals/${job._id}/boost`)).body;
    assert.deepEqual(overview.controls, { reminderEmails: false, aiCalls: false });
    const emails = await crm.post(`/api/crm/deals/${job._id}/boost/emails`).set(XHR);
    assert.equal(emails.status, 409);
    assert.equal(emails.body.error.code, "STUDENT_EMAILS_OFF");
    const calls = await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR);
    assert.equal(calls.status, 409);
    assert.equal(calls.body.error.code, "AI_CALLS_OFF");
    assert.equal(integrations.nxtdial.agents.length, 0);

    await save({ studentEmails: { boostReminder: true }, aiCalls: { enabled: true } });
    assert.equal((await crm.post(`/api/crm/deals/${job._id}/boost/calls`).set(XHR)).status, 202);
    assert.equal(integrations.nxtdial.agents[0].callTimeoutSeconds, 120);
    assert.match(integrations.nxtdial.agents[0].prompt, /within 2 minutes/);
  });

  test("window length and checkpoint times come from Settings", async () => {
    await save({ timing: { applicationWindowHours: 30, reminderOneHours: 5, reminderTwoHours: 15 } });
    const job = await openApplicationWindow(crm, "12345");
    assert.equal(job.applicationEndAt.getTime() - job.applicationStartAt.getTime(), 30 * HOUR);
    const at = async (type) => (await WorkflowTask.findOne({ jobId: job._id, type }).lean()).scheduledFor.getTime();
    assert.equal((await at(TASK_TYPE.REMINDER_10H)) - job.applicationStartAt.getTime(), 5 * HOUR);
    assert.equal((await at(TASK_TYPE.REMINDER_20H)) - job.applicationStartAt.getTime(), 15 * HOUR);
  });

  test("HubSpot write-back and AI job text can be turned off", async () => {
    await save({ automation: { hubspotWriteBack: false, aiJobContent: false } });
    let prompts = 0;
    overrideIntegration("gemini", {
      generateText: async () => {
        prompts += 1;
        return "AI text";
      },
    });
    const job = await openApplicationWindow(crm, "12345");
    await runDueTasks();
    const saved = await Job.findById(job._id);
    assert.equal(saved.hubspotWriteBack.status, "SKIPPED");
    assert.match(saved.hubspotWriteBack.error, /turned off in Settings/);
    assert.equal(await AuditLog.countDocuments({ action: "HUBSPOT_JOB_ID_WRITTEN" }), 0);
    assert.equal(prompts, 0, "the job text is written by the rule-based fallback");
  });

  test("with AI resume analysis off, candidates are marked skipped and the deal still reaches PSM review", async () => {
    await save({ automation: { aiResumeAnalysis: false } });
    const job = await runToPsmReview(crm, "12345");
    const statuses = await CandidateAnalysis.distinct("analysisStatus", { jobId: job._id });
    assert.ok(statuses.includes("SKIPPED"));
    assert.ok(!statuses.includes("COMPLETED"));
    const skipped = await CandidateAnalysis.findOne({ jobId: job._id, analysisStatus: "SKIPPED" }).lean();
    assert.match(skipped.analysisError, /turned off by the admin in Settings/);
  });

  test("with the candidate pool email off, the deal completes without emailing the CRM", async () => {
    const job = await runToPsmReview(crm, "12345");
    await save({ crmEmails: { candidatePool: false } });
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR)).status, 200);
    await runDueTasks();
    const done = await Job.findById(job._id);
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.crmShare.status, "LINK_GENERATED");
    assert.match(done.crmShare.error, /turned off by the admin in Settings/);
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id, type: NOTIFICATION_TYPE.CRM_POOL_READY }), 0);
  });
});
