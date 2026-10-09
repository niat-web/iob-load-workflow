import { LOGO_SOURCE } from "../config/logoSources.js";
import { Job, LearningPortalOrganisation } from "../models/index.js";
import { badRequest, conflict } from "../utils/errors.js";
import { AUDIT, audit } from "./auditService.js";
import { latestSnapshot } from "./dealSnapshotService.js";
import { checkLogoLink, findCompanyLogo, isLogoLink } from "./learningPortal/logoResolver.js";

export const usableLogo = (url) => isLogoLink(url);

export async function companyLogoFor(job, mapped) {
  return findCompanyLogo({
    companyName: mapped.companyName,
    website: mapped.companyWebsite,
    crmLogo: mapped.companyLogoLink,
    hubspotLogo: mapped.hubspotCompanyLogo,
  });
}

async function updatePendingOrganisation(job, logoUrl) {
  if (!job.learningPortalOrgId) return;
  await LearningPortalOrganisation.updateOne(
    { organisationId: job.learningPortalOrgId, createdIn: { $size: 0 } },
    { $set: { logoUrl: logoUrl ?? "NA" } },
  );
}

async function saveLogo(job, logo, actor, action) {
  const updated = await Job.findByIdAndUpdate(
    job._id,
    { $set: { companyLogoUrl: logo?.url ?? null, companyLogoSource: logo?.source ?? null } },
    { returnDocument: "after" },
  );
  await updatePendingOrganisation(job, logo?.url ?? null);
  await audit({ actor, action: AUDIT.COMPANY_LOGO_CHANGED, entityId: job._id, metadata: { how: action, source: logo?.source ?? null } });
  return updated;
}

export async function setCompanyLogo(job, url, actor) {
  if (url === null) return saveLogo(job, null, actor, "REMOVED");
  const link = url.trim();
  if (!isLogoLink(link)) {
    throw badRequest("Paste a direct https link to the logo image. Favicon and placeholder links are not accepted.");
  }
  if (!(await checkLogoLink(link))) {
    throw badRequest("This link does not open a usable logo image. Use a PNG, JPG, WebP or SVG of at least 80 pixels.");
  }
  return saveLogo(job, { url: link, source: LOGO_SOURCE.SET_BY_CRM }, actor, "SET");
}

export async function findLogoAgain(job, actor) {
  const snapshot = await latestSnapshot(job._id);
  const logo = await findCompanyLogo({
    companyName: job.companyName,
    website: job.companyWebsite,
    crmLogo: snapshot?.rawProperties?.company_logo_link ?? null,
    hubspotLogo: snapshot?.rawCompany?.logo ?? null,
  });
  if (!logo) throw conflict("No logo could be confirmed for this company. Paste a logo link instead.", "LOGO_NOT_FOUND");
  return saveLogo(job, logo, actor, "FOUND");
}
