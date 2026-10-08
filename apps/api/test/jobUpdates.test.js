import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_TYPE } from "../src/config/statuses.js";
import { Job, JobApplication, JobUpdateNotice, JobUpdateResponse, NotificationLog } from "../src/models/index.js";
import { integrations } from "../src/services/integrations.js";
import { jobUpdatedEmail } from "../src/templates/email/index.js";
import { XHR, advanceAndRun, api, loginAs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

describe("HubSpot changes during the window", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  async function changedLocation() {
    const job = await openApplicationWindow(crm, "12345");
    await advanceAndRun({ hours: 3 });
    await integrations.hubspot.setOverride("12345", { location: "Mumbai" });
    await advanceAndRun({ minutes: 31 });
    return Job.findById(job._id);
  }

  test("every 30 minutes the deal is checked; a change updates the job and emails applied students a form link", async () => {
    const job = await changedLocation();
    assert.equal(job.location, "Mumbai", "found by the 30-minute check, without a webhook");
    assert.equal(job.version, 2);

    const notice = await JobUpdateNotice.findOne({ jobId: job._id }).lean();
    assert.ok(notice.token.length >= 40);
    assert.equal(notice.learningPortalJobId, job.learningPortalJobId);
    assert.deepEqual(notice.changes.map((change) => change.field), ["location"]);

    const applied = await JobApplication.find({ jobId: job._id, email: { $nin: [null, ""] } }).lean();
    const sent = await NotificationLog.find({ jobId: job._id, type: NOTIFICATION_TYPE.JOB_UPDATED }).lean();
    assert.deepEqual(sent.map((log) => log.studentId).sort(), applied.map((row) => row.studentId).sort());
    assert.match(sent[0].payload.formUrl, new RegExp(`/job-update/${job.learningPortalJobId}/${notice.token}$`));

    const html = jobUpdatedEmail(job, { studentName: "Asha Rao", studentId: "u-1" }, notice.changes, sent[0].payload.formUrl).html;
    assert.match(html, new RegExp(`/job-update/${job.learningPortalJobId}/${notice.token}\\?user_id=u-1`));
    assert.match(html, /Mumbai/);
    assert.equal((html.match(/href=/g) ?? []).length, 1, "the form link is the only link");
  });

  test("an applied student answers the interest form; the answer is saved and shown in the applied pool", async () => {
    const job = await changedLocation();
    const notice = await JobUpdateNotice.findOne({ jobId: job._id }).lean();
    const student = await JobApplication.findOne({ jobId: job._id }).lean();
    const path = `/api/public/job-updates/${notice.token}`;

    const form = await api().get(path).query({ user_id: student.studentId, job_id: job.learningPortalJobId });
    assert.equal(form.status, 200);
    assert.equal(form.body.companyName, job.companyName);
    assert.deepEqual(form.body.changes.map((change) => change.newValue), ["Mumbai"]);
    assert.equal(form.body.response, null);

    assert.equal((await api().get(path).query({ user_id: "not-an-applicant" })).status, 404);
    assert.equal((await api().get(path).query({ user_id: student.studentId, job_id: "other-job" })).status, 404);
    assert.equal((await api().get("/api/public/job-updates/abcdefghijklmnopqrstuvwxyz").query({ user_id: student.studentId })).status, 404);

    const answer = await api()
      .post(path)
      .set(XHR)
      .send({ userId: student.studentId, jobId: job.learningPortalJobId, interested: false, reason: "LOCATION", comments: "Prefer Hyderabad" });
    assert.equal(answer.status, 200);
    assert.equal(answer.body.response.interested, false);
    const again = await api().post(path).set(XHR).send({ userId: student.studentId, interested: true });
    assert.equal(again.body.response.interested, true);
    assert.equal(await JobUpdateResponse.countDocuments({ jobId: job._id, studentId: student.studentId }), 1, "one answer per student per update");
    const saved = await JobUpdateResponse.findOne({ jobId: job._id, studentId: student.studentId }).lean();
    assert.equal(saved.companyName, job.companyName);
    assert.equal(saved.learningPortalJobId, job.learningPortalJobId);
    assert.equal(saved.reason, null);

    await advanceAndRun({ hours: 21 });
    const psm = await loginAs("psm.user@example.com", "PSM");
    const candidates = (await psm.get(`/api/psm/jobs/${job._id}/candidates`).query({ limit: 500 })).body.items;
    const row = candidates.find((candidate) => candidate.studentId === student.studentId);
    assert.equal(row.interest.interested, true);
    assert.ok(candidates.some((candidate) => candidate.interest === null));
  });
});
