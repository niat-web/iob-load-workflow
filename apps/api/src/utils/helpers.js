import { config } from "../config/env.js";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export async function mapLimit(items, limit, fn) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function createRateLimiter(perSecond) {
  const interval = 1000 / perSecond;
  let nextSlot = 0;
  return async function acquire() {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + interval;
    if (wait > 0) await sleep(wait);
  };
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function splitList(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return [
    ...new Set(
      String(value)
        .split(/[;,|\n]+/)
        .map((item) => item.trim())
        .filter((item) => item && item.toUpperCase() !== "NA"),
    ),
  ];
}

export function toInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value).replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

const LEGAL_SUFFIXES = [
  " pvt ltd", " pvt. ltd.", " private limited", " llp", " llc", " inc", " inc.", " ltd", " ltd.", " limited",
  " corp", " corp.", " corporation", " co", " co.",
];

export function normalizeCompanyName(name) {
  let normalized = String(name ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 &]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const suffix of LEGAL_SUFFIXES) {
    if (normalized.endsWith(suffix)) normalized = normalized.slice(0, -suffix.length).trim();
  }
  return normalized;
}

export function hoursFromNow(hours, from = new Date()) {
  return new Date(from.getTime() + hours * 60 * 60 * 1000);
}

export function backoffDelayMs(attempt) {
  const steps = config.workflow.backoffMinutes.length ? config.workflow.backoffMinutes : [1, 5, 15, 30];
  const minutes = steps[Math.min(attempt - 1, steps.length - 1)];
  return minutes * 60 * 1000;
}

export function parseRetryAfter(header, now = Date.now()) {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function normalizePhone(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const digits = text.replace(/\D/g, "");
  if (text.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return null;
}

export function formatDateTime(date, timeZone = "Asia/Kolkata") {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}
