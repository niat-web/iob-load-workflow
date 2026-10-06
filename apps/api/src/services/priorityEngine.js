import { config } from "../config/env.js";

export const COMPONENTS = ["resume", "grit", "assessment", "interview"];

export function normalizeWeights(weights = config.priority.weights) {
  const total = COMPONENTS.reduce((sum, key) => sum + Math.max(0, weights[key] ?? 0), 0);
  if (total <= 0) throw new Error("Priority weights must add up to more than 0");
  return Object.fromEntries(COMPONENTS.map((key) => [key, Math.max(0, weights[key] ?? 0) / total]));
}

const valid = (value) => typeof value === "number" && Number.isFinite(value);

export function overallScore(scores, weights = normalizeWeights(), strategy = config.priority.missingScoreStrategy) {
  let weighted = 0;
  let usedWeight = 0;
  for (const key of COMPONENTS) {
    const weight = weights[key];
    if (!weight) continue;
    if (valid(scores[key])) {
      weighted += Math.min(100, Math.max(0, scores[key])) * weight;
      usedWeight += weight;
    } else if (strategy === "zero") {
      usedWeight += weight;
    }
  }
  if (usedWeight === 0) return null;
  return Math.round((weighted / usedWeight) * 10) / 10;
}

export function suggestedStatus(score, thresholds = config.priority) {
  if (score === null) return "CONSIDER";
  if (score >= thresholds.recommendedMinScore) return "RECOMMENDED";
  if (score >= thresholds.considerMinScore) return "CONSIDER";
  return "NOT_RECOMMENDED";
}

export function rankCandidates(candidates, options = {}) {
  const weights = normalizeWeights(options.weights);
  const strategy = options.strategy ?? config.priority.missingScoreStrategy;
  const scored = candidates.map((candidate) => ({
    ...candidate,
    overallScore: overallScore(candidate.scores, weights, strategy),
  }));
  const byNumberDesc = (a, b) => (b ?? -1) - (a ?? -1);
  scored.sort(
    (a, b) =>
      byNumberDesc(a.overallScore, b.overallScore) ||
      byNumberDesc(a.scores.resume, b.scores.resume) ||
      (new Date(a.appliedAt ?? 0).getTime() - new Date(b.appliedAt ?? 0).getTime()) ||
      String(a.studentId).localeCompare(String(b.studentId)),
  );
  return scored.map((candidate, index) => ({
    ...candidate,
    rank: index + 1,
    priority: `P${index + 1}`,
    suggestedStatus: suggestedStatus(candidate.overallScore),
  }));
}
