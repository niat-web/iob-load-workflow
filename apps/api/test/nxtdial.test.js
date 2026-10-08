import "./setup.js";
import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { buildAgentDefinition, ensureRatingTemplate, RATING_COLUMNS, spokenJobSummary } from "../src/services/callAgentService.js";
import { integrations, overrideIntegration } from "../src/services/integrations.js";
import { mapProviderStatus } from "../src/services/boostService.js";
import { LiveNxtDialClient } from "../src/services/nxtDialClient.js";
import { resetDb, startTestDb, stopTestDb } from "./helpers.js";

function respond(status, body = {}, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

const JOB = {
  _id: "64b000000000000000000001",
  companyName: "neurogent.ai",
  jobRole: "AI Software Engineer (FDE) - Intern",
  employmentType: "Internship",
  location: "Gurugram",
  ctc: "₹25,000 – ₹50,000 per month",
  internshipDuration: "12 months",
  skills: ["GenAI", "React js", "TypeScript", "Python"],
  openings: 2,
};

describe("NxtDial client", () => {
  let client;
  beforeEach(() => {
    client = new LiveNxtDialClient();
  });
  afterEach(() => mock.restoreAll());

  test("creates an agent with the API key and returns its id", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => respond(201, { id: "agent-1", name: "Apply reminder" }));
    const agent = await client.createAgent({ name: "Apply reminder" });
    assert.deepEqual(agent, { id: "agent-1", name: "Apply reminder" });
    const [url, init] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, "https://nxtdial.test/api/agents");
    assert.equal(init.method, "POST");
    assert.match(init.headers.Authorization, /^Bearer /);
    assert.deepEqual(JSON.parse(init.body), { name: "Apply reminder" });
  });

  test("creates a batch, starts it with per-student items and reads its results", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/api/batches")) return respond(201, { id: "batch-1" });
      if (url.endsWith("/start")) return respond(200, { queued: 1 });
      return respond(200, { batch: { id: "batch-1", status: "active" }, calls: [{ callId: "c1", phone: "+919876500000", status: "completed" }] });
    });
    assert.deepEqual(await client.createBatch({ name: "B", agentId: "agent-1", fromNumber: "+911234567890" }), { id: "batch-1" });
    await client.startBatch("batch-1", [{ name: "Asha", phone: "+919876500000", metadata: { jd: "JD" } }]);
    const results = await client.getBatchResults("batch-1");
    assert.equal(results.calls[0].callId, "c1");

    const [, createInit] = fetchMock.mock.calls[0].arguments;
    assert.deepEqual(JSON.parse(createInit.body), { name: "B", agentId: "agent-1", telephonyProvider: "plivo", fromNumber: "+911234567890" });
    const [startUrl, startInit] = fetchMock.mock.calls[1].arguments;
    assert.equal(startUrl, "https://nxtdial.test/api/batches/batch-1/start");
    assert.deepEqual(JSON.parse(startInit.body).items[0].metadata, { jd: "JD" });
    const [resultsUrl, resultsInit] = fetchMock.mock.calls[2].arguments;
    assert.equal(resultsUrl, "https://nxtdial.test/api/batches/batch-1/results");
    assert.equal(resultsInit.body, undefined);
  });

  test("rate limits are retryable with the server's wait time; other client errors are not", async () => {
    mock.method(globalThis, "fetch", async () => respond(429, { message: "Daily request limit reached" }, { "Retry-After": "120" }));
    await assert.rejects(client.createAgent({}), (error) => error.retryable === true && error.retryAfterMs === 120_000);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => respond(403, { message: "Agent limit reached" }));
    await assert.rejects(client.createAgent({}), (error) => error.retryable === false && /Agent limit reached/.test(error.message));
  });

  test("provider call statuses map to the app's call statuses", () => {
    assert.equal(mapProviderStatus("completed"), "COMPLETED");
    assert.equal(mapProviderStatus("no-answer"), "NO_ANSWER");
    assert.equal(mapProviderStatus("busy"), "BUSY");
    assert.equal(mapProviderStatus("failed"), "FAILED");
    assert.equal(mapProviderStatus("queued"), "QUEUED");
    assert.equal(mapProviderStatus("in-progress"), "CALLING");
    assert.equal(mapProviderStatus("timeout"), "COMPLETED", "the call reached its time limit, so the student was reached");
    assert.equal(mapProviderStatus("silence-timeout"), "COMPLETED");
    assert.equal(mapProviderStatus("disconnected"), "COMPLETED");
    assert.equal(mapProviderStatus("voicemail"), "NO_ANSWER");
  });

  test("results are read from the batch items and ratings when the server has no results endpoint yet", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (url) => {
      if (url.endsWith("/results")) return new Response("<!DOCTYPE html><pre>Cannot GET</pre>", { status: 404 });
      if (url.endsWith("/items")) {
        return respond(200, [
          { id: "c1", studentName: "Asha", phone: "+919876500001", status: "Timeout", duration: "2m 0s", summary: "" },
          { id: "c2", studentName: "Ravi", phone: "+919876500002", status: "No Answer", duration: "--", summary: "" },
          { id: "c3", studentName: "Neha", phone: "+919876500003", status: "Running", duration: "0m 20s", summary: "" },
        ]);
      }
      if (url.endsWith("/api/ratings/c1")) {
        return respond(200, {
          callStatus: "Timeout",
          ratingStatus: "rated",
          durationSeconds: 120,
          startedAtIso: "2026-05-01T05:00:00.000Z",
          endedAtIso: "2026-05-01T05:02:00.000Z",
          recordingUrl: "https://recordings.test/c1.mp3",
          summary: "Asha will apply tonight.",
          overallRating: 4,
          remarks: "Keen",
          callBack: "",
          columnHeaders: ["Interested", "Will Apply"],
          cells: { Interested: { value: "Yes" }, "Will Apply": { value: "Yes" } },
        });
      }
      return respond(404, { message: "Not found" });
    });

    const { calls } = await client.getBatchResults("batch-9");
    assert.deepEqual(calls.map((call) => [call.callId, call.status]), [["c1", "timeout"], ["c2", "no-answer"], ["c3", "in-progress"]]);
    assert.equal(calls[0].durationSeconds, 120);
    assert.equal(calls[0].rating.cells.Interested.value, "Yes");
    assert.equal(calls[0].summary, "Asha will apply tonight.");
    assert.equal(calls[1].rating, null);
    assert.equal(calls[2].durationSeconds, 20);
    const ratingCalls = fetchMock.mock.calls.filter((call) => call.arguments[0].includes("/api/ratings/"));
    assert.equal(ratingCalls.length, 1, "ratings are read only for answered calls");

    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => respond(404, { message: "Batch not found." }));
    await assert.rejects(client.getBatchResults("missing"), /Batch not found/);
  });
});

describe("Call agent built from the job description", () => {
  before(startTestDb);
  after(stopTestDb);
  beforeEach(resetDb);

  test("the agent is two-way, capped at 2 minutes, and uses {name}, {jd} and {deadline}", () => {
    const agent = buildAgentDefinition(JOB, "job_application_reminder");
    assert.equal(agent.conversationEngine, "pipeline");
    assert.equal(agent.callTimeoutSeconds, 120);
    assert.equal(agent.ratingTemplate, "job_application_reminder");
    assert.match(agent.welcomeMessage, /^Hi \{name\},/);
    assert.match(agent.welcomeMessage, /neurogent\.ai/);
    for (const placeholder of ["{name}", "{jd}", "{deadline}"]) assert.ok(agent.prompt.includes(placeholder), placeholder);
    assert.match(agent.prompt, /within 2 minutes/);
    assert.ok(agent.finalCallMessage.length > 10);
    assert.deepEqual(agent.variables, ["name", "jd", "deadline"]);
    assert.equal(config.nxtdial.callMaxSeconds, 120);
  });

  test("the spoken job summary falls back to the job facts when Gemini returns nothing", async () => {
    const text = await spokenJobSummary(JOB);
    assert.match(text, /neurogent\.ai is hiring for the role of AI Software Engineer/);
    assert.match(text, /Gurugram/);
    assert.match(text, /₹25,000 – ₹50,000 per month/);
  });

  test("the scoring sheet is created once and then reused", async () => {
    const first = await ensureRatingTemplate();
    const second = await ensureRatingTemplate();
    assert.equal(first, "job_application_reminder");
    assert.equal(second, first);
    assert.equal(integrations.nxtdial.templates.length, 1);
    assert.deepEqual(integrations.nxtdial.templates[0].columnHeaders, RATING_COLUMNS);
  });

  test("a Gemini summary is used when it returns enough text", async () => {
    overrideIntegration("gemini", {
      generateText: async () => "neurogent.ai is hiring AI engineer interns in Gurugram with a stipend of up to fifty thousand rupees a month.",
    });
    assert.match(await spokenJobSummary(JOB), /fifty thousand rupees/);
  });
});
