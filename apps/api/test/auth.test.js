import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { User } from "../src/models/index.js";
import { XHR, api, createUser, loginAs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

describe("authentication and role authorization", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(resetDb);

  test("unauthenticated requests are rejected", async () => {
    const response = await api().get("/api/crm/deals");
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
  });

  test("CRM user cannot access PSM APIs", async () => {
    const crm = await loginAs("crm.user@example.com", "CRM");
    const response = await crm.get("/api/psm/jobs");
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  });

  test("PSM user cannot submit CRM deals", async () => {
    const psm = await loginAs("psm.user@example.com", "PSM");
    const response = await psm.post("/api/crm/deals/process").set(XHR).send({ dealId: "123" });
    assert.equal(response.status, 403);
  });

  test("ADMIN can access both CRM and PSM APIs", async () => {
    const admin = await loginAs("admin@example.com", "ADMIN");
    assert.equal((await admin.get("/api/crm/deals")).status, 200);
    assert.equal((await admin.get("/api/psm/jobs")).status, 200);
  });

  test("inactive user is denied at login", async () => {
    await createUser("old.crm@example.com", "CRM", { isActive: false });
    const response = await api().post("/api/auth/dev-login").set(XHR).send({ email: "old.crm@example.com" });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "ACCESS_DENIED");
  });

  test("a user deactivated after login loses access immediately", async () => {
    const crm = await loginAs("temp.crm@example.com", "CRM");
    assert.equal((await crm.get("/api/crm/deals")).status, 200);
    await User.updateOne({ email: "temp.crm@example.com" }, { $set: { isActive: false } });
    const response = await crm.get("/api/crm/deals");
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "ACCESS_DENIED");
  });

  test("unknown email is denied", async () => {
    const response = await api().post("/api/auth/dev-login").set(XHR).send({ email: "stranger@example.com" });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "ACCESS_DENIED");
  });

  test("me returns the authenticated user and the redirect target follows the role", async () => {
    await createUser("psm.user@example.com", "PSM");
    const login = await api().post("/api/auth/dev-login").set(XHR).send({ email: "psm.user@example.com" });
    assert.equal(login.body.redirectTo, "/psm");
    const cookie = login.headers["set-cookie"][0];
    assert.match(cookie, /HttpOnly/i);
    const me = await api().get("/api/auth/me").set("Cookie", cookie);
    assert.equal(me.body.user.email, "psm.user@example.com");
    assert.equal(me.body.user.role, "PSM");
  });

  test("state-changing requests without X-Requested-With are rejected (CSRF)", async () => {
    const crm = await loginAs("crm.user@example.com", "CRM");
    const response = await crm.post("/api/crm/deals/process").send({ dealId: "123" });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "CSRF_REJECTED");
  });

  test("logout clears the session", async () => {
    const crm = await loginAs("crm.user@example.com", "CRM");
    assert.equal((await crm.post("/api/auth/logout").set(XHR)).status, 204);
    assert.equal((await crm.get("/api/auth/me")).status, 401);
  });
});
