import crypto from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { config } from "../config/env.js";
import { IntegrationError } from "../utils/errors.js";
import { createRateLimiter } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";

const PERMANENT_ERRORS = new Set([
  "MessageRejected",
  "MailFromDomainNotVerifiedException",
  "ConfigurationSetDoesNotExistException",
  "InvalidParameterValue",
  "AccountSendingPausedException",
]);

class LiveSesService {
  constructor() {
    const credentials =
      config.ses.accessKeyId && config.ses.secretAccessKey
        ? { accessKeyId: config.ses.accessKeyId, secretAccessKey: config.ses.secretAccessKey }
        : undefined;
    this.client = new SESClient({ region: config.ses.region, credentials, maxAttempts: 2 });
    this.acquire = createRateLimiter(config.ses.maxSendRate);
  }

  async send({ to, subject, html, text }) {
    await this.acquire();
    try {
      const result = await this.client.send(
        new SendEmailCommand({
          Source: config.ses.fromEmail,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: text, Charset: "UTF-8" } },
          },
          ConfigurationSetName: config.ses.configurationSet,
        }),
      );
      return { messageId: result.MessageId };
    } catch (error) {
      const permanent = PERMANENT_ERRORS.has(error?.name);
      throw new IntegrationError(`SES ${error?.name ?? "error"}: ${error?.message}`, {
        integration: "ses",
        status: error?.$metadata?.httpStatusCode,
        retryable: !permanent,
        cause: error,
      });
    }
  }
}

class MockSesService {
  constructor() {
    this.sent = [];
  }

  async send({ to, subject }) {
    if (/@invalid\./i.test(to)) {
      throw new IntegrationError("SES MessageRejected: Address blacklisted (mock)", { integration: "ses", retryable: false });
    }
    const messageId = `mock-${crypto.randomUUID()}`;
    this.sent.push({ to, subject, messageId });
    logger.debug({ to, subject }, "[mock] email sent");
    return { messageId };
  }
}

export function createSesService() {
  return config.modes.ses === "live" ? new LiveSesService() : new MockSesService();
}
