import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { JOB_STATUS } from "../src/config/statuses.js";
import { Job, LearningPortalOrganisation } from "../src/models/index.js";
import { InMemorySheets } from "../src/services/googleSheets.js";
import { integrations, overrideIntegration } from "../src/services/integrations.js";
import { ensureOrganisation } from "../src/services/learningPortal/portalLoader.js";
import { MockLearningPortalClient } from "../src/services/learningPortalClient.js";
import { IntegrationError } from "../src/utils/errors.js";
import { XHR, loginAs, openApplicationWindow, resetDb, runDueTasks, startTestDb, stopTestDb, submitDeal } from "./helpers.js";

const callsOf = (op) => integrations.learningPortal.calls.filter((call) => call.op === op);
const envsOf = (op) => callsOf(op).map((call) => call.env);

describe("Learning Portal loading (beta then prod, as CRM_Job_Loading)", () => {
  let crm;
  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
  });

  test("a deal is loaded into beta, then prod, with one organisation id and one job id", async () => {
    const job = await openApplicationWindow(crm, "12345");

    const orgCalls = callsOf("createOrganisation");
    assert.deepEqual(orgCalls.map((call) => call.env), ["beta", "prod"]);
    assert.equal(orgCalls[0].organisation.organisationId, orgCalls[1].organisation.organisationId);
    assert.equal(orgCalls[0].organisation.organisationId, job.learningPortalOrgId);
    assert.equal(orgCalls[0].organisation.website, job.companyWebsite);

    const [beta, prod] = callsOf("upsertJob");
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"], "beta is loaded before prod");
    assert.equal(beta.payload.job_id, job.learningPortalJobId);
    assert.equal(prod.payload.job_id, job.learningPortalJobId);
    assert.equal(beta.payload.job_details.organisation_id, job.learningPortalOrgId);
    assert.match(beta.payload.job_details.link_to_apply, /^https:\/\/apply-beta\.test\/form\/company-opportunity\?company=/);
    assert.match(prod.payload.job_details.link_to_apply, /^https:\/\/apply\.test\/form\/company-opportunity\?company=/);
    assert.ok(prod.payload.job_details.link_to_apply.includes(`job_id=${job.learningPortalJobId}`));
    assert.deepEqual(
      { ...beta.payload.job_details, link_to_apply: null },
      { ...prod.payload.job_details, link_to_apply: null },
      "apart from the apply link, both environments get the same job",
    );

    const details = prod.payload.job_details;
    assert.deepEqual(details.enroll_plans, ["CCBP_INTENSIVE", "INTENSIVE_COLLEGE_PLUS", "CCBP_INTENSIVE_NSDC_SKILL_INDIA"]);
    assert.deepEqual(prod.payload.user_job_criteria.show_for_all_users_in_enroll_plans, details.enroll_plans);
    assert.equal(details.eligibility_criteria.content_type, "MARKDOWN_DICT");
    assert.notEqual(JSON.parse(details.eligibility_criteria.content[0]).V1, "NA");
    assert.match(details.disclaimer.content[0], /communication skills/);
    assert.match(details.organisation_description.content[0], /Company Website Link/);
    assert.equal(prod.payload.job_extra_details.taskflow_id, "12345");

    const grants = callsOf("grantAccess");
    assert.deepEqual(grants[0], { env: "beta", op: "grantAccess", jobId: job.learningPortalJobId, userIds: config.learningPortal.environments.beta.testUsers.INTENSIVE });
    assert.deepEqual(grants[1], { env: "prod", op: "grantAccess", jobId: job.learningPortalJobId, userIds: config.learningPortal.environments.prod.testUsers.INTENSIVE });
    assert.ok(grants.slice(2).length > 0 && grants.slice(2).every((call) => call.env === "prod"));

    assert.ok(job.learningPortalLoads.beta.loadedAt && job.learningPortalLoads.prod.loadedAt);
    assert.equal(job.learningPortalJobUrl, prod.payload.job_details.link_to_apply, "students are emailed the prod apply link");

    assert.deepEqual(integrations.hubspot.updates, [{ dealId: "12345", properties: { job_id: job.learningPortalJobId, jd_count: 1 } }]);
    assert.equal(job.hubspotWriteBack.status, "DONE");

    const detail = await crm.get(`/api/crm/deals/${job._id}`);
    assert.deepEqual(detail.body.learningPortal.environments.map((env) => [env.name, Boolean(env.loadedAt)]), [["beta", true], ["prod", true]]);
    assert.equal(detail.body.learningPortal.hubspotWriteBack, "DONE");
  });

  test("a prod failure is retried without reloading beta or creating another organisation", async () => {
    class ProdFailsOnce extends MockLearningPortalClient {
      failed = false;
      async upsertJob(env, payload) {
        if (env === "prod" && !this.failed) {
          this.failed = true;
          throw new IntegrationError("Learning Portal: prod job create returned HTTP 400", { retryable: false });
        }
        return super.upsertJob(env, payload);
      }
    }
    overrideIntegration("learningPortal", new ProdFailsOnce());

    const submitted = await submitDeal(crm, "12345");
    await runDueTasks();
    let job = await Job.findById(submitted.body.job.id);
    assert.equal(job.status, JOB_STATUS.FAILED);
    assert.equal(job.failedStep, JOB_STATUS.JOB_CREATING);
    assert.ok(job.learningPortalLoads.beta.loadedAt);
    assert.equal(job.learningPortalLoads.prod.loadedAt, null);
    const jobId = job.learningPortalJobId;

    const retry = await crm.post(`/api/crm/deals/${job._id}/retry`).set(XHR);
    assert.equal(retry.status, 200);
    await runDueTasks();

    job = await Job.findById(job._id);
    assert.equal(job.status, JOB_STATUS.APPLICATIONS_OPEN);
    assert.equal(job.learningPortalJobId, jobId, "the retry re-sends the same job id");
    assert.deepEqual(envsOf("upsertJob"), ["beta", "prod"], "beta was not loaded again");
    assert.deepEqual(envsOf("createOrganisation"), ["beta", "prod"], "no second organisation");
  });

  test("eligible students are read from beta and get access in prod", async () => {
    const source = config.eligibility.source;
    config.eligibility.source = "learning_portal";
    try {
      class EligiblePortal extends MockLearningPortalClient {
        async getEligibleStudentIds(env, eligibilityDetails) {
          await super.getEligibleStudentIds(env, eligibilityDetails);
          return ["u1", "u2", "u3"];
        }
      }
      overrideIntegration("learningPortal", new EligiblePortal());
      const bigquery = integrations.bigquery;
      overrideIntegration("bigquery", new Proxy(bigquery, {
        get: (target, property) =>
          property === "getStudentsByIds"
            ? async (ids) => ids.slice(0, 2).map((id) => ({ studentId: id, studentName: id, email: `${id}@students.example.com`, mobile: null }))
            : Reflect.get(target, property),
      }));

      const job = await openApplicationWindow(crm, "12345");
      const [lookup] = callsOf("getEligibleStudentIds");
      assert.equal(lookup.env, "beta");
      const placement = lookup.eligibilityDetails.find((detail) => detail.field_name === "placement_status");
      assert.equal(placement.value, "To Be Placed | Placed More Opps | Placement Support Not Required 2");
      assert.deepEqual(callsOf("grantAccess").at(-1), { env: "prod", op: "grantAccess", jobId: job.learningPortalJobId, userIds: ["u1", "u2", "u3"] });
      assert.equal(job.eligibleCount, 3);
    } finally {
      config.eligibility.source = source;
    }
  });

  test("order numbers continue from the tracker sheet, and nothing is written to the sheet", async () => {
    const headers = ["Date", "Job Deal ID", "Job ID", "Order", "Remarks"];
    const lastRow = headers.map((header) => (header === "Order" ? "41" : ""));
    const sheets = new InMemorySheets({ "Loaded Jobs Tracker": [headers, lastRow] });
    overrideIntegration("sheets", sheets);

    const first = await openApplicationWindow(crm, "12345");
    const second = await openApplicationWindow(crm, "12346");
    assert.equal(first.learningPortalPayload.job_details.order, 42);
    assert.equal(second.learningPortalPayload.job_details.order, 43);

    assert.deepEqual(sheets.worksheets["Loaded Jobs Tracker"], [headers, lastRow], "the sheet is only read");
    const saved = await Job.findById(first._id).lean();
    assert.equal(saved.learningPortalJobId, first.learningPortalJobId, "loaded-job details live in the database");
    assert.ok(saved.learningPortalLoads.prod.loadedAt);
  });
});

describe("Learning Portal organisations", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(resetDb);

  test("a company is created once and reused, whatever its legal suffix", async () => {
    const first = await ensureOrganisation({ companyName: "Zoho Pvt Ltd", companyWebsite: "https://www.zoho.com" });
    const second = await ensureOrganisation({ companyName: "ZOHO" });
    assert.equal(second.organisationId, first.organisationId);
    assert.deepEqual(envsOf("createOrganisation"), ["beta", "prod"]);
    assert.deepEqual([...first.createdIn], ["beta", "prod"]);
  });

  test("the org sheet's Org ID is reused; a similar name stops for confirmation; an empty Org ID creates one", async () => {
    overrideIntegration("sheets", new InMemorySheets({
      "NIAT Internships": [
        ["Company Name", "Org ID"],
        ["Acme Technologies Pvt Ltd", "org-acme"],
        ["Globex", ""],
      ],
    }));

    const acme = await ensureOrganisation({ companyName: "Acme Technologies" });
    assert.equal(acme.organisationId, "org-acme");
    assert.equal(acme.source, "SHEET");
    assert.equal(callsOf("createOrganisation").length, 0, "an org from the sheet already exists in the portals");

    await assert.rejects(
      ensureOrganisation({ companyName: "Acme" }),
      (error) => error.retryable === false && /similar companies are: Acme Technologies Pvt Ltd \(org-acme\)/.test(error.message),
    );
    assert.equal(await LearningPortalOrganisation.countDocuments({ normalizedName: "acme" }), 0);

    const globex = await ensureOrganisation({ companyName: "Globex" });
    assert.notEqual(globex.organisationId, "");
    assert.equal(globex.source, "CREATED");
    assert.deepEqual(envsOf("createOrganisation"), ["beta", "prod"]);
  });
});
