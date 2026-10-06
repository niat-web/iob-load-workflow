import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { isPrivateAddress } from "../resumeFetcher.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 5000;

const present = (value) => Boolean(value) && value !== "NA";

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
  const match = /https?:\/\/(?:www\.)?([^/]+)/.exec(url);
  return match ? match[1].split(":")[0] : url.trim();
}

export function linkedinSlug(url) {
  return /linkedin\.com\/company\/([^/?#]+)/i.exec(url ?? "")?.[1]?.trim() ?? "";
}

const providersFor = (domain) => [
  `https://logo.clearbit.com/${domain}`,
  `https://www.google.com/s2/favicons?sz=128&domain=${domain}`,
  `https://logos.hunter.io/${domain}`,
];

async function reachable(url, fetchImpl) {
  if (!publicUrl(url)) return false;
  const options = { headers: { "User-Agent": USER_AGENT }, redirect: "follow" };
  try {
    const head = await fetchImpl(url, { ...options, method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (head.status === 200) return true;
    const get = await fetchImpl(url, { ...options, method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await get.body?.cancel?.();
    return get.status === 200;
  } catch {
    return false;
  }
}

async function scrapeWebsiteLogo(website, fetchImpl) {
  const base = publicUrl(website.startsWith("http") ? website : `https://${website}`);
  if (!base) return null;
  try {
    const response = await fetchImpl(base, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) return null;
    const html = (await response.text()).slice(0, 2_000_000);
    const absolute = (value) => new URL(value, base).toString();
    const jsonLd = /"logo"\s*:\s*"([^"]+)"/i.exec(html)?.[1];
    if (jsonLd) return absolute(jsonLd);
    const ogImage = /<meta\s+property="og:image"\s+content="([^"]+)"/i.exec(html)?.[1];
    if (ogImage) return absolute(ogImage);
    for (const [, src] of html.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
      if (src.toLowerCase().includes("logo")) return absolute(src);
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveLogo({ website, linkedin, hubspotLogo }, { fetchImpl = fetch } = {}) {
  if (config.learningPortal.resolveLogos && config.modes.learningPortal === "live") {
    try {
      const domain = domainOf(website);
      if (domain) {
        for (const provider of providersFor(domain)) {
          if (await reachable(provider, fetchImpl)) return provider;
        }
        const scraped = await scrapeWebsiteLogo(website, fetchImpl);
        if (scraped && (await reachable(scraped, fetchImpl))) return scraped;
      }
      const slug = present(linkedin) && linkedin.toLowerCase().includes("linkedin.com") ? linkedinSlug(linkedin) : "";
      if (slug) {
        for (const provider of providersFor(`${slug}.com`)) {
          if (await reachable(provider, fetchImpl)) return provider;
        }
      }
    } catch (error) {
      logger.warn({ err: error }, "Logo lookup failed; falling back to the HubSpot logo");
    }
  }
  if (present(hubspotLogo) && hubspotLogo.startsWith("http") && !hubspotLogo.toLowerCase().includes("hubspot-logos.com")) {
    return hubspotLogo;
  }
  return "NA";
}
