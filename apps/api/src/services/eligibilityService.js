import { config } from "../config/env.js";
import { EligiblePoolStudent, JobEligibleStudent } from "../models/index.js";
import { IntegrationError, PermanentError } from "../utils/errors.js";
import { splitList } from "../utils/helpers.js";
import { ELIGIBLE, eligibleFromPool, productGroupFor, productGroupsForPlans } from "./eligiblePoolService.js";
import { integrations } from "./integrations.js";
import { buildEligibilityDetails } from "./learningPortal/nkbEligibility.js";
import { mockEligibleCount, mockStudents } from "./mock/mockData.js";

export const REMINDER_PRODUCT = "NIAT";

export function passOutYears(batch) {
  return [...new Set(splitList(batch).flatMap((value) => String(value).match(/\b(?:19|20)\d{2}\b/g) ?? []))];
}

const jobEnrollPlans = (job) => job.learningPortalPayload?.job_details?.enroll_plans ?? job.enrollPlans ?? [];

function soleProduct(job) {
  const products = productGroupsForPlans(jobEnrollPlans(job));
  return products.length === 1 ? products[0] : null;
}

const studentProduct = (student) => student.productGroup ?? productGroupFor(student.program) ?? null;

async function fromEligiblePool(job) {
  const enrollPlans = jobEnrollPlans(job);
  const products = productGroupsForPlans(enrollPlans);
  if (!products.length) {
    throw new PermanentError(
      enrollPlans.length
        ? "This deal's course plans are not NIAT or Academy, so no student in the Eligible Pool matches. Check the course plans, then retry."
        : "This job has no course plans, so the Eligible Pool products to use are unknown. Choose the course plans, then retry.",
    );
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

  const fallback = soleProduct(job);
  const unique = new Map();
  for (const student of students) {
    if (!student?.studentId) continue;
    const studentId = String(student.studentId);
    const product = studentProduct(student) ?? fallback;
    const current = unique.get(studentId);
    if (!current) unique.set(studentId, { ...student, studentId, product });
    else if (product === REMINDER_PRODUCT) current.product = product;
  }
  if (unique.size > config.eligibility.maxStudents) {
    throw new PermanentError(
      `Eligibility returned ${unique.size} students, above ELIGIBILITY_MAX_STUDENTS (${config.eligibility.maxStudents}). Check the deal's eligibility criteria.`,
    );
  }
  return [...unique.values()];
}

export async function fillStudentProducts(job) {
  const missing = await JobEligibleStudent.find({ jobId: job._id, product: null }, { studentId: 1 }).lean();
  if (!missing.length) return;
  const pool = await EligiblePoolStudent.find(
    { studentId: { $in: missing.map((row) => row.studentId) } },
    { studentId: 1, productGroup: 1 },
  ).lean();
  const fromPool = new Map(pool.map((row) => [row.studentId, row.productGroup]));
  const fallback = soleProduct(job);
  const updates = missing
    .map((row) => ({ studentId: row.studentId, product: fromPool.get(row.studentId) ?? fallback }))
    .filter((row) => row.product);
  if (!updates.length) return;
  await JobEligibleStudent.bulkWrite(
    updates.map(({ studentId, product }) => ({
      updateOne: { filter: { jobId: job._id, studentId }, update: { $set: { product } } },
    })),
    { ordered: false },
  );
}

export const reminderFilter = (job) => ({
  jobId: job._id,
  accessGrantedAt: { $ne: null },
  applied: { $ne: true },
  product: REMINDER_PRODUCT,
});

export async function reminderAudience(job) {
  await fillStudentProducts(job);
  const withAccess = { jobId: job._id, accessGrantedAt: { $ne: null } };
  const [students, niatWithAccess, othersWithAccess] = await Promise.all([
    JobEligibleStudent.find(reminderFilter(job)).lean(),
    JobEligibleStudent.countDocuments({ ...withAccess, product: REMINDER_PRODUCT }),
    JobEligibleStudent.countDocuments({ ...withAccess, product: { $ne: REMINDER_PRODUCT } }),
  ]);
  return { students, niatWithAccess, othersWithAccess };
}
