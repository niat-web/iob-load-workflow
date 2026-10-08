import { config } from "../config/env.js";
import { CandidateAnalysis, EligiblePoolStudent, Job, JobApplication } from "../models/index.js";
import { now } from "../utils/clock.js";
import { sha256 } from "../utils/crypto.js";
import { isRetryable } from "../utils/errors.js";
import { sleep } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { productGroupFor } from "./eligiblePoolService.js";
import { integrations } from "./integrations.js";
import { getResumeText } from "./resumeFetcher.js";
import { turnedOff } from "./settingsService.js";

export const NIAT = "NIAT";
export const NIAT_ONLY = "AI resume analysis and GRIT scores are only for NIAT students";

export async function productsFor(jobId, applications) {
  const products = new Map();
  const unknown = [];
  for (const application of applications) {
    const group = productGroupFor(application.profile?.product ?? application.profile?.enrollPlan ?? application.program);
    if (group) products.set(application.studentId, group);
    else unknown.push(application.studentId);
  }
  if (unknown.length) {
    const pool = await EligiblePoolStudent.find({ studentId: { $in: unknown } }, { studentId: 1, productGroup: 1 }).lean();
    for (const student of pool) if (student.productGroup) products.set(student.studentId, student.productGroup);
  }
  return products;
}

async function analyseWithRetry(job, resumeText) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await integrations.gemini.analyze({ job, resumeText });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
      await sleep((error.retryAfterMs ?? 2000 * 2 ** attempt) / (config.isTest ? 1000 : 1));
    }
  }
  throw lastError;
}

export async function analyseCandidate(job, candidate) {
  if (!candidate.resumeUrl) {
    return { analysisStatus: "NO_RESUME", analysisError: "No resume on the application" };
  }
  const application = await JobApplication.findOne({ jobId: job._id, studentId: candidate.studentId }).lean();
  const resumeText = await getResumeText(candidate.resumeUrl, {
    studentId: candidate.studentId,
    studentName: candidate.studentName,
    email: application?.email,
    batch: application?.batch,
    jobSkills: job.skills ?? [],
  });
  if (!resumeText) return { analysisStatus: "NO_RESUME", analysisError: "Resume has no extractable text" };

  const resumeTextHash = sha256(resumeText);
  if (candidate.analysisStatus === "COMPLETED" && candidate.resumeTextHash === resumeTextHash) return null;

  const result = await analyseWithRetry(job, resumeText);
  return {
    analysisStatus: "COMPLETED",
    analysisError: null,
    resumeTextHash,
    resumeScore: result.resumeScore,
    resumeReason: result.reason,
    matchedSkills: result.matchedSkills,
    missingSkills: result.missingSkills,
    relevantExperience: result.relevantExperience,
  };
}

export function notAnalysed(candidate, { aiOn }) {
  if (candidate.product !== NIAT) return { analysisStatus: "SKIPPED", analysisError: NIAT_ONLY };
  if (!candidate.resumeUrl) return { analysisStatus: "NO_RESUME", analysisError: "No resume on the application" };
  if (!aiOn) return { analysisStatus: "SKIPPED", analysisError: turnedOff("AI resume analysis") };
  return null;
}

export async function analyseQueuedCandidate({ jobId, studentId }, { finalAttempt = true } = {}) {
  const candidate = await CandidateAnalysis.findOne({ jobId, studentId }).lean();
  if (!candidate || candidate.analysisStatus !== "QUEUED") return;
  const job = await Job.findById(jobId).lean();
  if (!job) return;
  let update;
  try {
    update = (await analyseCandidate(job, candidate)) ?? { analysisStatus: "COMPLETED" };
  } catch (error) {
    if (!finalAttempt && isRetryable(error)) throw error;
    logger.warn({ err: error, studentId }, "Candidate analysis failed");
    update = { analysisStatus: "FAILED", analysisError: String(error.message ?? error).slice(0, 500) };
  }
  await CandidateAnalysis.updateOne({ _id: candidate._id, analysisStatus: "QUEUED" }, { $set: { ...update, analysedAt: now() } });
}
