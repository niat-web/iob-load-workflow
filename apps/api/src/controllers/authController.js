import { z } from "zod";
import { config } from "../config/env.js";
import { AUDIT, audit } from "../services/auditService.js";
import {
  clearSession,
  homeFor,
  issueSession,
  resolveUser,
  serializeUser,
  verifyGoogleIdToken,
} from "../services/authService.js";
import { notFound } from "../utils/errors.js";

export const googleLoginSchema = z.object({ credential: z.string().min(20).max(20000) });
export const devLoginSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) });

export function getConfig(req, res) {
  res.json({
    googleClientId: config.auth.googleClientId ?? null,
    devLoginEnabled: config.auth.devLoginEnabled,
  });
}

async function completeLogin(req, res, profile, method) {
  const user = await resolveUser(profile);
  issueSession(res, user);
  await audit({
    actor: user,
    action: AUDIT.LOGIN,
    entityType: "User",
    entityId: user.email,
    metadata: { method },
    ip: req.ip,
  });
  res.json({ user: serializeUser(user), redirectTo: homeFor(user.role) });
}

export async function googleLogin(req, res) {
  const profile = await verifyGoogleIdToken(req.valid.body.credential);
  await completeLogin(req, res, profile, "google");
}

export async function devLogin(req, res) {
  if (!config.auth.devLoginEnabled) throw notFound("Route not found");
  await completeLogin(req, res, { email: req.valid.body.email }, "dev");
}

export function me(req, res) {
  res.json({ user: serializeUser(req.user) });
}

export function logout(req, res) {
  clearSession(res);
  res.status(204).end();
}
