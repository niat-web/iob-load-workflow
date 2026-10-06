import { config } from "../../config/env.js";
import { JOB_STATUS as S, TASK_TYPE } from "../../config/statuses.js";
import { ApplicationSnapshot, CandidateAnalysis, Job, JobApplication } from "../../models/index.js";
import { syncApplicants } from "../../services/applicationService.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { getRelevantGritScores } from "../../services/gritRepository.js";
import { integrations } from "../../services/integrations.js";
import { transitionJob } from "../../services/jobService.js";
import { normalizeWeights, rankCandidates } from "../../services/priorityEngine.js";
import { getResumeText } from "../../services/resumeFetcher.js";
import { now } from "../../utils/clock.js";
import { sha256 } from "../../utils/crypto.js";
import { IntegrationError, isRetryable } from "../../utils/errors.js";
import { chunk, mapLimit, sleep } from "../../utils/helpers.js";
import { logger } from "../../utils/logger.js";
import { enqueueNext, isPast } from "./shared.js";

async function fetchFinalPool({ job }) {
  if (isPast(job, S.FETCHING_APPLIED_POOL)) return enqueueNext(job, TASK_TYPE.AI_ANALYSIS);
  await transitionJob(job._id, S.FETCHING_APPLIED_POOL, { from: [S.APPLICATIONS_CLOSED, S.FETCHING_APPLIED_POOL] });

  const { applicants } = await syncApplicants(job);
  const studentIds = applicants.map((applicant) => String(applicant.studentId));
  await ApplicationSnapshot.updateOne(
    { jobId: job._id, kind: "FINAL" },
    { $setOnInsert: { takenAt: now(), count: studentIds.length, studentIds } },
    { upsert: true },
  );
  if (!studentIds.length) {
    await audit({ action: AUDIT.APPLICATIONS_CLOSED, entityId: job._id, metadata: { warning: "No applications received" } });
  }
  await transitionJob(job._id, S.APPLIED_POOL_READY, { from: S.FETCHING_APPLIED_POOL, set: { appliedCount: studentIds.length } });
  await enqueueNext(job, TASK_TYPE.AI_ANALYSIS);
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

async function analyseCandidate(job, candidate) {
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

async function aiAnalysis({ task, job, heartbeat }) {
  if (isPast(job, S.AI_ANALYSIS)) return enqueueNext(job, TASK_TYPE.PRIORITY_GENERATION);
  await transitionJob(job._id, S.AI_ANALYSIS, { from: [S.APPLIED_POOL_READY, S.AI_ANALYSIS] });
  if (!job.ai?.startedAt) {
    await Job.updateOne({ _id: job._id }, { $set: { "ai.startedAt": now() } });
    await audit({ action: AUDIT.AI_ANALYSIS_STARTED, entityId: job._id });
  }

  const applications = await JobApplication.find({ jobId: job._id }).lean();
  for (const batch of chunk(applications, 1000)) {
    await CandidateAnalysis.bulkWrite(
      batch.map((application) => ({
        updateOne: {
          filter: { jobId: job._id, studentId: application.studentId },
          update: {
            $set: { studentName: application.studentName, campus: application.campus, resumeUrl: application.resumeUrl },
            $setOnInsert: { analysisStatus: "PENDING" },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  const statuses = task.payload?.retryFailed ? ["PENDING", "FAILED"] : ["PENDING"];
  const pending = await CandidateAnalysis.find({ jobId: job._id, analysisStatus: { $in: statuses } }).lean();
  const current = await Job.findById(job._id).lean();

  let processed = 0;
  await mapLimit(pending, config.gemini.concurrency, async (candidate) => {
    let update;
    try {
      update = await analyseCandidate(current, candidate);
    } catch (error) {
      logger.warn({ err: error, studentId: candidate.studentId }, "Candidate analysis failed");
      update = { analysisStatus: "FAILED", analysisError: String(error.message ?? error).slice(0, 500) };
    }
    if (update) await CandidateAnalysis.updateOne({ _id: candidate._id }, { $set: { ...update, analysedAt: now() } });
    processed += 1;
    if (processed % 20 === 0) await heartbeat();
  });

  const [total, failed, completed, analysed] = await Promise.all([
    CandidateAnalysis.countDocuments({ jobId: job._id }),
    CandidateAnalysis.countDocuments({ jobId: job._id, analysisStatus: "FAILED" }),
    CandidateAnalysis.countDocuments({ jobId: job._id, analysisStatus: "COMPLETED" }),
    CandidateAnalysis.countDocuments({ jobId: job._id, analysisStatus: { $in: ["COMPLETED", "NO_RESUME"] } }),
  ]);
  if (failed > 0 && completed === 0) {
    throw new IntegrationError(`AI analysis failed for all ${failed} candidates with a resume`, {
      integration: "gemini",
      retryable: true,
    });
  }

  await Job.updateOne(
    { _id: job._id },
    { $set: { "ai.completedAt": now(), "ai.analysedCount": analysed, "ai.failedCount": failed } },
  );
  await audit({ action: AUDIT.AI_ANALYSIS_COMPLETED, entityId: job._id, metadata: { total, analysed, failed } });
  await enqueueNext(job, TASK_TYPE.PRIORITY_GENERATION);
}

async function priorityGeneration({ job }) {
  if (isPast(job, S.PRIORITY_GENERATING)) return;
  await transitionJob(job._id, S.PRIORITY_GENERATING, { from: [S.AI_ANALYSIS, S.PRIORITY_GENERATING] });

  const current = await Job.findById(job._id).lean();
  const candidates = await CandidateAnalysis.find({ jobId: job._id }).lean();
  const studentIds = candidates.map((candidate) => candidate.studentId);
  const applications = await JobApplication.find({ jobId: job._id }, { studentId: 1, appliedAt: 1 }).lean();
  const appliedAt = new Map(applications.map((application) => [application.studentId, application.appliedAt]));

  const [grit, assessments, interviews] = await Promise.all([
    getRelevantGritScores(studentIds, current.skills ?? []),
    integrations.bigquery.getAssessmentScores(studentIds),
    integrations.bigquery.getInterviewScores(studentIds),
  ]);

  const round = (value) => (value === undefined || value === null ? null : Math.round(value));
  const ranked = rankCandidates(
    candidates.map((candidate) => ({
      studentId: candidate.studentId,
      appliedAt: appliedAt.get(candidate.studentId),
      psmEdited: candidate.psmEdited,
      candidateStatus: candidate.candidateStatus,
      gritDetails: grit.get(candidate.studentId)?.details ?? [],
      scores: {
        resume: candidate.analysisStatus === "NO_RESUME" ? 0 : candidate.resumeScore,
        grit: grit.get(candidate.studentId)?.score ?? null,
        assessment: round(assessments.get(candidate.studentId)),
        interview: round(interviews.get(candidate.studentId)),
      },
    })),
  );

  const weights = normalizeWeights();
  for (const batch of chunk(ranked, 500)) {
    await CandidateAnalysis.bulkWrite(
      batch.map((candidate) => ({
        updateOne: {
          filter: { jobId: job._id, studentId: candidate.studentId },
          update: {
            $set: {
              gritScore: candidate.scores.grit,
              gritDetails: candidate.gritDetails,
              assessmentScore: candidate.scores.assessment,
              interviewScore: candidate.scores.interview,
              overallScore: candidate.overallScore,
              scoreComponents: { ...candidate.scores, weights },
              aiRank: candidate.rank,
              aiPriority: candidate.priority,
              suggestedStatus: candidate.suggestedStatus,
              ...(candidate.psmEdited
                ? {}
                : {
                    finalRank: candidate.rank,
                    finalPriority: candidate.priority,
                    candidateStatus: candidate.candidateStatus ?? candidate.suggestedStatus,
                  }),
            },
          },
        },
      })),
      { ordered: false },
    );
  }

  await transitionJob(job._id, S.PRIORITY_GENERATED, { from: S.PRIORITY_GENERATING });
  await audit({ action: AUDIT.PRIORITY_GENERATED, entityId: job._id, metadata: { candidates: ranked.length } });
  await transitionJob(job._id, S.READY_FOR_PSM, { from: S.PRIORITY_GENERATED });
}

export const candidatePoolHandlers = {
  [TASK_TYPE.FETCH_FINAL_POOL]: { run: fetchFinalPool },
  [TASK_TYPE.AI_ANALYSIS]: { run: aiAnalysis },
  [TASK_TYPE.PRIORITY_GENERATION]: { run: priorityGeneration },
};
