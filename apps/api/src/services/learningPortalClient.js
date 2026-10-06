import crypto from "node:crypto";
import { config } from "../config/env.js";
import { IntegrationError, integrationErrorFromStatus } from "../utils/errors.js";
import { chunk, parseRetryAfter } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const GRANT_ATTEMPTS = 5;
const DEFAULT_REJECT_REASON = "Rejected by Learning Portal (invalid or placed)";

function stripNulls(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined).map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== null && item !== undefined)
        .map(([key, item]) => [key, stripNulls(item)]),
    );
  }
  return value;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function reasonPath(data, userId) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) && value.some((item) => String(item).trim().toLowerCase() === userId)) return key;
    if (value && typeof value === "object") {
      if (Object.keys(value).some((inner) => inner.trim().toLowerCase() === userId)) return key;
      const nested = reasonPath(value, userId);
      if (nested) return `${key} -> ${nested}`;
    }
  }
  return null;
}

export function parseGrantRejection(responseText) {
  const named = new Set((String(responseText ?? "").match(UUID) ?? []).map((id) => id.toLowerCase()));
  const body = parseJson(responseText);
  const inner = typeof body?.response === "string" ? parseJson(body.response) : body?.response;
  const fallback = body?.res_status ? String(body.res_status) : DEFAULT_REJECT_REASON;
  const reasonFor = (id) => reasonPath(body, id.toLowerCase()) ?? reasonPath(inner, id.toLowerCase()) ?? fallback;
  return { named, reasonFor };
}

class PortalEnvironment {
  constructor(settings) {
    this.name = settings.name;
    this.baseUrl = settings.baseUrl;
    this.apiKey = settings.apiKey;
  }

  async post(path, document, quote, what) {
    const { clientKeyDetailsId, timeoutMs } = config.learningPortal;
    const label = `Learning Portal ${this.name} ${what}`;
    let response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          data: `${quote}${JSON.stringify(stripNulls(document))}${quote}`,
          clientKeyDetailsId: Number(clientKeyDetailsId) || clientKeyDetailsId,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new IntegrationError(`${label} request failed: ${error.message}`, {
        integration: "learningPortal",
        retryable: true,
        cause: error,
      });
    }
    const text = await response.text();
    if (!response.ok) {
      const error = integrationErrorFromStatus(
        "Learning Portal",
        response.status,
        `${this.name} ${what} returned HTTP ${response.status}: ${text.slice(0, 300)}`,
        parseRetryAfter(response.headers.get("retry-after")),
      );
      error.responseText = text;
      throw error;
    }
    return text ? (parseJson(text) ?? { raw: text }) : {};
  }

  createOrganisation({ organisationId, name, website, logoUrl }) {
    return this.post(
      config.learningPortal.paths.createOrg,
      { org_details: { organisation_id: organisationId, website_url: website ?? "", name, logo_url: logoUrl || "NA" } },
      "`",
      "organisation create",
    );
  }

  upsertJob(payload) {
    return this.post(config.learningPortal.paths.createJob, payload, "'", "job create");
  }

  async grantAccess(jobId, userIds) {
    const granted = [];
    const rejected = [];
    for (const ids of chunk(userIds, config.learningPortal.accessChunkSize)) {
      let pending = [...ids];
      for (let attempt = 0; attempt < GRANT_ATTEMPTS && pending.length; attempt++) {
        try {
          await this.post(
            config.learningPortal.paths.grantAccess,
            { user_jobs_details: pending.map((id) => ({ user_id: id, job_id: jobId })) },
            '"',
            "grant access",
          );
          granted.push(...pending);
          pending = [];
        } catch (error) {
          if (!error.status || error.status >= 500 || error.status === 429) throw error;
          const { named, reasonFor } = parseGrantRejection(error.responseText);
          const bad = pending.filter((id) => named.has(String(id).toLowerCase()));
          if (!bad.length) {
            for (const id of pending) rejected.push({ studentId: id, reason: error.message.slice(0, 300) });
            pending = [];
            break;
          }
          for (const id of bad) rejected.push({ studentId: id, reason: reasonFor(id) });
          pending = pending.filter((id) => !bad.includes(id));
        }
      }
      for (const id of pending) rejected.push({ studentId: id, reason: "Still rejected after retries" });
    }
    return { granted, rejected };
  }

  async getEligibleStudentIds(eligibilityDetails) {
    const result = await this.post(
      config.learningPortal.paths.eligibleUsers,
      { eligibility_details: eligibilityDetails },
      "`",
      "eligible users",
    );
    const ids = result.user_ids ?? result.eligible_user_ids ?? [];
    if (!Array.isArray(ids)) {
      throw new IntegrationError(`Learning Portal ${this.name} eligible-users response had no user id list`, {
        integration: "learningPortal",
        retryable: false,
      });
    }
    return ids.map(String);
  }
}

class LiveLearningPortalClient {
  constructor() {
    this.environments = Object.fromEntries(
      Object.entries(config.learningPortal.environments).map(([name, settings]) => [name, new PortalEnvironment(settings)]),
    );
  }

  get targets() {
    return config.learningPortal.targets;
  }

  env(name) {
    const environment = this.environments[name];
    if (!environment?.apiKey) {
      throw new IntegrationError(`Learning Portal ${name} is not configured`, { integration: "learningPortal", retryable: false });
    }
    return environment;
  }

  newId() {
    return crypto.randomUUID();
  }

  createOrganisation(env, organisation) {
    return this.env(env).createOrganisation(organisation);
  }

  upsertJob(env, payload) {
    return this.env(env).upsertJob(payload);
  }

  grantAccess(env, jobId, userIds) {
    return this.env(env).grantAccess(jobId, userIds);
  }

  getEligibleStudentIds(env, eligibilityDetails) {
    return this.env(env).getEligibleStudentIds(eligibilityDetails);
  }
}

export class MockLearningPortalClient {
  constructor() {
    this.calls = [];
  }

  get targets() {
    return config.learningPortal.targets;
  }

  newId() {
    return crypto.randomUUID();
  }

  async createOrganisation(env, organisation) {
    this.calls.push({ env, op: "createOrganisation", organisation });
    logger.info({ env, organisationId: organisation.organisationId }, "[mock] Learning Portal organisation created");
  }

  async upsertJob(env, payload) {
    this.calls.push({ env, op: "upsertJob", payload });
    logger.info({ env, jobId: payload.job_id }, "[mock] Learning Portal job loaded");
  }

  async grantAccess(env, jobId, userIds) {
    this.calls.push({ env, op: "grantAccess", jobId, userIds: [...userIds] });
    return { granted: [...userIds], rejected: [] };
  }

  async getEligibleStudentIds(env, eligibilityDetails) {
    this.calls.push({ env, op: "getEligibleStudentIds", eligibilityDetails });
    return [];
  }
}

export function createLearningPortalClient() {
  return config.modes.learningPortal === "live" ? new LiveLearningPortalClient() : new MockLearningPortalClient();
}
