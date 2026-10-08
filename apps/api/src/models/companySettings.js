import mongoose from "mongoose";

const companySettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    companyName: { type: String, default: "" },
    checkpoints: { type: mongoose.Schema.Types.Mixed, default: {} },
    interviewerEmails: { type: [String], default: [] },
    updatedBy: { type: String, default: null },
    updatedAt: { type: Date, default: null },
  },
  { collection: "company_settings", versionKey: false, minimize: false },
);

export const CompanySettings = mongoose.model("CompanySettings", companySettingsSchema);
