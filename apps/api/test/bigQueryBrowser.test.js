import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { config } from "../src/config/env.js";
import { setBigQueryBrowserClient } from "../src/services/bigQueryBrowser.js";
import { loginAs, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const SCHEMA = {
  fields: [
    { name: "user_id", type: "STRING" },
    { name: "applied_datetime", type: "DATETIME" },
    { name: "score", type: "FLOAT" },
  ],
};

function fakeBigQuery(queries) {
  return {
    getDatasets: async () => [[{ id: "placement", metadata: { location: "asia-south1" } }]],
    dataset: (datasetId) => ({
      getTables: async () => {
        if (datasetId !== "placement") throw Object.assign(new Error("Not found: Dataset"), { code: 404 });
        return [[{ id: "applications", getMetadata: async () => [{ type: "VIEW", schema: SCHEMA }] }]];
      },
      table: () => ({ getMetadata: async () => [{ type: "VIEW", schema: SCHEMA }] }),
    }),
    createQueryJob: async (options) => {
      queries.push(options);
      return [
        {
          getQueryResultsStream: () =>
            Readable.from([
              { user_id: "u1", applied_datetime: { value: "2026-10-01T10:00:00" }, score: 81.5 },
              { user_id: 'say "hi", ok', applied_datetime: null, score: 0 },
              { user_id: "=HYPERLINK(1)", applied_datetime: { value: "2026-10-02T09:30:00" }, score: 70 },
            ]),
        },
      ];
    },
    query: async (options) => {
      queries.push(options);
      if (options.query.includes("COUNT(*)")) return [[{ total: 120 }]];
      return [[{ user_id: "u1", applied_datetime: { value: "2026-10-01T10:00:00" }, score: 81.5 }]];
    },
  };
}

describe("BigQuery browser (admin settings)", () => {
  let adminAgent;
  let queries;
  const saved = { credentials: config.bigquery.credentials, projectId: config.bigquery.projectId };
  before(startTestDb);
  after(async () => {
    Object.assign(config.bigquery, saved);
    setBigQueryBrowserClient(null);
    await stopTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    queries = [];
    Object.assign(config.bigquery, { credentials: { client_email: "test@example.com" }, projectId: "test-project" });
    setBigQueryBrowserClient(() => fakeBigQuery(queries));
    adminAgent = await loginAs("asha.verma@example.com", "ADMIN");
  });

  test("an admin lists datasets, then a dataset's tables with their columns", async () => {
    const datasets = await adminAgent.get("/api/admin/bigquery/datasets");
    assert.equal(datasets.status, 200);
    assert.deepEqual(datasets.body, { projectId: "test-project", datasets: [{ id: "placement", location: "asia-south1" }] });

    const tables = await adminAgent.get("/api/admin/bigquery/datasets/placement/tables");
    assert.equal(tables.status, 200);
    assert.equal(tables.body.tables[0].id, "applications");
    assert.equal(tables.body.tables[0].type, "VIEW");
    assert.deepEqual(tables.body.tables[0].columns.map((column) => column.name), ["user_id", "applied_datetime", "score"]);

    assert.equal((await adminAgent.get("/api/admin/bigquery/datasets/missing/tables")).status, 404);
  });

  test("table rows come back one page at a time with plain values and the total", async () => {
    const response = await adminAgent
      .get("/api/admin/bigquery/datasets/placement/tables/applications/rows")
      .query({ page: 3, limit: 50 });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.rows, [{ user_id: "u1", applied_datetime: "2026-10-01T10:00:00", score: 81.5 }]);
    assert.deepEqual(response.body.pagination, { page: 3, limit: 50, total: 120, totalPages: 3 });
    const pageQuery = queries.find((options) => options.query.includes("LIMIT"));
    assert.deepEqual(pageQuery.params, { limit: 50, offset: 100 });
    assert.match(pageQuery.query, /`test-project\.placement\.applications`/);
  });

  test("export downloads every row of the clicked table as CSV", async () => {
    const response = await adminAgent
      .get("/api/admin/bigquery/datasets/placement/tables/applications/export")
      .buffer(true)
      .parse((res, done) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (part) => (text += part));
        res.on("end", () => done(null, text));
      });
    assert.equal(response.status, 200);
    assert.match(response.headers["content-type"], /^text\/csv/);
    assert.match(response.headers["content-disposition"], /attachment; filename="applications\.csv"/);
    assert.equal(
      response.body,
      "\uFEFFuser_id,applied_datetime,score\r\n" +
        "u1,2026-10-01T10:00:00,81.5\r\n" +
        '"say ""hi"", ok",,0\r\n' +
        "'=HYPERLINK(1),2026-10-02T09:30:00,70\r\n",
    );
    const exportQuery = queries.find((options) => options.query.startsWith("SELECT * FROM") && !options.query.includes("LIMIT"));
    assert.match(exportQuery.query, /`test-project\.placement\.applications`$/);

    for (const role of ["CRM", "PSM"]) {
      const agent = await loginAs(`${role.toLowerCase()}.export@example.com`, role);
      assert.equal((await agent.get("/api/admin/bigquery/datasets/placement/tables/applications/export")).status, 403);
    }
  });

  test("unsafe names are refused and other roles cannot browse BigQuery", async () => {
    assert.equal((await adminAgent.get("/api/admin/bigquery/datasets/bad%60name/tables")).status, 400);
    for (const role of ["CRM", "PSM"]) {
      const agent = await loginAs(`${role.toLowerCase()}.user@example.com`, role);
      assert.equal((await agent.get("/api/admin/bigquery/datasets")).status, 403);
    }
  });

  test("without the service account key the page says BigQuery is not set up", async () => {
    config.bigquery.credentials = undefined;
    const response = await adminAgent.get("/api/admin/bigquery/datasets");
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "BIGQUERY_NOT_CONFIGURED");
  });
});
