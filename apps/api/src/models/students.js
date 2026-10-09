import mongoose from "mongoose";
import { CANDIDATE_STATUS } from "../config/statuses.js";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const eligibleSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    email: { type: String, default: null, lowercase: true },
    mobile: { type: String, default: null },
    campus: { type: String, default: null },
    batch: { type: String, default: null },
    product: { type: String, default: null },
    eligibleAt: { type: Date, required: true },
    accessGrantedAt: { type: Date, default: null },
    accessRejectedReason: { type: String, default: null },
    learningPortalJobId: { type: String, default: null },
    applied: { type: Boolean, default: false },
    appliedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "job_eligible_students" },
);
eligibleSchema.index({ jobId: 1, studentId: 1 }, { unique: true });
eligibleSchema.index({ jobId: 1, applied: 1 });

export const JobEligibleStudent = mongoose.model("JobEligibleStudent", eligibleSchema);

const applicationSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    email: { type: String, default: null, lowercase: true },
    mobile: { type: String, default: null },
    campus: { type: String, default: null },
    batch: { type: String, default: null },
    program: { type: String, default: null },
    resumeUrl: { type: String, default: null },
    appliedAt: { type: Date, default: null },
    learningPortalJobId: { type: String, default: null },
    applicationStage: { type: String, default: null },
    profile: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastSyncedAt: { type: Date, default: null },
    source: { type: String, default: "BIGQUERY" },
  },
  { timestamps: true, collection: "job_applications" },
);
applicationSchema.index({ jobId: 1, studentId: 1 }, { unique: true });

export const JobApplication = mongoose.model("JobApplication", applicationSchema);

const applicationSnapshotSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    kind: { type: String, enum: ["FINAL"], default: "FINAL" },
    takenAt: { type: Date, required: true },
    count: { type: Number, required: true },
    studentIds: { type: [String], default: [] },
  },
  { timestamps: true, collection: "application_snapshots" },
);
applicationSnapshotSchema.index({ jobId: 1, kind: 1 }, { unique: true });

export const ApplicationSnapshot = mongoose.model("ApplicationSnapshot", applicationSnapshotSchema);

const analysisSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    studentId: { type: String, required: true },
    studentName: { type: String, default: "" },
    campus: { type: String, default: null },
    resumeUrl: { type: String, default: null },
    resumeTextHash: { type: String, default: null },

    resumeScore: { type: Number, default: null },
    resumeReason: { type: String, default: null },
    matchedSkills: { type: [String], default: [] },
    missingSkills: { type: [String], default: [] },
    relevantExperience: { type: String, default: null },

    gritScore: { type: Number, default: null },
    gritDetails: { type: [{ _id: false, skill: String, score: Number }], default: [] },
    assessmentScore: { type: Number, default: null },
    interviewScore: { type: Number, default: null },
    overallScore: { type: Number, default: null },
    scoreComponents: { type: Mixed, default: {} },

    aiRank: { type: Number, default: null },
    aiPriority: { type: String, default: null },
    finalRank: { type: Number, default: null },
    finalPriority: { type: String, default: null },
    suggestedStatus: { type: String, enum: [...CANDIDATE_STATUS, null], default: null },
    candidateStatus: { type: String, enum: [...CANDIDATE_STATUS, null], default: null },
    psmRemarks: { type: String, default: "" },
    psmEdited: { type: Boolean, default: false },

    analysisStatus: {
      type: String,
      enum: ["PENDING", "QUEUED", "COMPLETED", "FAILED", "NO_RESUME", "SKIPPED"],
      default: "PENDING",
    },
    analysisError: { type: String, default: null },
    product: { type: String, default: null },
    queuedAt: { type: Date, default: null },
    analysedAt: { type: Date, default: null },

    publicRef: { type: String, default: undefined },
  },
  { timestamps: true, collection: "candidate_analysis" },
);
analysisSchema.index({ jobId: 1, studentId: 1 }, { unique: true });
analysisSchema.index({ jobId: 1, finalRank: 1 });
analysisSchema.index({ publicRef: 1 }, { unique: true, sparse: true });

export const CandidateAnalysis = mongoose.model("CandidateAnalysis", analysisSchema);

const priorityHistorySchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, index: true },
    studentId: { type: String, required: true },
    previousPriority: { type: String, default: null },
    newPriority: { type: String, default: null },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    previousRemarks: { type: String, default: null },
    newRemarks: { type: String, default: null },
    reason: { type: String, default: "PSM_EDIT" },
    changedByEmail: { type: String, required: true },
    changedAt: { type: Date, required: true },
  },
  { collection: "candidate_priority_history", versionKey: false },
);

export const CandidatePriorityHistory = mongoose.model("CandidatePriorityHistory", priorityHistorySchema);
