import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const mappingSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, unique: true },
    hubspotDealId: { type: String, required: true, unique: true },
    learningPortalJobId: { type: String, default: null },
    lastHubspotSyncAt: { type: Date, default: null },
    lastPayloadHash: { type: String, default: null },
  },
  { timestamps: true, collection: "job_hubspot_mappings" },
);

export const JobHubspotMapping = mongoose.model("JobHubspotMapping", mappingSchema);

const snapshotSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    hubspotDealId: { type: String, required: true },
    version: { type: Number, required: true },
    source: { type: String, enum: ["INITIAL", "WEBHOOK", "RETRY"], required: true },
    mappedFields: { type: Mixed, required: true },
    rawProperties: { type: Mixed, default: {} },
    payloadHash: { type: String, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "job_deal_snapshots", minimize: false },
);
snapshotSchema.index({ jobId: 1, version: -1 }, { unique: true });

export const JobDealSnapshot = mongoose.model("JobDealSnapshot", snapshotSchema);

const changeSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, index: true },
    hubspotDealId: { type: String, required: true },
    jobVersion: { type: Number, required: true },
    field: { type: String, required: true },
    oldValue: { type: Mixed, default: null },
    newValue: { type: Mixed, default: null },
    changedAt: { type: Date, required: true },
    source: { type: String, default: "HUBSPOT_WEBHOOK" },
    studentsNotified: { type: Boolean, default: false },
    notificationCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "job_change_history" },
);

export const JobChangeHistory = mongoose.model("JobChangeHistory", changeSchema);

const orgSchema = new mongoose.Schema(
  {
    normalizedName: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    organisationId: { type: String, required: true },
    website: { type: String, default: null },
    logoUrl: { type: String, default: null },
    source: { type: String, enum: ["CREATED", "SHEET"], default: "CREATED" },
    createdIn: { type: [String], default: [] },
  },
  { timestamps: true, collection: "learning_portal_organisations" },
);

export const LearningPortalOrganisation = mongoose.model("LearningPortalOrganisation", orgSchema);

const counterSchema = new mongoose.Schema(
  { _id: { type: String, required: true }, value: { type: Number, default: 0 } },
  { collection: "counters", versionKey: false },
);

export const Counter = mongoose.model("Counter", counterSchema);
