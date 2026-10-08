import { config } from "./env.js";

const DEFAULT_COLUMNS = {
  students: {
    studentId: "user_id",
    studentName: "name",
    email: "email",
    mobile: "phone",
    campus: "campus",
    batch: "passout_year",
    program: "enroll_plan_version_tag",
    placementStatus: "placement_status",
  },
  pool: {
    studentId: "user_id",
    studentName: "fullName",
    email: "email_id",
    mobile: "mobile_number",
    product: "product",
  },
  grit: {
    studentId: "user_id",
    skill: "skill",
    score: "score",
  },
  assessments: {
    studentId: "user_id",
    score: "score",
  },
  interviews: {
    studentId: "user_id",
    score: "score",
  },
};

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TABLE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+){0,2}$/;

function parseOverrides(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("BIGQUERY_COLUMNS_JSON is not valid JSON");
  }
}

function buildColumns() {
  const overrides = parseOverrides(config.bigquery.columnsJson);
  const columns = {};
  for (const [table, defaults] of Object.entries(DEFAULT_COLUMNS)) {
    columns[table] = { ...defaults, ...overrides[table] };
    for (const [field, column] of Object.entries(columns[table])) {
      if (!IDENTIFIER.test(column)) {
        throw new Error(`BigQuery column for ${table}.${field} is not a valid identifier: ${column}`);
      }
    }
  }
  return columns;
}

export const bigQueryColumns = buildColumns();

export function tableRef(logicalName) {
  const table = config.bigquery.tables[logicalName];
  if (!table) return null;
  if (!TABLE.test(table)) throw new Error(`Invalid BigQuery table name for ${logicalName}: ${table}`);
  const parts = table.split(".");
  if (parts.length === 3) return `\`${table}\``;
  if (parts.length === 2) return `\`${config.bigquery.projectId}.${table}\``;
  return `\`${config.bigquery.projectId}.${config.bigquery.dataset}.${table}\``;
}
