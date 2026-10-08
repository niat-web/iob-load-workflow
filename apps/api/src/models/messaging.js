import mongoose from "mongoose";
import { NOTIFICATION_TYPE } from "../config/statuses.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const notificationLogSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, index: true },
    studentId: { type: String, default: null },
    email: { type: String, required: true, lowercase: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPE), required: true },
    provider: { type: String, default: "SES" },
    providerMessageId: { type: String, default: null },
    status: { type: String, enum: ["PENDING", "SENT", "RETRYING", "FAILED", "SKIPPED"], default: "PENDING" },
    attemptCount: { type: Number, default: 0 },
    error: { type: String, default: null },
    payload: { type: Mixed, default: {} },
    idempotencyKey: { type: String, required: true, unique: true },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "notification_logs", minimize: false },
);
notificationLogSchema.index({ jobId: 1, type: 1, status: 1 });

export const NotificationLog = mongoose.model("NotificationLog", notificationLogSchema);

export const AI_CALL_STATUSES = ["QUEUED", "CALLING", "COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"];
export const AI_CALL_FINAL = ["COMPLETED", "NO_ANSWER", "BUSY", "FAILED", "CANCELLED"];

const aiCallSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    batchId: { type: String, required: true },
    studentId: { type: String, required: true },
    name: { type: String, default: "" },
    phone: { type: String, required: true },
    nxtDialCallId: { type: String, default: null },
    status: { type: String, enum: AI_CALL_STATUSES, default: "QUEUED" },
    providerStatus: { type: String, default: null },
    durationSeconds: { type: Number, default: null },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    recordingUrl: { type: String, default: null },
    summary: { type: String, default: null },
    ratingStatus: { type: String, default: null },
    overallRating: { type: Number, default: null },
    interested: { type: String, default: null },
    willApply: { type: String, default: null },
    reason: { type: String, default: null },
    questions: { type: String, default: null },
    callBack: { type: String, default: null },
    remarks: { type: String, default: null },
    cells: { type: Mixed, default: null },
    error: { type: String, default: null },
    requestedBy: { type: String, default: null },
  },
  { timestamps: true, collection: "ai_calls" },
);
aiCallSchema.index({ jobId: 1, batchId: 1, studentId: 1 }, { unique: true });
aiCallSchema.index({ jobId: 1, createdAt: -1 });
aiCallSchema.index({ jobId: 1, status: 1 });

export const AiCall = mongoose.model("AiCall", aiCallSchema);

const publicLinkSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, unique: true },
    learningPortalJobId: { type: String, required: true, unique: true },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    lastAccessedAt: { type: Date, default: null },
    accessCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "shared_links" },
);

export const PublicLink = mongoose.model("PublicLink", publicLinkSchema);
