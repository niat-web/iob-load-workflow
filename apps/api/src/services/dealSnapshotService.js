import { JobDealSnapshot, JobHubspotMapping } from "../models/index.js";
import { now } from "../utils/clock.js";
import { isDuplicateKeyError } from "../utils/errors.js";
import { fullHash } from "./dealMapper.js";

export async function latestSnapshot(jobId) {
  return JobDealSnapshot.findOne({ jobId }).sort({ version: -1 }).lean();
}

export async function saveSnapshot(job, mapped, rawProperties, source) {
  const payloadHash = fullHash(mapped);
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await latestSnapshot(job._id);
    try {
      const snapshot = await JobDealSnapshot.create({
        jobId: job._id,
        hubspotDealId: job.hubspotDealId,
        version: (latest?.version ?? 0) + 1,
        source: latest && source === "INITIAL" ? "RETRY" : source,
        mappedFields: mapped,
        rawProperties,
        payloadHash,
        fetchedAt: now(),
      });
      await JobHubspotMapping.updateOne(
        { jobId: job._id },
        { $set: { lastHubspotSyncAt: now(), lastPayloadHash: payloadHash } },
      );
      return snapshot;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }
  throw new Error("Could not store deal snapshot after concurrent updates");
}
