import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, TASK_TYPE } from "../src/config/statuses.js";
import { ApplicationSnapshot, CandidateAnalysis, Job, JobApplication, WorkflowTask } from "../src/models/index.js";
import { createGeminiResumeAnalyzer } from "../src/services/geminiResumeAnalyzer.js";
import { integrations, overrideIntegration } from "../src/services/integrations.js";
import { IntegrationError } from "../src/utils/errors.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import { advance, advanceAndRun, loginAs, openApplicationWindow, resetDb, runToPsmReview, startTestDb, stopTestDb } from "./helpers.js";

describe("21h close, final pool and AI prioritisation", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("at 21h the window closes, the final pool is fetched and AI analysis produces a ranking", async () => {
    const job = await runToPsmReview(crm, "12345");
    const statuses = job.statusHistory.map((entry) => entry.status);
    for (const status of [
      JOB_STATUS.APPLICATIONS_CLOSED,
      JOB_STATUS.FETCHING_APPLIED_POOL,
      JOB_STATUS.APPLIED_POOL_READY,
      JOB_STATUS.AI_ANALYSIS,
      JOB_STATUS.PRIORITY_GENERATED,
      JOB_STATUS.READY_FOR_PSM,
    ]) {
      assert.ok(statuses.includes(status), `went through ${status}`);
    }

    const snapshot = await ApplicationSnapshot.findOne({ jobId: job._id, kind: "FINAL" });
    const applications = await JobApplication.countDocuments({ jobId: job._id });
    assert.equal(snapshot.count, applications);
    assert.equal(job.appliedCount, applications);

    const candidates = await CandidateAnalysis.find({ jobId: job._id }).sort({ aiRank: 1 });
    assert.equal(candidates.length, applications);
    assert.deepEqual(
      candidates.map((candidate) => candidate.aiPriority),
      candidates.map((_, index) => `P${index + 1}`),
      "priorities are P1..Pn",
    );
    for (let i = 1; i < candidates.length; i++) {
      assert.ok((candidates[i - 1].overallScore ?? -1) >= (candidates[i].overallScore ?? -1), "sorted by overall score");
    }
    assert.ok(candidates.every((candidate) => candidate.finalPriority === candidate.aiPriority));
    const noResume = candidates.filter((candidate) => candidate.analysisStatus === "NO_RESUME");
    assert.ok(noResume.every((candidate) => candidate.resumeScore === null));
    const niat = candidates.filter((candidate) => candidate.product === "NIAT");
    const others = candidates.filter((candidate) => candidate.product !== "NIAT");
    assert.ok(niat.length > 0 && others.length > 0);
    assert.ok(niat.every((candidate) => ["COMPLETED", "NO_RESUME"].includes(candidate.analysisStatus)));
    assert.ok(niat.some((candidate) => candidate.gritScore !== null), "NIAT students get GRIT scores");
    assert.ok(
      others.every(
        (candidate) =>
          candidate.analysisStatus === "SKIPPED" &&
          /only for NIAT students/.test(candidate.analysisError) &&
          candidate.resumeScore === null &&
          candidate.gritScore === null,
      ),
      "Academy students get no AI resume score and no GRIT score",
    );
  });

  test("the window does not close before 21 hours even if the target is reached", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await Job.updateOne({ _id: job._id }, { $set: { expectedPoolCount: 1 } });
    await advanceAndRun({ hours: 20, minutes: 59 });
    const open = await Job.findById(job._id);
    assert.equal(open.poolTargetReached, true);
    assert.ok([JOB_STATUS.APPLICATIONS_OPEN, JOB_STATUS.REMINDER_10H_SENT, JOB_STATUS.REMINDER_20H_SENT].includes(open.status));
    await advanceAndRun({ minutes: 2 });
    assert.equal((await Job.findById(job._id)).status, JOB_STATUS.READY_FOR_PSM);
  });

  test("one candidate's AI failure does not fail the rest", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const mock = createGeminiResumeAnalyzer();
    let failedOnce = false;
    overrideIntegration("gemini", {
      async analyze(input) {
        if (!failedOnce) {
          failedOnce = true;
          throw new IntegrationError("Gemini output failed validation", { retryable: false });
        }
        return mock.analyze(input);
      },
    });
    await advanceAndRun({ hours: 21, minutes: 1 });

    const updated = await Job.findById(job._id);
    assert.equal(updated.status, JOB_STATUS.READY_FOR_PSM);
    const failed = await CandidateAnalysis.find({ jobId: job._id, analysisStatus: "FAILED" });
    assert.equal(failed.length, 1);
    assert.match(failed[0].analysisError, /validation/);
    assert.equal(updated.ai.failedCount, 1);
    assert.ok((await CandidateAnalysis.countDocuments({ jobId: job._id, analysisStatus: "COMPLETED" })) > 0);
    assert.ok(failed[0].aiPriority, "failed candidates are still ranked");
  });

  test("if AI fails for every candidate the step is retried instead of silently continuing", async () => {
    const job = await openApplicationWindow(crm, "12345");
    overrideIntegration("gemini", {
      async analyze() {
        throw new IntegrationError("Gemini 503", { retryable: false });
      },
    });
    await advanceAndRun({ hours: 21, minutes: 1 });
    const updated = await Job.findById(job._id);
    assert.equal(updated.status, JOB_STATUS.AI_ANALYSIS);
    const task = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.AI_ANALYSIS });
    assert.equal(task.status, "PENDING");
    assert.match(task.lastError, /all \d+ candidates with a resume/);
  });

  test("a BigQuery outage at close is retried and the pool is not marked ready until it succeeds", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const real = integrations.bigquery;
    let outage = true;
    overrideIntegration("bigquery", new Proxy(real, {
      get(target, property) {
        if (property === "getApplicants" && outage) {
          return async () => {
            throw new IntegrationError("BigQuery backendError", { retryable: true });
          };
        }
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      },
    }));

    await advanceAndRun({ hours: 21, minutes: 1 });
    assert.equal((await Job.findById(job._id)).status, JOB_STATUS.FETCHING_APPLIED_POOL);
    const task = await WorkflowTask.findOne({ jobId: job._id, type: TASK_TYPE.FETCH_FINAL_POOL });
    assert.equal(task.status, "PENDING");
    assert.equal(await ApplicationSnapshot.countDocuments({ jobId: job._id }), 0);

    outage = false;
    advance({ minutes: 2 });
    await runDueTasks();
    assert.equal((await Job.findById(job._id)).status, JOB_STATUS.READY_FOR_PSM);
  });
});
