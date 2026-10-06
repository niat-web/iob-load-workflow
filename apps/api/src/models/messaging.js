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

const aiCallLogSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    studentId: { type: String, required: true },
    name: { type: String, default: "" },
    phone: { type: String, required: true },
    reminderType: { type: String, enum: ["REMINDER_10H", "REMINDER_20H"], required: true },
    nxtDialCallId: { type: String, default: null },
    status: {
      type: String,
      enum: ["PENDING", "QUEUED", "RATE_LIMITED", "RETRYING", "FAILED", "SKIPPED"],
      default: "PENDING",
    },
    error: { type: String, default: null },
    attemptCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "ai_call_logs" },
);
aiCallLogSchema.index({ jobId: 1, studentId: 1, reminderType: 1 }, { unique: true });
aiCallLogSchema.index({ jobId: 1, status: 1 });

export const AiCallLog = mongoose.model("AiCallLog", aiCallLogSchema);

const publicLinkSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, unique: true },
    tokenHash: { type: String, required: true, unique: true },
    tokenEncrypted: { type: String, required: true },
    createdBy: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
    lastAccessedAt: { type: Date, default: null },
    accessCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "public_links" },
);

export const PublicLink = mongoose.model("PublicLink", publicLinkSchema);
