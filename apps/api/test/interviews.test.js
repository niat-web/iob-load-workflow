import "./setup.js";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config/env.js";
import { AuditLog, CompanySettings, GoogleConnection, InterviewMeet } from "../src/models/index.js";
import { setGoogleOAuthFactory } from "../src/services/googleConnectionService.js";
import { LiveGoogleMeetClient, MockGoogleMeetClient } from "../src/services/googleMeetClient.js";
import { integrations, overrideIntegration } from "../src/services/integrations.js";
import { encrypt } from "../src/utils/crypto.js";
import { IntegrationError } from "../src/utils/errors.js";
import { XHR, api, loginAs, nowMs, resetDb, runToPsmReview, startTestDb, stopTestDb } from "./helpers.js";

const CRM_EMAIL = "crm.user@example.com";
const INTERVIEWER = "hiring.lead@company.example.com";

describe("Interviews page and Google Meet", () => {
  let crm;
  let psm;
  let job;
  let sharedBase;
  let base;

  const meetBody = (overrides = {}) => ({
    eventName: "Interview",
    description: "First round",
    startAt: new Date(nowMs() + 24 * 60 * 60 * 1000).toISOString(),
    durationMinutes: 30,
    timeZone: "Asia/Kolkata",
    studentEmail: "student.one@students.example.com",
    interviewerEmails: [INTERVIEWER],
    otherEmails: [],
    saveInterviewers: true,
    ...overrides,
  });

  before(startTestDb);
  after(stopTestDb);
  beforeEach(async () => {
    await resetDb();
    crm = await loginAs(CRM_EMAIL, "CRM");
    psm = await loginAs("psm.user@example.com", "PSM");
    job = await runToPsmReview(crm, "12345");
    await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
    sharedBase = `/api/shared/profiles/${job.learningPortalJobId}`;
    base = `/api/interviews/jobs/${job._id}`;
  });

  test("CRMs see every shared profiles link with its company; PSMs cannot open the page", async () => {
    const list = await crm.get("/api/interviews/companies");
    assert.equal(list.status, 200);
    const item = list.body.items.find((entry) => entry.jobId === String(job._id));
    assert.equal(item.companyName, job.companyName);
    assert.equal(item.url, `http://localhost:5173/shared/profiles/${job.learningPortalJobId}`);
    assert.equal(item.linkStatus, "ACTIVE");
    assert.ok(item.profiles > 0);
    assert.equal(item.meets, 0);
    assert.equal((await psm.get("/api/interviews/companies")).status, 403);
    assert.equal((await api().get("/api/interviews/companies")).status, 401);
  });

  test("the sheet adds internal columns, fills student emails and keeps them off the shared page", async () => {
    const sheet = (await crm.get(base)).body;
    const internal = sheet.columns.filter((column) => column.internal).map((column) => column.key);
    assert.deepEqual(internal, ["studentEmail", "meetLink", "meetTime", "recording"]);
    assert.ok(sheet.rows[0].values.studentEmail.endsWith("@students.example.com"), "student email comes from our database");
    assert.equal(sheet.meetEnabled, true);
    assert.equal(sheet.meetProblem, null);

    const first = sheet.rows[0];
    assert.equal((await crm.patch(`${base}/rows/${first.id}`).set(XHR).send({ key: "meetLink", value: "https://meet.google.com/abc-defg-hij" })).status, 204);
    assert.equal((await crm.patch(`${base}/rows/${first.id}`).set(XHR).send({ key: "recording", value: "x" })).status, 400);
    assert.equal((await crm.patch(`${base}/rows/${first.id}`).set(XHR).send({ key: "candidateStatus", value: "Shortlisted" })).status, 204);

    const column = (await crm.post(`${base}/columns`).set(XHR).send({ label: "Panel notes" })).body.column;
    assert.match(column.key, /^i_/);
    assert.equal((await crm.patch(`${base}/rows/${first.id}`).set(XHR).send({ key: column.key, value: "Strong" })).status, 204);
    assert.equal((await crm.patch(`${base}/columns/${column.key}`).set(XHR).send({ label: "Panel" })).status, 204);

    const saved = await crm.patch(`${base}/interviewers`).set(XHR).send({ emails: [INTERVIEWER, INTERVIEWER.toUpperCase()] });
    assert.deepEqual(saved.body.interviewerEmails, [INTERVIEWER]);

    const current = (await crm.get(base)).body;
    assert.equal(current.rows[0].values.meetLink, "https://meet.google.com/abc-defg-hij");
    assert.equal(current.rows[0].values[column.key], "Strong");
    assert.equal(current.columns.find((item) => item.key === column.key).label, "Panel");
    assert.deepEqual(current.interviewerEmails, [INTERVIEWER]);

    const shared = (await api().get(sharedBase)).body;
    assert.equal(shared.rows[0].values.candidateStatus, "Shortlisted", "shared cells are the same data");
    const serialized = JSON.stringify(shared);
    for (const hidden of [INTERVIEWER, "meet.google.com", "studentEmail", "meetLink", "Panel", "Strong", "students.example.com"]) {
      assert.ok(!serialized.includes(hidden), `${hidden} is not on the shared page`);
    }

    assert.equal((await crm.delete(`${base}/columns/${column.key}`).set(XHR)).status, 204);
    assert.ok(!(await crm.get(base)).body.columns.some((item) => item.key === column.key));
  });

  test("Meet creates one calendar event with the CRM, student and interviewers, turns on recording and reschedules in place", async () => {
    const sheet = (await crm.get(base)).body;
    const row = sheet.rows[0];
    const created = await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody());
    assert.equal(created.status, 200, JSON.stringify(created.body));
    assert.match(created.body.meet.meetUrl, /^https:\/\/meet\.google\.com\//);
    assert.equal(created.body.meet.recording.status, "ON");
    assert.equal(created.body.meet.organizerEmail, CRM_EMAIL);

    const client = integrations.meet;
    const create = client.calls.find((call) => call.type === "create");
    assert.equal(create.organizer, CRM_EMAIL);
    assert.deepEqual(create.attendees, [CRM_EMAIL, "student.one@students.example.com", INTERVIEWER]);
    assert.match(create.eventId, /^jf[0-9a-f]{24}$/);
    assert.ok(client.calls.some((call) => call.type === "recording"));

    const after = (await crm.get(base)).body.rows.find((item) => item.id === row.id);
    assert.equal(after.values.meetLink, created.body.meet.meetUrl);
    assert.equal(after.values.studentEmail, "student.one@students.example.com");
    assert.match(after.values.meetTime, /\(30 min\)$/);
    assert.equal(after.values.recording, "On, with transcript");
    assert.equal(after.meet.eventName, "Interview");
    assert.deepEqual((await CompanySettings.findOne({ interviewerEmails: INTERVIEWER }).lean()).interviewerEmails, [INTERVIEWER]);

    const moved = await crm
      .post(`${base}/rows/${row.id}/meet`)
      .set(XHR)
      .send(meetBody({ durationMinutes: 45, interviewerEmails: [], saveInterviewers: false }));
    assert.equal(moved.status, 200);
    assert.equal(moved.body.meet.meetUrl, created.body.meet.meetUrl, "same Meet link after a reschedule");
    assert.equal(client.calls.filter((call) => call.type === "create").length, 1);
    assert.equal(client.calls.filter((call) => call.type === "recording").length, 1, "recording is not set twice");
    assert.equal(await InterviewMeet.countDocuments(), 1);
    assert.equal(await AuditLog.countDocuments({ action: "INTERVIEW_MEET_UPDATED" }), 1);

    const list = (await crm.get("/api/interviews/companies")).body.items[0];
    assert.equal(list.meets, 1);
    assert.equal(list.interviewers, 1);
    assert.ok(!JSON.stringify((await api().get(sharedBase)).body).includes("meet.google.com"));
  });

  test("Meet is refused when turned off, in the past or without a valid student email", async () => {
    const row = (await crm.get(base)).body.rows[0];
    const past = await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody({ startAt: new Date(nowMs() - 60 * 60 * 1000).toISOString() }));
    assert.equal(past.status, 400);
    assert.equal((await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody({ studentEmail: "nope" }))).status, 400);
    assert.equal((await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody({ timeZone: "Mars/Base" }))).status, 400);

    const admin = await loginAs("admin.user@example.com", "ADMIN");
    assert.equal((await admin.patch("/api/admin/settings").set(XHR).send({ interviews: { googleMeet: false } })).status, 200);
    const off = await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody());
    assert.equal(off.status, 409);
    assert.equal(off.body.error.code, "MEET_OFF");
    assert.equal((await crm.get(base)).body.meetEnabled, false);
    assert.equal(await InterviewMeet.countDocuments(), 0);
  });

  test("the Meet is kept when Google refuses auto-recording, and Google errors come back as clear messages", async () => {
    const row = (await crm.get(base)).body.rows[0];
    const client = new MockGoogleMeetClient();
    client.enableRecording = async () => {
      throw new IntegrationError("Google could not turn on auto-recording: Permission denied", { integration: "meet" });
    };
    overrideIntegration("meet", client);
    const created = await crm.post(`${base}/rows/${row.id}/meet`).set(XHR).send(meetBody());
    assert.equal(created.status, 200);
    assert.equal(created.body.meet.recording.status, "FAILED");
    assert.match(created.body.values.recording, /^Not on: Google could not turn on auto-recording/);

    const broken = new MockGoogleMeetClient();
    broken.createMeeting = async () => {
      throw new IntegrationError("Google did not let the app act as crm.user@example.com.", { integration: "meet" });
    };
    overrideIntegration("meet", broken);
    const other = (await crm.get(base)).body.rows[1];
    const failed = await crm.post(`${base}/rows/${other.id}/meet`).set(XHR).send(meetBody());
    assert.equal(failed.status, 502);
    assert.equal(failed.body.error.code, "MEET_FAILED");
    assert.match(failed.body.error.message, /act as crm\.user@example\.com/);
    assert.equal((await InterviewMeet.findOne({ rowId: other.id }).lean()).busyAt, null, "the row is free to try again");
  });
});

describe("Google Meet live client requests", () => {
  const details = {
    summary: "Interview",
    description: "First round",
    startAt: new Date("2026-05-02T09:30:00Z"),
    endAt: new Date("2026-05-02T10:00:00Z"),
    timeZone: "Asia/Kolkata",
    attendees: ["crm@company.test", "student@mail.test"],
  };

  function stubbed(handler) {
    const client = new LiveGoogleMeetClient({ credentials: { client_email: "svc@test", private_key: "key" }, timeoutMs: 1000 });
    const requests = [];
    client.client = (organizer) => ({
      request: async (options) => {
        requests.push({ organizer, ...options });
        return { data: await handler(options, requests.length) };
      },
    });
    return { client, requests };
  }

  test("creates the event with a Meet link as the organizer, then turns on recording and transcripts", async () => {
    const { client, requests } = stubbed((options) => {
      if (options.url.includes("/calendar/")) {
        return {
          id: "jfabc",
          htmlLink: "https://calendar.google.com/event?eid=1",
          hangoutLink: "https://meet.google.com/abc-defg-hij",
          conferenceData: { conferenceId: "abc-defg-hij", createRequest: { status: { statusCode: "success" } } },
        };
      }
      return options.method === "GET" ? { name: "spaces/XyZ123" } : {};
    });
    const meeting = await client.createMeeting({ organizer: "crm@company.test", eventId: "jfabc", ...details });
    assert.deepEqual(meeting, {
      eventId: "jfabc",
      eventLink: "https://calendar.google.com/event?eid=1",
      meetUrl: "https://meet.google.com/abc-defg-hij",
      meetingCode: "abc-defg-hij",
    });
    const [insert] = requests;
    assert.equal(insert.method, "POST");
    assert.equal(insert.url, "https://www.googleapis.com/calendar/v3/calendars/primary/events");
    assert.deepEqual(insert.params, { conferenceDataVersion: 1, sendUpdates: "all" });
    assert.deepEqual(insert.data.attendees, [{ email: "crm@company.test" }, { email: "student@mail.test" }]);
    assert.deepEqual(insert.data.conferenceData.createRequest, { requestId: "jfabc", conferenceSolutionKey: { type: "hangoutsMeet" } });
    assert.deepEqual(insert.data.start, { dateTime: "2026-05-02T09:30:00.000Z", timeZone: "Asia/Kolkata" });

    const result = await client.enableRecording({ organizer: "crm@company.test", meetingCode: "abc-defg-hij" });
    assert.deepEqual(result, { spaceName: "spaces/XyZ123", transcript: true });
    const [, get, recording, transcript] = requests;
    assert.equal(get.url, "https://meet.googleapis.com/v2/spaces/abc-defg-hij");
    assert.equal(recording.url, "https://meet.googleapis.com/v2/spaces/XyZ123");
    assert.equal(recording.method, "PATCH");
    assert.deepEqual(recording.params, { updateMask: "config.artifactConfig.recordingConfig.autoRecordingGeneration" });
    assert.deepEqual(recording.data, { config: { artifactConfig: { recordingConfig: { autoRecordingGeneration: "ON" } } } });
    assert.deepEqual(transcript.data, { config: { artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: "ON" } } } });
    assert.ok(requests.every((request) => request.organizer === "crm@company.test"));
  });

  test("an event that already exists is updated instead of duplicated, and delegation errors say what to fix", async () => {
    const { client, requests } = stubbed((options) => {
      if (options.method === "POST") throw Object.assign(new Error("duplicate"), { response: { status: 409 } });
      return { id: "jfabc", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij" } };
    });
    const meeting = await client.createMeeting({ organizer: "crm@company.test", eventId: "jfabc", ...details });
    assert.equal(meeting.meetUrl, "https://meet.google.com/abc-defg-hij");
    assert.equal(requests[1].method, "PATCH");
    assert.equal(requests[1].url, "https://www.googleapis.com/calendar/v3/calendars/primary/events/jfabc");

    const denied = stubbed(() => {
      throw Object.assign(new Error("unauthorized_client: Client is unauthorized to retrieve access tokens"), {
        response: { status: 401, data: { error: "unauthorized_client" } },
      });
    });
    await assert.rejects(
      denied.client.createMeeting({ organizer: "crm@company.test", eventId: "jfabc", ...details }),
      (error) => error instanceof IntegrationError && /domain-wide delegation/.test(error.message) && error.retryable === false,
    );
  });

  test("recording still counts as on when only transcripts are refused", async () => {
    const { client } = stubbed((options) => {
      if (options.method === "GET") return { name: "spaces/XyZ123" };
      if (options.params.updateMask.includes("transcription")) throw Object.assign(new Error("denied"), { response: { status: 403 } });
      return {};
    });
    assert.deepEqual(await client.enableRecording({ organizer: "crm@company.test", meetingCode: "abc-defg-hij" }), {
      spaceName: "spaces/XyZ123",
      transcript: false,
    });
  });
});

describe("Connect Google for Meet", () => {
  const ORGANIZER = "interviews@company.test";
  const SCOPES = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/meetings.space.settings";
  let crm;
  let google;

  function fakeGoogle() {
    const fake = {
      email: ORGANIZER,
      scope: SCOPES,
      refreshToken: "refresh-token-from-google",
      revoked: [],
      requests: [],
      failWith: null,
      generateAuthUrl: (opts) => `https://accounts.google.test/auth?${new URLSearchParams({ ...opts, scope: opts.scope.join(" ") })}`,
      getToken: async () => ({ tokens: { refresh_token: fake.refreshToken, id_token: "id-token", scope: fake.scope } }),
      verifyIdToken: async () => ({ getPayload: () => ({ email: fake.email }) }),
      setCredentials: (credentials) => {
        fake.credentials = credentials;
      },
      revokeToken: async (token) => {
        fake.revoked.push(token);
      },
      request: async (options) => {
        fake.requests.push(options);
        if (fake.failWith) throw fake.failWith;
        return { data: { id: "jfevent", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij" } } };
      },
    };
    return fake;
  }

  async function connect(agent = crm) {
    const start = await agent.get("/api/interviews/google/connect?returnTo=/crm/interviews");
    assert.equal(start.status, 302);
    const state = new URL(start.headers.location).searchParams.get("state");
    return agent.get(`/api/interviews/google/callback?code=auth-code&state=${state}`);
  }

  before(startTestDb);
  after(async () => {
    setGoogleOAuthFactory(null);
    await stopTestDb();
  });
  beforeEach(async () => {
    await resetDb();
    google = fakeGoogle();
    setGoogleOAuthFactory(() => google);
    crm = await loginAs(CRM_EMAIL, "CRM");
  });

  test("Connect Google asks for offline Calendar + Meet access and stores the permission encrypted", async () => {
    const start = await crm.get("/api/interviews/google/connect");
    assert.equal(start.status, 302);
    const url = new URL(start.headers.location);
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("scope"), SCOPES);
    assert.ok(url.searchParams.get("state").length > 20);
    assert.match(start.headers["set-cookie"].join(";"), /jf_google_state=.*HttpOnly/);

    const wrongState = await crm.get("/api/interviews/google/callback?code=auth-code&state=forged");
    assert.equal(wrongState.headers.location, "http://localhost:5173/crm/interviews?google=state");

    const done = await connect();
    assert.equal(done.status, 302);
    assert.equal(done.headers.location, "http://localhost:5173/crm/interviews?google=connected");
    const stored = await GoogleConnection.findById("meet").lean();
    assert.equal(stored.email, ORGANIZER);
    assert.equal(stored.connectedBy, CRM_EMAIL);
    assert.ok(!stored.refreshToken.includes(google.refreshToken), "the refresh token is encrypted");
    assert.equal(await AuditLog.countDocuments({ action: "GOOGLE_MEET_ACCOUNT_CONNECTED" }), 1);

    const status = (await crm.get("/api/interviews/google")).body;
    assert.equal(status.connected, true);
    assert.equal(status.email, ORGANIZER);
    assert.ok(!JSON.stringify(status).includes(google.refreshToken), "the token never leaves the server");

    assert.equal((await crm.delete("/api/interviews/google").set(XHR)).status, 204);
    assert.deepEqual(google.revoked, [google.refreshToken]);
    assert.equal((await crm.get("/api/interviews/google")).body.connected, false);
    const psm = await loginAs("psm.user@example.com", "PSM");
    assert.equal((await psm.get("/api/interviews/google/connect")).status, 403);
  });

  test("the wrong account, missing permissions and a cancelled sign-in are refused", async () => {
    const original = config.meet.organizerEmail;
    config.meet.organizerEmail = ORGANIZER;
    try {
      google.email = "someone.else@company.test";
      assert.match((await connect()).headers.location, /google=account$/);
      assert.deepEqual(google.revoked, [google.refreshToken], "access from the wrong account is handed back");
      google.email = ORGANIZER;
      google.scope = "openid https://www.googleapis.com/auth/calendar.events";
      assert.match((await connect()).headers.location, /google=scopes$/);
      assert.equal(await GoogleConnection.countDocuments(), 0);
      assert.match((await crm.get("/api/interviews/google/callback?error=access_denied")).headers.location, /google=denied$/);
    } finally {
      config.meet.organizerEmail = original;
    }
  });

  test("once connected, every Meet is organized by the connected account and the CRM is a guest", async () => {
    const mode = config.modes.meet;
    config.modes.meet = "live";
    try {
      const psm = await loginAs("psm.user@example.com", "PSM");
      const job = await runToPsmReview(crm, "12345");
      await psm.post(`/api/psm/jobs/${job._id}/submit`).set(XHR);
      const base = `/api/interviews/jobs/${job._id}`;
      const client = new MockGoogleMeetClient();
      overrideIntegration("meet", client);
      const body = {
        eventName: "Interview",
        description: "",
        startAt: new Date(nowMs() + 24 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 30,
        timeZone: "Asia/Kolkata",
        studentEmail: "student.one@students.example.com",
        interviewerEmails: [INTERVIEWER],
        otherEmails: [],
        saveInterviewers: false,
      };

      const before = (await crm.get(base)).body;
      assert.match(before.meetProblem, /not connected yet/);
      const refused = await crm.post(`${base}/rows/${before.rows[0].id}/meet`).set(XHR).send(body);
      assert.equal(refused.status, 503);
      assert.equal(refused.body.error.code, "MEET_NOT_SET_UP");

      await connect();
      const sheet = (await crm.get(base)).body;
      assert.equal(sheet.meetProblem, null);
      assert.equal(sheet.organizerEmail, ORGANIZER);
      const created = await crm.post(`${base}/rows/${sheet.rows[0].id}/meet`).set(XHR).send(body);
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.meet.organizerEmail, ORGANIZER);
      assert.equal(created.body.meet.recording.status, "ON");
      const create = client.calls.find((call) => call.type === "create");
      assert.equal(create.organizer, ORGANIZER);
      assert.deepEqual(create.attendees, [CRM_EMAIL, "student.one@students.example.com", INTERVIEWER]);
    } finally {
      config.modes.meet = mode;
    }
  });

  test("the live client uses the stored permission and asks to reconnect when Google withdraws it", async () => {
    await GoogleConnection.create({
      _id: "meet",
      email: ORGANIZER,
      refreshToken: encrypt("stored-refresh-token", config.encryptionSecret),
      connectedAt: new Date(nowMs()),
    });
    const live = new LiveGoogleMeetClient({ credentials: undefined, timeoutMs: 1000 });
    const details = {
      summary: "Interview",
      description: "",
      startAt: new Date(nowMs() + 3600000),
      endAt: new Date(nowMs() + 5400000),
      timeZone: "Asia/Kolkata",
      attendees: [CRM_EMAIL],
    };
    const meeting = await live.createMeeting({ organizer: ORGANIZER, eventId: "jfevent", ...details });
    assert.equal(meeting.meetUrl, "https://meet.google.com/abc-defg-hij");
    assert.deepEqual(google.credentials, { refresh_token: "stored-refresh-token" });
    assert.deepEqual(google.requests[0].params, { conferenceDataVersion: 1, sendUpdates: "all" });

    google.failWith = Object.assign(new Error("invalid_grant"), { response: { status: 400, data: { error: "invalid_grant" } } });
    await assert.rejects(
      live.createMeeting({ organizer: ORGANIZER, eventId: "jfevent2", ...details }),
      (error) => error instanceof IntegrationError && /Reconnect Google/.test(error.message) && error.retryable === false,
    );
    const stored = await GoogleConnection.findById("meet").lean();
    assert.equal(stored.status, "REVOKED");
    const mode = config.modes.meet;
    config.modes.meet = "live";
    try {
      assert.match((await crm.get("/api/interviews/google")).body.problem, /Reconnect Google/);
    } finally {
      config.modes.meet = mode;
    }
  });
});

