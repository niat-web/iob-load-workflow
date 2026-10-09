import { config } from "../config/env.js";
import { POOL_PRODUCTS } from "../config/statuses.js";
import { EligiblePoolStudent, EligiblePoolSync } from "../models/index.js";
import { now } from "../utils/clock.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors.js";
import { escapeRegex } from "../utils/helpers.js";
import { logger } from "../utils/logger.js";
import { AUDIT, audit } from "./auditService.js";
import { createBigQueryRepository } from "./bigQueryRepository.js";

const SYNC_ID = "eligible-pool";
const STALE_SYNC_MS = 2 * 60 * 60 * 1000;
export const PRODUCT_GROUPS = POOL_PRODUCTS;
export const EDITABLE_PRODUCTS = PRODUCT_GROUPS;
export const POOL_SORT_FIELDS = [
  "studentId",
  "niatId",
  "studentName",
  "mobile",
  "email",
  "productGroup",
  "campus",
  "batch",
  "eligibilityStatus",
  "remarks",
];
export const ELIGIBILITY_STATUSES = ["Eligible", "Placed", "Mint", "Do not Provided", "Not Interested"];
export const ELIGIBLE = "Eligible";

export function productGroupFor(tag) {
  const value = String(tag ?? "").trim().toUpperCase();
  if (value === "NIAT" || value.startsWith("NIAT_")) return "NIAT";
  if (value === "ACADEMY" || value.startsWith("CCBP_ACADEMY")) return "Academy";
  return null;
}

export function productGroupsForPlans(enrollPlans) {
  return [...new Set((enrollPlans ?? []).map(productGroupFor))].filter(Boolean);
}

export function poolSyncConfigured() {
  return config.modes.bigquery !== "live" || Boolean(config.bigquery.tables.pool);
}

export async function eligibleFromPool({ products, years = [] }) {
  const filter = { productGroup: { $in: products }, eligibilityStatus: ELIGIBLE };
  if (years.length) filter.batch = { $in: [...years, null, ""] };
  return EligiblePoolStudent.find(filter, { _id: 0, studentId: 1, studentName: 1, email: 1, mobile: 1, campus: 1, batch: 1 })
    .sort({ studentId: 1 })
    .lean();
}

const plain = (value) => (value && typeof value === "object" && "value" in value ? value.value : value);

function text(value) {
  const raw = plain(value);
  if (raw === null || raw === undefined) return null;
  const result = String(raw).trim();
  return result || null;
}

export function toPoolStudent(row, syncedAt) {
  return {
    studentId: text(row.studentId),
    studentName: text(row.studentName) ?? "",
    email: text(row.email)?.toLowerCase() ?? null,
    mobile: text(row.mobile),
    productGroup: productGroupFor(text(row.product)),
    syncedAt,
  };
}

const iso = (date) => (date ? new Date(date).toISOString() : null);

function toSyncInfo(sync) {
  return {
    status: sync?.status ?? "IDLE",
    startedAt: iso(sync?.startedAt),
    finishedAt: iso(sync?.finishedAt),
    startedBy: sync?.startedBy ?? null,
    rowsRead: sync?.rowsRead ?? 0,
    removed: sync?.removed ?? 0,
    error: sync?.error ?? null,
  };
}

async function savePage(rows, syncedAt) {
  const docs = rows.map((row) => toPoolStudent(row, syncedAt)).filter((doc) => doc.studentId && doc.productGroup);
  if (!docs.length) return 0;
  try {
    await EligiblePoolStudent.bulkWrite(
      docs.map((doc) => ({
        updateOne: {
          filter: { studentId: doc.studentId, manual: { $ne: true } },
          update: { $set: doc, $setOnInsert: { eligibilityStatus: ELIGIBLE } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  } catch (error) {
    const writeErrors = error?.writeErrors ?? error?.result?.result?.writeErrors ?? [];
    const onlyManualClashes = writeErrors.length > 0 && writeErrors.every((item) => (item.code ?? item.err?.code) === 11000);
    if (!onlyManualClashes) throw error;
  }
  return docs.length;
}

async function runSync(startedAt, actor) {
  let rowsRead = 0;
  try {
    await createBigQueryRepository().readPool(async (rows) => {
      rowsRead += await savePage(rows, startedAt);
      await EligiblePoolSync.updateOne({ _id: SYNC_ID }, { $set: { rowsRead } });
    });
    const { deletedCount } = await EligiblePoolStudent.deleteMany({ syncedAt: { $lt: startedAt }, manual: { $ne: true } });
    await EligiblePoolSync.updateOne(
      { _id: SYNC_ID },
      { $set: { status: "DONE", finishedAt: now(), rowsRead, removed: deletedCount ?? 0, error: null } },
    );
    await audit({
      actor,
      action: AUDIT.POOL_SYNCED,
      entityType: "EligiblePool",
      entityId: SYNC_ID,
      metadata: { rowsRead, removed: deletedCount ?? 0 },
    });
  } catch (error) {
    logger.error({ err: error }, "Eligible pool sync failed");
    await EligiblePoolSync.updateOne(
      { _id: SYNC_ID },
      { $set: { status: "FAILED", finishedAt: now(), rowsRead, error: String(error?.message ?? error).slice(0, 500) } },
    );
  }
}

export async function startPoolSync(actor) {
  if (!poolSyncConfigured()) {
    throw conflict("The BigQuery table for the eligible pool is not set yet. Add students on the Eligible Pool page for now.", "POOL_TABLE_NOT_SET");
  }
  const startedAt = now();
  await EligiblePoolSync.updateOne({ _id: SYNC_ID }, { $setOnInsert: { status: "IDLE" } }, { upsert: true });
  const claimed = await EligiblePoolSync.findOneAndUpdate(
    {
      _id: SYNC_ID,
      $or: [{ status: { $ne: "RUNNING" } }, { startedAt: { $lt: new Date(startedAt.getTime() - STALE_SYNC_MS) } }],
    },
    {
      $set: {
        status: "RUNNING",
        startedAt,
        finishedAt: null,
        startedBy: actor?.email ?? null,
        rowsRead: 0,
        removed: 0,
        error: null,
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) throw conflict("An eligible pool sync is already running", "SYNC_RUNNING");
  void runSync(startedAt, actor);
  return toSyncInfo(claimed);
}

function sortStage(sort) {
  const [field, direction] = String(sort ?? "").split(":");
  if (!POOL_SORT_FIELDS.includes(field)) return { productRank: 1, studentName: 1, studentId: 1 };
  const dir = direction === "desc" ? -1 : 1;
  const key = field === "productGroup" ? "productRank" : field;
  return field === "studentId" ? { studentId: dir } : { [key]: dir, studentId: 1 };
}

export function poolScope(user) {
  if (user?.role === "ADMIN") return null;
  return (user?.products ?? []).filter((product) => PRODUCT_GROUPS.includes(product));
}

function scopedProducts(requested, scope) {
  const wanted = [].concat(requested ?? []).filter(Boolean);
  if (!scope) return wanted;
  return wanted.length ? wanted.filter((product) => scope.includes(product)) : scope;
}

export async function listPool({ search, product, status, campus, sort, page, limit }, scope = null) {
  const filter = {};
  const many = (value) => [].concat(value ?? []).filter(Boolean);
  const products = scopedProducts(product, scope);
  if (scope && !products.length) {
    return { items: [], pagination: { page, limit, total: 0, totalPages: 1 } };
  }
  if (products.length) filter.productGroup = { $in: products };
  if (many(status).length) filter.eligibilityStatus = { $in: many(status) };
  if (many(campus).length) filter.campus = { $in: many(campus) };
  const term = search?.trim();
  if (term) {
    const pattern = new RegExp(escapeRegex(term), "i");
    filter.$or = [{ studentName: pattern }, { email: pattern }, { mobile: pattern }, { studentId: pattern }, { niatId: pattern }];
  }
  const [items, total] = await Promise.all([
    EligiblePoolStudent.aggregate([
      { $match: filter },
      { $addFields: { productRank: { $indexOfArray: [PRODUCT_GROUPS, "$productGroup"] } } },
      { $sort: sortStage(sort) },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      { $project: { _id: 0, __v: 0, createdAt: 0, productRank: 0 } },
    ]),
    EligiblePoolStudent.countDocuments(filter),
  ]);
  return {
    items: items.map((student) => ({ ...student, syncedAt: iso(student.syncedAt), updatedAt: iso(student.updatedAt) })),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function poolSummary(scope = null) {
  const visible = scope ? { productGroup: { $in: scope } } : {};
  const [total, byProduct, sync, byStatus, byCampus] = await Promise.all([
    scope ? EligiblePoolStudent.countDocuments(visible) : EligiblePoolStudent.estimatedDocumentCount(),
    EligiblePoolStudent.aggregate([{ $match: visible }, { $group: { _id: "$productGroup", count: { $sum: 1 } } }]),
    EligiblePoolSync.findById(SYNC_ID).lean(),
    EligiblePoolStudent.aggregate([
      { $match: { ...visible, eligibilityStatus: { $nin: [null, ""] } } },
      { $group: { _id: "$eligibilityStatus", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    EligiblePoolStudent.aggregate([
      { $match: { ...visible, campus: { $nin: [null, ""] } } },
      { $group: { _id: "$campus", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  const productCounts = new Map(byProduct.map((row) => [row._id, row.count]));
  return {
    total,
    products: PRODUCT_GROUPS.filter((name) => productCounts.has(name)).map((name) => ({
      product: name,
      count: productCounts.get(name),
    })),
    statuses: byStatus.map((row) => ({ status: row._id, count: row.count })),
    campuses: byCampus.map((row) => ({ campus: row._id, count: row.count })),
    sync: scope ? null : toSyncInfo(sync),
    syncConfigured: scope ? false : poolSyncConfigured(),
    allowedProducts: scope ?? PRODUCT_GROUPS,
  };
}

function toPublic(student) {
  const result = { ...student, syncedAt: iso(student.syncedAt), updatedAt: iso(student.updatedAt) };
  delete result._id;
  delete result.__v;
  delete result.createdAt;
  return result;
}

function editableFields(input) {
  const fields = { ...input };
  delete fields.studentId;
  if ("email" in fields) fields.email = fields.email ? fields.email.toLowerCase() : null;
  if ("productGroup" in fields) fields.productGroup = fields.productGroup || null;
  return fields;
}

function productForScope(product, scope) {
  if (!scope) return product;
  const chosen = product || (scope.length === 1 ? scope[0] : null);
  if (!chosen) throw badRequest("Choose the product for this student");
  if (!scope.includes(chosen)) throw forbidden(`You can only manage ${scope.join(" and ")} students`);
  return chosen;
}

export async function createPoolStudent(input, actor, scope = null) {
  const studentId = input.studentId.trim();
  const fields = editableFields(input);
  if (scope) fields.productGroup = productForScope(fields.productGroup, scope);
  if (await EligiblePoolStudent.exists({ studentId })) {
    throw conflict(`Student ${studentId} is already in the eligible pool`, "STUDENT_EXISTS");
  }
  const created = await EligiblePoolStudent.create({
    ...fields,
    studentId,
    syncedAt: now(),
    manual: true,
    updatedBy: actor?.email ?? null,
  });
  await audit({
    actor,
    action: AUDIT.POOL_STUDENT_ADDED,
    entityType: "EligiblePoolStudent",
    entityId: studentId,
    metadata: { studentName: created.studentName ?? "", product: created.productGroup ?? null },
  });
  return toPublic(created.toObject());
}

const scopedFilter = (studentId, scope) => (scope ? { studentId, productGroup: { $in: scope } } : { studentId });

export async function updatePoolStudent(studentId, changes, actor, scope = null) {
  const fields = editableFields(changes);
  if (scope && "productGroup" in fields) fields.productGroup = productForScope(fields.productGroup, scope);
  const before = await EligiblePoolStudent.findOne(scopedFilter(studentId, scope)).lean();
  if (!before) throw notFound(`Student ${studentId} is not in the eligible pool`);
  const updated = await EligiblePoolStudent.findOneAndUpdate(
    scopedFilter(studentId, scope),
    { $set: { ...fields, manual: true, updatedBy: actor?.email ?? null } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!updated) throw notFound(`Student ${studentId} is not in the eligible pool`);
  const changed = Object.keys(fields).filter((key) => String(before[key] ?? "") !== String(updated[key] ?? ""));
  await audit({
    actor,
    action: AUDIT.POOL_STUDENT_UPDATED,
    entityType: "EligiblePoolStudent",
    entityId: studentId,
    metadata: {
      studentName: updated.studentName ?? "",
      product: updated.productGroup ?? null,
      fields: changed.join(","),
      changes: Object.fromEntries(changed.map((key) => [key, { from: before[key] ?? null, to: updated[key] ?? null }])),
    },
  });
  return toPublic(updated);
}

export async function deletePoolStudent(studentId, actor, scope = null) {
  const existing = await EligiblePoolStudent.findOneAndDelete(scopedFilter(studentId, scope)).lean();
  if (!existing) throw notFound(`Student ${studentId} is not in the eligible pool`);
  await audit({
    actor,
    action: AUDIT.POOL_STUDENT_DELETED,
    entityType: "EligiblePoolStudent",
    entityId: studentId,
    metadata: { studentName: existing.studentName ?? "", product: existing.productGroup ?? null },
  });
}
