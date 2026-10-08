import crypto from "node:crypto";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { parseRetryAfter } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

function failure(status, detail, retryAfter) {
  if (status === 429) {
    return new IntegrationError(`NxtDial rate limited: ${detail}`, {
      integration: "nxtdial",
      status,
      retryable: true,
      retryAfterMs: parseRetryAfter(retryAfter) ?? 60_000,
    });
  }
  return new IntegrationError(`NxtDial HTTP ${status}: ${detail}`, {
    integration: "nxtdial",
    status,
    retryable: status >= 500,
  });
}

const FINAL_ANSWERED = new Set(["completed", "timeout", "silence-timeout", "disconnected"]);

function providerStatus(presented) {
  const status = String(presented ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return status === "running" ? "in-progress" : status;
}

function secondsFrom(duration) {
  const match = /^(\d+)m (\d+)s$/.exec(String(duration ?? ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export class LiveNxtDialClient {
  async request(method, path, body) {
    let response;
    try {
      const init = {
        method,
        headers: { Authorization: `Bearer ${config.nxtdial.apiKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(config.nxtdial.timeoutMs),
      };
      if (body) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      response = await fetch(`${config.nxtdial.baseUrl}${path}`, init);
    } catch (error) {
      throw new IntegrationError(`NxtDial request failed: ${error.message}`, { integration: "nxtdial", retryable: true, cause: error });
    }
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const detail = (parsed?.message ?? parsed?.error?.message ?? text).toString().slice(0, 300);
      throw failure(response.status, detail, response.headers.get("retry-after"));
    }
    return parsed;
  }

  async listRatingTemplates() {
    const rows = await this.request("GET", "/api/rating-templates");
    return Array.isArray(rows) ? rows : [];
  }

  async createRatingTemplate(template) {
    return this.request("POST", "/api/rating-templates", template);
  }

  async createAgent(agent) {
    const created = await this.request("POST", "/api/agents", agent);
    if (!created?.id) throw new IntegrationError("NxtDial did not return an agent id", { integration: "nxtdial", retryable: false });
    return { id: String(created.id), name: created.name ?? agent.name };
  }

  async createBatch({ name, agentId, fromNumber }) {
    const created = await this.request("POST", "/api/batches", { name, agentId, telephonyProvider: "plivo", fromNumber });
    if (!created?.id) throw new IntegrationError("NxtDial did not return a batch id", { integration: "nxtdial", retryable: false });
    return { id: String(created.id) };
  }

  async startBatch(batchId, items) {
    return this.request("POST", `/api/batches/${encodeURIComponent(batchId)}/start`, { items });
  }

  async getBatchResults(batchId) {
    let body;
    try {
      body = await this.request("GET", `/api/batches/${encodeURIComponent(batchId)}/results`);
    } catch (error) {
      if (error.status !== 404 || !/^\s*</.test(String(error.message).split(": ").slice(1).join(": "))) throw error;
      return this.batchResultsFromItems(batchId);
    }
    return { batch: body?.batch ?? null, calls: Array.isArray(body?.calls) ? body.calls : [] };
  }

  async batchResultsFromItems(batchId) {
    const items = await this.request("GET", `/api/batches/${encodeURIComponent(batchId)}/items`);
    const calls = [];
    for (const item of Array.isArray(items) ? items : []) {
      const status = providerStatus(item.status);
      let rated = null;
      if (FINAL_ANSWERED.has(status)) {
        rated = await this.request("GET", `/api/ratings/${encodeURIComponent(item.id)}`).catch((error) => {
          logger.warn({ err: error, callId: item.id }, "NxtDial rating could not be read");
          return null;
        });
      }
      const ratingStatus = rated?.ratingStatus ?? null;
      calls.push({
        callId: String(item.id),
        name: item.studentName ?? null,
        phone: item.phone ?? null,
        email: item.email ?? null,
        status: rated?.callStatus ? providerStatus(rated.callStatus) : status,
        subStatus: rated?.subStatus ?? null,
        startedAt: rated?.startedAtIso ?? null,
        endedAt: rated?.endedAtIso ?? null,
        durationSeconds: rated?.durationSeconds ?? secondsFrom(item.duration),
        recordingUrl: rated?.recordingUrl ?? null,
        summary: rated?.summary || item.summary || null,
        metadata: null,
        errorMessage: null,
        ratingStatus,
        rating:
          rated && ratingStatus === "rated"
            ? {
                overallRating: rated.overallRating ?? null,
                remarks: rated.remarks || null,
                followUpStatus: rated.followUpStatus || null,
                callBack: rated.callBack || null,
                columnHeaders: rated.columnHeaders ?? [],
                cells: rated.cells ?? null,
              }
            : null,
      });
    }
    return { batch: { id: String(batchId) }, calls };
  }
}

const MOCK_OUTCOMES = ["completed", "completed", "no-answer", "completed", "busy"];

export class MockNxtDialClient {
  constructor() {
    this.templates = [];
    this.agents = [];
    this.batches = new Map();
  }

  async listRatingTemplates() {
    return this.templates;
  }

  async createRatingTemplate(template) {
    const created = { id: crypto.randomUUID(), ...template };
    this.templates.push(created);
    return created;
  }

  async createAgent(agent) {
    const created = { id: `mock-agent-${crypto.randomUUID()}`, ...agent };
    this.agents.push(created);
    logger.debug({ name: agent.name }, "[mock] NxtDial agent created");
    return { id: created.id, name: created.name };
  }

  async createBatch({ name, agentId, fromNumber }) {
    const id = `mock-batch-${crypto.randomUUID()}`;
    this.batches.set(id, { id, name, agentId, fromNumber, items: [], status: "draft" });
    return { id };
  }

  async startBatch(batchId, items) {
    const batch = this.batches.get(batchId);
    batch.items = items.map((item) => ({ ...item, callId: `mock-call-${crypto.randomUUID()}` }));
    batch.status = "completed";
    return { message: "started", queued: items.length };
  }

  async getBatchResults(batchId) {
    const batch = this.batches.get(batchId);
    if (!batch) return { batch: null, calls: [] };
    const calls = batch.items.map((item, index) => {
      const status = MOCK_OUTCOMES[index % MOCK_OUTCOMES.length];
      const answered = status === "completed";
      const interested = index % 2 === 0 ? "Yes" : "No";
      return {
        callId: item.callId,
        name: item.name,
        phone: item.phone,
        status,
        durationSeconds: answered ? 75 + index : 0,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        recordingUrl: answered ? `https://recordings.example.com/${item.callId}.mp3` : null,
        summary: answered ? `${item.name} discussed the role.` : null,
        metadata: item.metadata ?? null,
        ratingStatus: answered ? "rated" : "skipped",
        rating: answered
          ? {
              overallRating: interested === "Yes" ? 4 : 2,
              remarks: interested === "Yes" ? "Keen to apply today." : "Not interested in this location.",
              followUpStatus: "",
              callBack: "",
              columnHeaders: ["Interested", "Will Apply", "Reason Not Applied", "Questions Asked", "Call Back Requested"],
              cells: {
                Interested: { value: interested, reason: "", kind: "boolean" },
                "Will Apply": { value: interested === "Yes" ? "Yes" : "No", reason: "", kind: "label" },
                "Reason Not Applied": { value: interested === "Yes" ? "Missed the email" : "Location", reason: "", kind: "text" },
                "Questions Asked": { value: "Stipend", reason: "", kind: "text" },
                "Call Back Requested": { value: "No", reason: "", kind: "boolean" },
              },
            }
          : null,
      };
    });
    return { batch: { id: batch.id, status: batch.status, agentId: batch.agentId, totalItems: calls.length }, calls };
  }
}

export function createNxtDialClient() {
  return config.modes.nxtdial === "live" ? new LiveNxtDialClient() : new MockNxtDialClient();
}
