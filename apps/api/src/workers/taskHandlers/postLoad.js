import { config } from "../../config/env.js";
import { TASK_TYPE } from "../../config/statuses.js";
import { Job } from "../../models/index.js";
import { AUDIT, audit } from "../../services/auditService.js";
import { integrations } from "../../services/integrations.js";
import { getSettings } from "../../services/settingsService.js";
import { now } from "../../utils/clock.js";
import { logger } from "../../utils/logger.js";

function ownerProperties(job) {
  const properties = { crm: job.crmOwnerId, profiling_poc: job.profilingPoc?.id, ise: job.ise?.id };
  return Object.fromEntries(Object.entries(properties).filter(([, value]) => value));
}

async function hubspotWriteBack({ job }) {
  if (job.hubspotWriteBack?.status === "DONE" || !job.learningPortalJobId) return;
  const writeOn = (await getSettings()).automation.hubspotWriteBack;
  if (!writeOn || !integrations.hubspot.canWrite) {
    const reason = writeOn
      ? "The HubSpot deal webhook is not set up, so the job ID was not written to HubSpot"
      : "Writing the job ID to HubSpot is turned off in Settings";
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

export const postLoadHandlers = {
  [TASK_TYPE.HUBSPOT_WRITE_BACK]: { run: hubspotWriteBack, onPermanentFailure: hubspotWriteBackFailed },
};
