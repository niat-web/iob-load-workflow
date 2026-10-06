import pino from "pino";
import { config } from "../config/env.js";

const LEVEL_NAMES = { 10: "TRACE", 20: "DEBUG", 30: "INFO", 40: "WARN", 50: "ERROR", 60: "FATAL" };
const LEVEL_COLORS = { 10: 90, 20: 90, 30: 36, 40: 33, 50: 31, 60: 31 };
const HIDDEN_KEYS = new Set(["level", "time", "msg", "service", "role", "reqId", "taskId", "err", "http"]);

const paint = (code, text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const clock = (time) => new Date(time).toLocaleTimeString("en-GB", { hour12: false });

function compact(value) {
  if (value === null || typeof value !== "object") return String(value);
  const flat = !Array.isArray(value) && Object.values(value).every((item) => item === null || typeof item !== "object");
  if (!flat) return JSON.stringify(value);
  return `{${Object.entries(value).map(([key, item]) => `${key}:${item}`).join(", ")}}`;
}

function statusText(status) {
  if (status === "cancelled") return paint(90, "cancelled");
  return paint(status >= 500 ? 31 : status >= 400 ? 33 : 32, status);
}

export function formatPretty(entry) {
  const { level, time, msg = "", http, err } = entry;
  const head = `${paint(90, clock(time))} ${paint(LEVEL_COLORS[level] ?? 0, (LEVEL_NAMES[level] ?? String(level)).padEnd(5))}`;
  if (http) {
    const user = http.user ? paint(90, `  ${http.user}`) : "";
    return `${head} ${http.method.padEnd(6)} ${http.url}  ${statusText(http.status)}  ${http.ms} ms${user}`;
  }
  const extras = Object.entries(entry)
    .filter(([key, value]) => !HIDDEN_KEYS.has(key) && value !== undefined)
    .map(([key, value]) => `${key}=${compact(value)}`);
  let line = `${head} ${msg}`;
  if (extras.length) line += paint(90, `  ${extras.join(" ")}`);
  if (err) line += ` — ${err.message ?? compact(err)}`;
  if (err?.stack && level >= 50) line += `\n${err.stack}`;
  return line;
}

const prettyStream = {
  write(chunk) {
    for (const raw of String(chunk).split("\n")) {
      if (!raw) continue;
      try {
        process.stdout.write(`${formatPretty(JSON.parse(raw))}\n`);
      } catch {
        process.stdout.write(`${raw}\n`);
      }
    }
  },
};

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: "job-flow-api", role: config.processRole },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "*.apiKey",
        "*.accessToken",
        "*.token",
        "*.password",
        "*.credential",
        "*.idToken",
      ],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  config.logFormat === "pretty" ? prettyStream : undefined,
);
