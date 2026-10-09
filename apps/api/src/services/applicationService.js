import { TASK_TYPE } from "../config/statuses.js";
import { Job, JobApplication, JobEligibleStudent } from "../models/index.js";
import { now } from "../utils/clock.js";
import { chunk } from "../utils/helpers.js";
import { integrations } from "./integrations.js";
import { enqueueTask } from "./taskQueue.js";

export async function recordAppliedCount(job, appliedCount) {
  const reached = Boolean(job.expectedPoolCount) && appliedCount >= job.expectedPoolCount;
  const set = { appliedCount, lastApplicationSyncAt: now(), applicationSyncError: null, applicationSyncFailedAt: null };
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

const present = (value) => value !== null && value !== undefined && value !== "";

export async function syncApplicants(job) {
  const applicants = await integrations.bigquery.getApplicants(job.learningPortalJobId);
  const syncedAt = now();

  for (const batch of chunk(applicants, 1000)) {
    const ids = batch.map((applicant) => String(applicant.studentId));
    const known = new Map(
      (await JobEligibleStudent.find({ jobId: job._id, studentId: { $in: ids } }).lean()).map((row) => [row.studentId, row]),
    );
    await JobApplication.bulkWrite(
      batch.map((applicant) => {
        const studentId = String(applicant.studentId);
        const eligible = known.get(studentId);
        const fields = {
          studentName: applicant.studentName || eligible?.studentName,
          email: applicant.email || eligible?.email,
          mobile: applicant.mobile || eligible?.mobile,
          campus: applicant.campus || eligible?.campus,
          batch: applicant.batch || eligible?.batch,
          program: applicant.program,
          resumeUrl: applicant.resumeUrl,
          appliedAt: applicant.appliedAt,
          applicationStage: applicant.applicationStage,
          profile: applicant.profile,
        };
        const set = Object.fromEntries(Object.entries(fields).filter(([, value]) => present(value)));
        return {
          updateOne: {
            filter: { jobId: job._id, studentId },
            update: {
              $set: { ...set, learningPortalJobId: job.learningPortalJobId ?? null, lastSyncedAt: syncedAt },
              $setOnInsert: { source: "BIGQUERY" },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
    await JobEligibleStudent.updateMany(
      { jobId: job._id, studentId: { $in: ids }, applied: { $ne: true } },
      { $set: { applied: true, appliedAt: now() } },
    );
  }

  const appliedCount = await JobApplication.countDocuments({ jobId: job._id });
  const updatedJob = await recordAppliedCount(job, appliedCount);
  return { applicants, job: updatedJob };
}
