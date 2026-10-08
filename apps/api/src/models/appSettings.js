import mongoose from "mongoose";

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "app" },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: String, default: null },
    updatedAt: { type: Date, default: null },
  },
  { collection: "app_settings", versionKey: false, minimize: false },
);

export const AppSettings = mongoose.model("AppSettings", appSettingsSchema);
