import { splitList } from "../../utils/helpers.js";

const LOCATIONS_OPTIONS = [
  "Hyderabad", "Benguluru", "Chennai", "Gurugram", "Pune", "Mumbai", "Noida", "Ahmedabad", "New Delhi",
  "Visakhapatnam", "Indore", "Coimbatore", "Tirupati", "Dehradun", "Kolkata", "Gandhinagar", "Surat", "Gujarat",
  "Guntur", "Permanent Work From Home", "India (Work From Home)", "Chandigarh", "Jaipur", "Bhubaneswar",
  "Work From Home", "Vijayawada", "Madurai", "Maharashtra", "Kerala", "Tamil Nadu", "Andhra Pradesh", "Karnataka",
  "Mangaluru", "Rajasthan", "Raipur", "Punjab", "Pan India", "Mysuru", "Nagpur", "Thane", "Haryana", "Pithapuram",
  "Kakinada", "Kochi", "Cochin", "Bhopal", "Patna", "Lucknow", "Trivandrum", "Thiruvananthapuram", "Guwahati", "Goa",
  "Vadodara", "Uttar Pradesh", "Uttarpradesh", "Kanpur",
];

const LOCATION_ALIASES = [
  [/uttar\s*-?pradesh/, "Uttar Pradesh"],
  [/kanpur/, "Kanpur"],
  [/bengaluru|bangalore/, "Benguluru"],
  [/gurgaon|gurgoan|gurugoan/, "Gurugram"],
  [/delhi/, "New Delhi"],
  [/kochi|cochin/, "Kochi"],
  [/trivandrum|thiruvananthapuram/, "Trivandrum"],
];

const SKILLS_OPTIONS = [
  "Python", "SQL", "JavaScript", "Bootstrap", "React JS", "Node JS", "HTML", "CSS", "Java", "Automation Testing",
  "PowerBI", "Tableau", "Springboot", "MongoDB", "Golang", "Selenium", "GraphQL", "RestAPI", "Shopify", "Azure", "AWS",
  "Typescript", "React Native", "GCP", "DSA", "C++", "C#", "C", "Ruby", "PHP", "Kotlin", "Angular", "Vue.js", "Svelte",
  "Next.js", "Gatsby", "Tailwind CSS", "Material-UI", "Three.js", "Django", "Flask", "Ruby on Rails", "ASP.NET Core",
  "Laravel", "Express.js", "FastAPI", "Phoenix", "MySQL", "PostgreSQL", "Redis", "Cassandra", "SQLite", "MariaDB",
  "DynamoDB", "Couchbase", "Elasticsearch", "Docker", "Kubernetes", "Jenkins", "Terraform", "Ansible",
  "CloudFormation", "OpenShift", "Hadoop", "Apache Spark", "Kafka", "Hive", "Snowflake", "Databricks", "Airflow",
  "Flink", "Presto", "HBase", "TensorFlow", "PyTorch", "Keras", "Scikit-learn", "OpenCV", "Hugging Face", "MLflow",
  "Fast.ai", "Google Vertex AI", "IBM Watson", "Flutter", "Swift", "Objective-C", "Xamarin", "Kotlin Multiplatform",
  "Ionic", "Cordova", "Jetpack Compose", "Unity (for mobile games)", "Cypress", "JUnit", "Jest", "Mocha", "Postman",
  "Appium", "Robot Framework", "TestNG", "Katalon Studio", "Blockchain", "Solidity", "OAuth", "Firebase", "RabbitMQ",
  "Prometheus", "Grafana", "Metabase", "Jira", "AI/ML", "DevOps", "ASP.NET Core MVC", "jQuery", "Flexcube", "Oracle",
  ".NET", "GenAI", "CCNA", "Cyber Security", "Excel", "LLM", "RAG", "NumPy", "Pandas", "LangChain", "Web Testing",
  "Manual Testing", "API Testing", "Agentic AI", "AI Native",
];

const SKILL_NORMALISATION = {
  "react js": "react js",
  "node js": "node js",
  "spring boot": "springboot",
  go: "golang",
  "rest apis": "restapi",
  "google cloud platform (gcp)": "gcp",
};

const ACADEMY_PLANS = [
  "CCBP_ACADEMY_SMART", "CCBP_ACADEMY_GENIUS", "CCBP_ACADEMY_EDGE", "CCBP_ACADEMY_SMART_PLUS",
  "CCBP_ACADEMY_GENIUS_PLUS", "CCBP_ACADEMY_EDGE_PLUS", "CCBP_ACADEMY_SMART_CAREER_PLUS",
  "CCBP_ACADEMY_GENIUS_CAREER_PLUS", "CCBP_ACADEMY_COLLEGE_PLUS",
];

export function mapLocations(raw) {
  const parts = splitList(raw).map((part) => part.toLowerCase());
  const mapped = new Set();
  for (const option of LOCATIONS_OPTIONS) {
    const plain = option.toLowerCase();
    if (parts.some((part) => part === plain || part.replace(/\s/g, "") === plain.replace(/\s/g, ""))) {
      mapped.add(option);
    }
  }
  if (parts.some((part) => part.includes("remote"))) mapped.add("Work From Home");
  for (const part of parts) {
    for (const [pattern, option] of LOCATION_ALIASES) if (pattern.test(part)) mapped.add(option);
  }
  return [...mapped];
}

export function mapSkills(skills) {
  const normalised = new Set(
    splitList(Array.isArray(skills) ? skills.join(";") : skills).map((skill) => {
      const lower = skill.toLowerCase();
      return SKILL_NORMALISATION[lower] ?? lower;
    }),
  );
  return SKILLS_OPTIONS.filter((option) => normalised.has(option.toLowerCase()));
}

export function mapJobType(crmJobType) {
  if (crmJobType === "Internship+Full time") return "INTERNSHIP_AND_FULL_TIME";
  if (["Full time", "Contract Based"].includes(crmJobType)) return "FULL_TIME";
  return "INTERNSHIP";
}

export function mapEnrollPlans(product) {
  const text = String(product ?? "");
  const lower = text.toLowerCase();
  const plans = [];
  if (lower.includes("offline")) plans.push("CCBP_TECH_INTENSIVE_OFFLINE");
  else if (lower.includes("intensive")) plans.push("CCBP_INTENSIVE", "INTENSIVE_COLLEGE_PLUS", "CCBP_INTENSIVE_NSDC_SKILL_INDIA");
  if (lower.includes("academy")) plans.push(...ACADEMY_PLANS);
  if (["NET", "PAP", "SJET", "Experienced", "Edge"].some((tag) => text.includes(tag))) {
    plans.push("NXTWAVE_EXTERNAL_JOB_PORTAL");
  }
  if (lower.includes("niat")) plans.push("NIAT");
  return plans;
}

export function enrollPlansFor(props, job = {}) {
  const enrollment = props.enrollment_plans ?? props.enroll_plans ?? "";
  return mapEnrollPlans(`${props.product ?? job.program ?? ""} ${enrollment}`.trim());
}

export const ALL_ENROLL_PLANS = [
  "CCBP_INTENSIVE",
  "INTENSIVE_COLLEGE_PLUS",
  "CCBP_INTENSIVE_NSDC_SKILL_INDIA",
  "CCBP_TECH_INTENSIVE_OFFLINE",
  ...ACADEMY_PLANS,
  "NXTWAVE_EXTERNAL_JOB_PORTAL",
  "NIAT",
];

const pythonFloat = (value) => (Number.isInteger(value) ? `${value}.0` : String(value));

function lpaFromStipend(raw) {
  const value = Number(raw);
  if (raw === "" || raw === null || raw === undefined || !Number.isFinite(value)) return String(raw ?? "0");
  return pythonFloat(value >= 1000 ? value / 1000 : value);
}

export function mapCtc(props, jobType) {
  const minLpa = props.minimum_ctc_in_lpa || "";
  const maxLpa = props.maximum_ctc_in_lpa || "";
  let min;
  let max;
  if (jobType !== "INTERNSHIP" || (minLpa && minLpa !== "0")) {
    min = minLpa ? String(minLpa) : "0";
    max = maxLpa ? String(maxLpa) : "0";
  } else {
    min = lpaFromStipend(props.internship_stipend_per_month || minLpa || "0");
    max = lpaFromStipend(props.max_internship_stipend_per_month || maxLpa || "0");
  }
  if (min === max) max = "0";
  return { min, max };
}

const BOND_MONTHS = {
  No: "0",
  "Yes - 1 year": "12",
  "Yes - 18 months": "18",
  "Yes - 2 years": "24",
  "Yes - 2.6 years": "30",
  "Yes - 3 years": "36",
};

export function mapDurations(props, jobType) {
  let min = props.min_internship_duration || "";
  if (!min) {
    const bond = String(props.any_bond__service_agreement || "");
    const months = bond.match(/^(\d{1,2}) Months?$/);
    min = BOND_MONTHS[bond] ?? (months ? months[1] : "0");
  }
  let max = "";
  if (String(props.product || "").includes("NIAT") || ["INTERNSHIP", "INTERNSHIP_AND_FULL_TIME"].includes(jobType)) {
    max = props.max_internship_duration || "";
  }
  min ||= "0";
  max ||= "0";
  if (min === max) max = "0";
  return { min, max };
}


export function formatIst(date) {
  const ist = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().replace("T", " ").slice(0, 19);
}

export function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(values[key] ?? ""));
}

const contentObject = (html) => (html && html !== "<p><br></p>" ? { content: [html], content_type: "HTML" } : null);

function positionsFor(props, job, jobType) {
  const isNiat = String(props.product ?? "").includes("NIAT");
  const positions =
    isNiat || ["INTERNSHIP", "INTERNSHIP_AND_FULL_TIME"].includes(jobType)
      ? props.number_of_interns_required || props.no_of_openings || job.openings
      : props.no_of_openings || job.openings;
  return !positions || String(positions).trim() === "0" ? "1" : String(positions);
}

export function buildNkbJobPayload({
  jobId,
  organisationId,
  job,
  props,
  deadline,
  order,
  content,
  enrollPlans: chosenPlans,
  showForAllInEnrollPlans = true,
}) {
  const jobType = mapJobType(props.crm_job_type ?? job.employmentType);
  const enrollPlans = chosenPlans ?? enrollPlansFor(props, job);
  const ctc = mapCtc(props, jobType);
  const durations = mapDurations(props, jobType);

  return {
    job_id: jobId,
    job_details: {
      organisation_id: organisationId,
      job_title: job.jobRole,
      job_description: job.jobDescription ?? undefined,
      eligibility_criteria: {
        content: content.eligibilityContent,
        content_type: "MARKDOWN_DICT",
      },
      locations: mapLocations(job.location),
      min_ctc: ctc.min,
      max_ctc: ctc.max,
      skills_required: mapSkills(job.skills),
      no_of_positions_available: positionsFor(props, job, jobType),
      order: order ?? undefined,
      service_agreement_in_months: durations.min,
      organisation_description: contentObject(content.organisationDescriptionHtml),
      disclaimer: contentObject(content.disclaimerHtml),
      is_process_done: "false",
      enroll_plans: enrollPlans,
      apply_by: deadline ? formatIst(deadline) : undefined,
      link_to_apply: null,
      max_service_agreement_in_months: durations.max,
      job_type: jobType,
      job_source: "INTERNAL",
      min_years_of_experience: "0",
      max_years_of_experience: "0",
    },
    job_extra_details: {
      ise: job.ise?.name ?? "NA",
      crm: job.crmOwnerName ?? "NA",
      profiling_poc: job.profilingPoc?.name ?? "NA",
      taskflow_id: job.hubspotDealId,
    },
    user_job_criteria: {
      show_for_all_users_in_enroll_plans: showForAllInEnrollPlans ? enrollPlans : [],
    },
  };
}

export function payloadForEnvironment(payload, environment, { companyName, deadline } = {}) {
  return {
    ...payload,
    job_details: {
      ...payload.job_details,
      ...(deadline ? { apply_by: formatIst(deadline) } : {}),
      link_to_apply: fillTemplate(environment.applyLinkTemplate, { company: companyName, jobId: payload.job_id }),
    },
  };
}

const TEST_USER_GROUPS = [
  ["INTENSIVE", (plans) => plans.includes("CCBP_INTENSIVE")],
  ["ACADEMY", (plans) => ["CCBP_ACADEMY_EDGE", "CCBP_ACADEMY_GENIUS", "CCBP_ACADEMY_SMART"].some((plan) => plans.includes(plan))],
  ["EXTERNAL", (plans) => plans.includes("NXTWAVE_EXTERNAL_JOB_PORTAL")],
  ["NIAT", (plans) => plans.includes("NIAT")],
  ["OFFLINE", (plans) => plans.includes("CCBP_TECH_INTENSIVE_OFFLINE")],
];

export function testUsersFor(environment, enrollPlans) {
  const plans = enrollPlans.map((plan) => plan.toUpperCase());
  const ids = TEST_USER_GROUPS.filter(([, matches]) => matches(plans)).flatMap(([group]) => environment.testUsers?.[group] ?? []);
  return [...new Set(ids)];
}
