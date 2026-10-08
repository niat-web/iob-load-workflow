import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { AuditLog, LoginCode } from "../src/models/index.js";
import { overrideIntegration } from "../src/services/integrations.js";
import { XHR, advance, api, app, createUser, resetDb, startTestDb, stopTestDb } from "./helpers.js";

const EMAIL = "crm.user@example.com";

describe("email sign-in with a one-time code", () => {
  let inbox;

  const latestCode = () => inbox.at(-1)?.text.match(/\b(\d{6})\b/)?.[1];
  const sendCode = (email = EMAIL) => api().post("/api/auth/email/code").set(XHR).send({ email });
  const verify = (code, email = EMAIL, agent = api()) => agent.post("/api/auth/email/verify").set(XHR).send({ email, code });

  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    inbox = [];
    overrideIntegration("ses", {
      send: async (message) => {
        inbox.push(message);
        return { messageId: `test-${inbox.length}` };
      },
    });
    await createUser(EMAIL, "CRM");
  });

  test("the sign-in page offers email codes", async () => {
    const config = (await api().get("/api/auth/config")).body;
    assert.equal(config.emailCodeEnabled, true);
  });

  test("a code is emailed to a user with access and signs them in once", async () => {
    const sent = await sendCode(EMAIL.toUpperCase());
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.body, { sent: true, expiresInMinutes: 10, resendAfterSeconds: 60 });
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].to, EMAIL);
    const code = latestCode();
    assert.match(code, /^\d{6}$/);
    assert.ok(inbox[0].subject.includes(code));
    const stored = await LoginCode.findById(EMAIL).lean();
    assert.ok(!JSON.stringify(stored).includes(code), "only a hash of the code is stored");

    const agent = request.agent(app);
    const signedIn = await verify(code, EMAIL, agent);
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.equal(signedIn.body.user.email, EMAIL);
    assert.equal((await agent.get("/api/auth/me")).body.user.role, "CRM");
    assert.equal(await AuditLog.countDocuments({ action: "USER_LOGIN", "metadata.method": "email_code" }), 1);

    assert.equal((await verify(code)).status, 400, "a code works only once");
  });

  test("unknown or inactive emails get the same answer but no email", async () => {
    await createUser("old.crm@example.com", "CRM", { isActive: false });
    for (const email of ["stranger@example.com", "old.crm@example.com"]) {
      const sent = await sendCode(email);
      assert.equal(sent.status, 200);
      assert.equal(sent.body.sent, true);
    }
    assert.equal(inbox.length, 0);
    assert.equal(await LoginCode.countDocuments(), 0);
    assert.equal((await verify("123456", "stranger@example.com")).status, 400);
  });

  test("a new code waits a minute, and the old one stops working", async () => {
    await sendCode();
    const first = latestCode();
    await sendCode();
    assert.equal(inbox.length, 1, "no second email within a minute");
    advance({ seconds: 61 });
    await sendCode();
    assert.equal(inbox.length, 2);
    const second = latestCode();
    if (first !== second) assert.equal((await verify(first)).status, 400);
    assert.equal((await verify(second)).status, 200);
  });

  test("codes expire after 10 minutes", async () => {
    await sendCode();
    advance({ minutes: 10, seconds: 1 });
    const late = await verify(latestCode());
    assert.equal(late.status, 400);
    assert.equal(late.body.error.code, "INVALID_CODE");
  });

  test("five wrong tries end the code", async () => {
    await sendCode();
    const code = latestCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let attempt = 1; attempt <= 4; attempt += 1) assert.equal((await verify(wrong)).status, 400);
    const last = await verify(wrong);
    assert.match(last.body.error.message, /Too many wrong tries/);
    assert.equal((await verify(code)).status, 400, "the right code no longer works");
    assert.equal(await LoginCode.countDocuments(), 0);
  });

  test("a code for a removed user does not sign them in", async () => {
    await sendCode();
    const code = latestCode();
    await createUser(EMAIL, "CRM", { isActive: false });
    const denied = await verify(code);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, "ACCESS_DENIED");
  });

  test("a failed email lets the user try again straight away", async () => {
    overrideIntegration("ses", {
      send: async () => {
        throw new Error("SES down");
      },
    });
    const failed = await sendCode();
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error.code, "CODE_NOT_SENT");
    assert.equal(await LoginCode.countDocuments(), 0);
    assert.equal((await verify("12345")).status, 400, "the code must have 6 digits");
  });
});
