import crypto from "node:crypto";
import { config } from "../config/env.js";
import { TASK_TYPE } from "../config/statuses.js";
import { Job, WebhookEvent } from "../models/index.js";
import { AUDIT, audit } from "../services/auditService.js";
import { enqueueTask } from "../services/taskQueue.js";
import { now } from "../utils/clock.js";
import { hashObject, timingSafeEqualStrings } from "../utils/crypto.js";
import { AppError, isDuplicateKeyError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const V3_DECODE = {
  "%3A": ":", "%2F": "/", "%3F": "?", "%40": "@", "%21": "!", "%24": "$", "%27": "'",
  "%28": "(", "%29": ")", "%2A": "*", "%2C": ",", "%3B": ";",
};

function requestUri(req) {
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  const full = config.hubspot.webhookUrl
    ? `${config.hubspot.webhookUrl}${query}`
    : `${req.protocol}://${req.get("host")}${req.originalUrl}`;
  return full.replace(/%[0-9A-F]{2}/gi, (match) => V3_DECODE[match.toUpperCase()] ?? match);
}

export function verifyHubspotSignature(req, rawBody) {
  const secret = config.hubspot.clientSecret;
  if (!secret) {
    if (config.modes.hubspot === "mock" && !config.isProduction) return true;
    return false;
  }
  const v3 = req.get("x-hubspot-signature-v3");
  if (v3) {
    const timestamp = Number(req.get("x-hubspot-request-timestamp"));
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > config.hubspot.webhookMaxAgeMs) return false;
    const source = `${req.method}${requestUri(req)}${rawBody}${timestamp}`;
    const expected = crypto.createHmac("sha256", secret).update(source, "utf8").digest("base64");
    return timingSafeEqualStrings(expected, v3);
  }
  const legacy = req.get("x-hubspot-signature");
  if (legacy) {
    const version = (req.get("x-hubspot-signature-version") ?? "v1").toLowerCase();
    const source = version === "v2" ? `${secret}${req.method}${requestUri(req)}${rawBody}` : `${secret}${rawBody}`;
    return timingSafeEqualStrings(crypto.createHash("sha256").update(source, "utf8").digest("hex"), legacy);
  }
  return false;
}

export async function hubspotWebhook(req, res) {
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!verifyHubspotSignature(req, rawBody)) {
    throw new AppError(401, "INVALID_SIGNATURE", "Webhook signature could not be verified");
  }

  let events;
  try {
    events = JSON.parse(rawBody || "[]");
  } catch {
    throw new AppError(400, "VALIDATION_ERROR", "Webhook body is not valid JSON");
  }
  if (!Array.isArray(events)) events = [events];

  const dealIds = new Set();
  let duplicates = 0;
  for (const event of events.slice(0, 500)) {
    if (!String(event?.subscriptionType ?? "").startsWith("deal.") || !event.objectId) continue;
    const eventKey = event.eventId ? `hubspot:${event.eventId}` : `hubspot:hash:${hashObject(event)}`;
    try {
      await WebhookEvent.create({
        eventKey,
        dealId: String(event.objectId),
        subscriptionType: event.subscriptionType,
        propertyName: event.propertyName ?? null,
      });
      dealIds.add(String(event.objectId));
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      duplicates += 1;
    }
  }

  const jobs = dealIds.size ? await Job.find({ hubspotDealId: { $in: [...dealIds] } }, { _id: 1, hubspotDealId: 1 }).lean() : [];
  for (const job of jobs) {
    await enqueueTask({
      jobId: job._id,
      type: TASK_TYPE.HUBSPOT_DEAL_UPDATE,
      scheduledFor: new Date(now().getTime() + config.hubspot.updateDebounceSeconds * 1000),
      dedupeKey: `${job._id}:${TASK_TYPE.HUBSPOT_DEAL_UPDATE}:pending`,
      releaseDedupeOnStart: true,
    });
    await audit({ action: AUDIT.HUBSPOT_UPDATE_RECEIVED, entityId: job._id, metadata: { hubspotDealId: job.hubspotDealId } });
  }

  logger.info({ events: events.length, deals: dealIds.size, jobs: jobs.length, duplicates }, "HubSpot webhook processed");
  res.json({ received: events.length, queued: jobs.length, duplicates });
}
