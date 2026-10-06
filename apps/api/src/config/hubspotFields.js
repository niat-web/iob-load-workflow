import "./env.js";

const DEFAULTS = {
  companyName: "",
  jobRole: "type_of_role",
  jobDescription: "",
  skills: "technologies_required",
  eligibility: "education_criteria",
  batch: "pass_out_year",
  campus: "",
  program: "product",
  location: "location",
  ctc: "minimum_ctc_in_lpa",
  ctcMax: "maximum_ctc_in_lpa",
  employmentType: "crm_job_type",
  openings: "no_of_openings",
  crmOwnerId: "hubspot_owner_id",
  crmOwnerName: "",
  crmOwnerEmail: "",
  applicationDeadline: "",
  importantInstructions: "nurturing_team_remarks",
};

const ENV_KEYS = {
  companyName: "HUBSPOT_PROP_COMPANY_NAME",
  jobRole: "HUBSPOT_PROP_JOB_ROLE",
  jobDescription: "HUBSPOT_PROP_JOB_DESCRIPTION",
  skills: "HUBSPOT_PROP_SKILLS",
  eligibility: "HUBSPOT_PROP_ELIGIBILITY",
  batch: "HUBSPOT_PROP_BATCH",
  campus: "HUBSPOT_PROP_CAMPUS",
  program: "HUBSPOT_PROP_PROGRAM",
  location: "HUBSPOT_PROP_LOCATION",
  ctc: "HUBSPOT_PROP_CTC",
  ctcMax: "HUBSPOT_PROP_CTC_MAX",
  employmentType: "HUBSPOT_PROP_EMPLOYMENT_TYPE",
  openings: "HUBSPOT_PROP_OPENINGS",
  crmOwnerId: "HUBSPOT_PROP_CRM_OWNER_ID",
  crmOwnerName: "HUBSPOT_PROP_CRM_OWNER_NAME",
  crmOwnerEmail: "HUBSPOT_PROP_CRM_OWNER_EMAIL",
  applicationDeadline: "HUBSPOT_PROP_APPLICATION_DEADLINE",
  importantInstructions: "HUBSPOT_PROP_IMPORTANT_INSTRUCTIONS",
};

export const hubspotFields = Object.fromEntries(
  Object.entries(DEFAULTS).map(([field, fallback]) => {
    const fromEnv = process.env[ENV_KEYS[field]];
    return [field, fromEnv === undefined ? fallback : fromEnv.trim()];
  }),
);

const LEARNING_PORTAL_PROPERTIES = [
  "dealname",
  "pipeline",
  "dealstage",
  "no_of_openings",
  "number_of_interns_required",
  "type_of_role",
  "product",
  "product_tags",
  "enrollment_plans",
  "enroll_plans",
  "crm_job_type",
  "crm_job_track",
  "job_track",
  "user_opt_in_form_preference",
  "bond_duration_in_months",
  "minimum_ctc_in_lpa",
  "maximum_ctc_in_lpa",
  "internship_stipend_per_month",
  "max_internship_stipend_per_month",
  "internship_duration",
  "min_internship_duration",
  "max_internship_duration",
  "any_bond__service_agreement",
  "technologies_required",
  "optional_technologies_required",
  "education_criteria",
  "education_stream",
  "education_department_tags",
  "pass_out_year",
  "n10th____",
  "intermediate____",
  "highest_degree____",
  "location",
  "deal_location",
  "no__of_working_days",
  "work_timings",
  "other_benefits",
  "offline_interview_rounds",
  "interview_process",
  "nurturing_team_remarks",
  "company_logo_link",
  "company_linkedin_profile",
  "hubspot_owner_id",
];

const extra = (process.env.HUBSPOT_EXTRA_PROPERTIES ?? "")
  .split(",")
  .map((property) => property.trim())
  .filter(Boolean);

export const HUBSPOT_DEAL_PROPERTIES = [
  ...new Set([...LEARNING_PORTAL_PROPERTIES, ...Object.values(hubspotFields).filter(Boolean), ...extra]),
];

export const TRACKED_FIELDS = [
  "jobRole",
  "jobDescription",
  "skills",
  "eligibility",
  "batch",
  "campus",
  "program",
  "location",
  "ctc",
  "employmentType",
  "openings",
  "applicationDeadline",
  "importantInstructions",
];

export const FIELD_LABELS = {
  companyName: "Company",
  jobRole: "Role",
  jobDescription: "Job Description",
  skills: "Skills",
  eligibility: "Eligibility",
  batch: "Batch",
  campus: "Campus",
  program: "Program",
  location: "Location",
  ctc: "CTC",
  employmentType: "Employment Type",
  openings: "Openings",
  applicationDeadline: "Application Deadline",
  importantInstructions: "Important Instructions",
  expectedPoolCount: "Expected Pool",
  crmOwnerEmail: "CRM Owner",
};

export const REQUIRED_FIELDS = ["companyName", "jobRole", "expectedPoolCount", "crmOwnerEmail"];
