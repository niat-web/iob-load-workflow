export const DASH = "—";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const numberFormatter = new Intl.NumberFormat("en-US");

const scoreFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return DASH;
  const parts = Object.fromEntries(
    dateTimeFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
  return `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
}

export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : DASH;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  return scoreFormatter.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return DASH;
  return numberFormatter.format(value);
}

export function orDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DASH;
}

export function initials(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email.split("@")[0] || "";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length >= 2 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : source.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function priorityNumber(priority: string): number {
  const match = /^P(\d+)$/i.exec(priority.trim());
  return match?.[1] ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export function priorityOptions(count: number): string[] {
  const safe = Math.max(0, Math.floor(count));
  return Array.from({ length: safe }, (_, i) => `P${i + 1}`);
}
