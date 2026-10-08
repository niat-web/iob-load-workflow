import crypto from "node:crypto";
import { config, missingIntegrationSettings } from "../config/env.js";
import { LoginCode, User } from "../models/index.js";
import { loginCodeEmail } from "../templates/email/index.js";
import { now } from "../utils/clock.js";
import { timingSafeEqualStrings } from "../utils/crypto.js";
import { AppError, notFound } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { AUDIT, audit } from "./auditService.js";
import { integrations } from "./integrations.js";

export const CODE_MINUTES = 10;
export const RESEND_SECONDS = 60;
export const MAX_ATTEMPTS = 5;

const wrongCode = (message = "This code is wrong or has expired. Check the latest email, or send a new code.") =>
  new AppError(400, "INVALID_CODE", message);

const hashCode = (email, code) =>
  crypto.createHmac("sha256", config.encryptionSecret).update(`${email}:${code}`).digest("hex");

export function emailCodeLoginEnabled() {
  return !missingIntegrationSettings().ses?.length;
}

async function canSignIn(email) {
  const domain = email.split("@")[1];
  if (config.auth.allowedEmailDomains.length && !config.auth.allowedEmailDomains.includes(domain)) return false;
  return Boolean(await User.exists({ email, isActive: true }));
}

export async function requestLoginCode(email, ip) {
  if (!emailCodeLoginEnabled()) throw notFound("Route not found");
  const reply = { sent: true, expiresInMinutes: CODE_MINUTES, resendAfterSeconds: RESEND_SECONDS };
  if (!(await canSignIn(email))) return reply;

  const current = now();
  const existing = await LoginCode.findById(email).lean();
  if (existing && current.getTime() - new Date(existing.sentAt).getTime() < RESEND_SECONDS * 1000) return reply;

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await LoginCode.updateOne(
    { _id: email },
    {
      $set: {
        codeHash: hashCode(email, code),
        expiresAt: new Date(current.getTime() + CODE_MINUTES * 60 * 1000),
        attempts: 0,
        sentAt: current,
      },
    },
    { upsert: true },
  );
  try {
    await integrations.ses.send({ to: email, ...loginCodeEmail(code, CODE_MINUTES) });
  } catch (error) {
    await LoginCode.deleteOne({ _id: email });
    logger.error({ err: error }, "Sign-in code email could not be sent");
    throw new AppError(503, "CODE_NOT_SENT", "The code could not be sent. Try again in a minute.");
  }
  await audit({ action: AUDIT.LOGIN_CODE_SENT, entityType: "User", entityId: email, ip });
  return reply;
}

export async function verifyLoginCode(email, code) {
  if (!emailCodeLoginEnabled()) throw notFound("Route not found");
  const record = await LoginCode.findOneAndUpdate(
    { _id: email, expiresAt: { $gt: now() }, attempts: { $lt: MAX_ATTEMPTS } },
    { $inc: { attempts: 1 } },
    { returnDocument: "after" },
  ).lean();
  if (!record) throw wrongCode();
  if (!timingSafeEqualStrings(record.codeHash, hashCode(email, code))) {
    if (record.attempts >= MAX_ATTEMPTS) {
      await LoginCode.deleteOne({ _id: email });
      throw wrongCode("Too many wrong tries. Send a new code.");
    }
    throw wrongCode();
  }
  const used = await LoginCode.deleteOne({ _id: email, codeHash: record.codeHash });
  if (!used.deletedCount) throw wrongCode();
  return { email };
}
