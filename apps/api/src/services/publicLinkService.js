import { config } from "../config/env.js";
import { PublicLink } from "../models/index.js";
import { now } from "../utils/clock.js";
import { decrypt, encrypt, randomToken, sha256 } from "../utils/crypto.js";
import { AppError, isDuplicateKeyError, notFound } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export function publicUrlForToken(token) {
  return `${config.frontendUrl}/public/candidate-pool/${token}`;
}

function urlForLink(link) {
  try {
    return publicUrlForToken(decrypt(link.tokenEncrypted, config.encryptionSecret));
  } catch (error) {
    logger.error({ err: error, linkId: String(link._id) }, "Cannot decrypt public link token");
    return null;
  }
}

export async function createPublicLinkForJob(jobId, createdBy) {
  const existing = await PublicLink.findOne({ jobId, isActive: true });
  if (existing) return { link: existing, url: urlForLink(existing) };

  const token = randomToken(32);
  const expiresAt = new Date(now().getTime() + config.publicLinks.expiryDays * 24 * 60 * 60 * 1000);
  try {
    const link = await PublicLink.create({
      jobId,
      tokenHash: sha256(token),
      tokenEncrypted: encrypt(token, config.encryptionSecret),
      createdBy,
      expiresAt,
    });
    return { link, url: publicUrlForToken(token) };
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const link = await PublicLink.findOne({ jobId });
    return { link, url: urlForLink(link) };
  }
}

export async function resolvePublicLink(token) {
  if (!token || token.length < 20 || token.length > 100) throw notFound("This link is not valid");
  const link = await PublicLink.findOne({ tokenHash: sha256(token) });
  if (!link || !link.isActive) throw notFound("This link is not valid");
  if (link.expiresAt.getTime() <= now().getTime()) {
    throw new AppError(410, "LINK_EXPIRED", "This link has expired");
  }
  await PublicLink.updateOne({ _id: link._id }, { $set: { lastAccessedAt: now() }, $inc: { accessCount: 1 } });
  return link;
}

export async function publicLinkUrlsForJobs(jobs) {
  const ids = jobs.filter((job) => job.publicLinkId).map((job) => job.publicLinkId);
  const map = new Map();
  if (!ids.length) return map;
  const links = await PublicLink.find({ _id: { $in: ids }, isActive: true }).lean();
  for (const link of links) map.set(String(link.jobId), urlForLink(link));
  return map;
}

export async function publicLinkUrlForJob(job) {
  const map = await publicLinkUrlsForJobs([job]);
  return map.get(String(job._id)) ?? null;
}
