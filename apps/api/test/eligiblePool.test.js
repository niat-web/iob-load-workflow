import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { EligiblePoolStudent, Job, JobEligibleStudent } from "../src/models/index.js";
import { findEligibleStudents, passOutYears } from "../src/services/eligibilityService.js";
import { productGroupFor, productGroupsForPlans } from "../src/services/eligiblePoolService.js";
import { XHR, loginAs, openApplicationWindow, resetDb, startTestDb, stopTestDb } from "./helpers.js";

function poolRow(studentId, productGroup, eligibilityStatus = "Eligible", batch = null) {
  return {
    studentId,
    studentName: `Student ${studentId}`,
    email: `${studentId.toLowerCase()}@students.example.com`,
    mobile: "9876543210",
    productGroup,
    eligibilityStatus,
    batch,
    syncedAt: new Date(),
    manual: true,
  };
}

async function withPoolSource(run) {
  const source = config.eligibility.source;
  config.eligibility.source = "pool";
  try {
    await run();
  } finally {
    config.eligibility.source = source;
  }
}

async function waitForSync(agent) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const summary = (await agent.get("/api/admin/eligible-pool/summary")).body;
    if (summary.sync.status !== "RUNNING") return summary;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Sync did not finish");
}

describe("eligible pool (admin only)", () => {
  let adminAgent;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    adminAgent = await loginAs("asha.verma@example.com", "ADMIN");
  });

  test("enroll plan tags are grouped by product", () => {
    assert.equal(productGroupFor("NIAT"), "NIAT");
    assert.equal(productGroupFor("ccbp_academy_genius_plus"), "Academy");
    assert.equal(productGroupFor("CCBP_TECH_INTENSIVE_OFFLINE"), "Intensive");
    assert.equal(productGroupFor("NXTWAVE_EXTERNAL_JOB_PORTAL"), "External");
    assert.equal(productGroupFor("ACADEMY "), "Academy");
    assert.equal(productGroupFor("niat"), "NIAT");
    assert.equal(productGroupFor(""), "Unknown");
  });

  test("an admin syncs the pool into the database and filters it by product and search", async () => {
    const started = await adminAgent.post("/api/admin/eligible-pool/sync").set(XHR);
    assert.equal(started.status, 202);
    const summary = await waitForSync(adminAgent);
    assert.equal(summary.sync.status, "DONE");
    assert.equal(summary.syncConfigured, true);
    assert.equal(summary.total, 120);
    assert.deepEqual(summary.statuses, [{ status: "Eligible", count: 120 }], "new students from BigQuery start as Eligible");
    assert.equal(summary.products.find((row) => row.product === "Academy").count, 48);

    const niat = await adminAgent.get("/api/admin/eligible-pool").query({ product: "NIAT", limit: 10 });
    assert.equal(niat.status, 200);
    assert.equal(niat.body.pagination.total, 24);
    assert.equal(niat.body.items.length, 10);
    assert.ok(niat.body.items.every((row) => row.productGroup === "NIAT" && row.studentName && row.studentId));
    for (const removed of ["enrollPlanTag", "product", "gender", "tenthPercentage", "highestEducation", "currentState"]) {
      assert.equal(removed in niat.body.items[0], false, removed);
    }
    assert.equal("enrollPlanTag" in niat.body.items[0], false);

    const firstPage = (await adminAgent.get("/api/admin/eligible-pool").query({ limit: 30 })).body.items;
    assert.deepEqual([...new Set(firstPage.map((row) => row.productGroup))], ["NIAT", "Academy"]);
    assert.equal(firstPage.findIndex((row) => row.productGroup === "Academy"), 24);

    const byNameDesc = (await adminAgent.get("/api/admin/eligible-pool").query({ sort: "studentName:desc", limit: 120 })).body.items;
    const names = byNameDesc.map((row) => row.studentName);
    assert.deepEqual(names, [...names].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0)));
    const byProductDesc = (await adminAgent.get("/api/admin/eligible-pool").query({ sort: "productGroup:desc", limit: 1 })).body.items;
    assert.notEqual(byProductDesc[0].productGroup, "NIAT");
    assert.equal((await adminAgent.get("/api/admin/eligible-pool").query({ sort: "password:asc" })).status, 400);

    const academy = await adminAgent.get("/api/admin/eligible-pool").query({ product: "Academy" });
    assert.equal(academy.body.pagination.total, 48);

    const one = academy.body.items[0];
    const found = await adminAgent.get("/api/admin/eligible-pool").query({ search: one.studentId });
    assert.equal(found.body.items[0].studentId, one.studentId);
  });

  test("a second sync replaces the pool and removes students no longer in BigQuery", async () => {
    await EligiblePoolStudent.create({ studentId: "OLD-1", studentName: "Gone", syncedAt: new Date("2020-01-01") });
    await adminAgent.post("/api/admin/eligible-pool/sync").set(XHR);
    const summary = await waitForSync(adminAgent);
    assert.equal(summary.sync.removed, 1);
    assert.equal(await EligiblePoolStudent.countDocuments({ studentId: "OLD-1" }), 0);
  });

  test("an admin adds, edits and deletes a student, and a sync keeps manual changes", async () => {
    const created = await adminAgent
      .post("/api/admin/eligible-pool")
      .set(XHR)
      .send({ studentId: "MANUAL-1", studentName: "Kiran Rao", email: "Kiran@Example.com", mobile: "+91 98765 43210", productGroup: "Academy" });
    assert.equal(created.status, 201);
    assert.equal(created.body.student.email, "kiran@example.com");
    assert.equal(created.body.student.productGroup, "Academy");
    assert.equal(created.body.student.manual, true);

    const duplicate = await adminAgent.post("/api/admin/eligible-pool").set(XHR).send({ studentId: "MANUAL-1", studentName: "Again" });
    assert.equal(duplicate.status, 409);
    const invalid = await adminAgent.post("/api/admin/eligible-pool").set(XHR).send({ studentId: "X", studentName: "", email: "not-an-email" });
    assert.equal(invalid.status, 400);
    const wrongProduct = await adminAgent.post("/api/admin/eligible-pool").set(XHR).send({ studentId: "Y", studentName: "Y", productGroup: "Unknown" });
    assert.equal(wrongProduct.status, 400);

    const updated = await adminAgent
      .patch("/api/admin/eligible-pool/MANUAL-1")
      .set(XHR)
      .send({ productGroup: "NIAT", mobile: "", batch: "2026" });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.student.productGroup, "NIAT");
    assert.equal(updated.body.student.mobile, null);
    assert.equal(updated.body.student.batch, "2026");
    assert.equal(updated.body.student.updatedBy, "asha.verma@example.com");

    await adminAgent.post("/api/admin/eligible-pool/sync").set(XHR);
    await waitForSync(adminAgent);
    const synced = await adminAgent.get("/api/admin/eligible-pool").query({ search: "MANUAL-1" });
    assert.equal(synced.body.items[0].studentName, "Kiran Rao");
    const someone = (await adminAgent.get("/api/admin/eligible-pool").query({ limit: 1 })).body.items[0];
    await adminAgent.patch(`/api/admin/eligible-pool/${someone.studentId}`).set(XHR).send({ studentName: "Edited Name" });
    await adminAgent.post("/api/admin/eligible-pool/sync").set(XHR);
    await waitForSync(adminAgent);
    const kept = await adminAgent.get("/api/admin/eligible-pool").query({ search: someone.studentId });
    assert.equal(kept.body.items[0].studentName, "Edited Name");

    assert.equal((await adminAgent.delete("/api/admin/eligible-pool/MANUAL-1").set(XHR)).status, 204);
    assert.equal((await adminAgent.delete("/api/admin/eligible-pool/MANUAL-1").set(XHR)).status, 404);
    assert.equal(await EligiblePoolStudent.countDocuments({ studentId: "MANUAL-1" }), 0);
  });

  test("NIAT ID, campus, batch, eligibility status and remarks are saved, searchable and filterable", async () => {
    const created = await adminAgent.post("/api/admin/eligible-pool").set(XHR).send({
      studentId: "1314fa04-a762-4f26-9bce-fa16a72b1eb5",
      studentName: "Test Student",
      productGroup: "NIAT",
      niatId: "N25P01A0265",
      campus: "A Dy Patil University",
      batch: "2025",
      eligibilityStatus: "Not Interested",
      remarks: "Grit cheating",
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.student.productGroup, "NIAT");
    assert.equal(created.body.student.niatId, "N25P01A0265");
    assert.equal(created.body.student.remarks, "Grit cheating");

    const byNiatId = await adminAgent.get("/api/admin/eligible-pool").query({ search: "N25P01A0265" });
    assert.equal(byNiatId.body.pagination.total, 1);
    const byStatus = await adminAgent.get("/api/admin/eligible-pool").query({ status: "Not Interested", campus: "A Dy Patil University" });
    assert.equal(byStatus.body.pagination.total, 1);
    assert.equal((await adminAgent.get("/api/admin/eligible-pool").query({ status: "Eligible" })).body.pagination.total, 0);
    const wrongStatus = await adminAgent
      .patch("/api/admin/eligible-pool/1314fa04-a762-4f26-9bce-fa16a72b1eb5")
      .set(XHR)
      .send({ eligibilityStatus: "Random" });
    assert.equal(wrongStatus.status, 400);
    const cleared = await adminAgent
      .patch("/api/admin/eligible-pool/1314fa04-a762-4f26-9bce-fa16a72b1eb5")
      .set(XHR)
      .send({ eligibilityStatus: "" });
    assert.equal(cleared.body.student.eligibilityStatus, null);
    await adminAgent.patch("/api/admin/eligible-pool/1314fa04-a762-4f26-9bce-fa16a72b1eb5").set(XHR).send({ eligibilityStatus: "Not Interested" });

    const summary = (await adminAgent.get("/api/admin/eligible-pool/summary")).body;
    assert.deepEqual(summary.statuses, [{ status: "Not Interested", count: 1 }]);
    assert.deepEqual(summary.campuses, [{ campus: "A Dy Patil University", count: 1 }]);
  });

  test("the sync is refused until the BigQuery pool table is set", async () => {
    const mode = config.modes.bigquery;
    const table = config.bigquery.tables.pool;
    config.modes.bigquery = "live";
    config.bigquery.tables.pool = undefined;
    try {
      const refused = await adminAgent.post("/api/admin/eligible-pool/sync").set(XHR);
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, "POOL_TABLE_NOT_SET");
      assert.equal((await adminAgent.get("/api/admin/eligible-pool/summary")).body.syncConfigured, false);
    } finally {
      config.modes.bigquery = mode;
      config.bigquery.tables.pool = table;
    }
  });

  test("CRM and PSM users cannot see the eligible pool", async () => {
    for (const role of ["CRM", "PSM"]) {
      const agent = await loginAs(`${role.toLowerCase()}.user@example.com`, role);
      assert.equal((await agent.get("/api/admin/eligible-pool")).status, 403);
      assert.equal((await agent.get("/api/admin/eligible-pool/summary")).status, 403);
      assert.equal((await agent.post("/api/admin/eligible-pool/sync").set(XHR)).status, 403);
      assert.equal((await agent.post("/api/admin/eligible-pool").set(XHR).send({ studentId: "S1", studentName: "N" })).status, 403);
      assert.equal((await agent.delete("/api/admin/eligible-pool/S1").set(XHR)).status, 403);
    }
  });
});

describe("eligible students for a deal come from the Eligible Pool table", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(resetDb);

  test("only Eligible students of the deal's products are picked, filtered by pass-out year when the deal has one", async () => {
    await EligiblePoolStudent.insertMany([
      poolRow("NIAT-25", "NIAT", "Eligible", "2025"),
      poolRow("NIAT-24", "NIAT", "Eligible", "2024"),
      poolRow("NIAT-PLACED", "NIAT", "Placed", "2025"),
      poolRow("NIAT-NOYEAR", "NIAT"),
      poolRow("ACAD-1", "Academy"),
      poolRow("ACAD-NI", "Academy", "Not Interested"),
      poolRow("INT-1", "Intensive"),
    ]);
    assert.deepEqual(productGroupsForPlans(["CCBP_ACADEMY_SMART", "CCBP_ACADEMY_GENIUS", "NIAT"]), ["Academy", "NIAT"]);
    assert.deepEqual(passOutYears("2025; 2026 batch"), ["2025", "2026"]);

    await withPoolSource(async () => {
      const ids = async (job) => (await findEligibleStudents(job, {})).map((student) => student.studentId).sort();
      assert.deepEqual(await ids({ enrollPlans: ["CCBP_ACADEMY_SMART", "NIAT"], batch: "2025, 2026" }), ["ACAD-1", "NIAT-25", "NIAT-NOYEAR"]);
      assert.deepEqual(await ids({ enrollPlans: ["NIAT"], batch: null }), ["NIAT-24", "NIAT-25", "NIAT-NOYEAR"]);
      assert.deepEqual(
        await ids({ enrollPlans: ["CCBP_INTENSIVE"], learningPortalPayload: { job_details: { enroll_plans: ["CCBP_INTENSIVE"] } } }),
        ["INT-1"],
      );
      const [student] = await findEligibleStudents({ enrollPlans: ["CCBP_INTENSIVE"] }, {});
      assert.equal(student.email, "int-1@students.example.com");
      assert.equal(student.mobile, "9876543210");

      await assert.rejects(findEligibleStudents({ enrollPlans: [] }, {}), /no course plans/);
      await assert.rejects(
        findEligibleStudents({ enrollPlans: ["NXTWAVE_EXTERNAL_JOB_PORTAL"] }, {}),
        /No student in the Eligible Pool is "Eligible" for External\. Add them on the Eligible Pool page/,
      );
    });
  });

  test("a submitted deal saves the matching pool students as its eligible list and gives them access", async () => {
    const products = ["NIAT", "Academy", "Intensive", "External"];
    await EligiblePoolStudent.insertMany(
      products.flatMap((product) => [1, 2, 3].map((n) => poolRow(`${product.toUpperCase()}-${n}`, product))),
    );
    await withPoolSource(async () => {
      const crm = await loginAs("crm.user@example.com", "CRM");
      const job = await openApplicationWindow(crm, "12345");
      const saved = await Job.findById(job._id).lean();
      const groups = productGroupsForPlans(saved.learningPortalPayload?.job_details?.enroll_plans ?? saved.enrollPlans);
      const expected = (await EligiblePoolStudent.find({ productGroup: { $in: groups } }).lean()).map((row) => row.studentId).sort();
      assert.ok(expected.length > 0);

      const eligible = await JobEligibleStudent.find({ jobId: job._id }).lean();
      assert.deepEqual(eligible.map((row) => row.studentId).sort(), expected);
      assert.equal(saved.eligibleCount, expected.length);
      assert.ok(eligible.every((row) => row.accessGrantedAt && row.email && row.mobile));
    });
  });
});
