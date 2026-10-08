import { BigQuery } from "@google-cloud/bigquery";
import { config } from "../config/env.js";
import { bigQueryColumns as C, tableRef } from "../config/bigquery.js";
import { Job } from "../models/index.js";
import { now } from "../utils/clock.js";
import { IntegrationError } from "../utils/errors.js";
import { chunk } from "../utils/helpers.js";
import { mockAppliedCount, mockEligibleCount, mockScores, mockStudents } from "./mock/mockData.js";

const ID_CHUNK = 10000;

function toIso(value) {
  if (!value) return null;
  const raw = value.value ?? value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function wrapError(error, what) {
  const status = Number(error?.code);
  const reason = error?.errors?.[0]?.reason;
  const retryable = !status || status === 429 || status >= 500 || ["rateLimitExceeded", "backendError"].includes(reason);
  return new IntegrationError(`BigQuery ${what} failed: ${error?.message ?? error}`, {
    integration: "bigquery",
    status,
    retryable,
    cause: error,
  });
}

class LiveBigQueryRepository {
  constructor() {
    this.client = new BigQuery({
      projectId: config.bigquery.projectId,
      credentials: config.bigquery.credentials,
      location: config.bigquery.location,
    });
  }

  async query(sql, params, what) {
    try {
      const [rows] = await this.client.query({ query: sql, params, location: config.bigquery.location });
      return rows;
    } catch (error) {
      throw wrapError(error, what);
    }
  }

  requireTable(name) {
    const ref = tableRef(name);
    if (!ref) {
      throw new IntegrationError(`The BigQuery "${name}" table name is not set in apps/api/src/config/bigqueryTables.js`, {
        integration: "bigquery",
        retryable: false,
      });
    }
    return ref;
  }

  async readPool(onRows, pageSize = 5000) {
    const columns = Object.entries(C.pool)
      .map(([field, column]) => `${column} AS ${field}`)
      .join(", ");
    const sql = `SELECT ${columns} FROM ${this.requireTable("pool")}`;
    let job;
    try {
      [job] = await this.client.createQueryJob({ query: sql, location: config.bigquery.location });
    } catch (error) {
      throw wrapError(error, "eligible pool read");
    }
    let pageToken;
    do {
      let rows;
      let next;
      try {
        [rows, next] = await job.getQueryResults({ maxResults: pageSize, pageToken, autoPaginate: false });
      } catch (error) {
        throw wrapError(error, "eligible pool read");
      }
      await onRows(rows);
      pageToken = next?.pageToken;
    } while (pageToken);
  }

  applicantSelect() {
    const a = C.applications;
    return `CAST(${a.studentId} AS STRING) AS studentId, ${a.studentName} AS studentName, ${a.email} AS email,
      CAST(${a.mobile} AS STRING) AS mobile, ${a.campus} AS campus, CAST(${a.batch} AS STRING) AS batch,
      ${a.program} AS program, ${a.resumeUrl} AS resumeUrl, ${a.appliedAt} AS appliedAt`;
  }

  async getApplicationCount(jobId) {
    const a = C.applications;
    const rows = await this.query(
      `SELECT COUNT(DISTINCT CAST(${a.studentId} AS STRING)) AS count
       FROM ${this.requireTable("applications")} WHERE CAST(${a.jobId} AS STRING) = @jobId`,
      { jobId: String(jobId) },
      "application count",
    );
    return Number(rows[0]?.count ?? 0);
  }

  async getApplicants(jobId) {
    const a = C.applications;
    const rows = await this.query(
      `SELECT ${this.applicantSelect()}
       FROM ${this.requireTable("applications")}
       WHERE CAST(${a.jobId} AS STRING) = @jobId
       QUALIFY ROW_NUMBER() OVER (PARTITION BY CAST(${a.studentId} AS STRING) ORDER BY ${a.appliedAt} DESC) = 1`,
      { jobId: String(jobId) },
      "applicant list",
    );
    return rows.map((row) => ({ ...row, appliedAt: toIso(row.appliedAt) }));
  }

  async getApplicant(studentId, jobId) {
    const a = C.applications;
    const rows = await this.query(
      `SELECT ${this.applicantSelect()} FROM ${this.requireTable("applications")}
       WHERE CAST(${a.jobId} AS STRING) = @jobId AND CAST(${a.studentId} AS STRING) = @studentId
       ORDER BY ${a.appliedAt} DESC LIMIT 1`,
      { jobId: String(jobId), studentId: String(studentId) },
      "applicant lookup",
    );
    return rows[0] ? { ...rows[0], appliedAt: toIso(rows[0].appliedAt) } : null;
  }

  async averageScores(tableName, columns, studentIds, what) {
    const result = new Map();
    const ref = tableRef(tableName);
    if (!ref || !studentIds.length) return result;
    for (const ids of chunk(studentIds.map(String), ID_CHUNK)) {
      const rows = await this.query(
        `SELECT CAST(${columns.studentId} AS STRING) AS studentId, AVG(SAFE_CAST(${columns.score} AS FLOAT64)) AS score
         FROM ${ref} WHERE CAST(${columns.studentId} AS STRING) IN UNNEST(@ids) GROUP BY 1`,
        { ids },
        what,
      );
      for (const row of rows) if (row.score !== null) result.set(row.studentId, Number(row.score));
    }
    return result;
  }

  getAssessmentScores(studentIds) {
    return this.averageScores("assessments", C.assessments, studentIds, "assessment scores");
  }

  getInterviewScores(studentIds) {
    return this.averageScores("interviews", C.interviews, studentIds, "interview scores");
  }

  async getGritScores(studentIds) {
    const result = new Map();
    const ref = tableRef("grit");
    if (!ref || !studentIds.length) return result;
    const g = C.grit;
    for (const ids of chunk(studentIds.map(String), ID_CHUNK)) {
      const rows = await this.query(
        `SELECT CAST(${g.studentId} AS STRING) AS studentId, CAST(${g.skill} AS STRING) AS skill,
                AVG(SAFE_CAST(${g.score} AS FLOAT64)) AS score
         FROM ${ref} WHERE CAST(${g.studentId} AS STRING) IN UNNEST(@ids) GROUP BY 1, 2`,
        { ids },
        "GRIT scores",
      );
      for (const row of rows) {
        if (row.score === null) continue;
        const list = result.get(row.studentId) ?? [];
        list.push({ skill: row.skill, score: Number(row.score) });
        result.set(row.studentId, list);
      }
    }
    return result;
  }

  studentSelect() {
    const s = C.students;
    return `CAST(${s.studentId} AS STRING) AS studentId, ${s.studentName} AS studentName, ${s.email} AS email,
      CAST(${s.mobile} AS STRING) AS mobile, ${s.campus} AS campus, CAST(${s.batch} AS STRING) AS batch,
      ${s.program} AS program`;
  }

  async getStudentsByIds(studentIds) {
    const ref = tableRef("students");
    if (!ref || !studentIds.length) return [];
    const s = C.students;
    const students = [];
    for (const ids of chunk(studentIds.map(String), ID_CHUNK)) {
      students.push(
        ...(await this.query(
          `SELECT ${this.studentSelect()} FROM ${ref} WHERE CAST(${s.studentId} AS STRING) IN UNNEST(@ids)`,
          { ids },
          "student lookup",
        )),
      );
    }
    return students;
  }
}

const MOCK_SKILLS = [
  "React JS", "Node JS", "SQL", "Python", "Django", "Java", "Springboot", "JavaScript", "Typescript",
  "Manual Testing", "Automation Testing", "Selenium",
];

class MockBigQueryRepository {
  async jobFor(learningPortalJobId) {
    return Job.findOne({ learningPortalJobId }).lean();
  }

  population(job) {
    const count = mockEligibleCount(job.hubspotDealId, job.expectedPoolCount);
    return mockStudents(job.hubspotDealId, count);
  }

  windowFraction(job) {
    if (!job.applicationStartAt || !job.applicationEndAt) return 0;
    const span = job.applicationEndAt.getTime() - job.applicationStartAt.getTime();
    return (now().getTime() - job.applicationStartAt.getTime()) / span;
  }

  async getApplicants(learningPortalJobId) {
    const job = await this.jobFor(learningPortalJobId);
    if (!job) return [];
    const students = this.population(job);
    const applied = mockAppliedCount(job.hubspotDealId, students.length, job.expectedPoolCount, this.windowFraction(job));
    const start = job.applicationStartAt?.getTime() ?? now().getTime();
    return students.slice(0, applied).map((student, index) => ({
      ...student,
      resumeUrl: index % 11 === 10 ? null : `mock://resume/${student.studentId}`,
      appliedAt: new Date(start + (index + 1) * 60 * 1000),
    }));
  }

  async getApplicationCount(learningPortalJobId) {
    return (await this.getApplicants(learningPortalJobId)).length;
  }

  async getApplicant(studentId, learningPortalJobId) {
    return (await this.getApplicants(learningPortalJobId)).find((a) => a.studentId === studentId) ?? null;
  }

  async getAssessmentScores(studentIds) {
    const map = new Map();
    for (const id of studentIds) {
      const score = mockScores(id, MOCK_SKILLS).assessment;
      if (score !== null) map.set(id, score);
    }
    return map;
  }

  async getInterviewScores(studentIds) {
    const map = new Map();
    for (const id of studentIds) {
      const score = mockScores(id, MOCK_SKILLS).interview;
      if (score !== null) map.set(id, score);
    }
    return map;
  }

  async getGritScores(studentIds) {
    const map = new Map();
    for (const id of studentIds) {
      const grit = mockScores(id, MOCK_SKILLS).grit;
      if (grit.length) map.set(id, grit);
    }
    return map;
  }

  async getStudentsByIds() {
    return [];
  }

  async readPool(onRows) {
    const plans = ["NIAT", "CCBP_ACADEMY_SMART", "CCBP_ACADEMY_GENIUS", "CCBP_INTENSIVE", "CCBP_TECH_INTENSIVE_OFFLINE"];
    const rows = mockStudents("eligible-pool", 120).map((student, index) => ({
      ...student,
      product: plans[index % plans.length],
    }));
    await onRows(rows);
  }

  async mockEligibleForJob(job) {
    return this.population(job);
  }
}

export function createBigQueryRepository() {
  return config.modes.bigquery === "live" ? new LiveBigQueryRepository() : new MockBigQueryRepository();
}
