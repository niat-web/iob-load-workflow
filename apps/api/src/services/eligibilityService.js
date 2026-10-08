import { config } from "../config/env.js";
import { IntegrationError, PermanentError } from "../utils/errors.js";
import { splitList } from "../utils/helpers.js";
import { ELIGIBLE, eligibleFromPool, productGroupsForPlans } from "./eligiblePoolService.js";
import { integrations } from "./integrations.js";
import { buildEligibilityDetails } from "./learningPortal/nkbEligibility.js";
import { mockEligibleCount, mockStudents } from "./mock/mockData.js";

export function passOutYears(batch) {
  return [...new Set(splitList(batch).flatMap((value) => String(value).match(/\b(?:19|20)\d{2}\b/g) ?? []))];
}

async function fromEligiblePool(job) {
  const enrollPlans = job.learningPortalPayload?.job_details?.enroll_plans ?? job.enrollPlans ?? [];
  const products = productGroupsForPlans(enrollPlans);
  if (!products.length) {
    throw new PermanentError("This job has no course plans, so the Eligible Pool products to use are unknown. Choose the course plans, then retry.");
  }
  const years = passOutYears(job.batch);
  const students = await eligibleFromPool({ products, years });
  if (!students.length) {
    const yearText = years.length ? ` with pass-out year ${years.join(", ")} (or no year set)` : "";
    throw new PermanentError(
      `No student in the Eligible Pool is "${ELIGIBLE}" for ${products.join(", ")}${yearText}. Add them on the Eligible Pool page, then retry.`,
    );
  }
  return students;
}

export async function findEligibleStudents(job, rawProperties) {
  const source = config.eligibility.source;
  let students;

  if (source === "pool") {
    students = await fromEligiblePool(job);
  } else if (source === "mock") {
    students = mockStudents(job.hubspotDealId, mockEligibleCount(job.hubspotDealId, job.expectedPoolCount));
  } else if (source === "learning_portal") {
    const details = buildEligibilityDetails(rawProperties, { placementStatuses: config.eligibility.placementStatuses });
    const ids = await integrations.learningPortal.getEligibleStudentIds(config.learningPortal.eligibilityEnv, details);
    const known = await integrations.bigquery.getStudentsByIds(ids);
    const byId = new Map(known.map((student) => [String(student.studentId), student]));
    students = ids.map((id) => byId.get(id) ?? { studentId: id, studentName: "", email: null, mobile: null });
  } else {
    throw new IntegrationError(`Unknown ELIGIBILITY_SOURCE ${source}`, { retryable: false });
  }

  const unique = new Map();
  for (const student of students) {
    if (student?.studentId && !unique.has(String(student.studentId))) {
      unique.set(String(student.studentId), { ...student, studentId: String(student.studentId) });
    }
  }
  if (unique.size > config.eligibility.maxStudents) {
    throw new PermanentError(
      `Eligibility returned ${unique.size} students, above ELIGIBILITY_MAX_STUDENTS (${config.eligibility.maxStudents}). Check the deal's eligibility criteria.`,
    );
  }
  return [...unique.values()];
}
