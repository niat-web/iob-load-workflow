import fs from "node:fs";

for (const key of Object.keys(process.env)) {
  if (key.startsWith("HUBSPOT_PROP_") || key.endsWith("_MODE")) delete process.env[key];
}

Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  INTEGRATION_MODE: "mock",
  FRONTEND_URL: "http://localhost:5173",
  JWT_SECRET: "test-jwt-secret-with-enough-length-1234567890",
  SESSION_SECRET: "test-session-secret-with-enough-length-123456",
  HUBSPOT_CLIENT_SECRET: "test-hubspot-client-secret",
  HUBSPOT_WEBHOOK_URL: "https://jobflow.test/api/webhooks/hubspot",
  HUBSPOT_UPDATE_DEBOUNCE_SECONDS: "0",
  ELIGIBILITY_SOURCE: "mock",
  APPLICATION_WINDOW_HOURS: "21",
  REMINDER_ONE_HOURS: "10",
  REMINDER_TWO_HOURS: "20",
  APPLICATION_COUNT_SYNC_MINUTES: "30",
  NXTDIAL_CHUNK_SIZE: "5",
  NXTDIAL_BASE_URL: "https://nxtdial.test",
  LEARNING_PORTAL_BETA_BASE_URL: "https://portal-beta.test",
  LEARNING_PORTAL_PROD_BASE_URL: "https://portal-prod.test",
  LEARNING_PORTAL_BETA_APPLY_LINK_TEMPLATE: "https://apply-beta.test/form/company-opportunity?company={company}&job_id={jobId}",
  LEARNING_PORTAL_PROD_APPLY_LINK_TEMPLATE: "https://apply.test/form/company-opportunity?company={company}&job_id={jobId}",
  LEARNING_PORTAL_BETA_TEST_USERS_JSON: JSON.stringify({ INTENSIVE: ["beta-test-1", "beta-test-2"], ACADEMY: ["beta-test-3"] }),
  LEARNING_PORTAL_PROD_TEST_USERS_JSON: JSON.stringify({ INTENSIVE: ["prod-test-1"] }),
  GEMINI_CONCURRENCY: "4",
  MOCK_SEED_USERS: "false",
  MOCK_CRM_OWNER_EMAIL: "owner.crm@example.com",
  TASK_MAX_ATTEMPTS: "3",
  HUBSPOT_OWNER_MAP_JSON: fs.readFileSync(new URL("../src/data/hubspotOwnerMap.example.json", import.meta.url), "utf8"),
  GOOGLE_CLIENT_ID: "1234567890-testclient.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-google-client-secret",
});
