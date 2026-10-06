import { seededRandom } from "../../utils/crypto.js";

const COMPANIES = ["TCS", "Zoho", "Infosys", "Freshworks", "Swiggy", "Razorpay", "Wipro", "Postman"];
const ROLE_SKILLS = {
  "Software Engineer": ["Java", "Springboot", "SQL"],
  "Full Stack Developer": ["React JS", "Node JS", "SQL"],
  "Frontend Developer": ["JavaScript", "React JS", "Typescript"],
  "Backend Developer": ["Python", "SQL", "Django"],
  "QA Engineer": ["Manual Testing", "Automation Testing", "Selenium"],
};
const ROLES = Object.keys(ROLE_SKILLS);
const LOCATIONS = ["Hyderabad", "Benguluru", "Chennai", "Pune", "Work From Home"];
const CAMPUSES = ["Hyderabad", "Bengaluru", "Chennai", "Pune", "Delhi NCR"];
const FIRST = ["Aarav", "Diya", "Rohan", "Ananya", "Vikram", "Sneha", "Karthik", "Meera", "Arjun", "Priya", "Rahul", "Kavya"];
const LAST = ["Reddy", "Sharma", "Iyer", "Patel", "Nair", "Rao", "Gupta", "Menon", "Das", "Kumar"];

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, min, max) => Math.round(min + rand() * (max - min));

export function mockDealExists(dealId) {
  return !(dealId === "404" || dealId.endsWith("000"));
}

export function mockDeal(dealId, crmOwnerEmail) {
  const rand = seededRandom(`deal:${dealId}`);
  const company = pick(rand, COMPANIES);
  const role = pick(rand, ROLES);
  const skills = ROLE_SKILLS[role];
  const openings = between(rand, 2, 12);
  const minCtc = between(rand, 4, 8);
  return {
    id: dealId,
    company: { id: `c-${dealId}`, name: company, domain: `${company.toLowerCase()}.example.com` },
    owner: { id: "900001", email: crmOwnerEmail, firstName: "Demo", lastName: "CRM" },
    properties: {
      dealname: `${company} - ${role}`,
      type_of_role: role,
      technologies_required: skills.join(";"),
      education_criteria: "B.Tech / BE (CSE, IT, ECE)",
      pass_out_year: "2025;2026",
      product: "Intensive",
      location: pick(rand, LOCATIONS),
      minimum_ctc_in_lpa: String(minCtc),
      maximum_ctc_in_lpa: String(minCtc + between(rand, 1, 4)),
      crm_job_type: "Full time",
      no_of_openings: String(openings),
      expected_application_pool: String(openings * between(rand, 4, 8)),
      hubspot_owner_id: "900001",
      nurturing_team_remarks: "Carry a copy of your resume. Laptops are required for the technical round.",
      interview_process: "Online assessment; Technical interview; HR discussion",
      pipeline: "1000100",
    },
  };
}

export function mockStudents(seed, count) {
  const rand = seededRandom(`students:${seed}`);
  return Array.from({ length: count }, (_, index) => {
    const first = pick(rand, FIRST);
    const last = pick(rand, LAST);
    const studentId = `STU${String(100000 + index * 7 + between(rand, 0, 6)).padStart(6, "0")}`;
    return {
      studentId,
      studentName: `${first} ${last}`,
      email: `${first}.${last}.${index}@students.example.com`.toLowerCase(),
      mobile: index % 15 === 14 ? null : `+9190000${String(10000 + index).slice(-5)}`,
      campus: pick(rand, CAMPUSES),
      batch: pick(rand, ["2025", "2026"]),
      program: "CCBP_INTENSIVE",
    };
  });
}

export function mockEligibleCount(seed, expectedPoolCount) {
  const rand = seededRandom(`eligible:${seed}`);
  return Math.max(12, Math.round((expectedPoolCount || 20) * (1.4 + rand() * 0.8)));
}

export function mockAppliedCount(seed, eligibleCount, expectedPoolCount, fraction) {
  const rand = seededRandom(`applied:${seed}`);
  const finalRatio = 0.55 + rand() * 0.75;
  const finalApplied = Math.min(eligibleCount, Math.round((expectedPoolCount || 20) * finalRatio));
  const curve = 1 - Math.pow(1 - Math.min(1, Math.max(0, fraction)), 2);
  return Math.round(finalApplied * curve);
}

export function mockResumeText(student, jobSkills) {
  const rand = seededRandom(`resume:${student.studentId}`);
  const known = jobSkills.filter(() => rand() > 0.35);
  const extra = pick(rand, [["Git", "Linux"], ["Docker"], ["AWS"], ["MongoDB", "Express.js"], []]);
  const projects = between(rand, 1, 4);
  return [
    `${student.studentName}`,
    `Email: ${student.email}`,
    `Education: B.Tech, ${student.batch}`,
    `Skills: ${[...known, ...extra].join(", ") || "Communication"}`,
    `Projects: ${projects} academic and personal projects`,
    ...Array.from({ length: projects }, (_, i) => `- Project ${i + 1} built with ${known[i % Math.max(1, known.length)] ?? "HTML"}`),
  ].join("\n");
}

export function mockScores(studentId, jobSkills) {
  const rand = seededRandom(`scores:${studentId}`);
  const grit = rand() < 0.1 ? [] : jobSkills.map((skill) => ({ skill, score: between(rand, 45, 98) }));
  return {
    grit,
    assessment: rand() < 0.15 ? null : between(rand, 40, 97),
    interview: rand() < 0.3 ? null : between(rand, 45, 95),
  };
}
