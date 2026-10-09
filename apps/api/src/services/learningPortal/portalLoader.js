import { config } from "../../config/env.js";
import { Counter, Job, LearningPortalOrganisation } from "../../models/index.js";
import { now } from "../../utils/clock.js";
import { isDuplicateKeyError } from "../../utils/errors.js";
import { normalizeCompanyName } from "../../utils/helpers.js";
import { logger } from "../../utils/logger.js";
import { AUDIT, audit } from "../auditService.js";
import { integrations } from "../integrations.js";
import { getSettings } from "../settingsService.js";
import { DEFAULT_ELIGIBILITY_TEMPLATES } from "./eligibilityTemplates.js";
import { buildJobContent } from "./jobContent.js";
import { findOrgInSheet, sheetEligibilityTemplates } from "./jobLoadingSheet.js";
import { isLogoLink } from "./logoResolver.js";
import {
  buildNkbJobPayload,
  enrollPlansFor,
  fillTemplate,
  mapSkills,
  payloadForEnvironment,
  testUsersFor,
} from "./nkbPayload.js";

const environment = (name) => config.learningPortal.environments[name];

export function jobUrlFor(job) {
  const template = config.learningPortal.jobUrlTemplate ?? environment(config.learningPortal.accessEnv).applyLinkTemplate;
  return fillTemplate(template, { jobId: job.learningPortalJobId, company: job.companyName });
}

async function generateText(prompt) {
  if (!(await getSettings()).automation.aiJobContent) return "";
  try {
    return (await integrations.gemini.generateText(prompt)) ?? "";
  } catch (error) {
    logger.warn({ err: error }, "AI text generation failed; using the rule-based text");
    return "";
  }
}

async function auditOrganisation(job, action, organisation) {
  if (!job?._id) return;
  await audit({
    action,
    entityId: job._id,
    metadata: { organisationId: organisation.organisationId, source: organisation.source ?? null, company: job.companyName ?? null },
  });
}

export async function prepareOrganisation(job) {
  const portal = integrations.learningPortal;
  const normalizedName = normalizeCompanyName(job.companyName);
  let organisation = await LearningPortalOrganisation.findOne({ normalizedName });

  if (organisation) {
    await auditOrganisation(job, AUDIT.ORG_REUSED, { ...organisation.toObject(), source: "APP" });
  } else {
    const fromSheet = await findOrgInSheet(job.companyName);
    const known = fromSheet?.status === "exact" && fromSheet.organisationId;
    const record = known
      ? { organisationId: fromSheet.organisationId, source: "SHEET", createdIn: [...portal.targets] }
      : {
          organisationId: portal.newId(),
          source: "CREATED",
          createdIn: [],
          logoUrl: isLogoLink(job.companyLogoUrl) ? job.companyLogoUrl : "NA",
        };
    try {
      organisation = await LearningPortalOrganisation.create({
        normalizedName,
        name: job.companyName,
        website: job.companyWebsite ?? null,
        ...record,
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      organisation = await LearningPortalOrganisation.findOne({ normalizedName });
    }
    await auditOrganisation(job, known ? AUDIT.ORG_REUSED : AUDIT.ORG_CREATED, organisation.toObject());
  }
  return organisation;
}

export async function ensureOrganisationIn(organisation, env) {
  if (organisation.createdIn.includes(env)) return organisation;
  await integrations.learningPortal.createOrganisation(env, {
    organisationId: organisation.organisationId,
    name: organisation.name,
    website: organisation.website ?? "NA",
    logoUrl: organisation.logoUrl ?? "NA",
  });
  return LearningPortalOrganisation.findByIdAndUpdate(
    organisation._id,
    { $addToSet: { createdIn: env } },
    { returnDocument: "after" },
  );
}

export async function ensureOrganisation(job) {
  let organisation = await prepareOrganisation(job);
  for (const env of integrations.learningPortal.targets) organisation = await ensureOrganisationIn(organisation, env);
  return organisation;
}

export const ORDER_COUNTER_ID = "learningPortalOrder";

export async function nextOrderNumber() {
  const counter = await Counter.findOneAndUpdate(
    { _id: ORDER_COUNTER_ID },
    { $inc: { value: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return counter.value;
}

async function eligibilityTemplates() {
  return { ...DEFAULT_ELIGIBILITY_TEMPLATES, ...(await sheetEligibilityTemplates()) };
}

export async function buildPortalPayload(job, props, { deadline, order, enrollPlans }) {
  const plans = enrollPlans ?? enrollPlansFor(props, job);
  const content = await buildJobContent({
    props,
    enrollPlans: plans,
    skills: mapSkills(job.skills),
    company: { website: job.companyWebsite, linkedin: job.companyLinkedin },
    generate: generateText,
    templates: await eligibilityTemplates(),
  });
  return buildNkbJobPayload({
    jobId: job.learningPortalJobId,
    organisationId: job.learningPortalOrgId,
    job,
    props,
    deadline,
    order,
    content,
    enrollPlans: plans,
    showForAllInEnrollPlans: config.learningPortal.showForAllInEnrollPlans,
  });
}

export const isLoadedInto = (job, env) =>
  Boolean(job.learningPortalLoads?.[env]?.loadedAt && job.learningPortalLoads?.[env]?.testUsersGrantedAt);

export async function loadInto(jobId, env) {
  const portal = integrations.learningPortal;
  let job = await Job.findById(jobId);
  const settings = environment(env);
  const organisation = await LearningPortalOrganisation.findOne({ organisationId: job.learningPortalOrgId });
  if (organisation) await ensureOrganisationIn(organisation, env);
  if (!job.learningPortalLoads?.[env]?.loadedAt) {
    await portal.upsertJob(env, payloadForEnvironment(job.learningPortalPayload, settings, { companyName: job.companyName }));
    job = await Job.findByIdAndUpdate(job._id, { $set: { [`learningPortalLoads.${env}.loadedAt`]: now() } }, { returnDocument: "after" });
    await audit({ action: AUDIT.JOB_LOADED, entityId: job._id, metadata: { environment: env, learningPortalJobId: job.learningPortalJobId } });
  }
  if (!job.learningPortalLoads?.[env]?.testUsersGrantedAt) {
    const testUsers = testUsersFor(settings, job.learningPortalPayload.job_details.enroll_plans ?? []);
    if (testUsers.length) await portal.grantAccess(env, job.learningPortalJobId, testUsers);
    job = await Job.findByIdAndUpdate(
      job._id,
      { $set: { [`learningPortalLoads.${env}.testUsersGrantedAt`]: now() } },
      { returnDocument: "after" },
    );
  }
  return job;
}

export async function resendToTargets(job, payload, { deadline } = {}) {
  const portal = integrations.learningPortal;
  for (const env of portal.targets) {
    await portal.upsertJob(env, payloadForEnvironment(payload, environment(env), { companyName: job.companyName, deadline }));
  }
}
