import { config } from "../../config/env.js";
import { LOGO_SOURCE } from "../../config/logoSources.js";
import { logger } from "../../utils/logger.js";
import { isPrivateAddress } from "../resumeFetcher.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const PAGE_TIMEOUT_MS = 8000;
const IMAGE_TIMEOUT_MS = 6000;
const MAX_PAGE_BYTES = 2_000_000;
const MAX_MANIFEST_BYTES = 200_000;
const MAX_IMAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 4;
const MAX_IMAGE_CHECKS = 12;

const BLOCKED_LOGO =
  /(google\.com\/s2\/favicons|gstatic\.com\/favicon|logo\.clearbit\.com|logos\.hunter\.io|hubspot-logos\.com|\/wp-includes\/|\/\/s\.w\.org\/|wordpress\.(?:com|org)\/(?:i|wp-content\/themes)\/|gravatar\.com|\/favicon\.ico(?:$|[?#])|placeholder|default[-_]?(?:logo|avatar|icon|image)|\/blank\.(?:png|gif)|spacer\.gif|\/1x1\.)/i;

const THIRD_PARTY =
  /(facebook|twitter|x-twitter|linkedin|instagram|youtube|whatsapp|telegram|pinterest|tiktok|google-?play|play-?store|app-?store|trustpilot|clutch|capterra|g2crowd|certif|badge|award|partner|client|customer|testimonial|flag|payment|visa|mastercard|paypal|avatar|banner|hero|slider|carousel|spinner|loader)/i;

const ORG_TYPE = /(organization|corporation|company|business|brand|airline|ngo|school|college|university|store|agency|organisation)$/i;
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ltd", "plc", "gen", "firm", "ind"]);

const present = (value) => typeof value === "string" && value.trim() !== "" && value.trim() !== "NA";

export const isBlockedLogo = (url) => BLOCKED_LOGO.test(String(url ?? ""));

export const isLogoLink = (url) => present(url) && /^https?:\/\//i.test(url.trim()) && !isBlockedLogo(url);

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return isPrivateAddress(url.hostname.replace(/^\[|\]$/g, "").toLowerCase()) ? null : url;
  } catch {
    return null;
  }
}

export function domainOf(url) {
  if (!present(url)) return "";
  const match = /^(?:https?:\/\/)?(?:www\.)?([^/?#:]+)/i.exec(url.trim());
  return match ? match[1].toLowerCase() : "";
}

export function brandOf(host) {
  const labels = String(host ?? "").toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length >= 3 && labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2))) return labels.at(-3);
  return labels.length >= 2 ? labels.at(-2) : (labels[0] ?? "");
}

async function readBody(response, max, truncate) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length <= max) return buffer;
    return truncate ? buffer.subarray(0, max) : null;
  }
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      if (!truncate) return null;
      chunks.push(Buffer.from(value).subarray(0, value.length - (size - max)));
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function safeFetch(raw, fetchImpl, { timeout, accept }) {
  let url = publicUrl(raw);
  for (let hop = 0; url && hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(url.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      redirect: "manual",
      signal: AbortSignal.timeout(timeout),
    });
    const location = response.headers?.get?.("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel?.().catch?.(() => {});
      url = publicUrl(new URL(location, url).toString());
      continue;
    }
    return { response, url };
  }
  return null;
}

function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const number = (name) => Number.parseFloat(new RegExp(`\\s${name}\\s*=\\s*["']?([\\d.]+)`, "i").exec(tag)?.[1] ?? "");
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag);
  const width = number("width") || Number(viewBox?.[1]) || 512;
  const height = number("height") || Number(viewBox?.[2]) || 512;
  return { type: "svg", width, height };
}

function jpegSize(buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += marker === 0xff ? 1 : 2;
      continue;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { type: "jpeg", width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

function webpSize(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8 " && buffer.length >= 30) {
    return { type: "webp", width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L" && buffer.length >= 25) {
    const width = 1 + (((buffer[22] & 0x3f) << 8) | buffer[21]);
    const height = 1 + (((buffer[24] & 0x0f) << 10) | (buffer[23] << 2) | ((buffer[22] & 0xc0) >> 6));
    return { type: "webp", width, height };
  }
  if (chunk === "VP8X" && buffer.length >= 30) {
    return { type: "webp", width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  return null;
}

function icoSize(buffer) {
  const count = buffer.readUInt16LE(4);
  let best = null;
  for (let index = 0; index < count && 6 + index * 16 + 2 <= buffer.length; index += 1) {
    const width = buffer[6 + index * 16] || 256;
    const height = buffer[7 + index * 16] || 256;
    if (!best || width * height > best.width * best.height) best = { type: "ico", width, height };
  }
  return best;
}

export function imageInfo(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47 && buffer.length >= 24) {
    return { type: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.toString("ascii", 0, 4) === "GIF8") {
    return { type: "gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpegSize(buffer);
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return webpSize(buffer);
  if (buffer.readUInt32BE(0) === 0x00000100) return icoSize(buffer);
  const text = buffer.toString("utf8", 0, Math.min(buffer.length, 20000));
  if (/<svg[\s>]/i.test(text)) return svgSize(text);
  return null;
}

export function looksLikeLogo(info) {
  if (!info?.width || !info?.height) return false;
  const long = Math.max(info.width, info.height);
  const short = Math.min(info.width, info.height);
  if (info.type !== "svg" && long < 80) return false;
  if (short < 16) return false;
  return long / short <= 8;
}

async function isRealLogo(url, fetchImpl) {
  if (!isLogoLink(url)) return false;
  try {
    const fetched = await safeFetch(url, fetchImpl, { timeout: IMAGE_TIMEOUT_MS, accept: "image/*" });
    if (!fetched || fetched.response.status !== 200 || isBlockedLogo(fetched.url.toString())) {
      await fetched?.response.body?.cancel?.().catch?.(() => {});
      return false;
    }
    if (/text\/html/i.test(fetched.response.headers?.get?.("content-type") ?? "")) {
      await fetched.response.body?.cancel?.().catch?.(() => {});
      return false;
    }
    return looksLikeLogo(imageInfo(await readBody(fetched.response, MAX_IMAGE_BYTES, false)));
  } catch {
    return false;
  }
}

const attribute = (tag, name) => {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "").trim() : "";
};

const decode = (value) =>
  value.replace(/&amp;/g, "&").replace(/&#0?38;/g, "&").replace(/&quot;/g, '"').replace(/&#x2F;/gi, "/");

function absolute(value, base) {
  if (!present(value) || /^data:/i.test(value.trim())) return null;
  try {
    return new URL(decode(value.trim()), base).toString();
  } catch {
    return null;
  }
}

function largestFromSrcset(srcset) {
  let best = null;
  for (const part of srcset.split(",")) {
    const [src, descriptor = "1x"] = part.trim().split(/\s+/);
    const size = Number.parseFloat(descriptor) || 1;
    if (src && (!best || size > best.size)) best = { src, size };
  }
  return best?.src ?? "";
}

function jsonLdLogos(html, base, companyName) {
  const own = [];
  const top = [];
  const byId = new Map();
  const nodes = [];
  const collect = (node, depth) => {
    if (Array.isArray(node)) return node.forEach((item) => collect(item, depth));
    if (!node || typeof node !== "object") return;
    nodes.push({ node, depth });
    if (typeof node["@id"] === "string") byId.set(node["@id"], node);
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object") collect(value, key === "@graph" ? depth : depth + 1);
    }
  };
  for (const [, body] of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collect(JSON.parse(body.trim()), 0);
    } catch {
      continue;
    }
  }
  const siteBrand = brandOf(new URL(base).hostname);
  const nameWords = words(companyName);
  const isOwn = (node) => {
    const nodeUrl = typeof node.url === "string" ? publicUrl(absolute(node.url, base) ?? "") : null;
    if (nodeUrl && brandOf(nodeUrl.hostname) === siteBrand) return true;
    const name = String(node.name ?? "").toLowerCase();
    return nameWords.length > 0 && nameWords.every((word) => name.includes(word));
  };
  const urlOf = (logo) => {
    if (typeof logo === "string") return logo;
    if (Array.isArray(logo)) return urlOf(logo[0]);
    if (logo && typeof logo === "object") {
      const target = !logo.url && !logo.contentUrl && typeof logo["@id"] === "string" ? byId.get(logo["@id"]) : logo;
      return target?.url ?? target?.contentUrl ?? null;
    }
    return null;
  };
  for (const { node, depth } of nodes) {
    const types = [].concat(node["@type"] ?? []).map(String);
    if (!node.logo || !types.some((type) => ORG_TYPE.test(type))) continue;
    const url = absolute(urlOf(node.logo) ?? "", base);
    if (!url) continue;
    if (isOwn(node)) own.push(url);
    else if (depth === 0) top.push(url);
  }
  return own.length ? own : top;
}

const words = (name) =>
  String(name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !["pvt", "ltd", "private", "limited", "inc", "llp", "the", "and", "technologies", "solutions"].includes(word));

function headerLogos(html, base, companyName) {
  const bodyStart = Math.max(0, html.search(/<body[\s>]/i));
  const body = html.slice(bodyStart);
  const header = /<header[\s>][\s\S]*?<\/header>/i.exec(body);
  const headerEnd = header ? header.index + header[0].length : 0;
  const scanEnd = Math.max(headerEnd, Math.min(body.length, 60_000));
  const region = body.slice(0, scanEnd);
  const home = new URL(base);
  const homeHref = new RegExp(
    `\\shref\\s*=\\s*["'](?:\\/|\\.\\/|https?:\\/\\/(?:www\\.)?${home.hostname.replace(/^www\./, "").replace(/\./g, "\\.")}\\/?)(?:index\\.\\w+)?["']`,
    "i",
  );
  const nameWords = words(companyName);
  const candidates = [];
  let order = 0;
  for (const match of region.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src =
      attribute(tag, "data-src") ||
      attribute(tag, "data-lazy-src") ||
      attribute(tag, "data-original") ||
      largestFromSrcset(attribute(tag, "data-srcset") || attribute(tag, "srcset")) ||
      attribute(tag, "src");
    const url = absolute(src, base);
    if (!url) continue;
    const alt = attribute(tag, "alt").toLowerCase();
    const marks = `${attribute(tag, "class")} ${attribute(tag, "id")}`.toLowerCase();
    const before = region.slice(Math.max(0, match.index - 600), match.index);
    const anchorAt = before.lastIndexOf("<a ");
    const insideAnchor = anchorAt >= 0 && !before.slice(anchorAt).includes("</a>") ? before.slice(anchorAt) : "";
    const context = before.slice(-400).toLowerCase();
    const thirdParty = THIRD_PARTY.exec(`${new URL(url).pathname} ${alt} ${marks}`)?.[1]?.toLowerCase();
    if (thirdParty && !nameWords.some((word) => word.includes(thirdParty) || thirdParty.includes(word))) continue;

    let score = 0;
    if (/custom-logo/.test(marks) || /custom-logo-link/.test(insideAnchor.toLowerCase())) score += 6;
    if (insideAnchor && homeHref.test(insideAnchor)) score += 5;
    if (/(logo|brand)/.test(marks)) score += 4;
    if (/class\s*=\s*["'][^"']*(logo|brand|site-title|site-branding|navbar-brand)/.test(context)) score += 3;
    if (nameWords.length && nameWords.some((word) => alt.includes(word))) score += 4;
    if (/logo/i.test(new URL(url).pathname)) score += 3;
    if (header && match.index < headerEnd) score += 2;
    if (order < 3) score += 1;
    if (/(white|light|negative|inverse|reverse|footer)/.test(`${url} ${marks}`.toLowerCase())) score -= 3;
    order += 1;
    if (score >= 5) candidates.push({ url, score, order });
  }
  return candidates.sort((a, b) => b.score - a.score || a.order - b.order).map((candidate) => candidate.url);
}

function sizeOf(sizes) {
  const values = String(sizes ?? "")
    .split(/\s+/)
    .map((size) => Number.parseInt(size.split("x")[0], 10))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

async function iconLogos(html, base, fetchImpl) {
  const icons = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, "rel").toLowerCase();
    const href = absolute(attribute(tag, "href"), base);
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) icons.push({ url: href, size: sizeOf(attribute(tag, "sizes")) || 180 });
    else if (/(^|\s)icon(\s|$)/.test(rel) && sizeOf(attribute(tag, "sizes")) >= 128) {
      icons.push({ url: href, size: sizeOf(attribute(tag, "sizes")) });
    } else if (rel === "manifest") {
      try {
        const fetched = await safeFetch(href, fetchImpl, { timeout: IMAGE_TIMEOUT_MS, accept: "application/json" });
        if (fetched?.response.status === 200) {
          const manifest = JSON.parse((await readBody(fetched.response, MAX_MANIFEST_BYTES, false))?.toString("utf8") ?? "{}");
          for (const icon of manifest.icons ?? []) {
            const url = absolute(icon.src, fetched.url);
            const size = sizeOf(icon.sizes);
            if (url && size >= 128 && !/monochrome/i.test(icon.purpose ?? "")) icons.push({ url, size });
          }
        }
      } catch {
        continue;
      }
    }
  }
  return icons.sort((a, b) => b.size - a.size).map((icon) => icon.url);
}

function socialLogos(html, base) {
  const found = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attribute(tag, "property") || attribute(tag, "name")).toLowerCase();
    if (!["og:image", "og:logo", "twitter:image"].includes(key)) continue;
    const url = absolute(attribute(tag, "content"), base);
    if (url && (key === "og:logo" || /logo/i.test(new URL(url).pathname))) found.push(url);
  }
  return found;
}

async function websiteLogos(website, companyName, fetchImpl) {
  const start = publicUrl(/^https?:\/\//i.test(website) ? website : `https://${website}`);
  if (!start) return null;
  const fetched = await safeFetch(start.toString(), fetchImpl, { timeout: PAGE_TIMEOUT_MS, accept: "text/html" });
  if (!fetched || fetched.response.status !== 200) return null;
  if (brandOf(fetched.url.hostname) !== brandOf(start.hostname)) {
    await fetched.response.body?.cancel?.().catch?.(() => {});
    return null;
  }
  const html = (await readBody(fetched.response, MAX_PAGE_BYTES, true)).toString("utf8");
  const base = absolute(attribute(/<base\b[^>]*>/i.exec(html)?.[0] ?? "", "href"), fetched.url) ?? fetched.url.toString();
  return {
    declared: [...jsonLdLogos(html, base, companyName), ...socialLogos(html, base)],
    header: headerLogos(html, base, companyName),
    icons: () => iconLogos(html, base, fetchImpl),
  };
}

const logoDevUrl = (domain) =>
  `https://img.logo.dev/${encodeURIComponent(domain)}?token=${encodeURIComponent(config.logos.logoDevToken)}&size=256&format=png&fallback=404`;

export async function findCompanyLogo({ companyName, website, crmLogo, hubspotLogo }, { fetchImpl = fetch } = {}) {
  const lookups = config.learningPortal.resolveLogos && config.modes.learningPortal === "live";
  if (!lookups) {
    if (isLogoLink(crmLogo)) return { url: crmLogo.trim(), source: LOGO_SOURCE.CRM_LINK };
    if (isLogoLink(hubspotLogo)) return { url: hubspotLogo.trim(), source: LOGO_SOURCE.HUBSPOT };
    return null;
  }

  const tried = new Set();
  const attempt = async (url, source) => {
    if (!isLogoLink(url) || tried.has(url) || tried.size >= MAX_IMAGE_CHECKS) return null;
    tried.add(url);
    return (await isRealLogo(url, fetchImpl)) ? { url, source } : null;
  };
  const firstOf = async (urls, source) => {
    for (const url of urls) {
      const found = await attempt(url, source);
      if (found) return found;
    }
    return null;
  };

  try {
    const fromCrm = await attempt(crmLogo?.trim(), LOGO_SOURCE.CRM_LINK);
    if (fromCrm) return fromCrm;

    const domain = domainOf(website);
    const site = domain ? await websiteLogos(website, companyName, fetchImpl).catch(() => null) : null;
    if (site) {
      const found =
        (await firstOf(site.declared, LOGO_SOURCE.WEBSITE_DECLARED)) ??
        (await firstOf(site.header, LOGO_SOURCE.WEBSITE_HEADER));
      if (found) return found;
    }
    if (domain && config.logos.logoDevToken) {
      const found = await attempt(logoDevUrl(domain), LOGO_SOURCE.LOGO_DEV);
      if (found) return found;
    }
    if (site) {
      const found = await firstOf(await site.icons(), LOGO_SOURCE.WEBSITE_ICON);
      if (found) return found;
    }
    return await attempt(hubspotLogo?.trim(), LOGO_SOURCE.HUBSPOT);
  } catch (error) {
    logger.warn({ err: error, company: companyName ?? null }, "Company logo lookup failed; the deal continues without a logo");
    return null;
  }
}

export async function checkLogoLink(url, { fetchImpl = fetch } = {}) {
  if (!isLogoLink(url)) return false;
  if (!(config.learningPortal.resolveLogos && config.modes.learningPortal === "live")) return true;
  return isRealLogo(url.trim(), fetchImpl);
}
