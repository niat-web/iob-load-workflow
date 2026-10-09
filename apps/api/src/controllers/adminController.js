import { z } from "zod";
import { config } from "../config/env.js";
import { FLOW_MODE, POOL_PRODUCTS, ROLES } from "../config/statuses.js";
import { User } from "../models/index.js";
import { releaseWaitingDeals } from "../services/approvalService.js";
import { auditLogFilters, listAuditLogs } from "../services/auditLogService.js";
import { AUDIT, audit } from "../services/auditService.js";
import { listDatasets, listTables, readTableRows } from "../services/bigQueryBrowser.js";
import {
  EDITABLE_PRODUCTS,
  ELIGIBILITY_STATUSES,
  POOL_SORT_FIELDS,
  PRODUCT_GROUPS,
  createPoolStudent,
  deletePoolStudent,
  listPool,
  poolScope,
  poolSummary,
  startPoolSync,
  updatePoolStudent,
} from "../services/eligiblePoolService.js";
import { findHubspotOwner, hubspotOwnerForEmail, hubspotOwnerForUser, ownerFields } from "../services/hubspotOwners.js";
import { APPROVAL_STEPS, settingsRecord, updateSettings } from "../services/settingsService.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";
import { listOf } from "../utils/queryList.js";

const hubspotOwnerId = z
  .string()
  .trim()
  .refine((id) => Boolean(findHubspotOwner(id)), "Choose a HubSpot owner from the list");

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

const products = z.array(z.enum(POOL_PRODUCTS, "Choose NIAT or Academy")).max(POOL_PRODUCTS.length);
const POOL_MANAGER = "POOL_MANAGER";
const needsProduct = "Choose at least one product (NIAT or Academy) for a Pool Manager";

export const createUserSchema = z
  .object({
    email,
    name: z.string().trim().max(120).optional(),
    role: z.enum(ROLES),
    hubspotOwnerId: hubspotOwnerId.optional(),
    products: products.optional(),
  })
  .refine((body) => body.role !== POOL_MANAGER || (body.products?.length ?? 0) > 0, { message: needsProduct, path: ["products"] });

export const updateUserSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    hubspotOwnerId: hubspotOwnerId.nullable().optional(),
    products: products.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

const productsFor = (role, list) => (role === POOL_MANAGER ? [...new Set(list ?? [])] : []);

export const userParams = z.object({ email });

function toAdminUser(user) {
  return {
    email: user.email,
    name: user.name ?? "",
    role: user.role,
    products: user.products ?? [],
    isActive: Boolean(user.isActive),
    hubspotOwner: hubspotOwnerForUser(user),
    lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
    createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
  };
}

function checkDomain(address) {
  const domains = config.auth.allowedEmailDomains;
  const domain = address.split("@")[1];
  if (domains.length && !domains.includes(domain)) {
    throw badRequest(`Only ${domains.join(", ")} email addresses can sign in`);
  }
}

export async function listUsers(req, res) {
  const users = await User.find().sort({ role: 1, email: 1 }).lean();
  res.json({ users: users.map(toAdminUser) });
}

export async function createUser(req, res) {
  const { email: address, name, role, hubspotOwnerId: ownerId } = req.valid.body;
  checkDomain(address);
  if (await User.exists({ email: address })) throw conflict(`${address} already has an account. Edit it in the list instead.`, "USER_EXISTS");
  const owner = ownerId ? findHubspotOwner(ownerId) : hubspotOwnerForEmail(address);
  const userProducts = productsFor(role, req.valid.body.products);
  const user = await User.create({
    email: address,
    name: name || owner?.name || "",
    role,
    products: userProducts,
    isActive: true,
    ...ownerFields(owner),
  });
  await audit({
    actor: req.user,
    action: AUDIT.USER_ADDED,
    entityType: "User",
    entityId: address,
    metadata: { role, products: userProducts, hubspotOwnerId: owner?.id ?? null },
    ip: req.ip,
  });
  res.status(201).json({ user: toAdminUser(user.toObject()) });
}

export async function updateUser(req, res) {
  const { email: address } = req.valid.params;
  const changes = req.valid.body;
  const existing = await User.findOne({ email: address }).lean();
  if (!existing) throw notFound("User not found");
  if (address === req.user.email) {
    if (changes.role && changes.role !== "ADMIN") throw conflict("You cannot remove your own admin role", "SELF_LOCKOUT");
    if (changes.isActive === false) throw conflict("You cannot deactivate your own account", "SELF_LOCKOUT");
  }

  const set = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.role) set.role = changes.role;
  if (changes.isActive !== undefined) set.isActive = changes.isActive;
  const finalRole = changes.role ?? existing.role;
  const finalProducts = productsFor(finalRole, changes.products ?? existing.products);
  if (finalRole === POOL_MANAGER && !finalProducts.length) throw badRequest(needsProduct);
  if (changes.role || changes.products) set.products = finalProducts;
  if (changes.hubspotOwnerId !== undefined) {
    Object.assign(set, ownerFields(changes.hubspotOwnerId ? findHubspotOwner(changes.hubspotOwnerId) : null));
  }
  const user = await User.findOneAndUpdate({ email: address }, { $set: set }, { returnDocument: "after" }).lean();
  await audit({
    actor: req.user,
    action: AUDIT.USER_UPDATED,
    entityType: "User",
    entityId: address,
    metadata: changes,
    ip: req.ip,
  });
  res.json({ user: toAdminUser(user) });
}

export const poolQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  product: listOf(z.enum(PRODUCT_GROUPS)),
  status: listOf(z.enum(ELIGIBILITY_STATUSES)),
  campus: listOf(z.string().max(200)),
  sort: z
    .string()
    .regex(new RegExp(`^(?:(${POOL_SORT_FIELDS.join("|")}):(asc|desc))?$`), "Invalid sort")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export async function eligiblePool(req, res) {
  res.json(await listPool(req.valid.query, poolScope(req.user)));
}

export async function eligiblePoolSummary(req, res) {
  res.json(await poolSummary(poolScope(req.user)));
}

export async function syncEligiblePool(req, res) {
  res.status(202).json({ sync: await startPoolSync(req.user) });
}

const bigQueryName = z.string().regex(/^[A-Za-z0-9_-]{1,1024}$/, "Invalid BigQuery name");

export const datasetParams = z.object({ dataset: bigQueryName });
export const tableParams = z.object({ dataset: bigQueryName, table: bigQueryName });
export const tableRowsQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export async function bigQueryDatasets(req, res) {
  res.json(await listDatasets());
}

export async function bigQueryTables(req, res) {
  res.json(await listTables(req.valid.params.dataset));
}

export async function bigQueryTableRows(req, res) {
  const { dataset, table } = req.valid.params;
  await audit({
    actor: req.user,
    action: AUDIT.BIGQUERY_VIEWED,
    entityType: "BigQueryTable",
    entityId: `${dataset}.${table}`,
    metadata: { page: req.valid.query.page, limit: req.valid.query.limit },
    ip: req.ip,
  });
  res.json(await readTableRows(dataset, table, req.valid.query));
}

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();
const fromList = (values, message) =>
  z
    .union([z.enum(values, message), z.literal("").transform(() => null)])
    .nullable()
    .optional();

const poolStudentFields = {
  studentName: z.string().trim().min(1, "Enter the student name").max(200),
  niatId: optionalText(50),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((value) => value || null)
    .pipe(z.email("Enter a valid email address").nullable())
    .nullable()
    .optional(),
  mobile: z
    .string()
    .trim()
    .max(20)
    .regex(/^\+?[0-9 -]*$/, "Mobile can only have digits, spaces, - and a leading +")
    .transform((value) => value || null)
    .nullable()
    .optional(),
  productGroup: fromList(EDITABLE_PRODUCTS, "Choose a product from the list"),
  campus: optionalText(200),
  batch: optionalText(20),
  eligibilityStatus: fromList(ELIGIBILITY_STATUSES, "Choose an eligibility status from the list"),
  remarks: optionalText(500),
};

const studentIdField = z.string().trim().min(1, "Enter the student user ID").max(100);

export const poolStudentCreateSchema = z.object({ studentId: studentIdField, ...poolStudentFields });
export const poolStudentUpdateSchema = z
  .object({ ...poolStudentFields, studentName: poolStudentFields.studentName.optional() })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export const poolStudentParams = z.object({ studentId: studentIdField });

export async function addPoolStudent(req, res) {
  res.status(201).json({ student: await createPoolStudent(req.valid.body, req.user, poolScope(req.user)) });
}

export async function editPoolStudent(req, res) {
  res.json({ student: await updatePoolStudent(req.valid.params.studentId, req.valid.body, req.user, poolScope(req.user)) });
}

export async function removePoolStudent(req, res) {
  await deletePoolStudent(req.valid.params.studentId, req.user, poolScope(req.user));
  res.status(204).end();
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const auditQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  actor: listOf(z.string().trim().max(200)),
  action: listOf(z.string().trim().max(80)),
  from: day.optional(),
  to: day.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function auditLogs(req, res) {
  res.json(await listAuditLogs(req.valid.query));
}

export async function auditLogFilterOptions(req, res) {
  res.json(await auditLogFilters());
}

const flag = z.boolean();
const switches = (keys) => z.object(Object.fromEntries(keys.map((key) => [key, flag]))).partial().strict();

export const settingsPatchSchema = z
  .object({
    flow: z
      .object({
        mode: z.enum(Object.values(FLOW_MODE)),
        crmOptions: switches(Object.values(FLOW_MODE)),
        approvals: switches(APPROVAL_STEPS),
      })
      .partial()
      .strict(),
    studentEmails: switches(["jobEmail", "jobUpdates", "boostReminder"]),
    checkpoints: switches(["firstEmails", "secondEmails", "secondCalls"]),
    crmEmails: switches(["poolReached", "candidatePool"]),
    aiCalls: switches(["enabled"]),
    interviews: switches(["googleMeet"]),
    automation: switches(["aiJobContent", "aiResumeAnalysis", "hubspotWriteBack"]),
    timing: z
      .object({
        applicationWindowHours: z.number().min(1, "The window must be at least 1 hour").max(240, "The window can be at most 240 hours"),
        reminderOneHours: z.number().min(0.5, "A checkpoint must be at least 0.5 hours").max(240),
        reminderTwoHours: z.number().min(0.5, "A checkpoint must be at least 0.5 hours").max(240),
        boostEmailCooldownMinutes: z.number().int().min(0).max(1440, "The gap can be at most 1,440 minutes"),
      })
      .partial()
      .strict(),
  })
  .partial()
  .strict();

export async function appSettings(req, res) {
  res.json(await settingsRecord());
}

export async function saveAppSettings(req, res) {
  const { settings } = await updateSettings(req.valid.body, req.user);
  const released = await releaseWaitingDeals(settings, req.user);
  res.json({ ...(await settingsRecord()), released });
}
