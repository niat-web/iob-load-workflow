import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";
import { User } from "../models/index.js";
import { hubspotOwnerForEmail, hubspotOwnerForUser, ownerFields } from "./hubspotOwners.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const KEYS_TTL_MS = 60 * 60 * 1000;
const MAX_TOKEN_AGE_SECONDS = 10 * 60;
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const invalidToken = (message = "Google sign-in could not be verified") =>
  new AppError(401, "INVALID_GOOGLE_TOKEN", message);
const googleUnavailable = () =>
  new AppError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is unavailable right now. Try again.");

async function downloadGoogleKeys() {
  let response;
  try {
    response = await fetch(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(10000) });
  } catch (error) {
    logger.warn({ err: error }, "Could not download Google signing keys");
    throw googleUnavailable();
  }
  if (!response.ok) throw googleUnavailable();
  const body = await response.json();
  return Array.isArray(body?.keys) ? body.keys : [];
}

let loadGoogleKeys = downloadGoogleKeys;
let keyCache = { keys: [], loadedAt: 0 };

export function setGoogleKeySource(source) {
  loadGoogleKeys = source ?? downloadGoogleKeys;
  keyCache = { keys: [], loadedAt: 0 };
}

async function googleSigningKey(kid) {
  const fresh = Date.now() - keyCache.loadedAt < KEYS_TTL_MS;
  let jwk = fresh ? keyCache.keys.find((key) => key.kid === kid) : null;
  if (!jwk) {
    keyCache = { keys: await loadGoogleKeys(), loadedAt: Date.now() };
    jwk = keyCache.keys.find((key) => key.kid === kid);
  }
  if (!jwk) throw invalidToken();
  return crypto.createPublicKey({ key: jwk, format: "jwk" });
}

export async function verifyGoogleIdToken(credential) {
  const clientId = config.auth.googleClientId;
  if (!clientId) throw new AppError(503, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
  const decoded = jwt.decode(credential, { complete: true });
  if (!decoded?.header?.kid) throw invalidToken();
  const key = await googleSigningKey(decoded.header.kid);

  let payload;
  try {
    payload = jwt.verify(credential, key, {
      algorithms: ["RS256"],
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
      clockTolerance: 60,
    });
  } catch {
    throw invalidToken();
  }
  if (!payload.iat || Date.now() / 1000 - payload.iat > MAX_TOKEN_AGE_SECONDS) {
    throw invalidToken("This sign-in has expired. Sign in again.");
  }
  const email = String(payload.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw invalidToken("This Google account has no email address");
  if (payload.email_verified !== true && payload.email_verified !== "true") {
    throw invalidToken("This Google account's email address is not verified");
  }
  return { email, name: payload.name ?? "", picture: payload.picture ?? null };
}

export async function resolveUser({ email, name, picture }) {
  const domain = email.split("@")[1];
  if (config.auth.allowedEmailDomains.length && !config.auth.allowedEmailDomains.includes(domain)) {
    throw new AppError(403, "ACCESS_DENIED", "This email domain is not allowed to use the application");
  }
  const user = await User.findOne({ email });
  if (!user || !user.isActive) {
    throw new AppError(403, "ACCESS_DENIED", `${email} does not have access. Ask an admin to add you.`);
  }
  const set = { lastLoginAt: new Date() };
  if (picture) set.picture = picture;
  if (name && !user.name) set.name = name;
  await User.updateOne({ _id: user._id }, { $set: set });
  return { ...user.toObject(), ...set };
}

export function homeFor(role) {
  if (role === "PSM") return "/psm";
  if (role === "POOL_MANAGER") return "/admin/eligible-pool";
  if (role === "ADMIN") return config.auth.adminHome;
  return "/crm";
}

export function serializeUser(user) {
  return {
    email: user.email,
    name: user.name || user.email.split("@")[0],
    role: user.role,
    products: user.role === "POOL_MANAGER" ? (user.products ?? []) : [],
    picture: user.picture ?? null,
    hubspotOwner: hubspotOwnerForUser(user),
  };
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.auth.cookieSecure,
  sameSite: config.auth.cookieSameSite,
  path: "/",
});

export function issueSession(res, user) {
  const token = jwt.sign({ role: user.role }, config.auth.jwtSecret, {
    subject: user.email,
    expiresIn: `${config.auth.sessionTtlHours}h`,
    issuer: "job-flow",
    audience: "job-flow-web",
    algorithm: "HS256",
  });
  res.cookie(config.auth.cookieName, token, { ...cookieOptions(), maxAge: config.auth.sessionTtlHours * 3600 * 1000 });
}

export function clearSession(res) {
  res.clearCookie(config.auth.cookieName, cookieOptions());
}

export function readSession(token) {
  try {
    return jwt.verify(token, config.auth.jwtSecret, {
      issuer: "job-flow",
      audience: "job-flow-web",
      algorithms: ["HS256"],
    });
  } catch {
    return null;
  }
}

const DEMO_USERS = [
  { email: "crm@example.com", name: "Demo CRM", role: "CRM" },
  { email: "psm@example.com", name: "Demo PSM", role: "PSM" },
  { email: "admin@example.com", name: "Demo Admin", role: "ADMIN" },
];

export async function bootstrapUsers() {
  for (const email of config.auth.bootstrapAdminEmails) {
    await User.updateOne({ email }, { $setOnInsert: { email, role: "ADMIN", isActive: true } }, { upsert: true });
  }
  for (const user of await User.find({ hubspotOwnerId: null }).select("email").lean()) {
    const owner = hubspotOwnerForEmail(user.email);
    if (owner) await User.updateOne({ _id: user._id }, { $set: ownerFields(owner) });
  }
  const allMock = Object.values(config.modes).every((mode) => mode === "mock");
  if (!config.isProduction && allMock && config.mock.seedUsers) {
    for (const user of DEMO_USERS) {
      await User.updateOne({ email: user.email }, { $setOnInsert: { ...user, isActive: true } }, { upsert: true });
    }
    logger.info("Demo users ready: crm@example.com, psm@example.com, admin@example.com (dev login)");
  }
}
