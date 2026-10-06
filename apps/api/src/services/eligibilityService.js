import { config } from "../config/env.js";
import { IntegrationError, PermanentError } from "../utils/errors.js";
import { splitList } from "../utils/helpers.js";
import { integrations } from "./integrations.js";
import { buildEligibilityDetails } from "./learningPortal/nkbEligibility.js";
import { mockEligibleCount, mockStudents } from "./mock/mockData.js";

export async function findEligibleStudents(job, rawProperties) {
  const source = config.eligibility.source;
  let students;

  if (source === "mock") {
    students = mockStudents(job.hubspotDealId, mockEligibleCount(job.hubspotDealId, job.expectedPoolCount));
  } else if (source === "learning_portal") {
    const details = buildEligibilityDetails(rawProperties, { placementStatuses: config.eligibility.placementStatuses });
    const ids = await integrations.learningPortal.getEligibleStudentIds(config.learningPortal.eligibilityEnv, details);
    const known = await integrations.bigquery.getStudentsByIds(ids);
    const byId = new Map(known.map((student) => [String(student.studentId), student]));
    students = ids.map((id) => byId.get(id) ?? { studentId: id, studentName: "", email: null, mobile: null });
  } else if (source === "bigquery") {
    students = await integrations.bigquery.findEligibleStudents({
      batches: splitList(job.batch),
      programs: splitList(job.program),
      campuses: splitList(job.campus),
    });
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
