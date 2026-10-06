import { z } from "zod";
import { CandidateAnalysis, Job } from "../models/index.js";
import { resolvePublicLink } from "../services/publicLinkService.js";
import { notFound } from "../utils/errors.js";
import { sendResume } from "./psmController.js";

export const tokenParams = z.object({ token: z.string().min(20).max(100) });
export const publicResumeParams = tokenParams.extend({ ref: z.string().min(8).max(40) });

export async function publicPool(req, res) {
  const link = await resolvePublicLink(req.valid.params.token);
  const job = await Job.findById(link.jobId).lean();
  if (!job) throw notFound("This link is not valid");
  const candidates = await CandidateAnalysis.find({ jobId: job._id }).sort({ finalRank: 1 }).lean();

  res.set("Cache-Control", "private, no-store");
  res.json({
    companyName: job.companyName,
    jobRole: job.jobRole,
    totalApplied: job.appliedCount ?? candidates.length,
    submittedAt: job.reviewSubmittedAt?.toISOString() ?? null,
    expiresAt: link.expiresAt.toISOString(),
    candidates: candidates.map((candidate) => ({
      ref: candidate.publicRef,
      finalPriority: candidate.finalPriority,
      studentName: candidate.studentName,
      hasResume: Boolean(candidate.resumeUrl),
      relevantSkills: candidate.matchedSkills ?? [],
      resumeScore: candidate.resumeScore ?? null,
      gritScore: candidate.gritScore ?? null,
      assessmentScore: candidate.assessmentScore ?? null,
      interviewScore: candidate.interviewScore ?? null,
      overallScore: candidate.overallScore ?? null,
      candidateStatus: candidate.candidateStatus ?? null,
    })),
  });
}

export async function publicResume(req, res) {
  const link = await resolvePublicLink(req.valid.params.token);
  const candidate = await CandidateAnalysis.findOne({ jobId: link.jobId, publicRef: req.valid.params.ref }).lean();
  if (!candidate?.resumeUrl) throw notFound("Resume not found");
  const job = await Job.findById(link.jobId, { skills: 1 }).lean();
  await sendResume(
    res,
    candidate.resumeUrl,
    { studentId: candidate.studentId, studentName: candidate.studentName, jobSkills: job?.skills ?? [] },
    `${candidate.studentName}-resume`,
  );
}
