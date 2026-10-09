import "./setup.js";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { JOB_STATUS } from "../src/config/statuses.js";
import { AuditLog, EligiblePoolStudent, Job, JobEligibleStudent } from "../src/models/index.js";
import { MockDealOverride } from "../src/services/hubspotClient.js";
import { integrations } from "../src/services/integrations.js";
import { XHR, advanceAndRun, loginAs, openApplicationWindow, resetDb, runDueTasks, startTestDb, stopTestDb } from "./helpers.js";

const poolRow = (studentId, productGroup = "NIAT", eligibilityStatus = "Eligible") => ({
  studentId,
  studentName: `Student ${studentId}`,
  email: `${studentId.toLowerCase()}@students.example.com`,
  mobile: "9876543210",
  productGroup,
  eligibilityStatus,
  batch: "2025",
  syncedAt: new Date(),
  manual: true,
});

const grantedTo = (jobId) =>
  integrations.learningPortal.calls
    .filter((call) => call.op === "grantAccess" && call.env === config.learningPortal.accessEnv && call.jobId === jobId)
    .flatMap((call) => call.userIds);

describe("adding new eligible students to a live deal", () => {
  let crm;
  let source;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    source = config.eligibility.source;
    config.eligibility.source = "pool";
    crm = await loginAs("crm.user@example.com", "CRM");
    await MockDealOverride.updateOne({ dealId: "12345" }, { $set: { properties: { product: "NIAT" } } }, { upsert: true });
    await EligiblePoolStudent.insertMany(["N1", "N2", "N3"].map((id) => poolRow(id)));
  });
  afterEach(() => {
    config.eligibility.source = source;
  });

  const detail = async (id) => (await crm.get(`/api/crm/deals/${id}`)).body;
  const preview = (id) => crm.get(`/api/crm/deals/${id}/new-eligible`);
  const add = (id) => crm.post(`/api/crm/deals/${id}/new-eligible`).set(XHR);

  test("while the window is open, new pool students are previewed and given job access straight away", async () => {
    const job = await openApplicationWindow(crm, "12345");
    assert.deepEqual((await detail(job._id)).addEligible, { allowed: true, accessNow: true, reason: null });
    assert.equal((await preview(job._id)).body.total, 0, "everyone who matches is already on the deal");

    await EligiblePoolStudent.insertMany([
      poolRow("N4"),
      poolRow("N5"),
      poolRow("A1", "Academy"),
      poolRow("N6", "NIAT", "Placed"),
    ]);
    const found = (await preview(job._id)).body;
    assert.equal(found.total, 2);
    assert.deepEqual(found.students.map((student) => student.studentId).sort(), ["N4", "N5"]);
    assert.equal(found.withEmail, 2);
    assert.equal(found.students[0].hasMobile, true);
    assert.equal("email" in found.students[0], false, "the preview carries no contact details");

    const response = await add(job._id);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.result, { added: 2, accessNow: true, granted: 2, rejected: 0, eligibleCount: 5 });
    assert.equal(response.body.deal.eligibleCount, 5);

    const rows = await JobEligibleStudent.find({ jobId: job._id, studentId: { $in: ["N4", "N5"] } }).lean();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.accessGrantedAt && row.product === "NIAT"));
    const granted = grantedTo(job.learningPortalJobId);
    assert.ok(["N4", "N5"].every((id) => granted.includes(id)));
    assert.ok(!granted.includes("A1") && !granted.includes("N6"));
    assert.ok(await AuditLog.findOne({ action: "NEW_ELIGIBLE_STUDENTS_ADDED", entityId: String(job._id) }).lean());

    const again = await add(job._id);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "NO_NEW_STUDENTS");
  });

  test("while a Step by step deal waits to give access, new students join the list and get access with everyone else", async () => {
    const admin = await loginAs("admin.user@example.com", "ADMIN");
    await admin
      .patch("/api/admin/settings")
      .set(XHR)
      .send({
        flow: {
          mode: "STEP_BY_STEP",
          approvals: { DEAL_DETAILS: false, LOAD_BETA: false, LOAD_PROD: false, ELIGIBLE_STUDENTS: true, START_WINDOW: false },
        },
      });
    const id = (await crm.post("/api/crm/deals/process").set(XHR).send({ dealId: "12345" })).body.job.id;
    await runDueTasks();
    assert.equal((await Job.findById(id)).awaitingApproval?.gate, "ELIGIBLE_STUDENTS");
    assert.deepEqual((await detail(id)).addEligible, { allowed: true, accessNow: false, reason: null });

    await EligiblePoolStudent.create(poolRow("N4"));
    const response = await add(id);
    assert.equal(response.status, 200);
    assert.equal(response.body.result.accessNow, false);
    assert.equal(response.body.result.granted, 0);
    assert.equal((await JobEligibleStudent.findOne({ jobId: id, studentId: "N4" }).lean()).accessGrantedAt, null);

    await crm.post(`/api/crm/deals/${id}/approve`).set(XHR).send({ gate: "ELIGIBLE_STUDENTS" });
    await runDueTasks();
    assert.ok((await JobEligibleStudent.findOne({ jobId: id, studentId: "N4" }).lean()).accessGrantedAt);
    assert.equal((await Job.findById(id)).status, JOB_STATUS.APPLICATIONS_OPEN);
  });

  test("the deal's students are listed with their job access and can be downloaded", async () => {
    const job = await openApplicationWindow(crm, "12345");
    await JobEligibleStudent.updateOne({ jobId: job._id, studentId: "N3" }, { $set: { accessGrantedAt: null, accessRejectedReason: "placed" } });

    const all = (await crm.get(`/api/crm/deals/${job._id}/students`)).body;
    assert.equal(all.pagination.total, 3);
    assert.deepEqual(
      { total: all.summary.total, access: all.summary.access, refused: all.summary.refused, waiting: all.summary.waiting },
      { total: 3, access: 2, refused: 1, waiting: 0 },
    );
    assert.deepEqual(all.summary.products, { NIAT: 3 });
    const refusedRow = all.items.find((row) => row.studentId === "N3");
    assert.equal(refusedRow.status, "REFUSED");
    assert.equal(refusedRow.accessRejectedReason, "placed");
    assert.ok(all.items.find((row) => row.studentId === "N1").accessGrantedAt);

    const refused = (await crm.get(`/api/crm/deals/${job._id}/students`).query({ access: "REFUSED" })).body;
    assert.deepEqual(refused.items.map((row) => row.studentId), ["N3"]);
    const searched = (await crm.get(`/api/crm/deals/${job._id}/students`).query({ search: "n2" })).body;
    assert.deepEqual(searched.items.map((row) => row.studentId), ["N2"]);

    const csv = await crm.get(`/api/crm/deals/${job._id}/students/export`).query({ access: "ACCESS" });
    assert.equal(csv.status, 200);
    assert.match(csv.headers["content-type"], /text\/csv/);
    assert.match(csv.headers["content-disposition"], /deal-12345-students\.csv/);
    const lines = csv.text.replace(/^﻿/, "").trim().split("\r\n");
    assert.match(lines[0], /^User ID,Name,Product/);
    assert.equal(lines.length, 3, "header plus the two students with access");
    assert.ok(lines.some((line) => line.startsWith("N1,")));

    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get(`/api/crm/deals/${job._id}/students`)).status, 403);
  });

  test("nothing can be added before the job is live or after the window closes, and PSMs cannot add", async () => {
    const admin = await loginAs("admin.user@example.com", "ADMIN");
    await admin.patch("/api/admin/settings").set(XHR).send({ flow: { mode: "STEP_BY_STEP" } });
    const waiting = (await crm.post("/api/crm/deals/process").set(XHR).send({ dealId: "12345" })).body.job.id;
    await runDueTasks();
    const early = (await detail(waiting)).addEligible;
    assert.equal(early.allowed, false);
    assert.match(early.reason, /live on the Learning Portal/);
    assert.equal((await add(waiting)).body.error.code, "TOP_UP_NOT_ALLOWED");

    await admin.patch("/api/admin/settings").set(XHR).send({ flow: { mode: "AUTOMATIC" } });
    await MockDealOverride.updateOne({ dealId: "67890" }, { $set: { properties: { product: "NIAT" } } }, { upsert: true });
    const job = await openApplicationWindow(crm, "67890");
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.post(`/api/crm/deals/${job._id}/new-eligible`).set(XHR)).status, 403);

    await advanceAndRun({ hours: 21, minutes: 1 });
    const closed = (await detail(job._id)).addEligible;
    assert.equal(closed.allowed, false);
    assert.match(closed.reason, /window has closed/);
    await EligiblePoolStudent.create(poolRow("N9"));
    const refused = await add(job._id);
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, "TOP_UP_NOT_ALLOWED");
  });
});
