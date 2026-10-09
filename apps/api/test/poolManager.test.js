import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { AuditLog, EligiblePoolStudent, User } from "../src/models/index.js";
import { XHR, app, loginAs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const POOL = "/api/admin/eligible-pool";

function poolRow(studentId, productGroup) {
  return {
    studentId,
    studentName: `Student ${studentId}`,
    productGroup,
    eligibilityStatus: "Eligible",
    syncedAt: new Date(),
    manual: true,
  };
}

async function poolManager(email, products) {
  await User.create({ email, role: "POOL_MANAGER", products, isActive: true, name: email.split("@")[0] });
  const agent = request.agent(app);
  const login = await agent.post("/api/auth/dev-login").set(XHR).send({ email });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { agent, login };
}

describe("Pool Manager role", () => {
  let admin;

  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs("admin.user@example.com", "ADMIN");
    await EligiblePoolStudent.insertMany([poolRow("N1", "NIAT"), poolRow("N2", "NIAT"), poolRow("A1", "Academy")]);
  });

  test("the admin adds a Pool Manager only with a product, and can change it later", async () => {
    const missing = await admin.post("/api/admin/users").set(XHR).send({ email: "pool.one@example.com", role: "POOL_MANAGER" });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error.message, /at least one product/);

    const created = await admin
      .post("/api/admin/users")
      .set(XHR)
      .send({ email: "pool.one@example.com", role: "POOL_MANAGER", products: ["NIAT"] });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(created.body.user.products, ["NIAT"]);

    const both = await admin.patch("/api/admin/users/pool.one@example.com").set(XHR).send({ products: ["NIAT", "Academy"] });
    assert.deepEqual(both.body.user.products, ["NIAT", "Academy"]);
    assert.equal((await admin.patch("/api/admin/users/pool.one@example.com").set(XHR).send({ products: [] })).status, 400);

    const crm = await admin.patch("/api/admin/users/pool.one@example.com").set(XHR).send({ role: "CRM" });
    assert.deepEqual(crm.body.user.products, [], "other roles carry no products");
    const added = await AuditLog.findOne({ action: "USER_ADDED" }).lean();
    assert.deepEqual(added.metadata.products, ["NIAT"]);
  });

  test("a NIAT Pool Manager sees and manages only NIAT students", async () => {
    const { agent, login } = await poolManager("pool.niat@example.com", ["NIAT"]);
    assert.equal(login.body.redirectTo, "/admin/eligible-pool");
    assert.deepEqual(login.body.user.products, ["NIAT"]);

    const list = (await agent.get(POOL)).body;
    assert.deepEqual(list.items.map((row) => row.studentId).sort(), ["N1", "N2"]);
    assert.equal((await agent.get(POOL).query({ product: "Academy" })).body.items.length, 0, "no Academy rows even when asked");
    const summary = (await agent.get(`${POOL}/summary`)).body;
    assert.equal(summary.total, 2);
    assert.deepEqual(summary.allowedProducts, ["NIAT"]);
    assert.equal(summary.sync, null);
    assert.equal(summary.syncConfigured, false);

    const added = await agent.post(POOL).set(XHR).send({ studentId: "N3", studentName: "New NIAT" });
    assert.equal(added.status, 201, JSON.stringify(added.body));
    assert.equal(added.body.student.productGroup, "NIAT", "their only product is filled in");
    const wrongProduct = await agent.post(POOL).set(XHR).send({ studentId: "A9", studentName: "Other", productGroup: "Academy" });
    assert.equal(wrongProduct.status, 403);

    const edited = await agent.patch(`${POOL}/N1`).set(XHR).send({ eligibilityStatus: "Placed" });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.student.eligibilityStatus, "Placed");
    assert.equal((await agent.patch(`${POOL}/N1`).set(XHR).send({ productGroup: "Academy" })).status, 403);
    assert.equal((await agent.patch(`${POOL}/A1`).set(XHR).send({ eligibilityStatus: "Placed" })).status, 404);
    assert.equal((await agent.delete(`${POOL}/A1`).set(XHR)).status, 404);
    assert.equal((await EligiblePoolStudent.findOne({ studentId: "A1" }).lean()).eligibilityStatus, "Eligible");
    assert.equal((await agent.delete(`${POOL}/N2`).set(XHR)).status, 204);

    const log = await AuditLog.findOne({ action: "ELIGIBLE_POOL_STUDENT_UPDATED" }).lean();
    assert.equal(log.actorEmail, "pool.niat@example.com");
    assert.equal(log.actorRole, "POOL_MANAGER");
    assert.deepEqual(log.metadata.changes.eligibilityStatus, { from: "Eligible", to: "Placed" });
  });

  test("a Pool Manager cannot sync, open other pages or the audit log", async () => {
    const { agent } = await poolManager("pool.academy@example.com", ["Academy"]);
    assert.equal((await agent.post(`${POOL}/sync`).set(XHR)).status, 403);
    assert.equal((await agent.get("/api/crm/deals")).status, 403);
    assert.equal((await agent.get("/api/psm/jobs")).status, 403);
    assert.equal((await agent.get("/api/interviews/companies")).status, 403);
    assert.equal((await agent.get("/api/admin/users")).status, 403);
    assert.equal((await agent.get("/api/admin/audit-logs")).status, 403);
    assert.equal((await agent.get("/api/admin/settings")).status, 403);

    const crm = await loginAs("crm.user@example.com", "CRM");
    assert.equal((await crm.get(POOL)).status, 403, "other roles still cannot open the Eligible Pool");
    assert.equal((await admin.get(POOL)).body.items.length, 3, "the admin still sees every product");
  });
});
