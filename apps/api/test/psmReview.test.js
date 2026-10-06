import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, NOTIFICATION_TYPE } from "../src/config/statuses.js";
import { CandidateAnalysis, CandidatePriorityHistory, Job, NotificationLog } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { XHR, advance, api, loginAs, resetDb, runToPsmReview, startTestDb, stopTestDb } from "./helpers.js";

describe("PSM review, public link and CRM notification", () => {
  let crm;
  let psm;
  let job;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
    psm = await loginAs("psm.user@example.com", "PSM");
    job = await runToPsmReview(crm, "12345");
  });

  test("the job appears on the PSM dashboard ready for review", async () => {
    const list = await psm.get("/api/psm/jobs");
    assert.equal(list.status, 200);
    const row = list.body.items.find((item) => item.id === String(job._id));
    assert.ok(row);
    assert.equal(row.action, "OPEN_REVIEW");
    assert.equal(row.aiStatus.label, "AI Completed");
    assert.equal(row.priorityStatus.label, "Priority Generated");
    assert.equal(row.psmStatus.label, "Ready for Review");
    assert.equal(row.crmShareStatus.label, "CRM Pending");

    const filtered = await psm.get("/api/psm/jobs?psmStatus=COMPLETED");
    assert.equal(filtered.body.items.length, 0);

    const start = await psm.post(`/api/psm/jobs/${job._id}/start-review`).set(XHR);
    assert.equal(start.body.job.psmStatus.label, "Under Review");
    assert.equal(start.body.job.action, "CONTINUE_REVIEW");
  });

  test("PSM overrides priority with a swap; AI priority is preserved and every change is audited", async () => {
    const candidates = (await psm.get(`/api/psm/jobs/${job._id}/candidates?limit=100`)).body.items;
    assert.ok(candidates.length >= 3);
    const third = candidates.find((candidate) => candidate.finalPriority === "P3");
    const first = candidates.find((candidate) => candidate.finalPriority === "P1");

    const response = await psm
      .patch(`/api/psm/jobs/${job._id}/candidates/${third.studentId}`)
      .set(XHR)
      .send({ finalPriority: "P1", psmRemarks: "Strong interview performance", candidateStatus: "RECOMMENDED" });
    assert.equal(response.status, 200);
    assert.equal(response.body.candidate.finalPriority, "P1");
    assert.equal(response.body.candidate.aiPriority, "P3", "AI priority is never overwritten");
    assert.deepEqual(response.body.swappedWith, { studentId: first.studentId, finalPriority: "P3" });

    const swapped = await CandidateAnalysis.findOne({ jobId: job._id, studentId: first.studentId });
    assert.equal(swapped.finalPriority, "P3");
    assert.equal(swapped.aiPriority, "P1");
    assert.equal(await CandidatePriorityHistory.countDocuments({ jobId: job._id }), 2);
    const history = await CandidatePriorityHistory.findOne({ studentId: third.studentId });
    assert.equal(history.previousPriority, "P3");
    assert.equal(history.newPriority, "P1");
    assert.equal(history.changedByEmail, "psm.user@example.com");

    const priorities = (await CandidateAnalysis.find({ jobId: job._id })).map((candidate) => candidate.finalPriority);
    assert.equal(new Set(priorities).size, priorities.length, "final priorities stay unique");
    assert.equal((await Job.findById(job._id)).status, JOB_STATUS.PSM_REVIEW_IN_PROGRESS);

    const invalid = await psm.patch(`/api/psm/jobs/${job._id}/candidates/${third.studentId}`).set(XHR).send({ finalPriority: "P9999" });
    assert.equal(invalid.status, 400);
  });

  test("CRM users cannot read candidate data", async () => {
    assert.equal((await crm.get(`/api/psm/jobs/${job._id}/candidates`)).status, 403);
  });

  test("submitting freezes the pool, creates a public link and emails the CRM owner exactly once", async () => {
    const submit = await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
    assert.equal(submit.status, 200);
    const link = submit.body.publicLinkUrl;
    assert.match(link, /^http:\/\/localhost:5173\/public\/candidate-pool\/[A-Za-z0-9_-]{40,}$/);
    assert.equal(submit.body.job.isSubmitted, true);
    assert.equal(submit.body.job.reviewedBy, "psm.user@example.com");

    const candidate = (await CandidateAnalysis.findOne({ jobId: job._id })).studentId;
    const frozen = await psm.patch(`/api/psm/jobs/${job._id}/candidates/${candidate}`).set(XHR).send({ psmRemarks: "late" });
    assert.equal(frozen.status, 409);
    assert.equal(frozen.body.error.code, "REVIEW_FROZEN");

    await runDueTasks();
    const again = await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
    assert.equal(again.body.publicLinkUrl, link, "idempotent submit returns the same link");
    await runDueTasks();

    const crmEmails = await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.CRM_POOL_READY });
    assert.equal(crmEmails.length, 1);
    assert.equal(crmEmails[0].email, "owner.crm@example.com", "only the deal's CRM owner is emailed");
    assert.equal(integrations.ses.sent.filter((mail) => /Candidate Pool Ready/.test(mail.subject)).length, 1);

    const completed = await Job.findById(job._id);
    assert.equal(completed.status, JOB_STATUS.COMPLETED);
    assert.equal(completed.crmShare.status, "SHARED");

    const row = (await crm.get("/api/crm/deals")).body.items[0];
    assert.equal(row.displayStatus.label, "Completed");
    assert.equal(row.currentStep, "Public Link Created / CRM Notified");
    assert.equal(row.publicLinkUrl, link);
    assert.equal(row.isActive, false);

    const psmRow = (await psm.get("/api/psm/jobs")).body.items[0];
    assert.equal(psmRow.action, "VIEW_POOL");
    assert.equal(psmRow.crmShareStatus.label, "Shared to CRM");
  });

  test("the public pool is read-only, sorted by final priority and hides internal data", async () => {
    const submit = await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
    const token = submit.body.publicLinkUrl.split("/").pop();

    const pool = await api().get(`/api/public/candidate-pools/${token}`);
    assert.equal(pool.status, 200);
    assert.equal(pool.body.companyName, job.companyName);
    assert.deepEqual(
      pool.body.candidates.map((candidate) => candidate.finalPriority),
      pool.body.candidates.map((_, index) => `P${index + 1}`),
    );
    const serialized = JSON.stringify(pool.body);
    for (const hidden of ["studentId", "psmRemarks", "email", "mobile", "_id", "jobId", "resumeUrl"]) {
      assert.ok(!serialized.includes(`"${hidden}"`), `${hidden} is not exposed`);
    }

    const withResume = pool.body.candidates.find((candidate) => candidate.hasResume);
    const resume = await api().get(`/api/public/candidate-pools/${token}/candidates/${withResume.ref}/resume`);
    assert.equal(resume.status, 200);

    assert.equal((await api().get(`/api/public/candidate-pools/${"x".repeat(43)}`)).status, 404);
    advance({ hours: 31 * 24 });
    const expired = await api().get(`/api/public/candidate-pools/${token}`);
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, "LINK_EXPIRED");
  });
});
