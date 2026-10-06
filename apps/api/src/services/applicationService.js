import { TASK_TYPE } from "../config/statuses.js";
import { Job, JobApplication, JobEligibleStudent } from "../models/index.js";
import { now } from "../utils/clock.js";
import { chunk } from "../utils/helpers.js";
import { integrations } from "./integrations.js";
import { enqueueTask } from "./taskQueue.js";

export async function recordAppliedCount(job, appliedCount) {
  const reached = Boolean(job.expectedPoolCount) && appliedCount >= job.expectedPoolCount;
  const set = { appliedCount, lastApplicationSyncAt: now() };
  const updated = await Job.findByIdAndUpdate(job._id, { $set: set }, { returnDocument: "after" });
  if (reached && !updated.poolTargetReached) {
    const flipped = await Job.findOneAndUpdate(
      { _id: job._id, poolTargetReached: false },
      { $set: { poolTargetReached: true, poolTargetReachedAt: now() } },
      { returnDocument: "after" },
    );
    if (!flipped) return Job.findById(job._id);
    await enqueueTask({
      jobId: job._id,
      type: TASK_TYPE.POOL_TARGET_EMAIL,
      dedupeKey: `${job._id}:${TASK_TYPE.POOL_TARGET_EMAIL}`,
    });
    return flipped;
  }
  return updated;
}

export async function syncApplicants(job) {
  const applicants = await integrations.bigquery.getApplicants(job.learningPortalJobId);

  for (const batch of chunk(applicants, 1000)) {
    await JobApplication.bulkWrite(
      batch.map((applicant) => ({
        updateOne: {
          filter: { jobId: job._id, studentId: String(applicant.studentId) },
          update: {
            $set: {
              studentName: applicant.studentName ?? "",
              email: applicant.email ?? null,
              mobile: applicant.mobile ?? null,
              campus: applicant.campus ?? null,
              batch: applicant.batch ?? null,
              program: applicant.program ?? null,
              resumeUrl: applicant.resumeUrl ?? null,
              appliedAt: applicant.appliedAt ?? null,
            },
            $setOnInsert: { source: "BIGQUERY" },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    await JobEligibleStudent.updateMany(
      { jobId: job._id, studentId: { $in: batch.map((applicant) => String(applicant.studentId)) }, applied: false },
      { $set: { applied: true, appliedAt: now() } },
    );
  }

  const updatedJob = await recordAppliedCount(job, applicants.length);
  return { applicants, job: updatedJob };
}
