import "./setup.js";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { JOB_STATUS } from "../src/config/statuses.js";
import { Job } from "../src/models/index.js";
import { WebhookHubspotClient, parseDealWebhookResponse } from "../src/services/hubspotClient.js";
import { overrideIntegration } from "../src/services/integrations.js";
import { mockDeal } from "../src/services/mock/mockData.js";
import { loginAs, resetDb, runDueTasks, startTestDb, stopTestDb, submitDeal } from "./helpers.js";

const jsonResponse = (status, body) =>
  new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function fakeWebhook(reply) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const request = { url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null };
    requests.push(request);
    return reply(request);
  };
  return { requests, client: new WebhookHubspotClient({ fetchImpl }) };
}

describe("deal details from the HubSpot deal webhook", () => {
  const original = { ...config.hubspot.dealWebhook };
  beforeEach(() => {
    Object.assign(config.hubspot.dealWebhook, {
      url: "https://hooks.example.com/webhook/hubspot-deal",
      method: "POST",
      apiKey: "secret-key",
      apiKeyHeader: "x-api-key",
    });
  });
  afterEach(() => Object.assign(config.hubspot.dealWebhook, original));

  test("accepts the HubSpot object shape, an n8n item list, a wrapped deal and plain properties", () => {
    const hubspotShape = {
      id: "123",
      properties: { dealname: "Acme - SDE", type_of_role: "SDE" },
      company: { properties: { name: "Acme", domain: "acme.com", linkedin_company_page: "https://linkedin.com/company/acme" } },
      owner: { email: "owner@example.com", firstName: "Asha", lastName: "Rao" },
    };
    const parsed = parseDealWebhookResponse(hubspotShape, "123");
    assert.deepEqual(parsed.deal, { id: "123", properties: { dealname: "Acme - SDE", type_of_role: "SDE" } });
    assert.deepEqual(parsed.company, { name: "Acme", domain: "acme.com", linkedin: "https://linkedin.com/company/acme", logo: null });
    assert.deepEqual(parsed.owner, { email: "owner@example.com", name: "Asha Rao" });

    assert.deepEqual(parseDealWebhookResponse([hubspotShape], "123").deal, parsed.deal, "first item of a list");
    assert.deepEqual(parseDealWebhookResponse({ data: hubspotShape }, "123").deal, parsed.deal, "under data");
    assert.deepEqual(
      parseDealWebhookResponse({ deal: { id: 123, properties: { dealname: { value: "Old style" } } } }, "123").deal.properties,
      { dealname: "Old style" },
      "wrapped deal with { value } properties",
    );
    const plain = parseDealWebhookResponse({ dealname: "Plain", type_of_role: "QA", owner: { email: "o@x.in" } }, "123");
    assert.deepEqual(plain.deal.properties, { dealname: "Plain", type_of_role: "QA" });
    assert.equal(plain.owner.email, "o@x.in");

    assert.equal(parseDealWebhookResponse({}, "123"), null, "an empty answer means no deal");
    assert.throws(() => parseDealWebhookResponse({ id: "999", properties: { dealname: "x" } }, "123"), /returned deal 999 instead of 123/);
    assert.throws(() => parseDealWebhookResponse({ error: "Deal not found" }, "123"), /Deal not found/);
  });

  test("POST sends the deal ID, the properties to read and the API key header", async () => {
    const { client, requests } = fakeWebhook(() => jsonResponse(200, { id: "555", properties: { dealname: "Acme" } }));
    const bundle = await client.fetchDealBundle("555");
    assert.equal(bundle.deal.properties.dealname, "Acme");
    const [request] = requests;
    assert.equal(request.url, "https://hooks.example.com/webhook/hubspot-deal");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-api-key"], "secret-key");
    assert.equal(request.body.action, "fetch");
    assert.equal(request.body.dealId, "555");
    assert.ok(request.body.properties.includes("technologies_required"));
    assert.ok(request.body.companyProperties.includes("domain"));
    assert.equal(client.canWrite, true, "writes go through the same webhook");
  });

  test("writing to a deal posts an update to the same webhook", async () => {
    const { client, requests } = fakeWebhook(() => jsonResponse(200, { ok: true }));
    await client.updateDeal("555", { job_id: "job-1", crm: "1000001" });
    const [request] = requests;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "https://hooks.example.com/webhook/hubspot-deal");
    assert.equal(request.headers["x-api-key"], "secret-key");
    assert.deepEqual(request.body, { action: "update", dealId: "555", properties: { job_id: "job-1", crm: "1000001" } });
    const outage = fakeWebhook(() => jsonResponse(503, { message: "busy" }));
    await assert.rejects(outage.client.updateDeal("555", { job_id: "x" }), (error) => error.retryable === true);
    const refused = fakeWebhook(() => jsonResponse(400, { message: "bad property" }));
    await assert.rejects(refused.client.updateDeal("555", { job_id: "x" }), (error) => error.retryable === false);
  });

  test("GET puts the deal ID in the URL template or the query string", async () => {
    config.hubspot.dealWebhook.method = "GET";
    config.hubspot.dealWebhook.url = "https://hooks.example.com/deals/{dealId}";
    const reply = () => jsonResponse(200, { properties: { dealname: "x" } });
    const templated = fakeWebhook(reply);
    await templated.client.fetchDealBundle("77");
    assert.equal(templated.requests[0].url, "https://hooks.example.com/deals/77");
    assert.equal(templated.requests[0].body, null);

    config.hubspot.dealWebhook.url = "https://hooks.example.com/deal?source=crm";
    const query = fakeWebhook(reply);
    await query.client.fetchDealBundle("78");
    assert.equal(query.requests[0].url, "https://hooks.example.com/deal?source=crm&dealId=78");
  });

  test("not found fails the deal; outages retry; a bad key does not", async () => {
    const notFound = fakeWebhook(() => jsonResponse(404, { message: "no deal" }));
    await assert.rejects(notFound.client.fetchDealBundle("1"), (error) => error.retryable === false && /not found/.test(error.message));
    const empty = fakeWebhook(() => jsonResponse(200, []));
    await assert.rejects(empty.client.fetchDealBundle("1"), /returned no deal/);
    const outage = fakeWebhook(() => jsonResponse(503, { message: "busy" }));
    await assert.rejects(outage.client.fetchDealBundle("1"), (error) => error.retryable === true);
    const forbidden = fakeWebhook(() => jsonResponse(401, { message: "bad key" }));
    await assert.rejects(forbidden.client.fetchDealBundle("1"), (error) => error.retryable === false && /HTTP 401/.test(error.message));
  });
});

describe("a deal processed with only the deal webhook", () => {
  let crm;
  const original = { ...config.hubspot.dealWebhook };
  before(startTestDb);
  after(async () => {
    Object.assign(config.hubspot.dealWebhook, original);
    await stopTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs("crm.user@example.com", "CRM");
    Object.assign(config.hubspot.dealWebhook, { url: "https://hooks.example.com/webhook/hubspot-deal", method: "POST" });
  });

  test("the job is loaded from the webhook's deal details and the job ID is written back through it", async () => {
    const sample = mockDeal("12345", "owner.crm@example.com");
    const { client, requests } = fakeWebhook(() =>
      jsonResponse(200, [
        {
          id: "12345",
          properties: sample.properties,
          company: { name: sample.company.name, domain: sample.company.domain },
          owner: { email: "owner.crm@example.com", firstName: "Demo", lastName: "CRM" },
        },
      ]),
    );
    overrideIntegration("hubspot", client);

    const response = await submitDeal(crm, "12345");
    await runDueTasks();
    const job = await Job.findById(response.body.job.id);
    assert.equal(job.status, JOB_STATUS.APPLICATIONS_OPEN, job.lastError);
    assert.equal(job.companyName, sample.company.name);
    assert.equal(job.companyWebsite, `https://www.${sample.company.domain}`);
    assert.equal(job.crmOwnerEmail, "owner.crm@example.com");
    assert.ok(job.learningPortalLoads.prod.loadedAt);
    assert.equal(job.hubspotWriteBack.status, "DONE", job.hubspotWriteBack.error);
    const update = requests.find((request) => request.body?.action === "update");
    assert.deepEqual(update.body, { action: "update", dealId: "12345", properties: { job_id: job.learningPortalJobId } });
    assert.equal(requests.filter((request) => request.body?.action === "update").length, 1, "no owner fields were chosen");
  });
});
