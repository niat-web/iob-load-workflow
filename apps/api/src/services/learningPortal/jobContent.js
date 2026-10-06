import { escapeHtml } from "../../utils/helpers.js";
import { DEFAULT_ELIGIBILITY_TEMPLATES } from "./eligibilityTemplates.js";
import { mapSkills } from "./nkbPayload.js";

const BLANK = ["none", "null", "n/a", "na"];
const COMMUNICATION_LINE = "Candidates should have good communication skills.";
const STARTUP_LINE =
  "Candidates should be willing to start their career in a startup environment, as the company is currently growing.";
const BULLET = /^[-*+•‣⁃⁌⁍∙◦○▪▫]\s*/;
const DEFAULT_SKILL_BLOCK =
  "- **Note:**\n - Point 1: After successfully applying for the opportunity, your application will be forwarded to the company, and you will receive updates accordingly.";

const text = (value) => (value === null || value === undefined ? "" : String(value));
const isDigits = (value) => /^\d+$/.test(value);

export function formatInternshipDuration(minValue, maxValue, rawDuration = "") {
  const raw = text(rawDuration).trim();
  if (raw && !BLANK.includes(raw.toLowerCase())) return /month/i.test(raw) ? raw : `${raw} Months`;
  const clean = (value) => (value && !BLANK.includes(text(value).trim().toLowerCase()) ? text(value).trim() : "");
  const min = clean(minValue);
  const max = clean(maxValue);
  if (!min && !max) return "";
  const duration = !max || min === max ? min || max : `${min} - ${max}`;
  return /month/i.test(duration) ? duration : `${duration} Months`;
}

export function formatStipend(minValue, maxValue) {
  if (!minValue && !maxValue) return "";
  const toK = (value) => {
    const raw = text(value).trim();
    if (!raw) return "";
    if (isDigits(raw)) {
      const amount = Number(raw);
      if (amount >= 1000 && amount % 1000 === 0) return `${amount / 1000}k`;
      if (amount < 1000) return `${amount}k`;
    }
    return raw.endsWith("k") || raw.includes("per") ? raw : `${raw}k`;
  };
  const min = toK(minValue);
  const max = toK(maxValue);
  if (!maxValue || min === max) return min;
  return `${min} - ${max}`;
}

export function formatCtcDisplay(minCtc, maxCtc) {
  if (!minCtc || ["0", "0.0", ""].includes(text(minCtc).trim())) return "";
  const min = Number(minCtc);
  const max = maxCtc ? Number(maxCtc) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return text(minCtc);
  return min === max || max === 0 ? `${min} LPA` : `${min} - ${max} LPA`;
}

export function buildInterviewProcess(onlineRaw, offlineRaw) {
  const rounds = (raw) => text(raw).split(";").map((round) => round.trim()).filter(Boolean);
  const online = rounds(onlineRaw);
  const offline = rounds(offlineRaw);
  const parts = [];
  if (online.length) parts.push(`Online Process: ${online.join(", ")}`);
  if (offline.length) parts.push(`Offline Process: ${offline.join(", ")}`);
  return parts.join(" | ");
}

export function htmlToPlainText(html) {
  if (!html) return "";
  return text(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replace(/^-\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function markdownToHtml(markdown) {
  if (!markdown) return "";
  return text(markdown)
    .replace(/^### (.*$)/gm, "<h3>$1</h3>")
    .replace(/^## (.*$)/gm, "<h2>$1</h2>")
    .replace(/^# (.*$)/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(/!\[(.*?)\]\((.*?)\)/g, "<img alt='$1' src='$2' />")
    .replace(/\[(.*?)\]\((.*?)\)/g, "<a href='$2'>$1</a>")
    .replaceAll("\n", "<br />");
}

const PLACEHOLDER_LINES = [
  "[specific technical skills not provided]",
  "[if any, not specified]",
  "[not specified]",
  "[not provided]",
  "work timings: na",
  "work timings: n/a",
  "service agreement / bond: na",
  "service agreement / bond: n/a",
];

export function cleanAiDisclaimerLines(raw) {
  if (!raw || !raw.trim()) return "";
  return raw
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const lower = line.toLowerCase();
      if (!line || ["job description:", "disclaimer:", "summary:", "n/a", "none", "null"].includes(lower)) return false;
      return !PLACEHOLDER_LINES.some((placeholder) => lower.includes(placeholder));
    })
    .join("\n");
}

function disclaimerPrompt(rawText, category) {
  if (category === "INTERNSHIP") {
    return (
      "Synthesize the following structured deal information and team remarks into a clean job description/disclaimer for an Internship.\n\n" +
      "Format Rules:\n" +
      "1. Line 1 MUST start with bullet dash '- ' and describe duration and stipend dynamically from text, e.g. '- **Internship Period:** **6 Months**, where the stipend will be **10k per month**'\n" +
      "2. Line 2 MUST be: 'Candidates should have good communication skills.'\n" +
      "3. If optional skills present, include: 'Add-on: Knowledge of **[Skills]** will be an advantage'\n" +
      "4. Followed by Work Timings (e.g. '**Work Timings:** **10.30 to 7.30**')\n" +
      "5. Followed by No. of Working Days (e.g. '**No. of Working Days:** **6 days a week**')\n" +
      "6. Followed by Interview Process (e.g. '**Interview Process (Tentative):** **Online Process:** Technical Round 1, Technical Round 2, HR.')\n" +
      "7. Do NOT include any section titles like 'Summary:', 'Compensation:'. Output plain lines only.\n" +
      "8. BOLD side headings (e.g. **Work Timings:**) and key terms/technologies (e.g. **Python**, **React**, **HTML**, **CSS**, **DSA**, **Bangalore**, **6 Months**) using markdown bold (**word**).\n" +
      "9. NEVER output placeholder text like '[Not specified]', 'N/A', or 'None'.\n\n" +
      `Original text:\n${rawText}`
    );
  }
  const typeInstructions =
    category === "INTERNSHIP_AND_FULL_TIME"
      ? "This is an Internship leading to Full-Time job opportunity."
      : "This is a Full-Time / Permanent job opportunity. Do NOT include any internship stipend lines unless present in conversion details.";
  return (
    "Synthesize the following structured deal information and team remarks into a clean, beautifully formatted job description/disclaimer.\n\n" +
    `${typeInstructions}\n` +
    "EXACT STRUCTURE RULES:\n" +
    "1. Top Summary Section: Each line MUST start with bullet '• ' (e.g. • **CTC:** **[CTC]**, • **Number of Working Days:** **[Days]**, • **Service Agreement/Bond:** **[Bond]**, • **Interview Process:** **[Process]**).\n" +
    "2. Subsequent Sections: Bold section headers on their own line (e.g. **Compensation**, **Role Structure**, **Responsibilities**, **Required Skills**, **Good to Have**, **Interview Process**).\n" +
    "3. Under section headers, prefix sub-item lines with bullet dash ' - ' (e.g.  - **Backend programming:** Strong knowledge of **Python**...).\n" +
    "4. BOLD side headings (e.g. **Topics Covered:**, **Total Rounds:**, **Final Round Travel:**, **Growth Path:**, **Eligible Institutes:**) and key terms/words (technologies, tools, languages, numbers, metrics, locations, degree names, key acronyms, e.g. **Python**, **Bash**, **Linux**, **DSA**, **Gurgaon**, **3**, **HFT**, **HTML, CSS, JavaScript, React**).\n" +
    "5. NEVER output placeholder text such as '[Specific technical skills not provided]', '[If any, not specified]', 'N/A', 'None', or '[Not provided]'.\n" +
    "6. If a section (such as Good to Have or Interview Process) has NO actual information from the text, DO NOT INCLUDE THAT SECTION AT ALL.\n" +
    "7. Output ONLY the clean formatted lines without any title headings like 'Job Description:' or 'Important Notes'.\n\n" +
    `Original text:\n${rawText}`
  );
}

export function regexFallbackDisclaimer(lines) {
  let duration;
  let stipend;
  let communication;
  let timings;
  let workingDays;
  let interview;
  for (const line of lines) {
    duration ||= /(\d+\s*months?) internship period/i.exec(line)?.[1];
    stipend ||= /stipend(?:\s+(?:will\s+be|is|of))?\s*[:-]?\s*(.*?)(?:\s*(?:per\s+month|\/\s*month))?$/i.exec(line)?.[1]?.trim();
    if (!communication && /communication skills/i.test(line)) communication = COMMUNICATION_LINE;
    timings ||= /Work Timings:\s*(.+)$/i.exec(line)?.[1]?.trim();
    workingDays ||= /No\.?\s*of Working Days:\s*(.+)$/i.exec(line)?.[1]?.trim();
    const interviewMatch = /(Interview Process\s*(?:\(Tentative\))?:\s*.+)$/i.exec(line)?.[1];
    if (!interview && interviewMatch) interview = `${interviewMatch.trim().replace(/\.+$/, "")}.`;
  }
  const result = [];
  if (duration && stipend) result.push(`${duration} internship period, where the stipend will be ${stipend} per month`);
  else if (duration) result.push(`${duration} internship period`);
  else if (stipend) result.push(`The stipend will be ${stipend} per month`);
  if (communication) result.push(communication);
  if (timings) result.push(`Work Timings: ${timings}`);
  if (workingDays) result.push(`No. of Working Days: ${workingDays}`);
  if (interview) result.push(interview);
  if (result.length) return result.join("\n");
  return lines
    .map((line) => line.replace(BULLET, "").replaceAll("**", "").replaceAll("*", "").trim())
    .filter(Boolean)
    .join("\n");
}

const INTERNAL_REMARK_MARKERS = [
  "attached jd", "please find", "refer to", "kindly find", "already hired", "do not load", "on hold", "hold this",
  "closed", "not loading", "interviews scheduled", "interview scheduled", "scheduled for", "interview at", "scheduled on",
];

export async function buildDisclaimer(props, generate) {
  const product = text(props.product);
  const isNiat = product.includes("NIAT");
  const crmJobType = text(props.crm_job_type);
  const category =
    crmJobType === "Internship+Full time"
      ? "INTERNSHIP_AND_FULL_TIME"
      : ["Full time", "Contract Based"].includes(crmJobType)
        ? "FULL_TIME"
        : "INTERNSHIP";

  const remarks = htmlToPlainText(props.nurturing_team_remarks);
  const duration = formatInternshipDuration(props.min_internship_duration, props.max_internship_duration, props.internship_duration);
  const stipend = formatStipend(props.internship_stipend_per_month, props.max_internship_stipend_per_month);
  const ctc = formatCtcDisplay(props.minimum_ctc_in_lpa, props.maximum_ctc_in_lpa);
  const bond = text(props.any_bond__service_agreement || props.bond_duration_in_months);
  const interviewProcess = buildInterviewProcess(props.interview_process, props.offline_interview_rounds);
  const workTimings = text(props.work_timings);
  const workingDays = text(props.no__of_working_days);
  const optionalSkills = mapSkills(props.optional_technologies_required);
  const optionalLine = optionalSkills.length
    ? `- Add-on: Knowledge of **${optionalSkills.join(", ")}** will be an advantage`
    : "";

  const mandatory = [];
  if (category === "INTERNSHIP_AND_FULL_TIME") {
    if (stipend) mandatory.push(`• **Internship Stipend:** **${stipend}** per month${duration ? ` for ${duration}` : ""}`);
    if (ctc) mandatory.push(`• **Full-Time CTC:** **${ctc}** upon successful conversion to full-time employment`);
    if (workingDays) mandatory.push(`• **Number of Working Days:** **${workingDays}**`);
    if (bond) mandatory.push(`• **Service Agreement/Bond:** **${bond}**`);
    if (interviewProcess) mandatory.push(`• **Interview Process:** **${interviewProcess}**`);
  } else if (category === "FULL_TIME") {
    if (ctc) mandatory.push(`• **CTC:** **${ctc}**`);
    if (workingDays) mandatory.push(`• **Number of Working Days:** **${workingDays}**`);
    if (bond) mandatory.push(`• **Service Agreement/Bond:** **${bond}**`);
    if (interviewProcess) mandatory.push(`• **Interview Process:** **${interviewProcess}**`);
  } else {
    if (stipend) mandatory.push(`- **${duration ? `${duration} ` : ""}internship period**, where the stipend will be **${stipend}** per month`);
    mandatory.push(COMMUNICATION_LINE);
    if (optionalLine) mandatory.push(optionalLine);
    if (workTimings) mandatory.push(`**Work Timings:** **${workTimings}**`);
    if (workingDays) mandatory.push(`**No. of Working Days:** **${workingDays}**`);
    if (interviewProcess) mandatory.push(`**Interview Process (Tentative):** **${interviewProcess}**`);
  }
  const mandatoryText = mandatory.filter(Boolean).join("\n");

  const remarkLines = remarks
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      const lower = line.toLowerCase();
      if (!line || ["na", "n/a", "none", "null", "no remarks", "n.a."].includes(lower)) return false;
      return !INTERNAL_REMARK_MARKERS.some((marker) => lower.includes(marker));
    });

  let fullRaw = mandatoryText;
  if (remarkLines.length) fullRaw = fullRaw ? `${fullRaw}\n${remarkLines.join("\n")}` : remarkLines.join("\n");

  let disclaimer;
  if (!fullRaw.trim() || fullRaw.trim().toUpperCase() === "NA") {
    disclaimer = mandatoryText;
  } else {
    const rewritten = cleanAiDisclaimerLines(await generate(disclaimerPrompt(fullRaw, category)));
    if (rewritten && rewritten.trim().toUpperCase() !== "NA") {
      disclaimer = !isNiat && !rewritten.toLowerCase().includes("communication")
        ? `${rewritten.trimEnd()}\n${COMMUNICATION_LINE}`
        : rewritten;
    } else {
      const beforeInterview = [];
      for (const line of remarkLines) {
        if (/Interview Process/i.test(line)) break;
        beforeInterview.push(line);
      }
      const fallback = beforeInterview.length ? regexFallbackDisclaimer(beforeInterview) : "";
      disclaimer =
        fallback && fallback.trim().toUpperCase() !== "NA" && fallback.trim() !== mandatoryText.trim()
          ? `${mandatoryText}\n${fallback.trim()}`
          : mandatoryText || fullRaw;
      if (!isNiat && !disclaimer.toLowerCase().includes("communication")) {
        disclaimer = `${disclaimer.trimEnd()}\n${COMMUNICATION_LINE}`;
      }
    }
  }

  const lines = disclaimer.split("\n").filter((line) => {
    const lower = line.toLowerCase();
    return !(lower.includes("add-on:") && lower.includes("knowledge of") && lower.includes("advantage"));
  });
  if (optionalLine) {
    const index = lines.findIndex((line) => line.toLowerCase().includes("communication"));
    if (index >= 0) lines.splice(index + 1, 0, optionalLine);
    else if (lines.length > 1) lines.splice(1, 0, optionalLine);
    else lines.push(optionalLine);
  }
  return lines.join("\n");
}

const COURSE_COMPLETION_NOTE = `- Always end the output with this exact note block, never modify it:
- **Note**
  - Point 1: The completion percentages of courses are calculated the day before the job is posted.
  - Point 2: Refer to the My Journey section to view the completion percentages of the courses.
  - Point 3: You must have logged into the portal at least once in the last 45 days and must have applied for at least one job during this period.`;

const BASIC_COURSE_MAPPING = `If the technologies contain "HTML" or "CSS":
  - Build Your Own Static Website: 75% of the course completion is required.
  - Build Your Own Responsive Website: 75% of the course completion is required.
If the technologies contain "JavaScript":
  - Build Your Own Dynamic Web Application: 75% of the course completion is required.
  - JavaScript Essentials: 75% of the course completion is required.
If the technologies contain "Python":
  - Programming Foundations: 75% of the course completion is required.
If the technologies contain "SQL":
  - Introduction to Databases: 75% of the course completion is required.
If the technologies contain "NodeJS" or "Node JS":
  - Developer Foundations Completion: 75% of the course completion is required.
  - Node JS: 75% of the course completion is required.
If the technologies contain "ReactJS" or "React JS":
  - React JS - Getting started: 75% of the course completion is required.`;

const EXTENDED_COURSE_MAPPING = `${BASIC_COURSE_MAPPING}
If the technologies contain "Java":
  - Java Fundamentals: 75% of the course completion is required.
If the technologies contain "Springboot" or "Spring Boot":
  - Backend with Spring Boot: 75% of the course completion is required.
If the technologies contain "Automation Testing" or "Selenium":
  - Automation Testing with Selenium: 75% of the course completion is required.
If the technologies contain "PowerBI" or "Power BI":
  - Data Analytics using PowerBI: 75% of the course completion is required.
  - Data Analytics Foundations: 75% of the course completion is required.
  - Data Analytics using Python: 75% of the course completion is required.
If the technologies contain "Tableau":
  - Data Analytics using Tableau: 75% of the course completion is required.
  - Data Analytics Foundations: 75% of the course completion is required.
  - Data Analytics using Python: 75% of the course completion is required.`;

const EDUCATION_RULES = `- For Education Details: if education criteria is empty or says "anyone can apply", write "Should have a Bachelor's / Master's degree." Otherwise list the degrees separated by " or " along with the educationDepartment provided above.`;
const YEAR_RULES = `- For Year of graduation: if pass out years are a range like 2019;2020;2021;2022;2023, write "2019 - 2023". If only one year, write that year. If empty, skip this line entirely.
- For Highest Degree, 12th, 10th percentage: only include the line if the value is not empty.`;
const PROMPT_HEADER =
  "You are a helpful assistant. Based on the following data, generate a structured eligibility criteria output exactly as shown in the examples below.";
const PROMPT_FOOTER = `--- OUTPUT ---
Generate the output now based on the input data above. Return only the final output, nothing else.`;

export function eligibilityPrompt(kind, props) {
  const input = {
    technologies: text(props.technologies_required),
    education: text(props.education_criteria),
    department: text(props.education_department_tags || props.education_stream),
    passOut: text(props.pass_out_year),
    highestDegree: text(props.highest_degree____),
    intermediate: text(props.intermediate____),
    tenth: text(props.n10th____),
    optIn: text(props.user_opt_in_form_preference),
  };
  const scores = `Highest Degree Percentage: ${input.highestDegree}
12th Percentage: ${input.intermediate}
10th Percentage: ${input.tenth}`;
  const education = `Education Criteria Courses: ${input.education}
Education Criteria Departments: ${input.department}
Pass Out Year: ${input.passOut}`;

  if (kind === "intensive_1_native") {
    return `
${PROMPT_HEADER}

--- INPUT DATA ---
Technologies Required: ${input.technologies}
${education}
${scores}
Opt In Form: ${input.optIn}


--- TECHNOLOGY TO COURSE MAPPING ---
${BASIC_COURSE_MAPPING}

--- RULES ---
- Only include course lines for technologies that are present in "Technologies Required". Skip the rest.
- Do not duplicate course lines if HTML and CSS are both present.
${EDUCATION_RULES}
Example: if education details are BTech;BE;ME, then consider the education details as BTech or BE or ME
${YEAR_RULES}
${COURSE_COMPLETION_NOTE}

${PROMPT_FOOTER}
`;
  }
  if (kind === "intensive_other") {
    return `
${PROMPT_HEADER}

--- INPUT DATA ---
Technologies Required: ${input.technologies}
${education}
${scores}
Opt In Form: ${input.optIn}


--- TECHNOLOGY TO COURSE MAPPING ---
${EXTENDED_COURSE_MAPPING}

--- RULES ---
- Only include course lines for technologies that are present in "Technologies Required". Skip the rest.
- Do not duplicate course lines. For example, if both PowerBI and Tableau are present, "Data Analytics Foundations" and "Data Analytics using Python" should appear only once.
- Do not duplicate course lines if HTML and CSS are both present.
${EDUCATION_RULES}
${YEAR_RULES}
${COURSE_COMPLETION_NOTE}

${PROMPT_FOOTER}
`;
  }
  if (kind === "external") {
    return `
${PROMPT_HEADER}

--- INPUT DATA ---
${education}
${scores}


--- RULES ---
${EDUCATION_RULES}
${YEAR_RULES}
- Always end the output with this exact note block, never modify it:
- **Note**
  - Point 1: Please apply only if you're truly interested and ready to join the company, as this ensures respect for both your time and the company’s efforts. If you choose to decline an offer, you will not be eligible for further opportunities
  - Point 2: After successfully applying for the opportunity, your application will be forwarded to the company, and you will receive updates accordingly.

${PROMPT_FOOTER}
`;
  }
  throw new Error(`Unknown eligibility prompt ${kind}`);
}

export function appendSkillBlock(existing, block) {
  const current = text(existing).trim();
  if (!current || current.toUpperCase() === "NA") return block;
  const extra = text(block).trim();
  if (current.includes(extra)) return current;
  const cleaned = current
    .replace(/^- Candidates should be Proficient in[\s\S]*?(?=\n- Candidates should be Proficient in|$(?![\s\S]))/gm, "")
    .trim();
  return cleaned ? `${cleaned}\n\n${extra}` : extra;
}

export function buildIntensiveOfflineEligibility(props, skillsText = "") {
  const education = text(props.education_criteria);
  const departments = text(props.education_department_tags || props.education_stream);
  const passOuts = text(props.pass_out_year);
  const blank = (value) => !value || ["anyone can apply", "na", "none"].includes(value.trim().toLowerCase());

  const courses = education.split(";").map((course) => course.trim()).filter(Boolean);
  const educationText = blank(education) || !courses.length
    ? "Should have a Bachelor's / Master's degree."
    : `[${courses.join(", ")}]`;
  const lines = [`- Education Details: ${educationText}`];

  if (departments && !["na", "none"].includes(departments.trim().toLowerCase())) {
    lines.push(`- Education Departments: ${departments.split(";").map((d) => d.trim()).filter(Boolean).join(", ")}.`);
  }
  if (passOuts && !["na", "none"].includes(passOuts.trim().toLowerCase())) {
    const years = passOuts.split(";").map((year) => year.trim()).filter(isDigits).map(Number).sort((a, b) => a - b);
    if (years.length) lines.push(`- Year of graduation: ${years.length === 1 ? years[0] : `${years[0]} - ${years.at(-1)}`}.`);
  }
  lines.push(
    skillsText
      ? `- Candidates should be Proficient in ${skillsText}.`
      : "- Candidates should be Proficient in HTML&CSS/JavaScript/Python/SQL/NodeJS/React JS.",
  );
  lines.push("- **Note:**");
  lines.push(" - Point 1: After successfully applying for the opportunity, your application will be forwarded to the company, and you will receive updates accordingly.");
  return lines.join("\n");
}

const ACADEMY_KEYS = [
  "CCBP_ACADEMY_SMART", "CCBP_ACADEMY_EDGE", "CCBP_ACADEMY_GENIUS", "CCBP_ACADEMY_GENIUS_PLUS", "CCBP_ACADEMY_SMART_PLUS",
  "CCBP_ACADEMY_EDGE_PLUS", "CCBP_ACADEMY_GENIUS_CAREER_PLUS", "CCBP_ACADEMY_COLLEGE_PLUS", "CCBP_ACADEMY_SMART_CAREER_PLUS",
];

export function buildEligibilityCriteriaJson(enrollPlans, texts) {
  const upper = enrollPlans.map((plan) => plan.toUpperCase());
  const hasIntensive = upper.some((plan) => plan.includes("INTENSIVE"));
  const hasAcademy = upper.some((plan) => plan.includes("ACADEMY"));
  const hasOffline = upper.some((plan) => plan.includes("OFFLINE"));
  const when = (condition, value) => (condition ? value : "NA");
  const dict = {
    V1: when(hasIntensive, texts.v1),
    V1_V2: when(hasIntensive, texts.v1v2),
    V2: when(hasIntensive, texts.v2),
    V3: when(hasIntensive, texts.v3),
    ...Object.fromEntries(ACADEMY_KEYS.map((key) => [key, when(hasAcademy, texts.academy)])),
    NXTWAVE_EXTERNAL_JOB_PORTAL: when(upper.includes("NXTWAVE_EXTERNAL_JOB_PORTAL"), texts.external),
    NIAT: when(upper.includes("NIAT"), texts.niat),
    CCBP_TECH_INTENSIVE_OFFLINE: when(hasOffline, texts.offline),
  };
  return [JSON.stringify(dict)];
}

export async function buildEligibilityContent({ props, enrollPlans, skills, generate, templates = DEFAULT_ELIGIBILITY_TEMPLATES }) {
  const template = (key, fallback) => (templates[key]?.trim() ? templates[key] : fallback);
  const skillsText = skills.join(", ");
  const upper = enrollPlans.map((plan) => plan.toUpperCase());
  const isNiat = upper.includes("NIAT");
  const isAcademy = upper.some((plan) => plan.includes("ACADEMY"));
  const isIntensive = upper.some((plan) => plan.includes("INTENSIVE") || plan.includes("OFFLINE"));
  const isExternal = upper.some((plan) => plan.includes("EXTERNAL") || plan.includes("JOB PORTAL"));

  const skillNote = template("skill_note", DEFAULT_SKILL_BLOCK);
  const skillBlock = skillsText ? `- Candidates should be Proficient in ${skillsText}.\n${skillNote}` : skillNote;
  const academyBase = template("academy", DEFAULT_ELIGIBILITY_TEMPLATES.academy);
  const academyBlock = skillsText ? `- Candidates should be Proficient in ${skillsText}.\n${academyBase}` : academyBase;

  const texts = { v1: "NA", v1v2: "NA", v2: "NA", v3: "NA", academy: "NA", external: "NA", niat: "NA", offline: "NA" };

  const [v1Raw, otherRaw, externalRaw] = await Promise.all([
    isIntensive ? generate(eligibilityPrompt("intensive_1_native", props)) : "",
    isIntensive ? generate(eligibilityPrompt("intensive_other", props)) : "",
    isExternal ? generate(eligibilityPrompt("external", props)) : "",
  ]);

  if (isIntensive) {
    texts.v1 = appendSkillBlock(v1Raw, template("intensive_v1", skillBlock));
    texts.v1v2 = appendSkillBlock(otherRaw, template("intensive_v1_v2", skillBlock));
    texts.v2 = texts.v1v2;
    texts.v3 = texts.v1v2;
  }
  if (isAcademy) texts.academy = academyBlock;
  if (isExternal) texts.external = appendSkillBlock(externalRaw, template("external", skillBlock));
  if (isNiat) {
    texts.niat = template("niat", skillNote);
    if (skillsText && !texts.niat.includes("- Candidates should be Proficient in")) {
      texts.niat = `- Candidates should be Proficient in ${skillsText}.\n${texts.niat}`;
    }
  }
  if (upper.some((plan) => plan.includes("OFFLINE"))) texts.offline = buildIntensiveOfflineEligibility(props, skillsText);

  return buildEligibilityCriteriaJson(enrollPlans, texts);
}

const present = (value) => Boolean(value) && value !== "NA";

export function organisationDescriptionHtml({ website, linkedin }) {
  const parts = [];
  if (present(website)) {
    const url = escapeHtml(website);
    parts.push(`<p><strong>Company Website Link:</strong> <a href='${url}' target='_blank' style='color:blue;'>${url}</a></p>`);
  }
  if (present(linkedin)) {
    const url = escapeHtml(linkedin);
    parts.push(`<p><strong>Company Linkedin Page:</strong> <a href='${url}' target='_blank' style='color:blue;'>${url}</a></p>`);
  }
  return parts.join("");
}

export async function buildJobContent({ props, enrollPlans, skills, company, generate, templates }) {
  const [eligibilityContent, disclaimerMarkdown] = await Promise.all([
    buildEligibilityContent({ props, enrollPlans, skills, generate, templates }),
    buildDisclaimer(props, generate),
  ]);
  let disclaimer = disclaimerMarkdown;
  if (!present(company.website) || !present(company.linkedin)) {
    if (!disclaimer) disclaimer = STARTUP_LINE;
    else if (!disclaimer.includes(STARTUP_LINE)) disclaimer = `${disclaimer.trim()}\n${STARTUP_LINE}`;
  }
  return {
    eligibilityContent,
    disclaimerMarkdown: disclaimer,
    disclaimerHtml: markdownToHtml(disclaimer),
    organisationDescriptionHtml: organisationDescriptionHtml(company),
  };
}
