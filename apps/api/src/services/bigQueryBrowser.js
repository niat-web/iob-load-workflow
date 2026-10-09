import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { BigQuery } from "@google-cloud/bigquery";
import { config } from "../config/env.js";
import { CSV_BOM, csvLine } from "../utils/csv.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const COUNT_TTL_MS = 5 * 60 * 1000;
const MAX_CELL_CHARS = 2000;

let createClient = () =>
  new BigQuery({
    projectId: config.bigquery.projectId,
    credentials: config.bigquery.credentials,
    location: config.bigquery.location,
  });
let client = null;
const countCache = new Map();

export function setBigQueryBrowserClient(factory) {
  createClient = factory;
  client = null;
  countCache.clear();
}

function bigquery() {
  if (!config.bigquery.credentials || !config.bigquery.projectId) {
    throw new AppError(503, "BIGQUERY_NOT_CONFIGURED", "BigQuery is not set up: add GOOGLE_APPLICATION_CREDENTIALS_JSON to apps/api/.env");
  }
  client ??= createClient();
  return client;
}

function bigQueryError(error, what) {
  if (error instanceof AppError) return error;
  const status = Number(error?.code);
  const message = String(error?.message ?? error).slice(0, 300);
  if (status === 404) return new AppError(404, "NOT_FOUND", `${what} was not found`);
  if (status === 403) return new AppError(403, "BIGQUERY_FORBIDDEN", `BigQuery refused access: ${message}`);
  return new AppError(502, "BIGQUERY_FAILED", `BigQuery ${what.toLowerCase()} failed: ${message}`);
}

function cell(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  if (typeof value === "object" && "value" in value && Object.keys(value).length === 1) return cell(value.value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") {
    const text = typeof value.toJSON === "function" ? value.toJSON() : value;
    return typeof text === "string" ? text : JSON.stringify(text).slice(0, MAX_CELL_CHARS);
  }
  if (typeof value === "string" && value.length > MAX_CELL_CHARS) return `${value.slice(0, MAX_CELL_CHARS)}…`;
  return value;
}

const columnsOf = (metadata) =>
  (metadata?.schema?.fields ?? []).map((field) => ({ name: field.name, type: field.type, mode: field.mode ?? "NULLABLE" }));

export async function listDatasets() {
  const bq = bigquery();
  try {
    const [datasets] = await bq.getDatasets();
    return {
      projectId: config.bigquery.projectId,
      datasets: datasets.map((dataset) => ({ id: dataset.id, location: dataset.metadata?.location ?? null })),
    };
  } catch (error) {
    throw bigQueryError(error, "Listing datasets");
  }
}

export async function listTables(datasetId) {
  const bq = bigquery();
  let tables;
  try {
    [tables] = await bq.dataset(datasetId).getTables();
  } catch (error) {
    throw bigQueryError(error, `Dataset ${datasetId}`);
  }
  const details = await Promise.all(
    tables.map(async (table) => {
      try {
        const [metadata] = await table.getMetadata();
        return {
          id: table.id,
          type: metadata.type ?? null,
          rowCount: metadata.type === "TABLE" ? Number(metadata.numRows ?? 0) : null,
          columns: columnsOf(metadata),
          updatedAt: metadata.lastModifiedTime ? new Date(Number(metadata.lastModifiedTime)).toISOString() : null,
        };
      } catch {
        return { id: table.id, type: table.metadata?.type ?? null, rowCount: null, columns: [], updatedAt: null };
      }
    }),
  );
  return { datasetId, tables: details.sort((a, b) => a.id.localeCompare(b.id)) };
}

async function countRows(bq, ref, key) {
  const cached = countCache.get(key);
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.total;
  const [rows] = await bq.query({ query: `SELECT COUNT(*) AS total FROM ${ref}`, location: config.bigquery.location });
  const total = Number(cell(rows[0]?.total) ?? 0);
  countCache.set(key, { total, at: Date.now() });
  return total;
}

export async function readTableRows(datasetId, tableId, { page, limit }) {
  const bq = bigquery();
  const ref = `\`${config.bigquery.projectId}.${datasetId}.${tableId}\``;
  let metadata;
  try {
    [metadata] = await bq.dataset(datasetId).table(tableId).getMetadata();
  } catch (error) {
    throw bigQueryError(error, `Table ${datasetId}.${tableId}`);
  }
  const columns = columnsOf(metadata);
  try {
    const [total, [rows]] = await Promise.all([
      countRows(bq, ref, `${datasetId}.${tableId}`),
      bq.query({
        query: `SELECT * FROM ${ref} LIMIT @limit OFFSET @offset`,
        params: { limit, offset: (page - 1) * limit },
        location: config.bigquery.location,
      }),
    ]);
    return {
      datasetId,
      tableId,
      type: metadata.type ?? null,
      columns,
      rows: rows.map((row) => Object.fromEntries(columns.map((column) => [column.name, cell(row[column.name])]))),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  } catch (error) {
    throw bigQueryError(error, `Reading ${datasetId}.${tableId}`);
  }
}

/** Full, untruncated text of a BigQuery value for CSV. */
function exportValue(value) {
  if (value === null || value === undefined) return "";
  if (Buffer.isBuffer(value)) return value.toString("base64");
  if (typeof value === "object" && "value" in value && Object.keys(value).length === 1) return exportValue(value.value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const text = typeof value.toJSON === "function" ? value.toJSON() : value;
    return typeof text === "string" ? text : JSON.stringify(text);
  }
  return String(value);
}

/**
 * Streams every row of a table or view to `res` as a CSV download. Rows are written as BigQuery
 * returns them, so large tables never sit in memory. Problems found before the first byte (missing
 * table, no access, bad query) become normal JSON errors; a failure mid-download ends the response.
 */
export async function streamTableCsv(datasetId, tableId, res) {
  const bq = bigquery();
  let metadata;
  try {
    [metadata] = await bq.dataset(datasetId).table(tableId).getMetadata();
  } catch (error) {
    throw bigQueryError(error, `Table ${datasetId}.${tableId}`);
  }
  const names = columnsOf(metadata).map((column) => column.name);
  const ref = `\`${config.bigquery.projectId}.${datasetId}.${tableId}\``;
  let job;
  try {
    [job] = await bq.createQueryJob({ query: `SELECT * FROM ${ref}`, location: config.bigquery.location });
  } catch (error) {
    throw bigQueryError(error, `Exporting ${datasetId}.${tableId}`);
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${tableId}.csv"`);
  res.setHeader("Cache-Control", "no-store");
  res.write(`${CSV_BOM}${csvLine(names)}`);

  const toCsv = new Transform({
    writableObjectMode: true,
    transform(row, _encoding, done) {
      done(null, csvLine(names.map((name) => exportValue(row[name]))));
    },
  });
  try {
    await pipeline(job.getQueryResultsStream(), toCsv, res);
  } catch (error) {
    // Headers are already sent, so the only signal left is to cut the download short.
    if (error?.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      logger.error({ err: error, table: `${datasetId}.${tableId}` }, "BigQuery CSV export failed mid-download");
    }
    res.destroy(error);
  }
}
