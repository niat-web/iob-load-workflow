import { integrations } from "./integrations.js";

const ALIASES = {
  reactjs: "react",
  react: "react",
  nodejs: "node",
  node: "node",
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  springboot: "spring",
  spring: "spring",
  golang: "go",
  go: "go",
  mysql: "sql",
  sql: "sql",
  postgresql: "postgres",
  postgres: "postgres",
  expressjs: "express",
  express: "express",
};

export function canonicalSkill(skill) {
  const key = String(skill).toLowerCase().replace(/[^a-z0-9+#]/g, "");
  return ALIASES[key] ?? key;
}

export async function getRelevantGritScores(studentIds, jobSkills, source = integrations.bigquery) {
  const all = await source.getGritScores(studentIds);
  const wanted = new Set(jobSkills.map(canonicalSkill));
  const result = new Map();
  for (const studentId of studentIds) {
    const scores = all.get(studentId) ?? [];
    const relevant = wanted.size ? scores.filter((entry) => wanted.has(canonicalSkill(entry.skill))) : scores;
    const score = relevant.length
      ? Math.round(relevant.reduce((sum, entry) => sum + entry.score, 0) / relevant.length)
      : null;
    result.set(studentId, { score, details: relevant.map(({ skill, score: value }) => ({ skill, score: Math.round(value) })) });
  }
  return result;
}
