import "./setup.js";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import request from "supertest";
import { setGoogleKeySource } from "../src/services/authService.js";
import { AppError } from "../src/utils/errors.js";
import { XHR, api, app, createUser, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const CLIENT = process.env.GOOGLE_CLIENT_ID;
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "google-key", use: "sig", alg: "RS256" };

function googleToken(
  claims = {},
  { audience = CLIENT, issuer = "https://accounts.google.com", privateKey = keys.privateKey, kid = "google-key", expiresIn = "1h" } = {},
) {
  return jwt.sign({ email: "crm.user@example.com", email_verified: true, name: "CRM User", ...claims }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    audience,
    issuer,
    expiresIn,
  });
}

const signIn = (credential, agent = api()) => agent.post("/api/auth/google").set(XHR).send({ credential });

describe("Google sign-in", () => {
  let keyDownloads;
  before(startTestDb);
  after(async () => {
    setGoogleKeySource(null);
    await stopTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    keyDownloads = 0;
    setGoogleKeySource(async () => {
      keyDownloads += 1;
      return [jwk];
    });
  });

  test("the login page gets the Google client ID, and the old Microsoft route is gone", async () => {
    const response = await api().get("/api/auth/config");
    assert.deepEqual(response.body, { googleClientId: CLIENT, devLoginEnabled: true, emailCodeEnabled: true });
    assert.equal((await api().post("/api/auth/microsoft").set(XHR).send({ idToken: "x".repeat(30) })).status, 404);
  });

  test("a Google account in the user list is signed in with its role, and keys are cached", async () => {
    await createUser("crm.user@example.com", "CRM");
    const agent = request.agent(app);
    const response = await signIn(googleToken({ picture: "https://lh3.googleusercontent.com/a/photo" }), agent);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, "CRM");
    assert.equal(response.body.redirectTo, "/crm");
    assert.equal((await agent.get("/api/auth/me")).body.user.email, "crm.user@example.com");
    await signIn(googleToken({ email: "CRM.User@example.com" }, { issuer: "accounts.google.com" }));
    assert.equal(keyDownloads, 1);
  });

  test("tokens for another app, from another issuer, expired, old, forged or unverified are refused", async () => {
    await createUser("crm.user@example.com", "CRM");
    const otherApp = await signIn(googleToken({}, { audience: "999-other.apps.googleusercontent.com" }));
    assert.equal(otherApp.status, 401);
    assert.equal(otherApp.body.error.code, "INVALID_GOOGLE_TOKEN");
    assert.equal((await signIn(googleToken({}, { issuer: "https://evil.example.com" }))).status, 401);
    assert.equal((await signIn(googleToken({}, { expiresIn: -120 }))).status, 401);
    const old = await signIn(googleToken({ iat: Math.floor(Date.now() / 1000) - 3600 }));
    assert.equal(old.status, 401);
    assert.match(old.body.error.message, /expired/);
    assert.equal((await signIn(googleToken({}, { privateKey: strangerKeys.privateKey }))).status, 401);
    assert.equal((await signIn(googleToken({}, { kid: "someone-else" }))).status, 401);
    const unverified = await signIn(googleToken({ email_verified: false }));
    assert.equal(unverified.status, 401);
    assert.match(unverified.body.error.message, /not verified/);
  });

  test("a Google account that is not in the user list is denied", async () => {
    const response = await signIn(googleToken({ email: "new.joiner@example.com" }));
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "ACCESS_DENIED");
  });

  test("when Google's keys cannot be downloaded, sign-in says to try again", async () => {
    setGoogleKeySource(async () => {
      throw new AppError(503, "GOOGLE_UNAVAILABLE", "Google sign-in is unavailable right now. Try again.");
    });
    await createUser("crm.user@example.com", "CRM");
    const response = await signIn(googleToken());
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "GOOGLE_UNAVAILABLE");
  });
});
