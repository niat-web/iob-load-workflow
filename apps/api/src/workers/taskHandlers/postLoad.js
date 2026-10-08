import { config } from "../../config/env.js";
import { TASK_TYPE } from "../../config/statuses.js";
import { Job, LearningPortalOrganisation } from "../../models/index.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { hubspotRecordUrl } from "../../services/dealMapper.js";
import { latestSnapshot } from "../../services/dealSnapshotService.js";
import { integrations } from "../../services/integrations.js";
import { appendTrackerRow } from "../../services/learningPortal/jobLoadingSheet.js";
import { formatIst } from "../../services/learningPortal/nkbPayload.js";
import { now } from "../../utils/clock.js";
import { logger } from "../../utils/logger.js";

function ownerProperties(job) {
  const properties = { crm: job.crmOwnerId, profiling_poc: job.profilingPoc?.id, ise: job.ise?.id };
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value));
}

async function hubspotWriteBack({ job }) {
  if (job.hubspotWriteBack?.status === "DONE" || !job.learningPortalJobId) return;
  if (!config.hubspot.writeJobId || !integrations.hubspot.canWrite) {
    const reason = config.hubspot.writeJobId
      ? "The HubSpot deal webhook is not set up, so the job ID was not written to HubSpot"
      : "HUBSPOT_WRITE_JOB_ID is off";
    await Job.updateOne({ _id: job._id }, { $set: { "hubspotWriteBack.status": "SKIPPED", "hubspotWriteBack.error": reason } });
    return;
  }
  const dealIds = await integrations.hubspot.findJobPipelineDealIds(job.hubspotDealId);
  const owners = ownerProperties(job);
  for (const dealId of dealIds) {
    await integrations.hubspot.updateDeal(dealId, {
      [config.hubspot.jobIdProperty]: job.learningPortalJobId,
      ...(job.jdCount > 0 ? { jd_count: job.jdCount } : {}),
    });
    if (!Object.keys(owners).length) continue;
    await integrations.hubspot.updateDeal(dealId, owners).catch((error) => {
      logger.warn({ err: error, dealId }, "Could not set the CRM, Profiling POC and ISE owners on the HubSpot deal");
    });
  }
  await Job.updateOne(
    { _id: job._id },
    { $set: { hubspotWriteBack: { status: "DONE", dealIds, at: now(), error: null } } },
  );
  await audit({
    action: AUDIT.HUBSPOT_JOB_ID_WRITTEN,
    entityId: job._id,
    metadata: { dealIds: dealIds.join(","), property: config.hubspot.jobIdProperty },
  });
}

async function hubspotWriteBackFailed({ job, error }) {
  await Job.updateOne(
    { _id: job._id },
    { $set: { "hubspotWriteBack.status": "FAILED", "hubspotWriteBack.error": String(error?.message ?? error).slice(0, 500) } },
  );
}

async function trackLoadedJob({ job }) {
  if (job.trackerRecordedAt || !job.learningPortalPayload || !integrations.sheets.enabled) return;
  const details = job.learningPortalPayload.job_details;
  const snapshot = await latestSnapshot(job._id);
  const props = snapshot?.rawProperties ?? {};
  const organisation = await LearningPortalOrganisation.findOne({ organisationId: job.learningPortalOrgId }).lean();
  const loadedAt = formatIst(now());
  const environments = integrations.learningPortal.targets.map((env) => env[0].toUpperCase() + env.slice(1)).join(" and ");

  await appendTrackerRow({
    Date: loadedAt.slice(0, 10),
    "Job Deal ID": job.hubspotDealId,
    "HubSpot Link": hubspotRecordUrl(job) ?? "",
    "Job ID": job.learningPortalJobId,
    Experience: String(props.product ?? "").includes("Experienced") ? "Yes" : "No",
    "Job Type": details.job_type,
    "Job Source": "INTERNAL",
    "Organization ID": job.learningPortalOrgId,
    "Company Name": job.companyName,
    "Company Website URL": job.companyWebsite ?? "NA",
    "Company Logo URL": organisation?.logoUrl ?? job.companyLogoUrl ?? "NA",
    "Company LinkedIn URL": job.companyLinkedin ?? "NA",
    "Job Title": details.job_title,
    Location: (details.locations ?? []).join(", "),
    "Min CTC/Stipend": details.min_ctc,
    "Max CTC/Stipend": details.max_ctc,
    Skills: (details.skills_required ?? []).join(", "),
    "Number of Positions Available": details.no_of_positions_available,
    Order: details.order ?? "",
    "Mode of Applying": "INTERNAL",
    "Min Internship Duration": details.service_agreement_in_months,
    "Max Internship Duration": details.max_service_agreement_in_months,
    "Compensation Description": String(props.nurturing_team_remarks ?? "").trim(),
    Deadline: details.apply_by ?? "",
    CRM: job.crmOwnerName ?? "NA",
    "Profiling Done By": job.profilingPoc?.name ?? "NA",
    "Enroll Plans": (details.enroll_plans ?? []).join(", "),
    "JD Count": String(job.jdCount ?? 1),
    "Internal Student List Link": "",
    "Max Update datetime": loadedAt,
    Remarks: `Loaded in ${environments} successfully (Job Flow Automation)`,
    "Loaded By (Email)": job.submittedBy ?? "",
    "Loaded By": job.submittedBy ?? "",
  });
  await Job.updateOne({ _id: job._id }, { $set: { trackerRecordedAt: now() } });
  await audit({ action: AUDIT.TRACKER_ROW_ADDED, entityId: job._id, metadata: { worksheet: config.jobLoadingSheet.trackerWorksheet } });
}

export const postLoadHandlers = {
  [TASK_TYPE.HUBSPOT_WRITE_BACK]: { run: hubspotWriteBack, onPermanentFailure: hubspotWriteBackFailed },
  [TASK_TYPE.TRACK_LOADED_JOB]: { run: trackLoadedJob },
};
