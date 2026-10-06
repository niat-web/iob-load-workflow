import "./setup.js";
import crypto from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import request from "supertest";
import { setMicrosoftKeySource } from "../src/services/authService.js";
import { AppError } from "../src/utils/errors.js";
import { XHR, api, app, createUser, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const CLIENT = process.env.MICROSOFT_CLIENT_ID;
const TENANT = process.env.MICROSOFT_TENANT_ID;
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: "company-key", use: "sig", alg: "RS256" };

function microsoftToken(claims = {}, { audience = CLIENT, tenant = TENANT, privateKey = keys.privateKey, kid = "company-key", expiresIn = "1h" } = {}) {
  return jwt.sign({ tid: tenant, email: "crm.user@example.com", name: "CRM User", ...claims }, privateKey, {
    algorithm: "RS256",
    keyid: kid,
    audience,
    issuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
    expiresIn,
  });
}

const signIn = (idToken, agent = api()) => agent.post("/api/auth/microsoft").set(XHR).send({ idToken });

describe("Microsoft sign-in", () => {
  let keyDownloads;
  before(startTestDb);
  after(async () => {
    setMicrosoftKeySource(null);
    await stopTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    keyDownloads = 0;
    setMicrosoftKeySource(async () => {
      keyDownloads += 1;
      return [jwk];
    });
  });

  test("the login page gets the Microsoft app and tenant, and no Google settings", async () => {
    const response = await api().get("/api/auth/config");
    assert.deepEqual(response.body, { microsoftClientId: CLIENT, microsoftTenantId: TENANT, devLoginEnabled: true });
    assert.equal((await api().post("/api/auth/google").set(XHR).send({ credential: "x".repeat(30) })).status, 404);
  });

  test("a company account in the user list is signed in with its role", async () => {
    await createUser("crm.user@example.com", "CRM");
    const agent = request.agent(app);
    const response = await signIn(microsoftToken(), agent);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, "CRM");
    assert.equal(response.body.redirectTo, "/crm");
    assert.equal((await agent.get("/api/auth/me")).body.user.email, "crm.user@example.com");
  });

  test("the account name is used when the token has no email claim, and keys are cached", async () => {
    await createUser("psm.user@example.com", "PSM");
    const token = microsoftToken({ email: undefined, preferred_username: "PSM.User@example.com" });
    assert.equal((await signIn(token)).body.user.email, "psm.user@example.com");
    await signIn(token);
    assert.equal(keyDownloads, 1);
  });

  test("tokens from another tenant, for another app, expired or forged are refused", async () => {
    await createUser("crm.user@example.com", "CRM");
    const otherTenant = await signIn(microsoftToken({}, { tenant: "99999999-9999-4999-8999-999999999999" }));
    assert.equal(otherTenant.status, 401);
    const otherApp = await signIn(microsoftToken({}, { audience: "00000000-0000-4000-8000-000000000000" }));
    assert.equal(otherApp.status, 401);
    const expired = await signIn(microsoftToken({}, { expiresIn: -120 }));
    assert.equal(expired.status, 401);
    const old = await signIn(microsoftToken({ iat: Math.floor(Date.now() / 1000) - 3600 }));
    assert.equal(old.status, 401);
    assert.match(old.body.error.message, /expired/);
    const forged = await signIn(microsoftToken({}, { privateKey: strangerKeys.privateKey }));
    assert.equal(forged.status, 401);
    const unknownKey = await signIn(microsoftToken({}, { kid: "someone-else" }));
    assert.equal(unknownKey.status, 401);
    assert.equal(otherTenant.body.error.code, "INVALID_MICROSOFT_TOKEN");
  });

  test("a company account that is not in the user list is denied", async () => {
    const response = await signIn(microsoftToken({ email: "new.joiner@example.com" }));
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "ACCESS_DENIED");
  });

  test("when Microsoft's keys cannot be downloaded, sign-in says to try again", async () => {
    setMicrosoftKeySource(async () => {
      throw new AppError(503, "MICROSOFT_UNAVAILABLE", "Microsoft sign-in is unavailable right now. Try again.");
    });
    await createUser("crm.user@example.com", "CRM");
    const response = await signIn(microsoftToken());
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "MICROSOFT_UNAVAILABLE");
  });
});
