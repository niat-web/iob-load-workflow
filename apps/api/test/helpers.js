import "./setup.js";
import crypto from "node:crypto";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../src/app.js";
import { connectDb } from "../src/config/db.js";
import { JOB_STATUS } from "../src/config/statuses.js";
import { Job, User } from "../src/models/index.js";
import { resetIntegrations } from "../src/services/integrations.js";
import { resetClock, setClock } from "../src/utils/clock.js";
import { runDueTasks } from "../src/workers/workflowWorker.js";

export const XHR = { "X-Requested-With": "XMLHttpRequest" };
export const app = createApp();

let mongo;

export async function startTestDb() {
  mongo = await MongoMemoryServer.create();
  await connectDb(mongo.getUri());
}

export async function stopTestDb() {
  await mongoose.disconnect();
  await mongo?.stop();
}

export async function resetDb() {
  for (const collection of await mongoose.connection.db.collections()) await collection.deleteMany({});
  resetIntegrations();
  freezeTime();
}

let currentTime = Date.parse("2026-05-01T04:00:00Z");

export function freezeTime(iso = "2026-05-01T04:00:00Z") {
  currentTime = Date.parse(iso);
  setClock(() => currentTime);
}

export function advance({ hours = 0, minutes = 0, seconds = 0 }) {
  currentTime += ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

export function nowMs() {
  return currentTime;
}

export async function advanceAndRun(duration) {
  advance(duration);
  return runDueTasks();
}

export { resetClock, runDueTasks };

export async function createUser(email, role, { isActive = true } = {}) {
  return User.findOneAndUpdate(
    { email },
    { $set: { email, role, isActive, name: email.split("@")[0] } },
    { upsert: true, returnDocument: "after" },
  );
}

export async function loginAs(email, role, options) {
  await createUser(email, role, options);
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/dev-login").set(XHR).send({ email });
  if (response.status !== 200) throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  return agent;
}

export const api = () => request(app);

export async function submitDeal(agent, dealId) {
  return agent.post("/api/crm/deals/process").set(XHR).send({ dealId });
}

export async function openApplicationWindow(agent, dealId = "12345") {
  const response = await submitDeal(agent, dealId);
  await runDueTasks();
  const job = await Job.findById(response.body.job.id);
  if (job.status !== JOB_STATUS.APPLICATIONS_OPEN) {
    throw new Error(`Expected APPLICATIONS_OPEN, got ${job.status}: ${job.lastError}`);
  }
  return job;
}

export async function runToPsmReview(agent, dealId = "12345") {
  const job = await openApplicationWindow(agent, dealId);
  await advanceAndRun({ hours: 21, minutes: 1 });
  const ready = await Job.findById(job._id);
  if (ready.status !== JOB_STATUS.READY_FOR_PSM) throw new Error(`Expected READY_FOR_PSM, got ${ready.status}: ${ready.lastError}`);
  return ready;
}

export const WEBHOOK_URL = process.env.HUBSPOT_WEBHOOK_URL;

export function hubspotHeaders(raw, uri = WEBHOOK_URL, timestamp = Date.now()) {
  const signature = crypto
    .createHmac("sha256", process.env.HUBSPOT_CLIENT_SECRET)
    .update(`POST${uri}${raw}${timestamp}`)
    .digest("base64");
  return {
    "Content-Type": "application/json",
    "X-HubSpot-Signature-v3": signature,
    "X-HubSpot-Request-Timestamp": String(timestamp),
  };
}
