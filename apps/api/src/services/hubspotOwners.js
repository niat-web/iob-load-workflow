import fs from "node:fs";
import { config } from "../config/env.js";
import { logger } from "../utils/logger.js";

const LOCAL_MAP_FILE = new URL("../data/hubspotOwnerMap.json", import.meta.url);

function loadOwnerMap() {
  try {
    if (config.hubspot.ownerMapJson) return JSON.parse(config.hubspot.ownerMapJson);
    if (fs.existsSync(LOCAL_MAP_FILE)) return JSON.parse(fs.readFileSync(LOCAL_MAP_FILE, "utf8"));
    logger.warn("HubSpot owner list is empty: add HUBSPOT_OWNER_MAP_JSON to apps/api/.env or apps/api/src/data/hubspotOwnerMap.json");
  } catch (error) {
    logger.warn({ err: error.message }, "HubSpot owner list could not be read");
  }
  return {};
}

const OWNER_MAP = loadOwnerMap();

const titleCase = (text) => text.replace(/(^|\s)(\p{L})/gu, (match, space, letter) => `${space}${letter.toUpperCase()}`);

function nameFromEmail(email) {
  const local = email.split("@")[0].replace(/\.hubspot$/, "");
  return titleCase(local.replace(/[._-]+/g, " ").trim());
}

export function buildOwners(map) {
  const byId = new Map();
  for (const [rawKey, rawId] of Object.entries(map)) {
    const key = rawKey.trim().toLowerCase();
    const id = String(rawId).trim();
    if (!/^\d+$/.test(id) || /^\d+$/.test(key) || !key) continue;
    const entry = byId.get(id) ?? { id, names: [], emails: [] };
    const bucket = key.includes("@") ? entry.emails : entry.names;
    if (!bucket.includes(key)) bucket.push(key);
    byId.set(id, entry);
  }
  return [...byId.values()]
    .map(({ id, names, emails }) => {
      const longest = [...names].sort((a, b) => b.length - a.length)[0];
      return { id, name: longest ? titleCase(longest) : nameFromEmail(emails[0]), email: emails[0] ?? null, emails };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const OWNERS = buildOwners(OWNER_MAP);
const OWNERS_BY_ID = new Map(OWNERS.map((owner) => [owner.id, owner]));
const OWNERS_BY_EMAIL = new Map(OWNERS.flatMap((owner) => owner.emails.map((email) => [email, owner])));

const publicOwner = (owner) => (owner ? { id: owner.id, name: owner.name, email: owner.email } : null);

export function listHubspotOwners() {
  return OWNERS.map(publicOwner);
}

export function findHubspotOwner(id) {
  if (id === null || id === undefined || id === "") return null;
  return publicOwner(OWNERS_BY_ID.get(String(id).trim()));
}

export function hubspotOwnerForEmail(email) {
  if (!email) return null;
  return publicOwner(OWNERS_BY_EMAIL.get(String(email).trim().toLowerCase()));
}

export function hubspotOwnerForUser(user) {
  if (!user) return null;
  if (user.hubspotOwnerId) {
    return (
      findHubspotOwner(user.hubspotOwnerId) ?? {
        id: String(user.hubspotOwnerId),
        name: user.hubspotOwnerName || user.name || user.email,
        email: user.hubspotOwnerEmail || user.email,
      }
    );
  }
  return hubspotOwnerForEmail(user.email);
}

export function ownerFields(owner) {
  return owner
    ? { hubspotOwnerId: owner.id, hubspotOwnerName: owner.name, hubspotOwnerEmail: owner.email }
    : { hubspotOwnerId: null, hubspotOwnerName: null, hubspotOwnerEmail: null };
}
