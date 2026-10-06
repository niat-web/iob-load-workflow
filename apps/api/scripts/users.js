import { connectDb, disconnectDb } from "../src/config/db.js";
import { ROLES } from "../src/config/statuses.js";
import { User } from "../src/models/index.js";
import { findHubspotOwner, hubspotOwnerForEmail, listHubspotOwners, ownerFields } from "../src/services/hubspotOwners.js";

const args = process.argv.slice(2);
const ownerFlag = args.indexOf("--owner");
const ownerArg = ownerFlag >= 0 ? args[ownerFlag + 1] : undefined;
const positional = ownerFlag >= 0 ? args.filter((_, index) => index !== ownerFlag && index !== ownerFlag + 1) : args;
const [command, rawEmail, rawRole, ...nameParts] = positional;
const email = rawEmail?.trim().toLowerCase();
const role = rawRole?.trim().toUpperCase();

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  users.js add <email> <CRM|PSM|ADMIN> [name] [--owner <hubspotOwnerId>]",
      "  users.js owner <email> <hubspotOwnerId>",
      "  users.js role <email> <role>",
      "  users.js activate <email> | deactivate <email>",
      "  users.js list",
      "  users.js owners",
    ].join("\n"),
  );
  process.exit(1);
}

const describeOwner = (user) =>
  user.hubspotOwnerId
    ? `HubSpot owner ${user.hubspotOwnerName} · ${user.hubspotOwnerId}`
    : "no HubSpot owner matched this email; set one with: owner <email> <hubspotOwnerId>";

async function main() {
  if (!command) usage();
  if (command === "owners") {
    console.table(listHubspotOwners());
    return;
  }
  if (command !== "list" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? "")) usage("a valid email is required");
  if (["add", "role"].includes(command) && !ROLES.includes(role)) usage(`role must be one of ${ROLES.join(", ")}`);
  if (ownerArg !== undefined && !findHubspotOwner(ownerArg)) usage(`HubSpot owner ${ownerArg} is not in the owner list (see: owners)`);
  if (command === "owner" && !findHubspotOwner(rawRole)) usage(`HubSpot owner ${rawRole ?? ""} is not in the owner list (see: owners)`);

  await connectDb();
  switch (command) {
    case "add": {
      const owner = ownerArg ? findHubspotOwner(ownerArg) : hubspotOwnerForEmail(email);
      const set = { role, isActive: true, ...(nameParts.length ? { name: nameParts.join(" ") } : {}) };
      if (owner) Object.assign(set, ownerFields(owner));
      const update = { $set: set };
      if (owner && !nameParts.length) update.$setOnInsert = { name: owner.name };
      const user = await User.findOneAndUpdate({ email }, update, { upsert: true, returnDocument: "after" });
      console.log(`Saved ${user.email} as ${user.role} (${describeOwner(user)})`);
      break;
    }
    case "owner": {
      const owner = findHubspotOwner(rawRole);
      const result = await User.updateOne({ email }, { $set: ownerFields(owner) });
      console.log(result.matchedCount ? `${email} → HubSpot owner ${owner.name} · ${owner.id}` : `${email} not found`);
      break;
    }
    case "role": {
      const result = await User.updateOne({ email }, { $set: { role } });
      console.log(result.matchedCount ? `${email} is now ${role}` : `${email} not found`);
      break;
    }
    case "activate":
    case "deactivate": {
      const result = await User.updateOne({ email }, { $set: { isActive: command === "activate" } });
      console.log(result.matchedCount ? `${email} ${command}d` : `${email} not found`);
      break;
    }
    case "list": {
      const users = await User.find().sort({ role: 1, email: 1 }).lean();
      console.table(
        users.map(({ email: e, role: r, isActive, name, hubspotOwnerId, hubspotOwnerName, lastLoginAt }) => ({
          email: e,
          role: r,
          isActive,
          name,
          hubspotOwner: hubspotOwnerName ?? "",
          hubspotOwnerId: hubspotOwnerId ?? "",
          lastLoginAt,
        })),
      );
      break;
    }
    default:
      usage(`unknown command ${command}`);
  }
  await disconnectDb();
}

main().catch(async (error) => {
  console.error(error.message);
  await disconnectDb();
  process.exit(1);
});
