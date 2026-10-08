import crypto from "node:crypto";
import { JWT } from "google-auth-library";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { MEET_SCOPES, connectedMeetClient, markGoogleRevoked } from "./googleConnectionService.js";

export { MEET_SCOPES };

const CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const MEET_API_URL = "https://meet.googleapis.com/v2";
const CONFERENCE_CHECKS = 6;
const CONFERENCE_WAIT_MS = 1000;

const RECORDING_MASK = "config.artifactConfig.recordingConfig.autoRecordingGeneration";
const TRANSCRIPT_MASK = "config.artifactConfig.transcriptionConfig.autoTranscriptionGeneration";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function eventBody({ summary, description, startAt, endAt, timeZone, attendees }) {
  return {
    summary,
    description,
    status: "confirmed",
    start: { dateTime: startAt.toISOString(), timeZone },
    end: { dateTime: endAt.toISOString(), timeZone },
    attendees: attendees.map((email) => ({ email })),
    guestsCanInviteOthers: false,
  };
}

function toMeeting(event) {
  const video = event?.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video");
  return {
    eventId: event.id,
    eventLink: event.htmlLink ?? null,
    meetUrl: event.hangoutLink ?? video?.uri ?? null,
    meetingCode: event.conferenceData?.conferenceId ?? null,
  };
}

function googleReason(error) {
  const data = error?.response?.data;
  return data?.error?.message ?? data?.error_description ?? (typeof data?.error === "string" ? data.error : null) ?? error?.message ?? "unknown error";
}

function meetError(error, organizer, step, connected) {
  const status = error?.response?.status ?? error?.status;
  const reason = googleReason(error);
  const text = `${reason} ${error?.message ?? ""}`;
  const denied = connected
    ? /invalid_grant|unauthorized_client|insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(text)
    : /unauthorized_client|invalid_grant|access_denied|Precondition check failed/i.test(text);
  let message = `Google could not ${step}: ${reason}`;
  if (denied && connected) {
    message = `Google access for ${organizer} was removed or has expired. Click Reconnect Google on the Interviews page.`;
  } else if (denied) {
    message = `Google did not let the app act as ${organizer}. Check that ${organizer} is a Google Workspace account and that the Workspace admin has turned on domain-wide delegation for the service account with the Calendar and Meet scopes.`;
  }
  const mapped = new IntegrationError(message, {
    integration: "meet",
    status,
    retryable: !denied && (!status || status === 429 || status >= 500),
    cause: error,
  });
  mapped.revoked = denied && connected;
  return mapped;
}

export class LiveGoogleMeetClient {
  constructor({ credentials, timeoutMs }) {
    this.credentials = credentials;
    this.timeoutMs = timeoutMs;
    this.clients = new Map();
  }

  async client(organizer) {
    if (!this.credentials) return (await connectedMeetClient()).client;
    if (!this.clients.has(organizer)) {
      this.clients.set(
        organizer,
        new JWT({
          email: this.credentials.client_email,
          key: this.credentials.private_key,
          scopes: [...MEET_SCOPES],
          subject: organizer,
        }),
      );
    }
    return this.clients.get(organizer);
  }

  async failure(error, organizer, step) {
    if (error instanceof IntegrationError) return error;
    const mapped = meetError(error, organizer, step, !this.credentials);
    if (mapped.revoked) await markGoogleRevoked(mapped.message);
    return mapped;
  }

  async request(organizer, options, step) {
    try {
      const client = await this.client(organizer);
      const response = await client.request({ timeout: this.timeoutMs, ...options });
      return response.data;
    } catch (error) {
      throw await this.failure(error, organizer, step);
    }
  }

  getEvent(organizer, eventId) {
    return this.request(
      organizer,
      { url: `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, method: "GET", params: { conferenceDataVersion: 1 } },
      "read the calendar event",
    );
  }

  async waitForConference(organizer, event) {
    let current = event;
    for (let check = 0; check < CONFERENCE_CHECKS; check += 1) {
      const state = current?.conferenceData?.createRequest?.status?.statusCode;
      if (state === "failure") throw new IntegrationError("Google could not add a Meet link to the event", { integration: "meet", retryable: false });
      if (current?.hangoutLink || state === "success" || !state) return current;
      await sleep(CONFERENCE_WAIT_MS);
      current = await this.getEvent(organizer, current.id);
    }
    return current;
  }

  async createMeeting({ organizer, eventId, ...details }) {
    let event;
    try {
      const client = await this.client(organizer);
      event = await client.request({
        url: CALENDAR_EVENTS_URL,
        method: "POST",
        timeout: this.timeoutMs,
        params: { conferenceDataVersion: 1, sendUpdates: "all" },
        data: {
          id: eventId,
          ...eventBody(details),
          conferenceData: { createRequest: { requestId: eventId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
        },
      }).then((response) => response.data);
    } catch (error) {
      if ((error?.response?.status ?? error?.status) !== 409) throw await this.failure(error, organizer, "create the calendar event");
      return this.updateMeeting({ organizer, eventId, ...details });
    }
    const meeting = toMeeting(await this.waitForConference(organizer, event));
    if (!meeting.meetUrl) throw new IntegrationError("Google created the event but did not return a Meet link", { integration: "meet", retryable: true });
    return meeting;
  }

  async updateMeeting({ organizer, eventId, ...details }) {
    const event = await this.request(
      organizer,
      {
        url: `${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`,
        method: "PATCH",
        params: { conferenceDataVersion: 1, sendUpdates: "all" },
        data: eventBody(details),
      },
      "update the calendar event",
    );
    const meeting = toMeeting(await this.waitForConference(organizer, event));
    if (!meeting.meetUrl) throw new IntegrationError("The calendar event has no Meet link", { integration: "meet", retryable: false });
    return meeting;
  }

  async patchSpace(organizer, spaceName, updateMask, artifactConfig, step) {
    await this.request(
      organizer,
      { url: `${MEET_API_URL}/${spaceName}`, method: "PATCH", params: { updateMask }, data: { config: { artifactConfig } } },
      step,
    );
  }

  async enableRecording({ organizer, meetingCode }) {
    const space = await this.request(
      organizer,
      { url: `${MEET_API_URL}/spaces/${encodeURIComponent(meetingCode)}`, method: "GET" },
      "find the Meet space",
    );
    await this.patchSpace(
      organizer,
      space.name,
      RECORDING_MASK,
      { recordingConfig: { autoRecordingGeneration: "ON" } },
      "turn on auto-recording",
    );
    let transcript = true;
    try {
      await this.patchSpace(
        organizer,
        space.name,
        TRANSCRIPT_MASK,
        { transcriptionConfig: { autoTranscriptionGeneration: "ON" } },
        "turn on auto-transcripts",
      );
    } catch {
      transcript = false;
    }
    return { spaceName: space.name, transcript };
  }
}

export class MockGoogleMeetClient {
  constructor() {
    this.events = new Map();
    this.calls = [];
  }

  code() {
    const letters = () => Array.from(crypto.randomBytes(4), (byte) => String.fromCharCode(97 + (byte % 26))).join("");
    return `${letters().slice(0, 3)}-${letters()}-${letters().slice(0, 3)}`;
  }

  async createMeeting({ organizer, eventId, ...details }) {
    this.calls.push({ type: "create", organizer, eventId, ...details });
    if (this.events.has(eventId)) return this.updateMeeting({ organizer, eventId, ...details });
    const meetingCode = this.code();
    const meeting = {
      eventId,
      eventLink: `https://calendar.google.com/calendar/event?eid=${eventId}`,
      meetUrl: `https://meet.google.com/${meetingCode}`,
      meetingCode,
    };
    this.events.set(eventId, { ...meeting, organizer, ...details });
    return meeting;
  }

  async updateMeeting({ organizer, eventId, ...details }) {
    this.calls.push({ type: "update", organizer, eventId, ...details });
    const existing = this.events.get(eventId);
    if (!existing) throw new IntegrationError("The calendar event no longer exists", { integration: "meet", retryable: false });
    this.events.set(eventId, { ...existing, organizer, ...details });
    return { eventId, eventLink: existing.eventLink, meetUrl: existing.meetUrl, meetingCode: existing.meetingCode };
  }

  async enableRecording({ organizer, meetingCode }) {
    this.calls.push({ type: "recording", organizer, meetingCode });
    return { spaceName: `spaces/${meetingCode.replaceAll("-", "")}`, transcript: true };
  }
}

export function createGoogleMeetClient() {
  if (config.modes.meet !== "live") return new MockGoogleMeetClient();
  return new LiveGoogleMeetClient({ credentials: config.meet.credentials, timeoutMs: config.meet.timeoutMs });
}
