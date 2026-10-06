import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS } from "../src/config/statuses.js";
import {
  AuditLog,
  Job,
  JobDealSnapshot,
  JobEligibleStudent,
  JobHubspotMapping,
  NotificationLog,
  WorkflowTask,
} from "../src/models/index.js";
import { failJob, transitionJob } from "../src/services/jobService.js";
import {
  XHR,
  advanceAndRun,
  loginAs,
  openApplicationWindow,
  resetDb,
  runDueTasks,
  startTestDb,
  stopTestDb,
  submitDeal,
} from "./helpers.js";

describe("stop and delete deals", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  const stop = (id) => crm.post(`/api/crm/deals/${id}/stop`).set(XHR);
  const remove = (id) => crm.delete(`/api/crm/deals/${id}`).set(XHR);
  const row = async (id) => (await crm.get("/api/crm/deals")).body.items.find((item) => item.id === String(id));

  test("a running deal can be stopped and no reminders, AI or PSM steps follow", async () => {
    const job = await openApplicationWindow(crm);
    const sent = await NotificationLog.countDocuments({ jobId: job._id });
    assert.equal((await row(job._id)).canStop, true);
    assert.equal((await row(job._id)).canDelete, false);

    const stopped = await stop(job._id);
    assert.equal(stopped.status, 200);
    assert.equal(stopped.body.job.displayStatus.label, "Stopped");
    assert.equal(stopped.body.job.currentStep, "Stopped");
    assert.equal(stopped.body.job.canStop, false);
    assert.equal(stopped.body.job.canDelete, true);
    assert.equal(stopped.body.job.isActive, false);

    await advanceAndRun({ hours: 24 });
    const after = await Job.findById(job._id);
    assert.equal(after.status, JOB_STATUS.CANCELLED);
    assert.equal(after.cancelledBy, "crm.user@example.com");
    assert.match(after.statusHistory.at(-1).note, /^Stopped at "Application Window" by crm\.user@example\.com$/);
    assert.equal(await NotificationLog.countDocuments({ jobId: job._id }), sent, "no reminders after stopping");
    assert.equal(await WorkflowTask.countDocuments({ jobId: job._id, status: "PENDING" }), 0);

    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get("/api/psm/jobs")).body.items.length, 0);
    assert.equal((await stop(job._id)).status, 409);
    assert.ok(await AuditLog.exists({ action: "DEAL_STOPPED", entityId: String(job._id) }));
  });

  test("a deal still fetching from HubSpot can be stopped before anything else runs", async () => {
    const id = (await submitDeal(crm, "12345")).body.job.id;
    assert.equal((await stop(id)).status, 200);
    await runDueTasks();
    const job = await Job.findById(id);
    assert.equal(job.status, JOB_STATUS.CANCELLED);
    assert.equal(job.companyName ?? null, null, "the fetch task was dropped");
  });

  test("deleting a stopped deal removes all its data and the Deal ID can be submitted again", async () => {
    const job = await openApplicationWindow(crm);
    assert.ok(await JobEligibleStudent.exists({ jobId: job._id }));

    const refused = await remove(job._id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, "NOT_DELETABLE");
    assert.match(refused.body.error.message, /Stop this deal/);

    await stop(job._id);
    assert.equal((await remove(job._id)).status, 204);
    assert.equal(await Job.exists({ _id: job._id }), null);
    for (const Model of [WorkflowTask, JobEligibleStudent, NotificationLog, JobDealSnapshot, JobHubspotMapping]) {
      assert.equal(await Model.countDocuments({ jobId: job._id }), 0, `${Model.modelName} rows remain`);
    }
    const deleted = await AuditLog.findOne({ action: "DEAL_DELETED", entityId: String(job._id) });
    assert.equal(deleted.metadata.hubspotDealId, "12345");
    assert.equal(deleted.actorEmail, "crm.user@example.com");
    assert.equal((await crm.get("/api/crm/deals")).body.items.length, 0);
    assert.equal((await remove(job._id)).status, 404);

    const again = await submitDeal(crm, "12345");
    assert.equal(again.status, 202);
    assert.equal(again.body.duplicate, false);
  });

  test("a failed deal can be deleted without stopping it first", async () => {
    const id = (await submitDeal(crm, "404")).body.job.id;
    await runDueTasks();
    const failed = await row(id);
    assert.equal(failed.displayStatus.key, "FAILED");
    assert.equal(failed.canStop, true);
    assert.equal(failed.canDelete, true);
    assert.equal((await remove(id)).status, 204);
    assert.equal(await Job.countDocuments(), 0);
  });

  test("a deal is not deleted while one of its steps is still running", async () => {
    const id = (await submitDeal(crm, "12345")).body.job.id;
    await stop(id);
    await WorkflowTask.updateOne({ jobId: id }, { $set: { status: "PROCESSING", lockedAt: new Date(), lockedBy: "w1" } });
    const busy = await remove(id);
    assert.equal(busy.status, 409);
    assert.match(busy.body.error.message, /still finishing/);
    assert.ok(await Job.exists({ _id: id }));
  });

  test("finished deals cannot be stopped or deleted", async () => {
    const job = await openApplicationWindow(crm);
    await Job.updateOne({ _id: job._id }, { $set: { status: JOB_STATUS.COMPLETED } });
    const finished = await row(job._id);
    assert.equal(finished.canStop, false);
    assert.equal(finished.canDelete, false);
    assert.equal((await stop(job._id)).status, 409);
    const refused = await remove(job._id);
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /Finished deals/);
  });

  test("a step finishing after the stop cannot overwrite the stopped status", async () => {
    const id = (await submitDeal(crm, "12345")).body.job.id;
    await stop(id);
    assert.equal(await failJob(id, "FETCH_DEAL", new Error("webhook down")).then((job) => job.status), JOB_STATUS.CANCELLED);
    assert.equal(await transitionJob(id, JOB_STATUS.DEAL_FETCHED), null);
    assert.equal((await Job.findById(id)).status, JOB_STATUS.CANCELLED);
  });

  test("PSM users cannot stop or delete deals", async () => {
    const id = (await submitDeal(crm, "12345")).body.job.id;
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.post(`/api/crm/deals/${id}/stop`).set(XHR)).status, 403);
    assert.equal((await psm.delete(`/api/crm/deals/${id}`).set(XHR)).status, 403);
    assert.equal((await crm.delete(`/api/crm/deals/${id}`)).status, 403, "the CSRF header is required");
  });
});
