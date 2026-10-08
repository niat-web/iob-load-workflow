import { INTEGRATION_LABELS, config, missingIntegrationSettings } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { createBigQueryRepository } from "./bigQueryRepository.js";
import { createSheetsClient } from "./googleSheets.js";
import { createGeminiResumeAnalyzer } from "./geminiResumeAnalyzer.js";
import { createGoogleMeetClient } from "./googleMeetClient.js";
import { createHubspotClient } from "./hubspotClient.js";
import { createLearningPortalClient } from "./learningPortalClient.js";
import { createNxtDialClient } from "./nxtDialClient.js";
import { createSesService } from "./sesService.js";

const factories = {
  hubspot: createHubspotClient,
  learningPortal: createLearningPortalClient,
  bigquery: createBigQueryRepository,
  gemini: createGeminiResumeAnalyzer,
  ses: createSesService,
  nxtdial: createNxtDialClient,
  sheets: createSheetsClient,
  meet: createGoogleMeetClient,
};

export function notSetUp(name, missing) {
  const label = INTEGRATION_LABELS[name] ?? name;
  const envKeys = missing.filter((item) => /^[A-Z0-9_]+$/.test(item));
  const others = missing.filter((item) => !envKeys.includes(item));
  const what = [envKeys.length ? `${envKeys.join(", ")} to apps/api/.env` : null, ...others].filter(Boolean).join(" and ");
  const fail = () => {
    throw new IntegrationError(
      `${label} is not set up yet: add ${what}, restart the API, then press Retry Failed Step`,
      { integration: name, retryable: false },
    );
  };
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then" || typeof property === "symbol") return undefined;
        if (property === "canWrite" || property === "enabled") return false;
        if (property === "targets") return config.learningPortal.targets;
        return fail;
      },
    },
  );
}

function create(name) {
  const missing = missingIntegrationSettings()[name];
  return missing?.length ? notSetUp(name, missing) : factories[name]();
}

const instances = new Map();

function get(name) {
  if (!instances.has(name)) instances.set(name, create(name));
  return instances.get(name);
}

export const integrations = {
  get hubspot() {
    return get("hubspot");
  },
  get learningPortal() {
    return get("learningPortal");
  },
  get bigquery() {
    return get("bigquery");
  },
  get gemini() {
    return get("gemini");
  },
  get ses() {
    return get("ses");
  },
  get nxtdial() {
    return get("nxtdial");
  },
  get sheets() {
    return get("sheets");
  },
  get meet() {
    return get("meet");
  },
};

export function overrideIntegration(name, implementation) {
  instances.set(name, implementation);
}

export function resetIntegrations() {
  instances.clear();
}
