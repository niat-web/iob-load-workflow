import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AuditLog, User } from "../src/models/index.js";
import { XHR, loginAs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

describe("admin user management", () => {
  let adminAgent;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    adminAgent = await loginAs("asha.verma@example.com", "ADMIN");
  });

  test("an admin adds a user, who is linked to their HubSpot owner by email", async () => {
    const created = await adminAgent.post("/api/admin/users").set(XHR).send({ email: "Ravi.Kumar@example.com", role: "CRM" });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, "ravi.kumar@example.com");
    assert.equal(created.body.user.name, "Ravi Kumar");
    assert.deepEqual(created.body.user.hubspotOwner, { id: "1000002", name: "Ravi Kumar", email: "ravi.kumar@example.com" });
    assert.equal((await User.findOne({ email: "ravi.kumar@example.com" }).lean()).hubspotOwnerId, "1000002");

    const again = await adminAgent.post("/api/admin/users").set(XHR).send({ email: "ravi.kumar@example.com", role: "PSM" });
    assert.equal(again.status, 409);
    assert.ok(await AuditLog.exists({ action: "USER_ADDED", entityId: "ravi.kumar@example.com" }));
    const list = (await adminAgent.get("/api/admin/users")).body.users;
    assert.ok(list.some((user) => user.email === "ravi.kumar@example.com" && user.role === "CRM" && user.isActive));
  });

  test("an admin changes role, HubSpot owner and access, and can link their own owner", async () => {
    await adminAgent.post("/api/admin/users").set(XHR).send({ email: "new.person@example.com", role: "CRM" });
    const updated = await adminAgent
      .patch("/api/admin/users/new.person%40example.com")
      .set(XHR)
      .send({ role: "PSM", hubspotOwnerId: "1000003", isActive: false });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.user.role, "PSM");
    assert.equal(updated.body.user.isActive, false);
    assert.equal(updated.body.user.hubspotOwner.name, "Neha Sharma");

    const mine = await adminAgent.patch("/api/admin/users/asha.verma%40example.com").set(XHR).send({ hubspotOwnerId: "1000002" });
    assert.equal(mine.body.user.hubspotOwner.id, "1000002");
    assert.equal((await adminAgent.get("/api/auth/me")).body.user.hubspotOwner.id, "1000002");
    assert.equal((await adminAgent.get("/api/crm/hubspot-owners")).body.defaultOwnerId, "1000002");

    const unknown = await adminAgent.patch("/api/admin/users/new.person%40example.com").set(XHR).send({ hubspotOwnerId: "1" });
    assert.equal(unknown.status, 400);
  });

  test("an admin cannot lock themselves out, and other roles cannot manage users", async () => {
    const self = "/api/admin/users/asha.verma%40example.com";
    assert.equal((await adminAgent.patch(self).set(XHR).send({ role: "CRM" })).status, 409);
    assert.equal((await adminAgent.patch(self).set(XHR).send({ isActive: false })).status, 409);
    const crm = await loginAs("crm.user@example.com", "CRM");
    assert.equal((await crm.get("/api/admin/users")).status, 403);
    assert.equal((await crm.post("/api/admin/users").set(XHR).send({ email: "x@example.com", role: "ADMIN" })).status, 403);
  });
});
