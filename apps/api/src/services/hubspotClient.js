import mongoose from "mongoose";
import { config } from "../config/env.js";
import { HUBSPOT_DEAL_PROPERTIES } from "../config/hubspotFields.js";
import { IntegrationError, PermanentError } from "../utils/errors.js";
import { parseRetryAfter } from "../utils/helpers.js";
import { mockDeal, mockDealExists } from "./mock/mockData.js";

const COMPANY_PROPERTIES = ["name", "domain", "linkedin_company_page", "logo"];

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const first = (value) => (Array.isArray(value) ? value[0] : value);
const plainProperties = (properties) =>
  Object.fromEntries(
    Object.entries(properties ?? {}).map(([key, value]) => [key, isObject(value) && "value" in value ? value.value : value]),
  );
const NESTED_KEYS = new Set(["company", "companyProperties", "owner", "associations", "associatedCompany", "deal"]);

function parsedObject(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function companyFrom(raw) {
  const company = first(parsedObject(raw));
  if (!isObject(company)) return null;
  const props = { ...plainProperties(company.properties), ...company };
  return {
    name: props.name ?? null,
    domain: props.domain ?? null,
    linkedin: props.linkedin ?? props.linkedin_company_page ?? null,
    logo: props.logo ?? null,
  };
}

function ownerFrom(raw) {
  const owner = first(raw);
  if (!isObject(owner)) return null;
  const name = owner.name ?? ([owner.firstName, owner.lastName].filter(Boolean).join(" ") || null);
  return { email: owner.email ?? null, name };
}

export function parseDealWebhookResponse(raw, dealId) {
  let body = first(raw);
  if (isObject(body) && body.data !== undefined && !body.deal && !body.properties) body = first(body.data);
  if (!isObject(body) || !Object.keys(body).length) return null;
  if (typeof body.error === "string" && !body.deal && !body.properties) {
    throw new PermanentError(`HubSpot deal webhook: ${body.error}`);
  }

  const dealPart = isObject(body.deal) ? body.deal : body;
  const properties = isObject(dealPart.properties)
    ? plainProperties(dealPart.properties)
    : plainProperties(Object.fromEntries(Object.entries(dealPart).filter(([key]) => !NESTED_KEYS.has(key) && key !== "id")));
  if (!Object.keys(properties).length) return null;

  const returnedId = dealPart.id ?? properties.hs_object_id;
  if (returnedId !== undefined && returnedId !== null && String(returnedId) !== String(dealId)) {
    throw new PermanentError(`HubSpot deal webhook returned deal ${returnedId} instead of ${dealId}`);
  }
  return {
    deal: { id: String(dealId), properties },
    company: companyFrom(
      body.company ?? dealPart.company ?? body.associatedCompany ?? body.companyProperties ?? dealPart.companyProperties,
    ),
    owner: ownerFrom(body.owner ?? dealPart.owner),
  };
}

export class WebhookHubspotClient {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.canWrite = true;
  }

  async send({ method, dealId, body, what }) {
    const { url, apiKey, apiKeyHeader, timeoutMs } = config.hubspot.dealWebhook;
    const headers = { Accept: "application/json" };
    if (apiKey) headers[apiKeyHeader] = apiKey;
    let target = url.replaceAll("{dealId}", encodeURIComponent(dealId));
    const init = { method, headers, signal: AbortSignal.timeout(timeoutMs) };
    if (method === "GET") {
      if (!url.includes("{dealId}")) {
        const withQuery = new URL(target);
        withQuery.searchParams.set("dealId", dealId);
        target = withQuery.toString();
      }
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(target, init);
    } catch (error) {
      throw new IntegrationError(`HubSpot deal webhook request failed (${what}): ${error.message}`, {
        integration: "hubspot",
        retryable: true,
        cause: error,
      });
    }
    const text = await response.text();
    if (response.status === 404) throw new PermanentError(`HubSpot deal ${dealId} not found (deal webhook returned 404)`);
    if (!response.ok) {
      throw new IntegrationError(`HubSpot deal webhook returned HTTP ${response.status} (${what}): ${text.slice(0, 300)}`, {
        integration: "hubspot",
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")),
      });
    }
    return text;
  }

  async fetchDealBundle(dealId) {
    const id = String(dealId);
    const text = await this.send({
      method: config.hubspot.dealWebhook.method,
      dealId: id,
      what: "read deal",
      body: { action: "fetch", dealId: id, properties: HUBSPOT_DEAL_PROPERTIES, companyProperties: COMPANY_PROPERTIES },
    });
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw new IntegrationError("HubSpot deal webhook did not return JSON", { integration: "hubspot", retryable: false });
    }
    const bundle = parseDealWebhookResponse(body, id);
    if (!bundle) throw new PermanentError(`HubSpot deal ${id} not found (the deal webhook returned no deal)`);
    return bundle;
  }

  async findJobPipelineDealIds(dealId) {
    return [String(dealId)];
  }

  async updateDeal(dealId, properties) {
    const id = String(dealId);
    await this.send({ method: "POST", dealId: id, what: "update deal", body: { action: "update", dealId: id, properties } });
  }
}

const mockOverrideSchema = new mongoose.Schema(
  { dealId: { type: String, unique: true }, properties: { type: mongoose.Schema.Types.Mixed, default: {} } },
  { collection: "dev_mock_hubspot_overrides", minimize: false },
);
export const MockDealOverride =
  mongoose.models.MockDealOverride ?? mongoose.model("MockDealOverride", mockOverrideSchema);

class MockHubspotClient {
  canWrite = true;

  async fetchDealBundle(dealId) {
    if (!mockDealExists(dealId)) throw new PermanentError(`HubSpot deal ${dealId} not found`);
    const base = mockDeal(dealId, config.mock.crmOwnerEmail);
    const override = await MockDealOverride.findOne({ dealId }).lean();
    const properties = { ...base.properties, ...override?.properties };
    return {
      deal: { id: dealId, properties },
      company: {
        name: properties.company_name_override ?? base.company.name,
        domain: base.company.domain,
        linkedin: base.company.linkedin ?? null,
        logo: null,
      },
      owner: { email: base.owner.email, name: `${base.owner.firstName} ${base.owner.lastName}` },
    };
  }

  async findJobPipelineDealIds(dealId) {
    return [String(dealId)];
  }

  async updateDeal(dealId, properties) {
    this.updates ??= [];
    this.updates.push({ dealId: String(dealId), properties });
  }

  async setOverride(dealId, properties) {
    await MockDealOverride.updateOne(
      { dealId },
      { $set: Object.fromEntries(Object.entries(properties).map(([k, v]) => [`properties.${k}`, v])) },
      { upsert: true },
    );
  }
}

export function createHubspotClient() {
  if (config.modes.hubspot !== "live") return new MockHubspotClient();
  return new WebhookHubspotClient();
}
