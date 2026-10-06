import crypto from "node:crypto";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { parseRetryAfter } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

function collectCallIds(body, phones) {
  const map = new Map();
  const calls = body?.calls ?? body?.data?.calls ?? body?.results ?? [];
  if (Array.isArray(calls)) {
    for (const call of calls) {
      const phone = call?.phone ?? call?.to ?? call?.number;
      const id = call?.id ?? call?.callId ?? call?.call_id;
      if (phone && id) map.set(String(phone), String(id));
    }
  }
  const requestId = body?.id ?? body?.alertId ?? body?.requestId ?? body?.data?.id ?? null;
  if (!map.size && requestId) for (const { phone } of phones) map.set(phone, String(requestId));
  return { requestId: requestId ? String(requestId) : null, callIds: map };
}

export class LiveNxtDialClient {
  async alert({ phones, variables }) {
    let response;
    try {
      response = await fetch(`${config.nxtdial.baseUrl}/api/alert`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.nxtdial.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: config.nxtdial.agentId,
          fromNumber: config.nxtdial.fromNumber,
          phones,
          variables,
        }),
        signal: AbortSignal.timeout(config.nxtdial.timeoutMs),
      });
    } catch (error) {
      throw new IntegrationError(`NxtDial request failed: ${error.message}`, { integration: "nxtdial", retryable: true, cause: error });
    }

    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (response.ok) return collectCallIds(body, phones);

    const status = response.status;
    const detail = (body?.error?.message ?? body?.message ?? text).toString().slice(0, 300);
    if (status === 429) {
      throw new IntegrationError(`NxtDial rate limited: ${detail}`, {
        integration: "nxtdial",
        status,
        retryable: true,
        retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) ?? 60_000,
      });
    }
    throw new IntegrationError(`NxtDial HTTP ${status}: ${detail}`, {
      integration: "nxtdial",
      status,
      retryable: status >= 500,
    });
  }
}

class MockNxtDialClient {
  constructor() {
    this.requests = [];
  }

  async alert({ phones, variables }) {
    const requestId = `mock-alert-${crypto.randomUUID()}`;
    this.requests.push({ phones, variables, requestId });
    logger.debug({ count: phones.length, variables }, "[mock] NxtDial reminder calls queued");
    return {
      requestId,
      callIds: new Map(phones.map(({ phone }, index) => [phone, `${requestId}-${index}`])),
    };
  }
}

export function createNxtDialClient() {
  return config.modes.nxtdial === "live" ? new LiveNxtDialClient() : new MockNxtDialClient();
}
