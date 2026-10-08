import mongoose from "mongoose";

const { ObjectId } = mongoose.Schema.Types;

const interviewMeetSchema = new mongoose.Schema(
  {
    jobId: { type: ObjectId, ref: "Job", required: true },
    rowId: { type: String, required: true },
    companyKey: { type: String, default: null },
    companyName: { type: String, default: null },
    eventName: { type: String, default: "" },
    description: { type: String, default: "" },
    startAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: null },
    timeZone: { type: String, default: null },
    organizerEmail: { type: String, default: null, lowercase: true },
    crmEmail: { type: String, default: null, lowercase: true },
    studentEmail: { type: String, default: null, lowercase: true },
    interviewerEmails: { type: [String], default: [] },
    otherEmails: { type: [String], default: [] },
    calendarEventId: { type: String, default: null },
    calendarEventLink: { type: String, default: null },
    meetUrl: { type: String, default: null },
    meetingCode: { type: String, default: null },
    spaceName: { type: String, default: null },
    recording: {
      status: { type: String, enum: ["PENDING", "ON", "FAILED"], default: "PENDING" },
      transcript: { type: Boolean, default: false },
      error: { type: String, default: null },
    },
    busyAt: { type: Date, default: null },
    scheduledBy: { type: String, default: null },
    scheduleCount: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "interview_meets" },
);
interviewMeetSchema.index({ jobId: 1, rowId: 1 }, { unique: true });

export const InterviewMeet = mongoose.model("InterviewMeet", interviewMeetSchema);

const googleConnectionSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, lowercase: true },
    refreshToken: { type: String, required: true },
    scopes: { type: [String], default: [] },
    status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" },
    lastError: { type: String, default: null },
    connectedBy: { type: String, default: null },
    connectedAt: { type: Date, required: true },
  },
  { timestamps: true, collection: "google_connections", versionKey: false },
);

export const GoogleConnection = mongoose.model("GoogleConnection", googleConnectionSchema);
