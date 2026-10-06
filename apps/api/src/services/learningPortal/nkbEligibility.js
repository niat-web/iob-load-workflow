import { splitList } from "../../utils/helpers.js";

const field = (fieldName, operator, value, valueType = "STRING", extra = {}) => ({
  category: null,
  field_name: fieldName,
  operator,
  value,
  value_type: valueType,
  ...extra,
});

const ENROLL_TAGS = {
  intensive: ["Intensive 1.0 Users", "Intensive 2.0 Users", "1.0 to 2.0 Converted Users", "Intensive 3.0 Users", "EDGE_COLLEGE_AND_INTENSIVE"],
  academy: [
    "CCBP_ACADEMY_SMART", "CCBP_ACADEMY_EDGE", "CCBP_ACADEMY_GENIUS", "CCBP_ACADEMY_SMART_PLUS", "CCBP_ACADEMY_EDGE_PLUS",
    "CCBP_ACADEMY_GENIUS_PLUS", "CCBP_ACADEMY_SMART_CAREER_PLUS", "CCBP_ACADEMY_GENIUS_CAREER_PLUS",
    "CCBP_ACADEMY_COLLEGE_PLUS", "EDGE_COLLEGE_AND_ACADEMY",
  ],
  edge: ["EDGE_COLLEGE", "EDGE_COLLEGE_AND_ACADEMY", "EDGE_COLLEGE_AND_INTENSIVE"],
  external: ["NXTWAVE_EXTERNAL_JOB_PORTAL"],
};

const SKILL_FLAGS = [
  [["HTML", "CSS"], "html_css_eligibility"],
  [["JAVASCRIPT", "JS"], "javascript_eligibility"],
  [["PYTHON"], "python_eligibilty"],
  [["SQL", "MYSQL"], "sql_eligibility"],
  [["NODE", "NODEJS"], "nodejs_eligibility"],
  [["REACT", "REACTJS"], "reactjs_eligibility"],
];

function jobTrack(raw) {
  const track = String(raw ?? "").toUpperCase().replace(/ /g, "_");
  if (!track) return null;
  if (track.includes("MERN")) return "MERN_FULL_STACK";
  if (track.includes("PYTHON") && track.includes("FULL")) return "PYTHON_FULL_STACK";
  if (track.includes("JAVA") && track.includes("FULL")) return "JAVA_FULL_STACK";
  if (track.includes("QA") || track.includes("TESTING")) return "QA";
  return null;
}

export function buildEligibilityDetails(props, { placementStatuses }) {
  const product = `${props.product ?? ""} ${props.product_tags ?? ""} ${props.enrollment_plans ?? ""}`.toUpperCase();
  const hasIntensive = product.includes("INTENSIVE");
  const hasAcademy = product.includes("ACADEMY");
  const hasEdge = product.includes("EDGE");
  const hasExternal = product.includes("EXTERNAL") || product.includes("FIRSTJOB");

  const tags = [];
  if (hasIntensive || (!hasAcademy && !hasEdge && !hasExternal)) tags.push(...ENROLL_TAGS.intensive);
  if (hasAcademy) tags.push(...ENROLL_TAGS.academy);
  if (hasEdge) tags.push(...ENROLL_TAGS.edge);
  if (hasExternal) tags.push(...ENROLL_TAGS.external);

  const details = [
    field("enroll_plan_version_tag", "IN", [...new Set(tags)].join(" | "), "STRING", { parent_category: "ENROLL-PLAN1" }),
  ];

  const track = jobTrack(props.crm_job_track || props.job_track);
  if (track) details.push(field("job_track_enum", "IN", track));

  details.push(
    field("highest_education", "IN", "BACHELORS | MASTERS"),
    field("highest_education_active_no_of_backlogs", "LTE", 0, "INT"),
    field("placement_status", "IN", placementStatuses.join(" | ")),
    field("opt_in_form_response", "IN", "Need Placement Support"),
  );

  const education = String(props.education_criteria ?? "").toUpperCase();
  const bachelors = [];
  if (["BE", "B.TECH", "BTECH"].some((tag) => education.includes(tag))) {
    bachelors.push("BE (Bachelor of Engineering)", "B Tech (Bachelor of Technology)");
  }
  if (education.includes("BCA")) bachelors.push("BCA (Bachelor of Computer Applications)");
  if (education.includes("BSC")) bachelors.push("B Sc (Bachelor of Science)");
  if (!bachelors.length) bachelors.push("BE (Bachelor of Engineering)", "B Tech (Bachelor of Technology)");
  details.push(
    { ...field("bachelors_course_name", "IN", [...new Set(bachelors)].join(" | ")), category: "EDUCATION-BACHELORS" },
    { ...field("bachelors_active_no_of_backlogs", "LTE", 0, "INT"), category: "EDUCATION-BACHELORS" },
  );

  const years = splitList(props.pass_out_year).filter((year) => /^\d{4}$/.test(year));
  if (years.length) {
    details.push({ ...field("bachelors_year_of_graduation", "IN", years.join(" | "), "INT"), category: "EDUCATION-BACHELORS" });
  }

  const masters = [];
  if (["ME", "M.TECH", "MTECH"].some((tag) => education.includes(tag))) {
    masters.push("ME (Master of Engineering)", "M Tech (Master of Technology)");
  }
  if (education.includes("MCA")) masters.push("MCA (Master of Computer Applications)");
  if (education.includes("MSC")) masters.push("M Sc (Master of Science)");
  if (masters.length) {
    details.push(
      { ...field("masters_course_name", "IN", [...new Set(masters)].join(" | ")), category: "EDUCATION-HIGHEST" },
      { ...field("masters_active_no_of_backlogs", "LTE", 0, "INT"), category: "EDUCATION-HIGHEST" },
    );
  }

  const words = new Set(String(props.technologies_required ?? "").toUpperCase().split(/[;,|\s()-]+/));
  for (const [keywords, flag] of SKILL_FLAGS) {
    if (keywords.some((word) => words.has(word))) {
      details.push(field(flag, "IN", "ELIGIBLE", "STRING", { parent_category: "ENROLL-PLAN1" }));
    }
  }
  if (words.has("JAVA") && !words.has("JAVASCRIPT")) {
    details.push(field("java_fundamentals_eligibility", "IN", "ELIGIBLE", "STRING", { parent_category: "ENROLL-PLAN1" }));
  }

  details.push(
    { ...field("days_since_latest_login", "LTE", 45, "INT"), category: "DAYS-LOGIN" },
    { ...field("days_since_job_application_and_latest_rollout", "LTE", 45, "INT"), category: "DAYS-DAYS" },
    { ...field("days_since_latest_placed_more_opps_entry", "LTE", 30, "INT"), category: "DAYS-PLACED" },
  );
  return details;
}
