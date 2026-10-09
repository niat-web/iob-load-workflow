import { config } from "../config/env.js";
import { Job, PublicLink } from "../models/index.js";
import { now } from "../utils/clock.js";
import { AppError, isDuplicateKeyError, notFound } from "../utils/errors.js";
import { companySlug } from "../utils/helpers.js";

export const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sharedProfilesUrl(learningPortalJobId, companyName) {
  const slug = companySlug(companyName);
  return `${config.frontendUrl}/shared/profiles/${slug ? `${slug}/` : ""}${learningPortalJobId}`;
}

const urlForLink = (link, companyName) =>
  link?.learningPortalJobId ? sharedProfilesUrl(link.learningPortalJobId, companyName) : null;

export async function createPublicLinkForJob(jobId, createdBy) {
  const job = await Job.findById(jobId, { learningPortalJobId: 1, companyName: 1 }).lean();
  const existing = await PublicLink.findOne({ jobId, isActive: true });
  if (existing) return { link: existing, url: urlForLink(existing, job?.companyName) };

  if (!job?.learningPortalJobId) throw notFound("This job has no Learning Portal job ID");
  const expiresAt = new Date(now().getTime() + config.publicLinks.expiryDays * 24 * 60 * 60 * 1000);
  try {
    const link = await PublicLink.create({ jobId, learningPortalJobId: job.learningPortalJobId, createdBy, expiresAt });
    return { link, url: urlForLink(link, job.companyName) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const link = await PublicLink.findOne({ jobId });
    return { link, url: urlForLink(link, job.companyName) };
  }
}

export async function resolveSharedLink(learningPortalJobId) {
  if (!JOB_ID_PATTERN.test(String(learningPortalJobId ?? ""))) throw notFound("This link is not valid");
  const link = await PublicLink.findOne({ learningPortalJobId });
  if (!link || !link.isActive) throw notFound("This link is not valid");
  if (link.expiresAt.getTime() <= now().getTime()) {
    throw new AppError(410, "LINK_EXPIRED", "This link has expired");
  }
  const job = await Job.findById(link.jobId).lean();
  if (!job) throw notFound("This link is not valid");
  await PublicLink.updateOne({ _id: link._id }, { $set: { lastAccessedAt: now() }, $inc: { accessCount: 1 } });
  return { link, job };
}

export async function publicLinkUrlsForJobs(jobs) {
  const ids = jobs.filter((job) => job.publicLinkId).map((job) => job.publicLinkId);
  const map = new Map();
  if (!ids.length) return map;
  const companies = new Map(jobs.map((job) => [String(job._id), job.companyName]));
  const links = await PublicLink.find({ _id: { $in: ids }, isActive: true }).lean();
  for (const link of links) map.set(String(link.jobId), urlForLink(link, companies.get(String(link.jobId))));
  return map;
}

export async function publicLinkUrlForJob(job) {
  const map = await publicLinkUrlsForJobs([job]);
  return map.get(String(job._id)) ?? null;
}
