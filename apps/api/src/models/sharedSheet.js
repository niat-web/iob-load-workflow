import mongoose from "mongoose";

const { ObjectId, Mixed } = mongoose.Schema.Types;

const rowSchema = new mongoose.Schema(
  {
    ref: { type: String, default: null },
    source: { type: String, enum: ["PSM", "ADDED"], required: true },
    values: { type: Mixed, default: {} },
    internal: { type: Mixed, default: {} },
    createdAt: { type: Date, required: true },
  },
  { minimize: false },
);

const columnSchema = new mongoose.Schema(
  { key: { type: String, required: true }, label: { type: String, required: true } },
  { _id: false },
);

const sharedSheetSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true, unique: true },
    learningPortalJobId: { type: String, default: null },
    customColumns: { type: [columnSchema], default: [] },
    internalColumns: { type: [columnSchema], default: [] },
    rows: { type: [rowSchema], default: [] },
  },
  { timestamps: true, collection: "shared_profile_sheets", minimize: false },
);

export const SharedSheet = mongoose.model("SharedSheet", sharedSheetSchema);

const preferenceSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    value: { type: Mixed, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, collection: "preferences", minimize: false },
);

export const Preference = mongoose.model("Preference", preferenceSchema);
