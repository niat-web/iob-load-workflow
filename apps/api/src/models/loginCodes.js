import mongoose from "mongoose";

const loginCodeSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    sentAt: { type: Date, required: true },
  },
  { collection: "login_codes", versionKey: false },
);
loginCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginCode = mongoose.model("LoginCode", loginCodeSchema);
