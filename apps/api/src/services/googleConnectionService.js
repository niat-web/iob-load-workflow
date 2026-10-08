import { OAuth2Client } from "google-auth-library";
import { config } from "../config/env.js";
import { GoogleConnection } from "../models/index.js";
import { now } from "../utils/clock.js";
import { decrypt, encrypt } from "../utils/crypto.js";
import { AppError, IntegrationError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { AUDIT, audit } from "./auditService.js";

export const MEET_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/meetings.space.settings",
]);
export const CONNECT_SCOPES = Object.freeze(["openid", "https://www.googleapis.com/auth/userinfo.email", ...MEET_SCOPES]);

const CONNECTION_ID = "meet";

const defaultFactory = () =>
  new OAuth2Client({
    clientId: config.auth.googleClientId,
    clientSecret: config.meet.oauth.clientSecret,
    redirectUri: config.meet.oauth.redirectUri,
  });

let oauthFactory = defaultFactory;
let cached = null;

export function setGoogleOAuthFactory(factory) {
  oauthFactory = factory ?? defaultFactory;
  cached = null;
}

export function meetAuthMode() {
  if (config.modes.meet !== "live") return "mock";
  return config.meet.credentials ? "delegation" : "oauth";
}

const connectFailed = (code, message) => new AppError(400, "GOOGLE_CONNECT_FAILED", message, { reason: code });

function accountLabel() {
  return config.meet.organizerEmail ?? "the interview Google account";
}

function problemFor(doc) {
  if (!doc) return `Google Meet is not connected yet. Click Connect Google on the Interviews page and sign in as ${accountLabel()}.`;
  if (doc.status !== "ACTIVE") {
    return `Google access for ${doc.email} was removed or has expired. Click Reconnect Google on the Interviews page.`;
  }
  return null;
}

export async function googleConnectionProblem() {
  if (meetAuthMode() !== "oauth") return null;
  return problemFor(await GoogleConnection.findById(CONNECTION_ID).lean());
}

export async function googleConnectionStatus() {
  const doc = await GoogleConnection.findById(CONNECTION_ID).lean();
  return {
    mode: meetAuthMode(),
    configured: Boolean(config.auth.googleClientId && config.meet.oauth.clientSecret),
    connected: doc?.status === "ACTIVE",
    status: doc?.status ?? null,
    email: doc?.email ?? null,
    expectedEmail: config.meet.organizerEmail ?? null,
    connectedBy: doc?.connectedBy ?? null,
    connectedAt: doc?.connectedAt ? new Date(doc.connectedAt).toISOString() : null,
    lastError: doc?.lastError ?? null,
  };
}

export async function connectedOrganizer() {
  const doc = await GoogleConnection.findById(CONNECTION_ID, { email: 1, status: 1 }).lean();
  return doc?.status === "ACTIVE" ? doc.email : null;
}

export function googleConnectUrl(state) {
  return oauthFactory().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [...CONNECT_SCOPES],
    state,
    ...(config.meet.organizerEmail ? { login_hint: config.meet.organizerEmail } : {}),
  });
}

async function revokeQuietly(client, token) {
  try {
    await client.revokeToken(token);
  } catch (error) {
    logger.warn({ err: error }, "Could not revoke the Google token");
  }
}

export async function finishGoogleConnect(code, actor) {
  const client = oauthFactory();
  let tokens;
  try {
    ({ tokens } = await client.getToken(code));
  } catch (error) {
    logger.warn({ err: error }, "Google sign-in code exchange failed");
    throw connectFailed("failed", "Google sign-in failed. Try again.");
  }
  const granted = new Set(String(tokens?.scope ?? "").split(/\s+/).filter(Boolean));
  if (MEET_SCOPES.some((scope) => !granted.has(scope))) {
    if (tokens?.refresh_token) await revokeQuietly(client, tokens.refresh_token);
    throw connectFailed("scopes", "Allow both Google Calendar and Google Meet access when Google asks, then try again.");
  }
  let email = null;
  try {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: config.auth.googleClientId });
    email = ticket.getPayload()?.email?.toLowerCase() ?? null;
  } catch (error) {
    logger.warn({ err: error }, "Google sign-in returned an unreadable ID token");
  }
  if (!email) throw connectFailed("failed", "Google did not say which account signed in. Try again.");
  if (config.meet.organizerEmail && email !== config.meet.organizerEmail) {
    if (tokens.refresh_token) await revokeQuietly(client, tokens.refresh_token);
    throw connectFailed("account", `Sign in as ${config.meet.organizerEmail}, not ${email}.`);
  }
  if (!tokens.refresh_token) {
    throw connectFailed("norefresh", "Google did not give lasting access. Try Connect Google again.");
  }
  await GoogleConnection.updateOne(
    { _id: CONNECTION_ID },
    {
      $set: {
        email,
        refreshToken: encrypt(tokens.refresh_token, config.encryptionSecret),
        scopes: [...granted],
        status: "ACTIVE",
        lastError: null,
        connectedBy: actor?.email ?? null,
        connectedAt: now(),
      },
    },
    { upsert: true },
  );
  cached = null;
  await audit({ actor, action: AUDIT.GOOGLE_CONNECTED, entityType: "Settings", entityId: CONNECTION_ID, metadata: { email } });
  return { email };
}

export async function disconnectGoogle(actor) {
  const doc = await GoogleConnection.findById(CONNECTION_ID).lean();
  if (!doc) return;
  try {
    await revokeQuietly(oauthFactory(), decrypt(doc.refreshToken, config.encryptionSecret));
  } catch (error) {
    logger.warn({ err: error }, "Stored Google token could not be read");
  }
  await GoogleConnection.deleteOne({ _id: CONNECTION_ID });
  cached = null;
  await audit({
    actor,
    action: AUDIT.GOOGLE_DISCONNECTED,
    entityType: "Settings",
    entityId: CONNECTION_ID,
    metadata: { email: doc.email },
  });
}

export async function connectedMeetClient() {
  const doc = await GoogleConnection.findById(CONNECTION_ID).lean();
  const problem = problemFor(doc);
  if (problem) throw new IntegrationError(problem, { integration: "meet", retryable: false });
  const key = `${doc.email}:${new Date(doc.connectedAt).getTime()}`;
  if (cached?.key !== key) {
    const client = oauthFactory();
    client.setCredentials({ refresh_token: decrypt(doc.refreshToken, config.encryptionSecret) });
    cached = { key, client, email: doc.email };
  }
  return cached;
}

export async function markGoogleRevoked(reason) {
  await GoogleConnection.updateOne(
    { _id: CONNECTION_ID, status: "ACTIVE" },
    { $set: { status: "REVOKED", lastError: String(reason ?? "").slice(0, 500) } },
  );
  cached = null;
}
