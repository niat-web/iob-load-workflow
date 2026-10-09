import mongoose from "mongoose";
import { FLOW_MODE, JOB_STATUS } from "../config/statuses.js";

const reminderSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["SENT", "SKIPPED", "FAILED"] },
    at: Date,
    emailCount: { type: Number, default: 0 },
    callCount: { type: Number, default: 0 },
    reason: { type: String, default: null },
  },
  { _id: false },
);

const loadSchema = new mongoose.Schema(
  {
    loadedAt: { type: Date, default: null },
    testUsersGrantedAt: { type: Date, default: null },
  },
  { _id: false },
);

const boostEmailRunSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    by: { type: String, default: null },
    recipients: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
  { _id: false },
);

const boostCallRunSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true },
    at: { type: Date, required: true },
    by: { type: String, default: null },
    agentId: { type: String, default: null },
    queued: { type: Number, default: 0 },
    skippedNoPhone: { type: Number, default: 0 },
  },
  { _id: false },
);

const ownerSchema = new mongoose.Schema(
  {
    id: { type: String, default: null },
    name: { type: String, default: null },
    email: { type: String, default: null },
  },
  { _id: false },
);

const jobSchema = new mongoose.Schema(
  {
    hubspotDealId: { type: String, required: true, unique: true, trim: true },
    hubspotDealUrl: { type: String, default: null },
    flowMode: { type: String, enum: Object.values(FLOW_MODE), default: FLOW_MODE.AUTOMATIC },
    awaitingApproval: {
      type: new mongoose.Schema({ gate: String, requestedAt: Date }, { _id: false }),
      default: null,
    },
    approvals: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    cancelledBy: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    learningPortalJobId: { type: String, default: null, index: true },
    learningPortalJobUrl: { type: String, default: null },
    learningPortalOrgId: { type: String, default: null },
    learningPortalPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    learningPortalLoads: {
      beta: { type: loadSchema, default: () => ({}) },
      prod: { type: loadSchema, default: () => ({}) },
    },
    hubspotWriteBack: {
      status: { type: String, enum: ["PENDING", "DONE", "FAILED", "SKIPPED"], default: "PENDING" },
      dealIds: { type: [String], default: [] },
      at: { type: Date, default: null },
      error: { type: String, default: null },
    },

    companyName: { type: String, default: null },
    companyKey: { type: String, default: null },
    sharedColumns: { type: [String], default: undefined },
    companyWebsite: { type: String, default: null },
    companyLinkedin: { type: String, default: null },
    companyLogoUrl: { type: String, default: null },
    jobRole: { type: String, default: null },
    jobDescription: { type: String, default: null },
    skills: { type: [String], default: [] },
    eligibility: { type: String, default: null },
    batch: { type: String, default: null },
    campus: { type: String, default: null },
    program: { type: String, default: null },
    location: { type: String, default: null },
    ctc: { type: String, default: null },
    employmentType: { type: String, default: null },
    openings: { type: Number, default: null },
    applicationDeadline: { type: String, default: null },
    importantInstructions: { type: String, default: null },
    jdCount: { type: Number, default: null },
    jobType: { type: String, default: null },
    experienceType: { type: String, default: null },
    jobSource: { type: String, default: null },
    applicationMode: { type: String, default: null },
    internshipDuration: { type: String, default: null },
    enrollPlans: { type: [String], default: [] },

    expectedPoolCount: { type: Number, default: null },
    appliedCount: { type: Number, default: 0 },
    eligibleCount: { type: Number, default: 0 },
    eligibleTopUpLockAt: { type: Date, default: null },
    poolTargetReached: { type: Boolean, default: false },
    poolTargetReachedAt: { type: Date, default: null },

    windowHours: { type: Number, default: null },
    applicationStartAt: { type: Date, default: null },
    applicationEndAt: { type: Date, default: null },
    learningPortalDeadline: { type: Date, default: null },
    pendingUpdate: { type: mongoose.Schema.Types.Mixed, default: null },
    lastApplicationSyncAt: { type: Date, default: null },
    applicationSyncError: { type: String, default: null },
    applicationSyncFailedAt: { type: Date, default: null },
    psmColumns: { type: [String], default: undefined },
    reminders: {
      r10h: { type: reminderSchema, default: null },
      r20h: { type: reminderSchema, default: null },
    },
    checkpoints: { type: mongoose.Schema.Types.Mixed, default: null },
    boost: {
      emailRuns: { type: [boostEmailRunSchema], default: [] },
      callRuns: { type: [boostCallRunSchema], default: [] },
      callAgentId: { type: String, default: null },
      callAgentCreatedAt: { type: Date, default: null },
      spokenJd: { type: String, default: null },
      lastCallSyncAt: { type: Date, default: null },
      emailLockAt: { type: Date, default: null },
      callLockAt: { type: Date, default: null },
    },

    crmOwnerId: { type: String, default: null },
    crmOwnerName: { type: String, default: null },
    crmOwnerEmail: { type: String, default: null, lowercase: true },
    profilingPoc: { type: ownerSchema, default: null },
    ise: { type: ownerSchema, default: null },
    submittedInputs: { type: mongoose.Schema.Types.Mixed, default: null },

    status: { type: String, enum: Object.values(JOB_STATUS), default: JOB_STATUS.SUBMITTED, index: true },
    currentStep: { type: String, default: "Submitted" },
    failedStep: { type: String, default: null },
    failedTaskType: { type: String, default: null },
    lastError: { type: String, default: null },
    statusHistory: {
      type: [{ _id: false, status: String, at: Date, note: String }],
      default: [],
    },
    version: { type: Number, default: 1 },

    ai: {
      startedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      analysedCount: { type: Number, default: 0 },
      failedCount: { type: Number, default: 0 },
    },

    psm: {
      startedAt: { type: Date, default: null },
      startedBy: { type: String, default: null },
    },

    crmShare: {
      status: { type: String, enum: ["PENDING", "LINK_GENERATED", "SHARED", "FAILED"], default: "PENDING" },
      sentAt: { type: Date, default: null },
      error: { type: String, default: null },
    },

    publicLinkId: { type: mongoose.Schema.Types.ObjectId, ref: "PublicLink", default: null },
    submittedBy: { type: String, default: null },
    reviewedBy: { type: String, default: null },
    reviewSubmittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "jobs" },
);

jobSchema.index({ updatedAt: -1 });
jobSchema.index({ companyName: 1 });
jobSchema.index({ companyKey: 1 });
jobSchema.index({ status: 1, updatedAt: -1 });

export const Job = mongoose.model("Job", jobSchema);
