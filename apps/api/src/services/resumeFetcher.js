import net from "node:net";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";
import { config } from "../config/env.js";
import { IntegrationError, PermanentError } from "../utils/errors.js";
import { mockResumeText } from "./mock/mockData.js";

const MAX_REDIRECTS = 3;
const MAX_TEXT_CHARS = 30000;

export function isPrivateAddress(host) {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return true;
  const version = net.isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  return false;
}

function assertAllowedUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new PermanentError("Resume URL is not a valid URL");
  }
  const httpAllowed = !config.isProduction && url.protocol === "http:";
  if (url.protocol !== "https:" && !httpAllowed) throw new PermanentError("Resume URL must use https");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isPrivateAddress(host)) throw new PermanentError("Resume URL points to a private address");
  const allowed = config.resume.allowedHosts;
  if (allowed.length && !allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
    throw new PermanentError(`Resume host ${host} is not in RESUME_ALLOWED_HOSTS`);
  }
  return url;
}

function detectType(contentType, buffer, url) {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("pdf") || buffer.subarray(0, 4).toString() === "%PDF") return "pdf";
  if (type.includes("wordprocessingml") || /\.docx(\?|$)/i.test(url)) return "docx";
  if (buffer.subarray(0, 2).toString() === "PK" && !type.includes("zip")) return "docx";
  if (type.startsWith("text/") || /\.txt(\?|$)/i.test(url)) return "text";
  return "unknown";
}

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "text/plain; charset=utf-8",
  unknown: "application/octet-stream",
};

export async function downloadResume(rawUrl, context = {}) {
  if (rawUrl.startsWith("mock://")) {
    const text = mockResumeText(
      { studentId: context.studentId, studentName: context.studentName ?? "Student", email: context.email ?? "", batch: context.batch ?? "" },
      context.jobSkills ?? [],
    );
    return { buffer: Buffer.from(text), kind: "text", contentType: MIME.text };
  }

  let url = assertAllowedUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response;
    try {
      response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(config.resume.timeoutMs) });
    } catch (error) {
      throw new IntegrationError(`Resume download failed: ${error.message}`, { integration: "resume", retryable: true });
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      url = assertAllowedUrl(new URL(response.headers.get("location"), url).toString());
      continue;
    }
    if (!response.ok) {
      throw new IntegrationError(`Resume download returned HTTP ${response.status}`, {
        integration: "resume",
        status: response.status,
        retryable: response.status >= 500 || response.status === 429,
      });
    }
    const declared = Number(response.headers.get("content-length"));
    if (declared > config.resume.maxBytes) throw new PermanentError("Resume file is too large");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > config.resume.maxBytes) throw new PermanentError("Resume file is too large");
    const kind = detectType(response.headers.get("content-type"), buffer, url.toString());
    return { buffer, kind, contentType: MIME[kind] };
  }
  throw new PermanentError("Resume URL redirected too many times");
}

export async function extractText({ buffer, kind }) {
  let text = "";
  if (kind === "pdf") {
    const result = await extractPdfText(new Uint8Array(buffer), { mergePages: true });
    text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  } else if (kind === "docx") {
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (kind === "text") {
    text = buffer.toString("utf8");
  } else {
    throw new PermanentError("Unsupported resume format (supported: PDF, DOCX, plain text)");
  }
  const cleaned = text.replaceAll("\u0000", "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.slice(0, MAX_TEXT_CHARS);
}

export async function getResumeText(url, context) {
  return extractText(await downloadResume(url, context));
}
