import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, TASK_TYPE } from "../src/config/statuses.js";
import { Job, JobEligibleStudent, NotificationLog, WorkflowTask } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { XHR, advanceAndRun, loginAs, resetDb, runDueTasks, startTestDb, stopTestDb } from "./helpers.js";

const callsOf = (op) => integrations.learningPortal.calls.filter((call) => call.op === op);
const envsOf = (op) => callsOf(op).map((call) => call.env);

describe("step-by-step flow", () => {
  let crm;
  let admin;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
    admin = await loginAs("admin.user@example.com", "ADMIN");
    await setFlow({ mode: "STEP_BY_STEP" });
  });

  const setFlow = (flow) => admin.patch("/api/admin/settings").set(XHR).send({ flow });
  const submit = (dealId, flowMode) =>
    crm.post("/api/crm/deals/process").set(XHR).send(flowMode ? { dealId, flowMode } : { dealId });
  const preview = async (id) => (await crm.get(`/api/crm/deals/${id}/approval`)).body.approval;
  const approve = (id, gate) => crm.post(`/api/crm/deals/${id}/approve`).set(XHR).send({ gate });
  const waitingGate = async (id) => (await Job.findById(id)).awaitingApproval?.gate ?? null;

  test("each stop waits for approval and shows what will happen next", async () => {
    const submitted = await submit("12345");
    assert.equal(submitted.status, 202);
    assert.equal(submitted.body.job.flowMode, "STEP_BY_STEP");
    const id = submitted.body.job.id;

    await runDueTasks();
    assert.equal(await waitingGate(id), "DEAL_DETAILS");
    const row = (await crm.get(`/api/crm/deals/${id}`)).body;
    assert.equal(row.displayStatus.key, "WAITING");
    assert.equal(row.currentStep, "Approve: Deal details");
    assert.equal(row.isActive, false);
    const deal = await preview(id);
    assert.ok(deal.deal.find((item) => item.label === "Company").value);
    assert.equal(integrations.learningPortal.calls.length, 0, "nothing reaches the portal before approval");

    assert.equal((await approve(id, "DEAL_DETAILS")).status, 200);
    await runDueTasks();
    assert.equal(await waitingGate(id), "LOAD_BETA");
    assert.equal(integrations.learningPortal.calls.length, 0, "the job is prepared but not loaded");
    const beta = (await preview(id)).load;
    assert.equal(beta.environment, "beta");
    assert.equal(beta.canEditPlans, true);
    assert.equal(beta.organisation.existsInPortal, false);
    assert.match(beta.applyLink, /^https:\/\/apply-beta\.test\//);
    assert.ok(beta.eligibility.length > 0);
    assert.ok(beta.disclaimer.includes("communication skills"));

    const plans = await crm.post(`/api/crm/deals/${id}/approval/plans`).set(XHR).send({ enrollPlans: ["CCBP_INTENSIVE", "NIAT"] });
    assert.equal(plans.status, 200);
    assert.deepEqual(plans.body.approval.load.enrollPlans, ["CCBP_INTENSIVE", "NIAT"]);

    await approve(id, "LOAD_BETA");
    await runDueTasks();
    assert.equal(await waitingGate(id), "LOAD_PROD");
    assert.deepEqual(envsOf("upsertJob"), ["beta"]);
    assert.deepEqual(callsOf("upsertJob")[0].payload.job_details.enroll_plans, ["CCBP_INTENSIVE", "NIAT"]);
    const prod = (await preview(id)).load;
    assert.equal(prod.environment, "prod");
    assert.equal(prod.canEditPlans, false);
    assert.deepEqual(prod.loadedIn.map((env) => env.name), ["beta"]);
    const locked = await crm.post(`/api/crm/deals/${id}/approval/plans`).set(XHR).send({ enrollPlans: ["CCBP_INTENSIVE"] });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error.code, "PLANS_LOCKED");

    await approve(id, "LOAD_PROD");
    await runDueTasks();
    assert.equal(await waitingGate(id), "ELIGIBLE_STUDENTS");
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"]);
    assert.equal(callsOf("grantAccess").length, 2, "only the test accounts have access so far");
    const job = await Job.findById(id);
    assert.equal(job.status, JOB_STATUS.ELIGIBLE_STUDENTS_IDENTIFIED);
    assert.equal((await preview(id)).students.total, job.eligibleCount);

    await approve(id, "ELIGIBLE_STUDENTS");
    await runDueTasks();
    assert.equal(await waitingGate(id), "START_WINDOW");
    assert.equal(await JobEligibleStudent.countDocuments({ jobId: id, accessGrantedAt: { $ne: null } }), job.eligibleCount);
    assert.equal(await NotificationLog.countDocuments({ jobId: id }), 0, "no email before the window is approved");
    assert.equal((await Job.findById(id)).applicationStartAt, null);
    const window = (await preview(id)).window;
    assert.equal(window.granted, job.eligibleCount);
    assert.ok(window.emails > 0);

    await approve(id, "START_WINDOW");
    await runDueTasks();
    const open = await Job.findById(id);
    assert.equal(open.status, JOB_STATUS.APPLICATIONS_OPEN);
    assert.equal(open.awaitingApproval, null);
    assert.ok(await NotificationLog.countDocuments({ jobId: id, type: "INITIAL_JOB_EMAIL", status: "SENT" }));

    const detail = (await crm.get(`/api/crm/deals/${id}`)).body;
    assert.deepEqual(
      detail.approvals.map((approval) => [approval.gate, approval.by]),
      [
        ["DEAL_DETAILS", "crm.user@example.com"],
        ["LOAD_BETA", "crm.user@example.com"],
        ["LOAD_PROD", "crm.user@example.com"],
        ["ELIGIBLE_STUDENTS", "crm.user@example.com"],
        ["START_WINDOW", "crm.user@example.com"],
      ],
    );
  });

  const runToStartWindow = async () => {
    const id = (await submit("12345")).body.job.id;
    await runDueTasks();
    for (const gate of ["DEAL_DETAILS", "LOAD_BETA", "LOAD_PROD", "ELIGIBLE_STUDENTS"]) {
      await approve(id, gate);
      await runDueTasks();
    }
    assert.equal(await waitingGate(id), "START_WINDOW");
    return id;
  };

  test("time spent waiting at the stops comes out of the window, and the job is never sent to the portal again", async () => {
    const id = await runToStartWindow();
    const deadline = (await Job.findById(id)).learningPortalDeadline;
    await advanceAndRun({ hours: 2 });

    const window = (await preview(id)).window;
    assert.equal(window.closed, false);
    assert.equal(window.plannedWindowHours, 21);
    assert.equal(window.windowHours, 19);
    assert.equal(window.closesAt, deadline.toISOString());

    await approve(id, "START_WINDOW");
    await runDueTasks();
    const open = await Job.findById(id);
    assert.equal(open.status, JOB_STATUS.APPLICATIONS_OPEN, open.lastError);
    assert.equal(open.applicationEndAt.getTime(), deadline.getTime(), "the window closes at the portal deadline");
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"], "the job is not re-sent when the window starts");
    const close = await WorkflowTask.findOne({ jobId: id, type: TASK_TYPE.APPLICATION_CLOSE_21H });
    assert.equal(close.scheduledFor.getTime(), deadline.getTime());
    assert.ok(await NotificationLog.countDocuments({ jobId: id, type: "INITIAL_JOB_EMAIL", status: "SENT" }));
  });

  test("a window cannot open after the job's portal deadline has passed", async () => {
    const id = await runToStartWindow();
    await advanceAndRun({ hours: 22 });
    assert.equal((await preview(id)).window.closed, true);

    await approve(id, "START_WINDOW");
    await runDueTasks();
    const failed = await Job.findById(id);
    assert.equal(failed.status, JOB_STATUS.FAILED);
    assert.match(failed.lastError, /closes on the Learning Portal at .* which has already passed/);
    assert.equal(await NotificationLog.countDocuments({ jobId: id, type: "INITIAL_JOB_EMAIL" }), 0);
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"]);
  });

  test("approving the wrong step or the same step twice is refused", async () => {
    const id = (await submit("12345")).body.job.id;
    await runDueTasks();
    const wrong = await approve(id, "LOAD_BETA");
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error.code, "NOT_WAITING");
    assert.equal((await approve(id, "DEAL_DETAILS")).status, 200);
    assert.equal((await approve(id, "DEAL_DETAILS")).status, 409);
  });

  test("stopping at an approval ends the deal and nothing more runs", async () => {
    const id = (await submit("12345")).body.job.id;
    await runDueTasks();
    await approve(id, "DEAL_DETAILS");
    await runDueTasks();
    assert.equal(await waitingGate(id), "LOAD_BETA");

    const stopped = await crm.post(`/api/crm/deals/${id}/stop`).set(XHR);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.job.displayStatus.key, "CANCELLED");
    assert.equal(stopped.body.job.awaitingApproval, null);
    assert.match((await Job.findById(id)).statusHistory.at(-1).note, /^Stopped at "Load into Beta" by /);
    assert.equal((await approve(id, "LOAD_BETA")).status, 409);
    await runDueTasks();
    assert.equal((await Job.findById(id)).status, JOB_STATUS.CANCELLED);
    assert.equal(integrations.learningPortal.calls.length, 0);

    const list = await crm.get("/api/crm/deals?status=CANCELLED");
    assert.deepEqual(list.body.items.map((item) => item.id), [id]);
    assert.equal((await crm.post(`/api/crm/deals/${id}/stop`).set(XHR)).status, 409);
  });

  test("waiting deals can be filtered, and turning off a step's approval lets them continue", async () => {
    const manual = (await submit("12345")).body.job.id;
    await runDueTasks();

    const waiting = await crm.get("/api/crm/deals?status=WAITING");
    assert.deepEqual(waiting.body.items.map((item) => item.id), [manual]);
    const processing = await crm.get("/api/crm/deals?status=PROCESSING");
    assert.ok(!processing.body.items.some((item) => item.id === manual));
    const either = await crm.get("/api/crm/deals").query({ status: "PROCESSING|WAITING" });
    assert.ok(either.body.items.some((item) => item.id === manual));
    const company = (await Job.findById(manual)).companyName;
    const byCompany = await crm.get("/api/crm/deals").query({ company: `${company}|Nobody Ltd` });
    assert.deepEqual(byCompany.body.items.map((item) => item.id), [manual]);

    const saved = await setFlow({ approvals: { DEAL_DETAILS: false } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.released, 1);
    await runDueTasks();
    assert.equal(await waitingGate(manual), "LOAD_BETA");
    const released = await Job.findById(manual);
    assert.equal(released.approvals.DEAL_DETAILS.by, "admin.user@example.com");

    const automatic = (await submit("12346", "AUTOMATIC")).body.job.id;
    await runDueTasks();
    const auto = await Job.findById(automatic);
    assert.equal(auto.status, JOB_STATUS.APPLICATIONS_OPEN);
    assert.equal(auto.flowMode, "AUTOMATIC");
    assert.equal(auto.approvals?.DEAL_DETAILS, undefined);
  });

  test("the admin decides which flows CRMs can pick", async () => {
    const both = (await crm.get("/api/crm/controls")).body.flow;
    assert.deepEqual(both.options, ["AUTOMATIC", "STEP_BY_STEP"]);
    assert.equal(both.defaultMode, "STEP_BY_STEP");

    await setFlow({ crmOptions: { STEP_BY_STEP: false } });
    const onlyAutomatic = (await crm.get("/api/crm/controls")).body.flow;
    assert.deepEqual(onlyAutomatic.options, ["AUTOMATIC"]);
    assert.equal(onlyAutomatic.defaultMode, "AUTOMATIC");
    const refused = await submit("12345", "STEP_BY_STEP");
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /Step by step flow is turned off/);
    assert.equal((await submit("12345")).body.job.flowMode, "AUTOMATIC");

    await setFlow({ crmOptions: { AUTOMATIC: false, STEP_BY_STEP: false }, mode: "STEP_BY_STEP" });
    assert.deepEqual((await crm.get("/api/crm/controls")).body.flow.options, []);
    const hidden = await submit("12346", "AUTOMATIC");
    assert.equal(hidden.body.job.flowMode, "STEP_BY_STEP", "with no choice shown, the admin's flow is used");
  });

  test("only the steps the admin picks wait for approval", async () => {
    await setFlow({
      mode: "STEP_BY_STEP",
      approvals: { DEAL_DETAILS: false, LOAD_BETA: false, LOAD_PROD: false, ELIGIBLE_STUDENTS: false, START_WINDOW: true },
    });
    const id = (await submit("12345")).body.job.id;
    await runDueTasks();
    assert.equal(await waitingGate(id), "START_WINDOW");
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"]);
    assert.equal(await NotificationLog.countDocuments({ jobId: id }), 0);

    assert.equal((await approve(id, "START_WINDOW")).status, 200);
    await runDueTasks();
    assert.equal((await Job.findById(id)).status, JOB_STATUS.APPLICATIONS_OPEN);
  });
});
