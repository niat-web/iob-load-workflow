import mongoose from "mongoose";
import { TASK_TYPE } from "../config/statuses.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const workflowTaskSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", index: true },
    type: { type: String, enum: Object.values(TASK_TYPE), required: true },
    scheduledFor: { type: Date, required: true },
    status: { type: String, enum: ["PENDING", "PROCESSING", "COMPLETED", "FAILED"], default: "PENDING" },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    payload: { type: Mixed, default: {} },
    dedupeKey: { type: String, default: undefined },
    releaseDedupeOnStart: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "workflow_tasks", minimize: false },
);

workflowTaskSchema.index({ status: 1, scheduledFor: 1 });
workflowTaskSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });

export const WorkflowTask = mongoose.model("WorkflowTask", workflowTaskSchema);

const workerHeartbeatSchema = new mongoose.Schema(
  {
    workerId: { type: String, required: true, unique: true },
    lastSeenAt: { type: Date, required: true },
    startedAt: { type: Date, required: true },
  },
  { collection: "worker_heartbeats" },
);
workerHeartbeatSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const WorkerHeartbeat = mongoose.model("WorkerHeartbeat", workerHeartbeatSchema);

const webhookEventSchema = new mongoose.Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    source: { type: String, default: "hubspot" },
    dealId: { type: String, default: null },
    subscriptionType: { type: String, default: null },
    propertyName: { type: String, default: null },
    receivedAt: { type: Date, default: Date.now },
  },
  { collection: "webhook_events" },
);
webhookEventSchema.index({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const WebhookEvent = mongoose.model("WebhookEvent", webhookEventSchema);

const apiUsageSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    day: { type: String, required: true },
    count: { type: Number, default: 0 },
  },
  { collection: "api_usage" },
);
apiUsageSchema.index({ provider: 1, day: 1 }, { unique: true });

export const ApiUsage = mongoose.model("ApiUsage", apiUsageSchema);

const auditLogSchema = new mongoose.Schema(
  {
    actorEmail: { type: String, default: "system" },
    actorRole: { type: String, default: "SYSTEM" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    metadata: { type: Mixed, default: {} },
    ip: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "audit_logs", versionKey: false },
);
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
