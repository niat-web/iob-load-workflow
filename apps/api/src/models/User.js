import mongoose from "mongoose";
import { ROLES } from "../config/statuses.js";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    role: { type: String, enum: ROLES, required: true },
    isActive: { type: Boolean, default: true },
    picture: { type: String, default: null },
    hubspotOwnerId: { type: String, default: null },
    hubspotOwnerName: { type: String, default: null },
    hubspotOwnerEmail: { type: String, default: null, lowercase: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "users" },
);

export const User = mongoose.model("User", userSchema);
