import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const noticeSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    version: { type: Number, required: true },
    token: { type: String, required: true, unique: true },
    learningPortalJobId: { type: String, default: null },
    companyKey: { type: String, default: null },
    companyName: { type: String, default: "" },
    jobRole: { type: String, default: "" },
    changes: { type: [Mixed], default: [] },
  },
  { timestamps: true, collection: "job_update_notices" },
);
noticeSchema.index({ jobId: 1, version: 1 }, { unique: true });

export const JobUpdateNotice = mongoose.model("JobUpdateNotice", noticeSchema);

export const INTEREST_REASONS = ["LOCATION", "PAY", "ROLE", "TIMING", "OTHER"];

const responseSchema = new mongoose.Schema(
  {
    noticeId: { type: ObjectId, ref: "JobUpdateNotice", required: true },
    jobId: { type: ObjectId, ref: "Job", required: true },
    version: { type: Number, required: true },
    learningPortalJobId: { type: String, default: null },
    companyKey: { type: String, default: null },
    companyName: { type: String, default: "" },
    jobRole: { type: String, default: "" },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    email: { type: String, default: null },
    interested: { type: Boolean, required: true },
    reason: { type: String, enum: [...INTEREST_REASONS, null], default: null },
    comments: { type: String, default: "" },
    submittedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "job_update_responses" },
);
responseSchema.index({ noticeId: 1, studentId: 1 }, { unique: true });
responseSchema.index({ jobId: 1, studentId: 1, submittedAt: -1 });
responseSchema.index({ companyKey: 1 });

export const JobUpdateResponse = mongoose.model("JobUpdateResponse", responseSchema);
