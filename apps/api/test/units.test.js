import "./setup.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { requestFields } from "../src/app.js";
import { collectConfigProblems, config, missingIntegrationSettings } from "../src/config/env.js";
import { notSetUp } from "../src/services/integrations.js";
import { hubspotOwnerForEmail, listHubspotOwners } from "../src/services/hubspotOwners.js";
import { extractDealId } from "../src/controllers/crmController.js";
import { diffTrackedFields, mapDeal, missingRequiredFields } from "../src/services/dealMapper.js";
import { parseAnalysis } from "../src/services/geminiResumeAnalyzer.js";
import { canonicalSkill } from "../src/services/gritRepository.js";
import { formatPretty } from "../src/utils/logger.js";
import {
  buildDisclaimer,
  buildEligibilityContent,
  buildJobContent,
  formatCtcDisplay,
  formatInternshipDuration,
  formatStipend,
  markdownToHtml,
} from "../src/services/learningPortal/jobContent.js";
import {
  enrollPlansFor,
  mapCtc,
  mapJobType,
  mapLocations,
  mapSkills,
  payloadForEnvironment,
  testUsersFor,
} from "../src/services/learningPortal/nkbPayload.js";
import { parseGrantRejection } from "../src/services/learningPortalClient.js";
import { normalizeWeights, overallScore, rankCandidates } from "../src/services/priorityEngine.js";
import { normalizeCompanyName, normalizePhone, parseRetryAfter } from "../src/utils/helpers.js";

describe("priority engine", () => {
  test("weights are normalised to 100%", () => {
    const weights = normalizeWeights({ resume: 2, grit: 1, assessment: 1, interview: 0 });
    assert.equal(weights.resume, 0.5);
    assert.equal(weights.grit, 0.25);
    assert.equal(weights.interview, 0);
    assert.throws(() => normalizeWeights({ resume: 0, grit: 0, assessment: 0, interview: 0 }));
  });

  test("overall score handles missing components per strategy", () => {
    const weights = normalizeWeights({ resume: 50, grit: 50, assessment: 0, interview: 0 });
    assert.equal(overallScore({ resume: 80, grit: 60 }, weights, "renormalize"), 70);
    assert.equal(overallScore({ resume: 80, grit: null }, weights, "renormalize"), 80);
    assert.equal(overallScore({ resume: 80, grit: null }, weights, "zero"), 40);
    assert.equal(overallScore({}, weights, "renormalize"), null);
  });

  test("candidates are ranked best-first with unique P1..Pn priorities", () => {
    const ranked = rankCandidates(
      [
        { studentId: "A", scores: { resume: 60, grit: 60, assessment: 60, interview: 60 } },
        { studentId: "B", scores: { resume: 90, grit: 90, assessment: 90, interview: 90 } },
        { studentId: "C", scores: { resume: 75, grit: null, assessment: null, interview: null } },
        { studentId: "D", scores: { resume: null, grit: null, assessment: null, interview: null } },
      ],
      { weights: { resume: 40, grit: 25, assessment: 20, interview: 15 }, strategy: "renormalize" },
    );
    assert.deepEqual(ranked.map((c) => c.studentId), ["B", "C", "A", "D"]);
    assert.deepEqual(ranked.map((c) => c.priority), ["P1", "P2", "P3", "P4"]);
    assert.equal(ranked[0].suggestedStatus, "RECOMMENDED");
    assert.equal(ranked[3].overallScore, null);
  });

  test("ties break on resume score, then earlier application", () => {
    const ranked = rankCandidates(
      [
        { studentId: "late", appliedAt: "2026-05-01T10:00:00Z", scores: { resume: 70, grit: 70, assessment: 70, interview: 70 } },
        { studentId: "early", appliedAt: "2026-05-01T09:00:00Z", scores: { resume: 70, grit: 70, assessment: 70, interview: 70 } },
      ],
      { weights: { resume: 1, grit: 1, assessment: 1, interview: 1 } },
    );
    assert.deepEqual(ranked.map((c) => c.studentId), ["early", "late"]);
  });
});

describe("Gemini output validation", () => {
  const valid = {
    resumeScore: 88.4,
    matchedSkills: ["React", "Node.js"],
    missingSkills: ["AWS"],
    relevantExperience: "Two React projects.",
    reason: "Strong React and Node.js match.",
  };

  test("valid JSON is accepted and the score rounded", () => {
    assert.equal(parseAnalysis(JSON.stringify(valid)).resumeScore, 88);
  });

  test("malformed or out-of-range output is rejected as a permanent error", () => {
    assert.throws(() => parseAnalysis("not json"), (error) => error.retryable === false);
    assert.throws(() => parseAnalysis({ ...valid, resumeScore: 140 }), /validation/);
    assert.throws(() => parseAnalysis({ ...valid, reason: "" }), /validation/);
    assert.throws(() => parseAnalysis({ resumeScore: 50 }), /validation/);
  });
});

describe("deal mapping and change detection", () => {
  const bundle = {
    deal: {
      id: "42",
      properties: {
        dealname: "Acme - SDE",
        type_of_role: "Software Engineer",
        technologies_required: "React JS;Node JS",
        pass_out_year: "2025;2026",
        location: "Hyderabad",
        deal_location: "Pune",
        minimum_ctc_in_lpa: "6",
        maximum_ctc_in_lpa: "8",
        no_of_openings: "4",
        expected_application_pool: "40",
      },
    },
    company: { name: "Acme Pvt Ltd" },
    owner: { email: "Owner@Example.com", name: "Owner Name" },
  };

  test("maps HubSpot properties through the configured field names", () => {
    const mapped = mapDeal(bundle);
    assert.equal(mapped.companyName, "Acme Pvt Ltd");
    assert.equal(mapped.jobRole, "Software Engineer");
    assert.deepEqual(mapped.skills, ["React JS", "Node JS"]);
    assert.equal(mapped.batch, "2025, 2026");
    assert.equal(mapped.location, "Hyderabad, Pune");
    assert.equal(mapped.ctc, "6–8 LPA");
    assert.equal(mapped.openings, 4);
    assert.equal(mapped.expectedPoolCount, 40);
    assert.equal(mapped.crmOwnerEmail, "owner@example.com");
    assert.deepEqual(missingRequiredFields(mapped), []);
  });

  test("reports missing required fields", () => {
    const mapped = mapDeal({ ...bundle, owner: null, deal: { id: "1", properties: { dealname: "X" } }, company: null });
    assert.deepEqual(missingRequiredFields(mapped), ["Expected Pool", "CRM Owner"]);
  });

  test("only student-facing fields count as changes", () => {
    const before = mapDeal(bundle);
    const after = { ...before, location: "Bengaluru", expectedPoolCount: 99, skills: ["Node JS", "React JS"] };
    const changes = diffTrackedFields(before, after);
    assert.deepEqual(changes.map((change) => change.field), ["location"]);
  });
});

describe("helpers and payload mapping", () => {
  test("deal IDs are extracted from IDs and URLs", () => {
    assert.equal(extractDealId(" 12345 "), "12345");
    assert.equal(extractDealId("HS-10234"), "10234");
    assert.equal(extractDealId("https://app.hubspot.com/contacts/99/record/0-3/5550001/view/1"), "5550001");
    assert.throws(() => extractDealId("abc"), (error) => error.code === "INVALID_DEAL_ID");
  });

  test("phone numbers are normalised to E.164", () => {
    assert.equal(normalizePhone("98765 43210"), "+919876543210");
    assert.equal(normalizePhone("+1 415 555 0100"), "+14155550100");
    assert.equal(normalizePhone("091234"), null);
    assert.equal(normalizePhone(null), null);
  });

  test("Retry-After accepts seconds and HTTP dates", () => {
    assert.equal(parseRetryAfter("120"), 120000);
    assert.equal(parseRetryAfter(new Date(Date.now() + 5000).toUTCString(), Date.now()) > 0, true);
    assert.equal(parseRetryAfter(undefined), undefined);
  });

  test("NKB payload helpers match the existing tool's rules", () => {
    assert.deepEqual(mapLocations("bangalore; Remote; Hyderabad"), ["Hyderabad", "Work From Home", "Benguluru"]);
    assert.deepEqual(mapSkills(["react js", "node js", "Spring Boot"]), ["React JS", "Node JS", "Springboot"]);
    assert.equal(mapJobType("Internship+Full time"), "INTERNSHIP_AND_FULL_TIME");
    assert.equal(mapJobType("Full time"), "FULL_TIME");
    assert.deepEqual(mapCtc({ internship_stipend_per_month: "15000", max_internship_stipend_per_month: "20000" }, "INTERNSHIP"), { min: "15.0", max: "20.0" });
    assert.deepEqual(mapCtc({ minimum_ctc_in_lpa: "6", maximum_ctc_in_lpa: "6" }, "FULL_TIME"), { min: "6", max: "0" });
    assert.equal(canonicalSkill("React JS"), canonicalSkill("reactjs"));
  });

  test("enroll plans combine product and enrollment plans; test accounts follow the plans", () => {
    assert.deepEqual(enrollPlansFor({ product: "Intensive", enrollment_plans: "NIAT" }), [
      "CCBP_INTENSIVE", "INTENSIVE_COLLEGE_PLUS", "CCBP_INTENSIVE_NSDC_SKILL_INDIA", "NIAT",
    ]);
    assert.deepEqual(enrollPlansFor({ product: "Something else" }), []);
    assert.deepEqual(enrollPlansFor({ product: "Academy" }), [
      "CCBP_ACADEMY_SMART",
      "CCBP_ACADEMY_GENIUS",
      "CCBP_ACADEMY_EDGE",
      "CCBP_ACADEMY_SMART_PLUS",
      "CCBP_ACADEMY_GENIUS_PLUS",
      "CCBP_ACADEMY_EDGE_PLUS",
      "CCBP_ACADEMY_SMART_CAREER_PLUS",
      "CCBP_ACADEMY_GENIUS_CAREER_PLUS",
      "CCBP_ACADEMY_COLLEGE_PLUS",
      "NIAT",
    ]);
    assert.deepEqual(enrollPlansFor({ product: "NIAT;Academy" }).filter((plan) => plan === "NIAT"), ["NIAT"]);
    const beta = { testUsers: { INTENSIVE: ["a", "b"], ACADEMY: ["c"], EXTERNAL: [], NIAT: ["d"], OFFLINE: [] } };
    assert.deepEqual(testUsersFor(beta, ["CCBP_INTENSIVE", "NIAT"]), ["a", "b", "d"]);
    assert.deepEqual(testUsersFor(beta, ["CCBP_ACADEMY_SMART_PLUS"]), [], "only SMART/GENIUS/EDGE select academy test users");
  });

  test("each environment gets its own apply link for the same job", () => {
    const payload = { job_id: "job-1", job_details: { apply_by: "2026-05-02 06:30:00", link_to_apply: null } };
    const beta = payloadForEnvironment(payload, { applyLinkTemplate: "https://beta/apply?company={company}&job_id={jobId}" }, { companyName: "A & B" });
    assert.equal(beta.job_details.link_to_apply, "https://beta/apply?company=A%20%26%20B&job_id=job-1");
    assert.equal(payload.job_details.link_to_apply, null, "the stored payload is not modified");
  });

  test("company names match the org sheet the way the tool normalises them", () => {
    assert.equal(normalizeCompanyName("Zoho Pvt Ltd"), "zoho");
    assert.equal(normalizeCompanyName("  Tata Consultancy Services Limited "), "tata consultancy services");
    assert.equal(normalizeCompanyName("AT&T Inc."), "at&t");
  });

  test("a rejected access grant names the users to drop and why", () => {
    const body = JSON.stringify({
      res_status: "INVALID_USERS",
      response: JSON.stringify({ placed_users: ["11111111-1111-4111-8111-111111111111"] }),
    });
    const { named, reasonFor } = parseGrantRejection(body);
    assert.ok(named.has("11111111-1111-4111-8111-111111111111"));
    assert.equal(reasonFor("11111111-1111-4111-8111-111111111111"), "placed_users");
    assert.equal(parseGrantRejection("{}").reasonFor("x"), "Rejected by Learning Portal (invalid or placed)");
  });
});

describe("portal job content (CRM_Job_Loading text rules)", () => {
  const noAi = async () => "";

  test("stipend, duration and CTC are written like the tool writes them", () => {
    assert.equal(formatStipend("10000", "15000"), "10k - 15k");
    assert.equal(formatStipend("12000", "12000"), "12k");
    assert.equal(formatInternshipDuration("6", "", ""), "6 Months");
    assert.equal(formatInternshipDuration("3", "6", ""), "3 - 6 Months");
    assert.equal(formatCtcDisplay("4.5", "6"), "4.5 - 6 LPA");
    assert.equal(formatCtcDisplay("0", "6"), "");
  });

  test("without AI the internship disclaimer is built from the deal fields and remarks", async () => {
    const disclaimer = await buildDisclaimer(
      {
        crm_job_type: "Internship",
        internship_stipend_per_month: "10000",
        min_internship_duration: "6",
        optional_technologies_required: "Docker",
        work_timings: "10 AM - 7 PM",
        interview_process: "Online test;Technical",
        nurturing_team_remarks: "Laptop is mandatory.<br>Already hired one candidate - do not load",
      },
      noAi,
    );
    assert.deepEqual(disclaimer.split("\n"), [
      "- **6 Months internship period**, where the stipend will be **10k** per month",
      "Candidates should have good communication skills.",
      "- Add-on: Knowledge of **Docker** will be an advantage",
      "**Work Timings:** **10 AM - 7 PM**",
      "**Interview Process (Tentative):** **Online Process: Online test, Technical**",
      "Laptop is mandatory.",
    ]);
  });

  test("AI text is used when available, with the communication line guaranteed", async () => {
    const disclaimer = await buildDisclaimer(
      { crm_job_type: "Full time", minimum_ctc_in_lpa: "6", nurturing_team_remarks: "Good role" },
      async () => "• **CTC:** **6 LPA**\nN/A",
    );
    assert.equal(disclaimer, "• **CTC:** **6 LPA**\nCandidates should have good communication skills.");
  });

  test("eligibility criteria fill every enroll-plan key, NA for plans the job is not for", async () => {
    const [json] = await buildEligibilityContent({
      props: { technologies_required: "Python", education_criteria: "BTech" },
      enrollPlans: ["CCBP_INTENSIVE", "NXTWAVE_EXTERNAL_JOB_PORTAL"],
      skills: ["Python"],
      generate: async (prompt) => (prompt.includes("Programming Foundations") ? "- Programming Foundations: 75% of the course completion is required." : ""),
    });
    const criteria = JSON.parse(json);
    assert.match(criteria.V1, /^- Programming Foundations/);
    assert.match(criteria.V1, /- \*\*Note:\*\*/, "the plan's note block is appended to the AI text");
    assert.equal(criteria.V2, criteria.V1_V2);
    assert.match(criteria.NXTWAVE_EXTERNAL_JOB_PORTAL, /^- \*\*Note:\*\*\n - Point 1: After successfully applying/);
    assert.equal(criteria.CCBP_ACADEMY_SMART, "NA");
    assert.equal(criteria.NIAT, "NA");
  });

  test("a missing website or LinkedIn page adds the startup line; links become the org description", async () => {
    const content = await buildJobContent({
      props: { crm_job_type: "Full time" },
      enrollPlans: [],
      skills: [],
      company: { website: "https://www.acme.com", linkedin: null },
      generate: noAi,
    });
    assert.match(content.disclaimerMarkdown, /start their career in a startup environment/);
    assert.match(content.organisationDescriptionHtml, /Company Website Link:<\/strong> <a href='https:\/\/www\.acme\.com'/);
    assert.ok(!content.organisationDescriptionHtml.includes("Linkedin"));
    assert.equal(markdownToHtml("**Bold** line\nnext"), "<strong>Bold</strong> line<br />next");
  });
});

describe("readable logs", () => {
  const at = "2026-10-05T05:35:21.220Z";

  test("a request is one line: method, endpoint, status, time and who called it", () => {
    const line = formatPretty({
      level: 30,
      time: at,
      reqId: 7,
      http: { method: "DELETE", url: "/api/crm/deals/6ac0fcfe13a9bb4fc70a58a5", status: 204, ms: 647, user: "admin@example.com" },
      msg: "DELETE /api/crm/deals/6ac0fcfe13a9bb4fc70a58a5 204 647ms",
    });
    assert.match(line, /INFO {2}DELETE \/api\/crm\/deals\/6ac0fcfe13a9bb4fc70a58a5 {2}204 {2}647 ms {2}admin@example\.com$/);
    assert.ok(!line.includes("reqId"));
  });

  test("a worker warning shows its details and the error message, without the stack", () => {
    const error = new Error("HubSpot deal webhook returned HTTP 500");
    const line = formatPretty({
      level: 40,
      time: at,
      service: "job-flow-api",
      role: "all",
      taskId: "t1",
      type: "FETCH_DEAL",
      attempt: 2,
      err: { message: error.message, stack: error.stack },
      msg: "Task failed; retry scheduled",
    });
    assert.match(line, /WARN {2}Task failed; retry scheduled {2}type=FETCH_DEAL attempt=2 — HubSpot deal webhook returned HTTP 500$/);
    assert.ok(!line.includes("service=") && !line.includes("taskId"));
  });

  test("errors keep their stack; small objects print inline", () => {
    const line = formatPretty({ level: 50, time: at, err: { message: "boom", stack: "Error: boom\n    at here" }, msg: "Unhandled request error" });
    assert.match(line, /ERROR Unhandled request error — boom\nError: boom\n {4}at here$/);
    assert.match(formatPretty({ level: 30, time: at, modes: { hubspot: "live" }, msg: "API listening" }), /modes=\{hubspot:live\}$/);
  });

  test("request fields hide public link tokens and mark requests the browser cancelled", () => {
    const req = { method: "GET", originalUrl: "/api/public/candidate-pools/abc123/candidates/r1/resume?x=1" };
    const done = requestFields(req, { writableEnded: true, statusCode: 200 }, 5);
    assert.equal(done.url, "/api/public/candidate-pools/***/candidates/r1/resume?x=1");
    assert.equal(done.user, undefined);
    const cancelled = requestFields({ ...req, user: { email: "a@b.in" } }, { writableEnded: false, statusCode: 200 }, 3);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.user, "a@b.in");
  });
});

describe("settings that are not filled in yet", () => {
  test("each live integration lists exactly the keys it still needs", () => {
    const cfg = {
      ...config,
      modes: { ...config.modes, gemini: "live", ses: "live", nxtdial: "live" },
      gemini: { ...config.gemini, apiKey: undefined },
      ses: { ...config.ses, fromEmail: undefined },
      nxtdial: { ...config.nxtdial, apiKey: "key", agentId: "agent", fromNumber: "+910000000000" },
    };
    const missing = missingIntegrationSettings(cfg);
    assert.deepEqual(missing.gemini, ["GEMINI_API_KEY"]);
    assert.deepEqual(missing.ses, ["SES_FROM_EMAIL"]);
    assert.equal(missing.nxtdial, undefined);
    assert.ok(collectConfigProblems(cfg).includes("Gemini is not set up: add GEMINI_API_KEY"));
  });

  test("a service without its keys answers with what to add instead of crashing", async () => {
    const bigquery = notSetUp("bigquery", ["BIGQUERY_PROJECT_ID", "BIGQUERY_DATASET"]);
    assert.throws(
      () => bigquery.getApplicants("job-1"),
      (error) =>
        error.retryable === false &&
        error.message === "BigQuery is not set up yet: add BIGQUERY_PROJECT_ID, BIGQUERY_DATASET to apps/api/.env, restart the API, then press Retry Failed Step",
    );
    await assert.rejects(async () => bigquery.getApplicationCount("job-1"), /BigQuery is not set up yet/);
    assert.equal(bigquery.then, undefined);
    assert.equal(notSetUp("hubspot", ["HUBSPOT_DEAL_WEBHOOK_URL"]).canWrite, false);
    assert.deepEqual(notSetUp("learningPortal", ["BETA_API_KEY"]).targets, config.learningPortal.targets);
  });
});

describe("HubSpot owner list", () => {
  test("names, emails and IDs are merged per owner and invalid entries are left out", () => {
    const owners = listHubspotOwners();
    const byId = new Map(owners.map((owner) => [owner.id, owner]));
    assert.deepEqual(byId.get("1000003"), { id: "1000003", name: "Neha Sharma", email: "neha.sharma@example.com" });
    assert.equal(byId.get("1000004").name, "Arjun Rao");
    assert.equal(byId.get("1000005").name, "Kiran Reddy");
    assert.equal(byId.has("1000006"), false);
    assert.equal(byId.has("1000007"), false);
    assert.equal(owners.filter((owner) => owner.id === "1000001").length, 1);
    assert.equal(hubspotOwnerForEmail("Asha.Verma@example.com").id, "1000001");
  });
});
