import mongoose from "mongoose";

const poolStudentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true },
    niatId: { type: String, default: null },
    studentName: { type: String, default: "" },
    mobile: { type: String, default: null },
    email: { type: String, default: null, lowercase: true },
    productGroup: { type: String, default: null },
    campus: { type: String, default: null },
    batch: { type: String, default: null },
    eligibilityStatus: { type: String, default: null },
    remarks: { type: String, default: null },
    syncedAt: { type: Date, required: true },
    manual: { type: Boolean, default: false },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true, collection: "eligible_pool_students" },
);
poolStudentSchema.index({ productGroup: 1, studentName: 1 });
poolStudentSchema.index({ studentName: 1 });
poolStudentSchema.index({ syncedAt: 1 });
poolStudentSchema.index({ eligibilityStatus: 1 });
poolStudentSchema.index({ campus: 1 });
poolStudentSchema.index({ niatId: 1 });

export const EligiblePoolStudent = mongoose.model("EligiblePoolStudent", poolStudentSchema);

const poolSyncSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "eligible-pool" },
    status: { type: String, enum: ["IDLE", "RUNNING", "DONE", "FAILED"], default: "IDLE" },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    startedBy: { type: String, default: null },
    rowsRead: { type: Number, default: 0 },
    removed: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { collection: "eligible_pool_sync", versionKey: false },
);

export const EligiblePoolSync = mongoose.model("EligiblePoolSync", poolSyncSchema);
