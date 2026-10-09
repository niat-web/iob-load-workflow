import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AuditLog } from "../src/models/index.js";
import { describeAudit } from "../src/services/auditLogService.js";
import { XHR, loginAs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

describe("Audit log", () => {
  let admin;
  let crm;

  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    admin = await loginAs("admin.user@example.com", "ADMIN");
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("every step of a deal writes one plain line, newest first", async () => {
    const job = await openApplicationWindow(crm, "12345");
    const response = await admin.get("/api/admin/audit-logs").query({ limit: 200 });
    assert.equal(response.status, 200);
    const items = response.body.items;
    const actions = items.map((item) => item.action);
    for (const action of [
      "CRM_SUBMITTED_DEAL",
      "DEAL_FETCHED",
      "ORGANISATION_CREATED",
      "JOB_LOADED_TO_PORTAL",
      "ELIGIBLE_STUDENTS_FOUND",
      "STUDENT_ACCESS_GRANTED",
      "INITIAL_EMAIL_SENT",
      "APPLICATIONS_OPENED",
    ]) {
      assert.ok(actions.includes(action), `${action} is logged`);
    }
    const times = items.map((item) => item.at);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");

    const access = items.find((item) => item.action === "STUDENT_ACCESS_GRANTED");
    assert.match(access.text, /^Job access given to \d+ students? for job [0-9a-f]{8}/);
    assert.equal(access.actor.name, "System");
    assert.equal(access.deal.hubspotDealId, "12345");
    assert.equal(access.deal.companyName, job.companyName);

    const submitted = items.find((item) => item.action === "CRM_SUBMITTED_DEAL");
    assert.equal(submitted.actor.email, "crm.user@example.com");
    assert.equal(submitted.actor.roleLabel, "CRM");
    assert.equal(submitted.text, "Submitted HubSpot deal 12345");
    assert.match(items.find((item) => item.action === "DEAL_FETCHED").text, /^Fetched the deal from HubSpot: \d+ fields, JD 1/);
  });

  test("filters by user, action, text and date; only admins can see it", async () => {
    await openApplicationWindow(crm, "12345");
    const byUser = (await admin.get("/api/admin/audit-logs").query({ actor: "crm.user@example.com" })).body.items;
    assert.ok(byUser.length > 0);
    assert.ok(byUser.every((item) => item.actor.email === "crm.user@example.com"));

    const system = (await admin.get("/api/admin/audit-logs").query({ actor: "system", limit: 200 })).body.items;
    assert.ok(system.length > 0 && system.every((item) => item.actor.role === "SYSTEM"));

    const access = (await admin.get("/api/admin/audit-logs").query({ action: "STUDENT_ACCESS_GRANTED|APPLICATIONS_OPENED" })).body;
    assert.equal(access.pagination.total, 2);

    const byDeal = (await admin.get("/api/admin/audit-logs").query({ search: "12345", limit: 200 })).body.items;
    assert.ok(byDeal.some((item) => item.action === "STUDENT_ACCESS_GRANTED"), "search by deal ID finds the job's steps");

    const future = (await admin.get("/api/admin/audit-logs").query({ from: "2099-01-01" })).body;
    assert.equal(future.pagination.total, 0);
    assert.equal((await admin.get("/api/admin/audit-logs").query({ from: "yesterday" })).status, 400);

    const filters = (await admin.get("/api/admin/audit-logs/filters")).body;
    assert.ok(filters.actors.some((option) => option.value === "crm.user@example.com"));
    assert.ok(filters.actions.some((option) => option.value === "STUDENT_ACCESS_GRANTED" && option.label === "Job access given"));

    assert.equal((await crm.get("/api/admin/audit-logs")).status, 403);
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get("/api/admin/audit-logs")).status, 403);
    assert.equal((await admin.post("/api/admin/audit-logs").set(XHR)).status, 404, "the log cannot be changed through the API");
  });

  test("old or unknown actions still read sensibly", async () => {
    const log = await AuditLog.create({ action: "ELIGIBLE_POOL_BULK_UPDATED", entityType: "EligiblePool", entityId: "x" });
    assert.equal(describeAudit(log.toObject()), "Eligible pool bulk updated");
    assert.equal(
      describeAudit({ action: "ELIGIBLE_POOL_STUDENT_UPDATED", entityId: "N1", metadata: { studentName: "Asha", product: "NIAT", changes: { eligibilityStatus: { from: "Eligible", to: "Placed" } } } }),
      "Edited student N1 (Asha, NIAT): status Eligible → Placed",
    );
  });
});
