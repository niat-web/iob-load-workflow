import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { AuditLog, EligiblePoolStudent, User } from "../src/models/index.js";
import { XHR, app, loginAs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const BULK = "/api/admin/eligible-pool/bulk";

const row = (studentId, extra = {}) => ({
  studentId,
  niatId: "",
  studentName: `Student ${studentId}`,
  mobile: "9876543210",
  email: `${studentId.toLowerCase()}@students.example.com`,
  productGroup: "NIAT",
  campus: "Campus A",
  batch: "2025",
  eligibilityStatus: "",
  remarks: "",
  ...extra,
});

async function poolManager(email, products) {
  await User.create({ email, role: "POOL_MANAGER", products, isActive: true, name: email.split("@")[0] });
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/dev-login").set(XHR).send({ email });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return agent;
}

describe("adding Eligible Pool students in bulk", () => {
  let admin;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs("admin.user@example.com", "ADMIN");
  });

  test("new students are added as Eligible when the status is empty, products in any case", async () => {
    const response = await admin
      .post(BULK)
      .set(XHR)
      .send({ source: "CSV", students: [row("U1"), row("U2", { productGroup: "academy" }), row("U3", { eligibilityStatus: "placed" })] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.result, { added: 3, updated: 0, total: 3 });

    const saved = new Map((await EligiblePoolStudent.find({}).lean()).map((student) => [student.studentId, student]));
    assert.equal(saved.get("U1").eligibilityStatus, "Eligible");
    assert.equal(saved.get("U1").productGroup, "NIAT");
    assert.equal(saved.get("U1").manual, true);
    assert.equal(saved.get("U2").productGroup, "Academy");
    assert.equal(saved.get("U3").eligibilityStatus, "Placed");

    const log = await AuditLog.findOne({ action: "ELIGIBLE_POOL_STUDENTS_IMPORTED" }).lean();
    assert.equal(log.metadata.added, 3);
    assert.equal(log.metadata.source, "CSV");
  });

  test("any problem is reported row by row and nothing is saved", async () => {
    await EligiblePoolStudent.create({ studentId: "OLD", studentName: "Old", productGroup: "NIAT", eligibilityStatus: "Eligible", syncedAt: new Date() });
    const response = await admin
      .post(BULK)
      .set(XHR)
      .send({
        students: [
          row("U1"),
          row("U2", { studentName: "" }),
          row("U3", { productGroup: "Intensive" }),
          row("U4", { email: "not-an-email" }),
          row("U1"),
          row("OLD"),
          row("U5", { productGroup: "" }),
          row("U6", { eligibilityStatus: "Maybe" }),
        ],
      });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "BULK_INVALID");
    assert.match(response.body.error.message, /7 rows need fixing\. Nothing was saved\./);
    const byRow = new Map(response.body.error.details.map((problem) => [problem.row, problem]));
    assert.equal(byRow.get(2).field, "studentName");
    assert.match(byRow.get(3).message, /Product must be NIAT or Academy/);
    assert.equal(byRow.get(4).field, "email");
    assert.match(byRow.get(5).message, /Same user ID as row 1/);
    assert.match(byRow.get(6).message, /Already in the Eligible Pool/);
    assert.match(byRow.get(7).message, /Choose the product/);
    assert.match(byRow.get(8).message, /Eligibility status must be one of/);
    assert.equal(await EligiblePoolStudent.countDocuments(), 1, "nothing was saved");
  });

  test("with Update ticked, students already in the pool are updated and empty cells keep saved values", async () => {
    await EligiblePoolStudent.create({
      studentId: "OLD",
      studentName: "Old Name",
      email: "old@students.example.com",
      productGroup: "NIAT",
      eligibilityStatus: "Placed",
      syncedAt: new Date(),
    });
    const response = await admin
      .post(BULK)
      .set(XHR)
      .send({ updateExisting: true, students: [row("OLD", { studentName: "New Name", email: "", eligibilityStatus: "" }), row("U1")] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.result, { added: 1, updated: 1, total: 2 });
    const old = await EligiblePoolStudent.findOne({ studentId: "OLD" }).lean();
    assert.equal(old.studentName, "New Name");
    assert.equal(old.email, "old@students.example.com", "an empty cell does not clear the saved email");
    assert.equal(old.eligibilityStatus, "Placed", "an empty status keeps the saved one");
  });

  test("a Pool Manager adds only their own product; an empty product becomes theirs", async () => {
    await EligiblePoolStudent.create({ studentId: "A-OLD", studentName: "Academy", productGroup: "Academy", syncedAt: new Date() });
    const manager = await poolManager("pool.niat@example.com", ["NIAT"]);

    const refused = await manager
      .post(BULK)
      .set(XHR)
      .send({ updateExisting: true, students: [row("N1", { productGroup: "" }), row("A1", { productGroup: "Academy" }), row("A-OLD")] });
    assert.equal(refused.status, 400);
    const messages = refused.body.error.details.map((problem) => `${problem.row}:${problem.message}`);
    assert.ok(messages.some((message) => message.startsWith("2:You can only add NIAT students")));
    assert.ok(messages.some((message) => message.startsWith("3:Already in the pool as Academy")));

    const ok = await manager.post(BULK).set(XHR).send({ students: [row("N1", { productGroup: "" })] });
    assert.equal(ok.status, 200);
    assert.equal((await EligiblePoolStudent.findOne({ studentId: "N1" }).lean()).productGroup, "NIAT");
  });

  test("empty or oversized uploads are refused", async () => {
    assert.equal((await admin.post(BULK).set(XHR).send({ students: [] })).status, 400);
    const unknownColumn = await admin.post(BULK).set(XHR).send({ students: [{ ...row("U1"), extra: "x" }] });
    assert.equal(unknownColumn.status, 400);
  });
});
