import { z } from "zod";
import { config } from "../config/env.js";
import { ROLES } from "../config/statuses.js";
import { User } from "../models/index.js";
import { AUDIT, audit } from "../services/auditService.js";
import { findHubspotOwner, hubspotOwnerForEmail, hubspotOwnerForUser, ownerFields } from "../services/hubspotOwners.js";
import { badRequest, conflict, notFound } from "../utils/errors.js";

const hubspotOwnerId = z
  .string()
  .trim()
  .refine((id) => Boolean(findHubspotOwner(id)), "Choose a HubSpot owner from the list");

const email = z.string().trim().toLowerCase().email("Enter a valid email address").max(200);

export const createUserSchema = z.object({
  email,
  name: z.string().trim().max(120).optional(),
  role: z.enum(ROLES),
  hubspotOwnerId: hubspotOwnerId.optional(),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().max(120).optional(),
    role: z.enum(ROLES).optional(),
    isActive: z.boolean().optional(),
    hubspotOwnerId: hubspotOwnerId.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");

export const userParams = z.object({ email });

function toAdminUser(user) {
  return {
    email: user.email,
    name: user.name ?? "",
    role: user.role,
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
  const user = await User.create({ email: address, name: name || owner?.name || "", role, isActive: true, ...ownerFields(owner) });
  await audit({
    actor: req.user,
    action: AUDIT.USER_ADDED,
    entityType: "User",
    entityId: address,
    metadata: { role, hubspotOwnerId: owner?.id ?? null },
    ip: req.ip,
  });
  res.status(201).json({ user: toAdminUser(user.toObject()) });
}

export async function updateUser(req, res) {
  const { email: address } = req.valid.params;
  const changes = req.valid.body;
  if (!(await User.exists({ email: address }))) throw notFound("User not found");
  if (address === req.user.email) {
    if (changes.role && changes.role !== "ADMIN") throw conflict("You cannot remove your own admin role", "SELF_LOCKOUT");
    if (changes.isActive === false) throw conflict("You cannot deactivate your own account", "SELF_LOCKOUT");
  }

  const set = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.role) set.role = changes.role;
  if (changes.isActive !== undefined) set.isActive = changes.isActive;
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
