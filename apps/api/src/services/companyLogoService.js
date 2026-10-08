import { logger } from "../utils/logger.js";
import { resolveLogo } from "./learningPortal/logoResolver.js";

export const usableLogo = (url) =>
  typeof url === "string" && /^https?:\/\//.test(url) && !url.toLowerCase().includes("hubspot-logos.com");

export async function companyLogoFor(job, mapped) {
  try {
    const logo = await resolveLogo({
      website: mapped.companyWebsite,
      linkedin: mapped.companyLinkedin,
      hubspotLogo: mapped.companyLogoUrl,
    });
    return usableLogo(logo) ? logo : null;
  } catch (error) {
    logger.warn({ err: error, jobId: String(job._id) }, "Company logo lookup failed; the deal continues without a logo");
    return usableLogo(mapped.companyLogoUrl) ? mapped.companyLogoUrl : null;
  }
}
