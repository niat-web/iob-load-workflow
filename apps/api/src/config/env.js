import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";
import { BIGQUERY_TABLES } from "./bigqueryTables.js";
import { PORTAL_DEFAULTS, PORTAL_ENVIRONMENTS } from "./learningPortalDefaults.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "../..");
const repoRoot = path.resolve(apiRoot, "../..");

if (process.env.NODE_ENV !== "test") {
  for (const file of [path.join(apiRoot, ".env"), path.join(repoRoot, ".env")]) {
    if (fs.existsSync(file)) dotenv.config({ path: file, quiet: true });
  }
}

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  });

const bool = (fallback) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === "") return fallback;
      return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
    });

const number = (fallback, { min = -Infinity, max = Infinity } = {}) =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value.trim() === "") return fallback;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        ctx.addIssue({ code: "custom", message: `must be a number between ${min} and ${max}` });
        return z.NEVER;
      }
      return parsed;
    });

const list = (fallback = []) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (!value || !value.trim()) return fallback;
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    });

const mode = z
  .string()
  .optional()
  .transform((value) => (value?.trim().toLowerCase() || undefined))
  .pipe(z.enum(["mock", "live"]).optional());

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: number(8000, { min: 1, max: 65535 }),
  PROCESS_ROLE: z.enum(["api", "worker", "all"]).default("api"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),
  LOG_FORMAT: z.enum(["pretty", "json"]).optional(),
  FRONTEND_URL: optionalString,
  CORS_ORIGINS: list(),
  TRUST_PROXY_HOPS: number(1, { min: 0, max: 10 }),

  MONGODB_URI: optionalString,

  JWT_SECRET: optionalString,
  SESSION_SECRET: optionalString,
  SESSION_TTL_HOURS: number(12, { min: 1, max: 24 * 30 }),
  COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
  GOOGLE_CLIENT_ID: optionalString,
  ALLOWED_EMAIL_DOMAINS: list(),
  ALLOW_DEV_LOGIN: bool(true),
  BOOTSTRAP_ADMIN_EMAILS: list(),
  ADMIN_HOME: z.enum(["/crm", "/psm"]).default("/crm"),

  INTEGRATION_MODE: z.enum(["mock", "live"]).default("live"),
  HUBSPOT_MODE: mode,
  LEARNING_PORTAL_MODE: mode,
  BIGQUERY_MODE: mode,
  GEMINI_MODE: mode,
  SES_MODE: mode,
  NXTDIAL_MODE: mode,

  HUBSPOT_DEAL_WEBHOOK_URL: optionalString,
  HUBSPOT_DEAL_WEBHOOK_METHOD: z.enum(["GET", "POST"]).default("POST"),
  HUBSPOT_DEAL_WEBHOOK_API_KEY: optionalString,
  HUBSPOT_DEAL_WEBHOOK_API_KEY_HEADER: z.string().default("x-api-key"),
  HUBSPOT_DEAL_WEBHOOK_TIMEOUT_MS: number(30000, { min: 1000, max: 300000 }),
  HUBSPOT_CLIENT_SECRET: optionalString,
  HUBSPOT_WEBHOOK_URL: optionalString,
  HUBSPOT_UPDATE_DEBOUNCE_SECONDS: number(30, { min: 0, max: 3600 }),
  HUBSPOT_PORTAL_ID: optionalString,
  HUBSPOT_OWNER_MAP_JSON: optionalString,
  HUBSPOT_WRITE_JOB_ID: bool(true),
  HUBSPOT_JOB_ID_PROPERTY: z.string().default("job_id"),
  HUBSPOT_JOB_PIPELINE_IDS: list(),

  LEARNING_PORTAL_TARGETS: list(PORTAL_ENVIRONMENTS),
  LEARNING_PORTAL_ELIGIBILITY_ENV: z.enum(PORTAL_ENVIRONMENTS).default("beta"),
  LEARNING_PORTAL_ACCESS_ENV: z.enum(PORTAL_ENVIRONMENTS).default("prod"),
  LEARNING_PORTAL_BETA_BASE_URL: optionalString,
  LEARNING_PORTAL_BETA_API_KEY: optionalString,
  BETA_API_KEY: optionalString,
  LEARNING_PORTAL_BETA_APPLY_LINK_TEMPLATE: optionalString,
  LEARNING_PORTAL_BETA_TEST_USERS_JSON: optionalString,
  LEARNING_PORTAL_PROD_BASE_URL: optionalString,
  LEARNING_PORTAL_PROD_API_KEY: optionalString,
  PROD_API_KEY: optionalString,
  LEARNING_PORTAL_PROD_APPLY_LINK_TEMPLATE: optionalString,
  LEARNING_PORTAL_PROD_TEST_USERS_JSON: optionalString,
  LEARNING_PORTAL_CLIENT_KEY_DETAILS_ID: optionalString,
  LEARNING_PORTAL_CREATE_ORG_PATH: optionalString,
  LEARNING_PORTAL_CREATE_JOB_PATH: optionalString,
  LEARNING_PORTAL_GRANT_ACCESS_PATH: optionalString,
  LEARNING_PORTAL_ELIGIBLE_USERS_PATH: optionalString,
  LEARNING_PORTAL_JOB_URL_TEMPLATE: optionalString,
  LEARNING_PORTAL_ACCESS_CHUNK_SIZE: number(100, { min: 1, max: 1000 }),
  LEARNING_PORTAL_SHOW_FOR_ALL_ENROLL_PLANS: bool(true),
  LEARNING_PORTAL_TIMEOUT_MS: number(30000, { min: 1000, max: 300000 }),
  LEARNING_PORTAL_RESOLVE_LOGOS: bool(true),

  JOB_LOADING_SHEET_ID: optionalString,
  SHEET_ID: optionalString,
  JOB_LOADING_ORG_WORKSHEET: z.string().default("NIAT Internships"),
  JOB_LOADING_TRACKER_WORKSHEET: z.string().default("Loaded Jobs Tracker"),
  GOOGLE_SHEETS_CREDENTIALS_JSON: optionalString,

  ELIGIBILITY_SOURCE: z.enum(["pool", "learning_portal", "mock"]).optional(),
  ELIGIBILITY_PLACEMENT_STATUSES: list(["To Be Placed", "Placed More Opps", "Placement Support Not Required 2"]),
  ELIGIBILITY_MAX_STUDENTS: number(20000, { min: 1 }),

  BIGQUERY_PROJECT_ID: optionalString,
  BIGQUERY_DATASET: optionalString,
  BIGQUERY_LOCATION: optionalString,
  BIGQUERY_APPLICATIONS_TABLE: optionalString,
  BIGQUERY_STUDENTS_TABLE: optionalString,
  BIGQUERY_POOL_TABLE: optionalString,
  BIGQUERY_GRIT_TABLE: optionalString,
  BIGQUERY_ASSESSMENTS_TABLE: optionalString,
  BIGQUERY_INTERVIEWS_TABLE: optionalString,
  BIGQUERY_COLUMNS_JSON: optionalString,
  GOOGLE_APPLICATION_CREDENTIALS_JSON: optionalString,

  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_CONTENT_MODEL: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_CONCURRENCY: number(4, { min: 1, max: 32 }),
  GEMINI_TIMEOUT_MS: number(60000, { min: 1000 }),

  AWS_REGION: optionalString,
  AWS_ACCESS_KEY_ID: optionalString,
  AWS_SECRET_ACCESS_KEY: optionalString,
  SES_FROM_EMAIL: optionalString,
  SES_CONFIGURATION_SET: optionalString,
  SES_MAX_SEND_RATE: number(10, { min: 1, max: 1000 }),

  NXTDIAL_BASE_URL: z.string().default(""),
  NXTDIAL_API_KEY: optionalString,
  NXTDIAL_AGENT_ID: optionalString,
  NXTDIAL_FROM_NUMBER: optionalString,
  NXTDIAL_CALL_MAX_SECONDS: number(120, { min: 30, max: 600 }),
  NXTDIAL_CALLER_NAME: z.string().default("Priya"),
  NXTDIAL_CALLING_FROM: z.string().default("NxtWave Placements"),
  NXTDIAL_LANGUAGE: z.string().default("English"),
  NXTDIAL_RATING_TEMPLATE: z.string().default("job_application_reminder"),
  NXTDIAL_RESULTS_SYNC_MINUTES: number(3, { min: 1, max: 60 }),
  BOOST_EMAIL_COOLDOWN_MINUTES: number(60, { min: 0, max: 1440 }),
  NXTDIAL_CHUNK_SIZE: number(50, { min: 1, max: 1000 }),
  NXTDIAL_DAILY_REQUEST_LIMIT: number(5000, { min: 1 }),
  NXTDIAL_TIMEOUT_MS: number(30000, { min: 1000 }),

  APPLICATION_WINDOW_HOURS: number(21, { min: 0.001 }),
  REMINDER_ONE_HOURS: number(10, { min: 0.001 }),
  REMINDER_TWO_HOURS: number(20, { min: 0.001 }),
  APPLICATION_COUNT_SYNC_MINUTES: number(30, { min: 0.05 }),
  WORKER_POLL_MS: number(5000, { min: 100 }),
  WORKER_CONCURRENCY: number(4, { min: 1, max: 32 }),
  WORKER_LOCK_TIMEOUT_MINUTES: number(15, { min: 1 }),
  TASK_MAX_ATTEMPTS: number(5, { min: 1, max: 50 }),
  TASK_BACKOFF_MINUTES: list(["1", "5", "15", "30"]),

  PRIORITY_RESUME_WEIGHT: number(40, { min: 0 }),
  PRIORITY_GRIT_WEIGHT: number(25, { min: 0 }),
  PRIORITY_ASSESSMENT_WEIGHT: number(20, { min: 0 }),
  PRIORITY_INTERVIEW_WEIGHT: number(15, { min: 0 }),
  PRIORITY_MISSING_SCORE_STRATEGY: z.enum(["renormalize", "zero"]).default("renormalize"),
  PRIORITY_RECOMMENDED_MIN_SCORE: number(75, { min: 0, max: 100 }),
  PRIORITY_CONSIDER_MIN_SCORE: number(50, { min: 0, max: 100 }),

  PUBLIC_LINK_EXPIRY_DAYS: number(30, { min: 1, max: 365 }),

  RESUME_ALLOWED_HOSTS: list(),
  RESUME_MAX_BYTES: number(10 * 1024 * 1024, { min: 1024 }),
  RESUME_TIMEOUT_MS: number(20000, { min: 1000 }),

  MOCK_CRM_OWNER_EMAIL: z.string().default("crm@example.com"),
  MOCK_SEED_USERS: bool(true),
});

function parseEnv(source) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

function parseCredentials(raw, name = "GOOGLE_APPLICATION_CREDENTIALS_JSON") {
  if (!raw) return undefined;
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${name} must be service-account JSON or its base64 encoding`);
  }
}

function parseTestUsers(raw, defaults, name) {
  if (!raw) return defaults;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  const valid =
    parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
    Object.values(parsed).every((ids) => Array.isArray(ids) && ids.every((id) => typeof id === "string"));
  if (!valid) throw new Error(`${name} must map plan groups to arrays of user IDs`);
  return { ...defaults, ...parsed };
}

function portalEnvironment(env, name) {
  const prefix = `LEARNING_PORTAL_${name.toUpperCase()}`;
  const defaults = PORTAL_DEFAULTS[name];
  return {
    name,
    baseUrl: (env[`${prefix}_BASE_URL`] ?? defaults.baseUrl).replace(/\/+$/, ""),
    apiKey: env[`${prefix}_API_KEY`] ?? env[`${name.toUpperCase()}_API_KEY`],
    applyLinkTemplate: env[`${prefix}_APPLY_LINK_TEMPLATE`] ?? defaults.applyLinkTemplate,
    testUsers: parseTestUsers(env[`${prefix}_TEST_USERS_JSON`], defaults.testUsers, `${prefix}_TEST_USERS_JSON`),
  };
}

function buildConfig(env) {
  const isProduction = env.NODE_ENV === "production";
  const isTest = env.NODE_ENV === "test";
  const modeFor = (override) => override ?? env.INTEGRATION_MODE;
  const frontendUrl = (env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/+$/, "");
  const bigqueryCredentials = parseCredentials(env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

  return {
    env: env.NODE_ENV,
    isProduction,
    isTest,
    port: env.PORT,
    processRole: env.PROCESS_ROLE,
    logLevel: env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
    logFormat: env.LOG_FORMAT ?? (isProduction ? "json" : "pretty"),
    frontendUrl,
    corsOrigins: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : [frontendUrl],
    trustProxyHops: env.TRUST_PROXY_HOPS,
    mongodbUri: env.MONGODB_URI ?? (isProduction ? undefined : "mongodb://127.0.0.1:27017/job_flow"),

    auth: {
      jwtSecret: env.JWT_SECRET ?? (isProduction ? undefined : "development-only-jwt-secret-change-me-now"),
      sessionTtlHours: env.SESSION_TTL_HOURS,
      cookieName: "jf_session",
      cookieSameSite: env.COOKIE_SAMESITE,
      cookieSecure: isProduction || env.COOKIE_SAMESITE === "none",
      googleClientId: env.GOOGLE_CLIENT_ID,
      allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS.map((domain) => domain.toLowerCase()),
      devLoginEnabled: !isProduction && (env.ALLOW_DEV_LOGIN || isTest),
      bootstrapAdminEmails: env.BOOTSTRAP_ADMIN_EMAILS.map((email) => email.toLowerCase()),
      adminHome: env.ADMIN_HOME,
    },

    encryptionSecret:
      env.SESSION_SECRET ?? (isProduction ? undefined : "development-only-session-secret-change-me"),

    integrationMode: env.INTEGRATION_MODE,
    modes: {
      hubspot: modeFor(env.HUBSPOT_MODE),
      learningPortal: modeFor(env.LEARNING_PORTAL_MODE),
      bigquery: modeFor(env.BIGQUERY_MODE),
      gemini: modeFor(env.GEMINI_MODE),
      ses: modeFor(env.SES_MODE),
      nxtdial: modeFor(env.NXTDIAL_MODE),
    },

    hubspot: {
      dealWebhook: {
        url: env.HUBSPOT_DEAL_WEBHOOK_URL,
        method: env.HUBSPOT_DEAL_WEBHOOK_METHOD,
        apiKey: env.HUBSPOT_DEAL_WEBHOOK_API_KEY,
        apiKeyHeader: env.HUBSPOT_DEAL_WEBHOOK_API_KEY_HEADER,
        timeoutMs: env.HUBSPOT_DEAL_WEBHOOK_TIMEOUT_MS,
      },
      clientSecret: env.HUBSPOT_CLIENT_SECRET,
      webhookUrl: env.HUBSPOT_WEBHOOK_URL,
      webhookMaxAgeMs: 5 * 60 * 1000,
      updateDebounceSeconds: env.HUBSPOT_UPDATE_DEBOUNCE_SECONDS,
      portalId: env.HUBSPOT_PORTAL_ID,
      ownerMapJson: env.HUBSPOT_OWNER_MAP_JSON,
      writeJobId: env.HUBSPOT_WRITE_JOB_ID,
      jobIdProperty: env.HUBSPOT_JOB_ID_PROPERTY,
      jobPipelineIds: env.HUBSPOT_JOB_PIPELINE_IDS,
    },

    learningPortal: {
      targets: env.LEARNING_PORTAL_TARGETS.map((target) => target.toLowerCase()),
      eligibilityEnv: env.LEARNING_PORTAL_ELIGIBILITY_ENV,
      accessEnv: env.LEARNING_PORTAL_ACCESS_ENV,
      environments: Object.fromEntries(PORTAL_ENVIRONMENTS.map((name) => [name, portalEnvironment(env, name)])),
      clientKeyDetailsId: env.LEARNING_PORTAL_CLIENT_KEY_DETAILS_ID ?? "1",
      paths: {
        createOrg: env.LEARNING_PORTAL_CREATE_ORG_PATH ?? "/api/nkb_jobs/org_details/create/v1/",
        createJob: env.LEARNING_PORTAL_CREATE_JOB_PATH ?? "/api/nkb_jobs/job_details/create/v1/",
        grantAccess: env.LEARNING_PORTAL_GRANT_ACCESS_PATH ?? "/api/nkb_jobs/user/jobs/create/v1/",
        eligibleUsers:
          env.LEARNING_PORTAL_ELIGIBLE_USERS_PATH ?? "/api/nkb_jobs/jobs/eligible/users/count/get/v1/",
      },
      jobUrlTemplate: env.LEARNING_PORTAL_JOB_URL_TEMPLATE,
      accessChunkSize: env.LEARNING_PORTAL_ACCESS_CHUNK_SIZE,
      showForAllInEnrollPlans: env.LEARNING_PORTAL_SHOW_FOR_ALL_ENROLL_PLANS,
      timeoutMs: env.LEARNING_PORTAL_TIMEOUT_MS,
      resolveLogos: env.LEARNING_PORTAL_RESOLVE_LOGOS,
    },

    jobLoadingSheet: {
      sheetId: env.JOB_LOADING_SHEET_ID ?? env.SHEET_ID,
      orgWorksheet: env.JOB_LOADING_ORG_WORKSHEET,
      trackerWorksheet: env.JOB_LOADING_TRACKER_WORKSHEET,
      credentials:
        parseCredentials(env.GOOGLE_SHEETS_CREDENTIALS_JSON, "GOOGLE_SHEETS_CREDENTIALS_JSON") ?? bigqueryCredentials,
    },

    eligibility: {
      source: env.ELIGIBILITY_SOURCE ?? "pool",
      placementStatuses: env.ELIGIBILITY_PLACEMENT_STATUSES,
      maxStudents: env.ELIGIBILITY_MAX_STUDENTS,
    },

    bigquery: {
      projectId: env.BIGQUERY_PROJECT_ID ?? bigqueryCredentials?.project_id,
      dataset: env.BIGQUERY_DATASET,
      location: env.BIGQUERY_LOCATION,
      credentials: bigqueryCredentials,
      tables: {
        applications: env.BIGQUERY_APPLICATIONS_TABLE ?? (BIGQUERY_TABLES.applications || undefined),
        students: env.BIGQUERY_STUDENTS_TABLE ?? (BIGQUERY_TABLES.students || undefined),
        grit: env.BIGQUERY_GRIT_TABLE ?? (BIGQUERY_TABLES.grit || undefined),
        assessments: env.BIGQUERY_ASSESSMENTS_TABLE ?? (BIGQUERY_TABLES.assessments || undefined),
        interviews: env.BIGQUERY_INTERVIEWS_TABLE ?? (BIGQUERY_TABLES.interviews || undefined),
        pool: env.BIGQUERY_POOL_TABLE ?? (BIGQUERY_TABLES.pool || undefined),
      },
      columnsJson: env.BIGQUERY_COLUMNS_JSON,
    },

    gemini: {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
      contentModel: env.GEMINI_CONTENT_MODEL,
      concurrency: env.GEMINI_CONCURRENCY,
      timeoutMs: env.GEMINI_TIMEOUT_MS,
    },

    ses: {
      region: env.AWS_REGION ?? "ap-south-1",
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      fromEmail: env.SES_FROM_EMAIL,
      configurationSet: env.SES_CONFIGURATION_SET,
      maxSendRate: env.SES_MAX_SEND_RATE,
    },

    nxtdial: {
      baseUrl: env.NXTDIAL_BASE_URL.replace(/\/+$/, ""),
      apiKey: env.NXTDIAL_API_KEY,
      agentId: env.NXTDIAL_AGENT_ID,
      fromNumber: env.NXTDIAL_FROM_NUMBER,
      callMaxSeconds: env.NXTDIAL_CALL_MAX_SECONDS,
      callerName: env.NXTDIAL_CALLER_NAME,
      callingFrom: env.NXTDIAL_CALLING_FROM,
      language: env.NXTDIAL_LANGUAGE,
      ratingTemplate: env.NXTDIAL_RATING_TEMPLATE,
      resultsSyncMinutes: env.NXTDIAL_RESULTS_SYNC_MINUTES,
      boostEmailCooldownMinutes: env.BOOST_EMAIL_COOLDOWN_MINUTES,
      chunkSize: env.NXTDIAL_CHUNK_SIZE,
      dailyRequestLimit: env.NXTDIAL_DAILY_REQUEST_LIMIT,
      timeoutMs: env.NXTDIAL_TIMEOUT_MS,
    },

    workflow: {
      applicationWindowHours: env.APPLICATION_WINDOW_HOURS,
      reminderOneHours: env.REMINDER_ONE_HOURS,
      reminderTwoHours: env.REMINDER_TWO_HOURS,
      countSyncMinutes: env.APPLICATION_COUNT_SYNC_MINUTES,
      workerPollMs: env.WORKER_POLL_MS,
      workerConcurrency: env.WORKER_CONCURRENCY,
      lockTimeoutMs: env.WORKER_LOCK_TIMEOUT_MINUTES * 60 * 1000,
      maxAttempts: env.TASK_MAX_ATTEMPTS,
      backoffMinutes: env.TASK_BACKOFF_MINUTES.map(Number).filter((n) => Number.isFinite(n) && n >= 0),
    },

    priority: {
      weights: {
        resume: env.PRIORITY_RESUME_WEIGHT,
        grit: env.PRIORITY_GRIT_WEIGHT,
        assessment: env.PRIORITY_ASSESSMENT_WEIGHT,
        interview: env.PRIORITY_INTERVIEW_WEIGHT,
      },
      missingScoreStrategy: env.PRIORITY_MISSING_SCORE_STRATEGY,
      recommendedMinScore: env.PRIORITY_RECOMMENDED_MIN_SCORE,
      considerMinScore: env.PRIORITY_CONSIDER_MIN_SCORE,
    },

    publicLinks: {
      expiryDays: env.PUBLIC_LINK_EXPIRY_DAYS,
    },

    resume: {
      allowedHosts: env.RESUME_ALLOWED_HOSTS.map((host) => host.toLowerCase()),
      maxBytes: env.RESUME_MAX_BYTES,
      timeoutMs: env.RESUME_TIMEOUT_MS,
    },

    mock: {
      crmOwnerEmail: env.MOCK_CRM_OWNER_EMAIL,
      seedUsers: env.MOCK_SEED_USERS,
    },
  };
}

export const INTEGRATION_LABELS = {
  hubspot: "HubSpot",
  learningPortal: "Learning Portal",
  bigquery: "BigQuery",
  gemini: "Gemini",
  ses: "AWS SES",
  nxtdial: "NxtDial",
};

export function missingIntegrationSettings(cfg = config) {
  const missing = {};
  const add = (name, key, present) => {
    if (cfg.modes[name] === "live" && !present) (missing[name] ??= []).push(key);
  };
  add("hubspot", "HUBSPOT_DEAL_WEBHOOK_URL", cfg.hubspot.dealWebhook.url);
  const portal = cfg.learningPortal;
  for (const name of new Set([...portal.targets, portal.eligibilityEnv, portal.accessEnv])) {
    const environment = portal.environments[name];
    if (!environment) continue;
    add("learningPortal", `LEARNING_PORTAL_${name.toUpperCase()}_BASE_URL`, environment.baseUrl);
    add("learningPortal", `${name.toUpperCase()}_API_KEY`, environment.apiKey);
  }
  const tableParts = String(cfg.bigquery.tables.applications ?? "").split(".").length;
  add("bigquery", "GOOGLE_APPLICATION_CREDENTIALS_JSON", cfg.bigquery.credentials);
  add("bigquery", "the applications table name in apps/api/src/config/bigqueryTables.js", cfg.bigquery.tables.applications);
  if (cfg.bigquery.tables.applications) {
    add("bigquery", "BIGQUERY_PROJECT_ID", cfg.bigquery.projectId || tableParts === 3);
    add("bigquery", "BIGQUERY_DATASET", cfg.bigquery.dataset || tableParts > 1);
  }
  add("gemini", "GEMINI_API_KEY", cfg.gemini.apiKey);
  add("ses", "SES_FROM_EMAIL", cfg.ses.fromEmail);
  add("ses", "AWS_REGION", cfg.ses.region);
  add("nxtdial", "NXTDIAL_BASE_URL", cfg.nxtdial.baseUrl);
  add("nxtdial", "NXTDIAL_API_KEY", cfg.nxtdial.apiKey);
  add("nxtdial", "NXTDIAL_FROM_NUMBER", cfg.nxtdial.fromNumber);
  return missing;
}

export function collectConfigProblems(cfg) {
  const problems = [];
  const need = (condition, message) => {
    if (!condition) problems.push(message);
  };

  if (cfg.isProduction) {
    need(cfg.mongodbUri, "MONGODB_URI is required in production");
    need(cfg.auth.jwtSecret && cfg.auth.jwtSecret.length >= 32, "JWT_SECRET must be at least 32 characters");
    need(cfg.encryptionSecret && cfg.encryptionSecret.length >= 32, "SESSION_SECRET must be at least 32 characters");
    need(!cfg.frontendUrl.startsWith("http://localhost"), "FRONTEND_URL must be the deployed frontend origin");
    need(cfg.auth.googleClientId, "GOOGLE_CLIENT_ID is required in production");
    for (const [name, value] of Object.entries(cfg.modes)) {
      need(value === "live", `${name} integration cannot run in mock mode in production (set INTEGRATION_MODE=live)`);
    }
  }

  const { modes } = cfg;
  for (const [name, keys] of Object.entries(missingIntegrationSettings(cfg))) {
    problems.push(`${INTEGRATION_LABELS[name]} is not set up: add ${keys.join(", ")}`);
  }
  if (cfg.auth.googleClientId) {
    need(
      /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(cfg.auth.googleClientId),
      "GOOGLE_CLIENT_ID must be the OAuth Client ID, e.g. 1234567890-abc123.apps.googleusercontent.com",
    );
  }

  const portal = cfg.learningPortal;
  const unknownTargets = portal.targets.filter((target) => !PORTAL_ENVIRONMENTS.includes(target));
  need(!unknownTargets.length, `LEARNING_PORTAL_TARGETS may only contain ${PORTAL_ENVIRONMENTS.join(", ")}`);
  need(portal.targets.length > 0, "LEARNING_PORTAL_TARGETS needs at least one of beta, prod");
  need(
    portal.targets.includes(portal.accessEnv),
    "LEARNING_PORTAL_ACCESS_ENV must be one of LEARNING_PORTAL_TARGETS (students get access where the job is loaded)",
  );
  if (cfg.jobLoadingSheet.sheetId) {
    need(
      cfg.jobLoadingSheet.credentials,
      "JOB_LOADING_SHEET_ID needs GOOGLE_SHEETS_CREDENTIALS_JSON (or GOOGLE_APPLICATION_CREDENTIALS_JSON) with access to the sheet",
    );
  }
  if (cfg.eligibility.source === "learning_portal") {
    need(modes.learningPortal === "live", "ELIGIBILITY_SOURCE=learning_portal requires the Learning Portal to be live");
  }
  if (cfg.eligibility.source === "mock") {
    need(!cfg.isProduction, "ELIGIBILITY_SOURCE=mock is not allowed in production");
  }
  const weights = Object.values(cfg.priority.weights);
  need(
    weights.some((weight) => weight > 0),
    "At least one PRIORITY_*_WEIGHT must be greater than 0",
  );
  need(
    cfg.workflow.reminderOneHours < cfg.workflow.reminderTwoHours &&
      cfg.workflow.reminderTwoHours < cfg.workflow.applicationWindowHours,
    "REMINDER_ONE_HOURS < REMINDER_TWO_HOURS < APPLICATION_WINDOW_HOURS must hold",
  );
  return problems;
}

export const config = buildConfig(parseEnv(process.env));
