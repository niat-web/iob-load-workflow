import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_STATUS, NOTIFICATION_TYPE } from "../src/config/statuses.js";
import { CandidateAnalysis, CandidatePriorityHistory, Job, NotificationLog } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { companySlug } from "../src/utils/helpers.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";
import {
  XHR,
  advance,
  advanceAndRun,
  api,
  loginAs,
  openApplicationWindow,
  resetDb,
  runToPsmReview,
  startTestDb,
  stopTestDb,
} from "./helpers.js";

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
    const either = await psm.get("/api/psm/jobs").query({ psmStatus: "COMPLETED|READY", aiStatus: "COMPLETED" });
    assert.ok(either.body.items.some((item) => item.id === String(job._id)));
    const both = await psm.get("/api/psm/jobs").query({ psmStatus: "READY", aiStatus: "FAILED|PENDING" });
    assert.equal(both.body.items.length, 0);
    const byCompanies = await psm.get("/api/psm/jobs").query({ company: `Nobody Inc|${row.companyName}` });
    assert.ok(byCompanies.body.items.some((item) => item.id === String(job._id)));
    assert.equal((await psm.get("/api/psm/jobs").query({ psmStatus: "READY|NOPE" })).status, 400);

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
    assert.equal(link, `http://localhost:5173/shared/profiles/${companySlug(job.companyName)}/${job.learningPortalJobId}`);
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
    assert.equal(crmEmails[0].email, "crm.user@example.com", "the CRM who loaded the deal is emailed");
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

  test("the shared profiles page has the same columns for every company and only the status dropdowns can change", async () => {
    const submit = await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
    const url = submit.body.publicLinkUrl;
    assert.ok(url.includes(`/shared/profiles/${companySlug(job.companyName)}/`), "the company name is in the link");
    const jobId = url.split("/").pop();
    assert.equal(jobId, job.learningPortalJobId);
    const base = `/api/shared/profiles/${jobId}`;

    const sheet = (await api().get(base)).body;
    assert.deepEqual(
      sheet.columns.map((column) => column.label),
      [
        "Full Name",
        "Mobile Number",
        "Email Id",
        "Bachelors Course Name",
        "Bachelors Department Name",
        "Bachelors Year of Completion",
        "Bachelors Percentage",
        "Resume",
        "Resume Shortlisting",
        "TR Round 1",
        "TR Round 2",
        "HR Round",
        "MR Round",
        "Final Status",
      ],
    );
    assert.deepEqual(
      sheet.columns.filter((column) => column.editable).map((column) => column.key),
      ["resumeShortlisting", "trRound1", "trRound2", "hrRound", "mrRound", "finalStatus"],
    );
    assert.deepEqual(sheet.columns.find((column) => column.key === "resumeShortlisting").options, ["Selected", "Rejected", "On Hold"]);
    assert.deepEqual(
      sheet.columns.find((column) => column.key === "finalStatus").options,
      ["Yet to Schedule", "Scheduled", "Selected", "Rejected", "Hold", "No Show"],
    );
    assert.ok(!("totalApplied" in sheet), "no summary on the page");

    const ranked = await CandidateAnalysis.find({ jobId: job._id }).sort({ finalRank: 1 }).lean();
    assert.deepEqual(
      sheet.rows.map((row) => row.values.fullName),
      ranked.map((candidate) => candidate.studentName),
      "rows follow the PSM's final priority",
    );
    const first = sheet.rows[0];
    assert.ok(first.values.email.endsWith("@students.example.com"));
    assert.equal(first.values.bachelorsCourse, "B.Tech");
    assert.ok(first.values.bachelorsPercentage);
    const serialized = JSON.stringify(sheet);
    for (const hidden of ["studentId", "psmRemarks", "resumeUrl", "overallScore", "finalPriority", ranked[0].studentId]) {
      assert.ok(!serialized.includes(hidden), `${hidden} is not exposed`);
    }

    const edit = (key, value) => api().patch(`${base}/rows/${first.id}`).set(XHR).send({ key, value });
    assert.equal((await edit("trRound1", "Scheduled")).status, 204);
    assert.equal((await edit("resumeShortlisting", "Selected")).status, 204);
    assert.equal((await edit("trRound1", "Maybe")).status, 400, "only the listed options");
    assert.equal((await edit("resumeShortlisting", "Scheduled")).status, 400);
    assert.equal((await edit("fullName", "Someone else")).status, 400, "student details cannot be changed");
    assert.equal((await edit("resume", "x")).status, 400);
    assert.equal((await api().post(`${base}/rows`).set(XHR).send({ values: {} })).status, 404, "rows cannot be added");
    assert.equal((await api().post(`${base}/columns`).set(XHR).send({ label: "Slot" })).status, 404, "columns cannot be added");

    const current = (await api().get(base)).body;
    assert.equal(current.rows[0].values.trRound1, "Scheduled");
    assert.equal(current.rows[0].values.resumeShortlisting, "Selected");
    assert.equal(current.rows[0].values.finalStatus, "");
    assert.equal((await edit("trRound1", "")).status, 204, "a choice can be cleared");

    const withResume = current.rows.find((row) => row.resumeRef);
    assert.equal((await api().get(`${base}/resumes/${withResume.resumeRef}`)).status, 200);
    assert.equal((await api().get("/api/shared/profiles/not-a-job-id")).status, 400);
    assert.equal((await api().get("/api/shared/profiles/00000000-0000-4000-8000-000000000000")).status, 404);
    advance({ hours: 31 * 24 });
    const expired = await api().get(base);
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, "LINK_EXPIRED");
  });

  test("the review shows the applicant's details, and the PSM picks which extra columns show for this deal", async () => {
    assert.deepEqual((await psm.get(`/api/psm/jobs/${job._id}`)).body.psmColumns, []);
    const candidate = (await psm.get(`/api/psm/jobs/${job._id}/candidates`)).body.items[0];
    assert.equal(candidate.details.userId, candidate.studentId);
    assert.equal(candidate.details.jobId, job.learningPortalJobId);
    assert.equal(candidate.details.bachelorsCourse, "B.Tech");
    assert.ok(candidate.details.email.endsWith("@students.example.com"));
    assert.ok(candidate.details.appliedAt);

    const columns = (body) => psm.patch(`/api/psm/jobs/${job._id}/columns`).set(XHR).send(body);
    assert.equal((await columns({ columns: ["email", "nope"] })).status, 400);
    const saved = await columns({ columns: ["email", "appliedAt"] });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.psmColumns, ["appliedAt", "email"]);
    assert.deepEqual((await psm.get(`/api/psm/jobs/${job._id}`)).body.psmColumns, ["appliedAt", "email"]);
    assert.equal((await crm.patch(`/api/psm/jobs/${job._id}/columns`).set(XHR).send({ columns: [] })).status, 403);
  });

  test("a deal shows on Candidate Pools while its window is open, with the applied pool synced every 30 minutes", async () => {
    const open = await openApplicationWindow(crm, "12346");
    await advanceAndRun({ hours: 5 });

    const row = (await psm.get("/api/psm/jobs")).body.items.find((item) => item.id === String(open._id));
    assert.ok(row, "the open deal is listed");
    assert.equal(row.applicationWindow.label, "Open");
    assert.equal(row.action, "VIEW_APPLICANTS");
    assert.ok(row.lastSyncedAt);
    assert.equal(row.syncError, null);

    const applicants = (await psm.get(`/api/psm/jobs/${open._id}/applicants`)).body;
    assert.equal(applicants.windowOpen, true);
    assert.equal(applicants.pagination.total, (await Job.findById(open._id)).appliedCount);
    assert.ok(applicants.items.length > 0);
    const withResume = applicants.items.find((item) => item.hasResume);
    assert.equal((await psm.get(`/api/psm/jobs/${open._id}/applicants/${withResume.studentId}/resume`)).status, 200);
    assert.equal((await crm.get(`/api/psm/jobs/${open._id}/applicants`)).status, 403);
  });
});
