import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "../config/env.js";
import { isDbReady } from "../config/db.js";
import { TASK_TYPE } from "../config/statuses.js";
import * as admin from "../controllers/adminController.js";
import * as auth from "../controllers/authController.js";
import * as crm from "../controllers/crmController.js";
import * as interviews from "../controllers/interviewController.js";
import * as psm from "../controllers/psmController.js";
import * as jobUpdates from "../controllers/jobUpdateController.js";
import * as shared from "../controllers/sharedProfilesController.js";
import { hubspotWebhook } from "../controllers/webhookController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncRoute as a, authLimiter, publicLimiter, validate } from "../middleware/common.js";
import { Job, WorkerHeartbeat } from "../models/index.js";
import { integrations } from "../services/integrations.js";
import { enqueueTask } from "../services/taskQueue.js";
import { now } from "../utils/clock.js";
import { notFound } from "../utils/errors.js";

export function healthRoutes() {
  const router = Router();
  router.get("/health", (req, res) => res.json({ status: "ok" }));
  router.get(
    "/ready",
    a(async (req, res) => {
      const checks = { mongo: "down" };
      if (isDbReady()) {
        await mongoose.connection.db.admin().ping();
        checks.mongo = "ok";
      }
      const worker = await WorkerHeartbeat.findOne().sort({ lastSeenAt: -1 }).lean().catch(() => null);
      const ready = checks.mongo === "ok";
      res.status(ready ? 200 : 503).json({
        status: ready ? "ready" : "not_ready",
        checks,
        worker: worker ? { lastSeenAt: worker.lastSeenAt } : null,
        integrationModes: config.modes,
      });
    }),
  );
  return router;
}

export function authRoutes() {
  const router = Router();
  router.use(authLimiter);
  router.get("/config", auth.getConfig);
  router.post("/google", validate({ body: auth.googleLoginSchema }), a(auth.googleLogin));
  router.post("/dev-login", validate({ body: auth.devLoginSchema }), a(auth.devLogin));
  router.post("/email/code", validate({ body: auth.emailCodeSchema }), a(auth.sendEmailCode));
  router.post("/email/verify", validate({ body: auth.verifyCodeSchema }), a(auth.emailCodeLogin));
  router.get("/me", requireAuth, auth.me);
  router.post("/logout", auth.logout);
  return router;
}

export function crmRoutes() {
  const router = Router();
  router.use(requireAuth, requireRole("CRM"));
  router.post("/deals/process", validate({ body: crm.processDealSchema }), a(crm.processDeal));
  router.get("/deals", validate({ query: crm.listSchema }), a(crm.listDeals));
  router.get("/deals/filters", a(crm.dealFilters));
  router.get("/hubspot-owners", crm.hubspotOwners);
  router.get("/controls", a(crm.controls));
  router.get("/deals/:jobId", validate({ params: crm.jobIdParams }), a(crm.dealDetail));
  router.get("/deals/:jobId/logs", validate({ params: crm.jobIdParams }), a(crm.dealLogs));
  router.post("/deals/:jobId/retry", validate({ params: crm.jobIdParams }), a(crm.retryDeal));
  router.get("/deals/:jobId/new-eligible", validate({ params: crm.jobIdParams }), a(crm.newEligibleDetail));
  router.post("/deals/:jobId/new-eligible", validate({ params: crm.jobIdParams }), a(crm.addNewEligible));
  router.get(
    "/deals/:jobId/students",
    validate({ params: crm.jobIdParams, query: crm.studentsQuerySchema }),
    a(crm.dealStudents),
  );
  router.get(
    "/deals/:jobId/students/export",
    validate({ params: crm.jobIdParams, query: crm.studentsExportSchema }),
    a(crm.dealStudentsExport),
  );
  router.get("/deals/:jobId/reminders", validate({ params: crm.jobIdParams }), a(crm.reminderDetail));
  router.patch(
    "/deals/:jobId/reminders",
    validate({ params: crm.jobIdParams, body: crm.remindersSchema }),
    a(crm.updateReminders),
  );
  router.get("/deals/:jobId/approval", validate({ params: crm.jobIdParams }), a(crm.approvalDetail));
  router.post("/deals/:jobId/approve", validate({ params: crm.jobIdParams, body: crm.approveSchema }), a(crm.approveStep));
  router.post(
    "/deals/:jobId/approval/plans",
    validate({ params: crm.jobIdParams, body: crm.plansSchema }),
    a(crm.updateApprovalPlans),
  );
  router.post("/deals/:jobId/stop", validate({ params: crm.jobIdParams }), a(crm.stopDeal));
  router.delete("/deals/:jobId", validate({ params: crm.jobIdParams }), a(crm.deleteDeal));
  router.get("/deals/:jobId/boost", validate({ params: crm.jobIdParams }), a(crm.boostDetail));
  router.post("/deals/:jobId/boost/emails", validate({ params: crm.jobIdParams }), a(crm.boostEmails));
  router.post("/deals/:jobId/boost/calls", validate({ params: crm.jobIdParams }), a(crm.boostCalls));
  router.post("/deals/:jobId/boost/calls/sync", validate({ params: crm.jobIdParams }), a(crm.boostCallsSync));
  return router;
}

export function interviewRoutes() {
  const router = Router();
  router.use(requireAuth, requireRole("CRM"));
  router.get("/companies", a(interviews.listCompanies));
  router.get("/google", a(interviews.googleStatus));
  router.delete("/google", a(interviews.googleDisconnect));
  router.get("/google/connect", validate({ query: interviews.connectQuery }), a(interviews.googleConnect));
  router.get("/google/callback", a(interviews.googleCallback));
  router.get("/jobs/:jobId", validate({ params: interviews.jobParams }), a(interviews.sheet));
  router.patch(
    "/jobs/:jobId/interviewers",
    validate({ params: interviews.jobParams, body: interviews.interviewersSchema }),
    a(interviews.updateInterviewers),
  );
  router.post("/jobs/:jobId/rows", validate({ params: interviews.jobParams, body: interviews.rowSchema }), a(interviews.addRow));
  router.patch(
    "/jobs/:jobId/rows/:rowId",
    validate({ params: interviews.rowParams, body: interviews.cellSchema }),
    a(interviews.updateCell),
  );
  router.delete("/jobs/:jobId/rows/:rowId", validate({ params: interviews.rowParams }), a(interviews.deleteRow));
  router.post(
    "/jobs/:jobId/rows/:rowId/meet",
    validate({ params: interviews.rowParams, body: interviews.meetSchema }),
    a(interviews.createMeet),
  );
  router.post(
    "/jobs/:jobId/columns",
    validate({ params: interviews.jobParams, body: interviews.columnSchema }),
    a(interviews.addColumn),
  );
  router.patch(
    "/jobs/:jobId/columns/:key",
    validate({ params: interviews.columnParams, body: interviews.columnSchema }),
    a(interviews.renameColumn),
  );
  router.delete("/jobs/:jobId/columns/:key", validate({ params: interviews.columnParams }), a(interviews.deleteColumn));
  return router;
}

export function psmRoutes() {
  const router = Router();
  const jobParams = { params: crm.jobIdParams };
  router.use(requireAuth, requireRole("PSM"));
  router.get("/jobs", validate({ query: psm.psmListSchema }), a(psm.listJobs));
  router.get("/jobs/filters", a(psm.jobFilters));
  router.get("/jobs/:jobId", validate(jobParams), a(psm.jobDetail));
  router.post("/jobs/:jobId/start-review", validate(jobParams), a(psm.startReview));
  router.get("/jobs/:jobId/candidates", validate({ ...jobParams, query: psm.candidateListSchema }), a(psm.listCandidates));
  router.patch(
    "/jobs/:jobId/candidates/:studentId",
    validate({ params: psm.candidateParams, body: psm.candidateUpdateSchema }),
    a(psm.updateCandidate),
  );
  router.get("/jobs/:jobId/candidates/:studentId/resume", validate({ params: psm.candidateParams }), a(psm.candidateResume));
  router.post("/jobs/:jobId/submit", validate(jobParams), a(psm.submitPool));
  router.get("/jobs/:jobId/shared-columns", validate(jobParams), a(psm.sharedColumns));
  router.patch("/jobs/:jobId/shared-columns", validate({ ...jobParams, body: psm.sharedColumnsSchema }), a(psm.updateSharedColumns));
  return router;
}

export function publicRoutes() {
  const router = Router();
  router.use(publicLimiter);
  router.get(
    "/job-updates/:token",
    validate({ params: jobUpdates.tokenParams, query: jobUpdates.formQuery }),
    a(jobUpdates.getForm),
  );
  router.post(
    "/job-updates/:token",
    validate({ params: jobUpdates.tokenParams, body: jobUpdates.submitSchema }),
    a(jobUpdates.submitForm),
  );
  return router;
}

export function sharedRoutes() {
  const router = Router();
  router.use(publicLimiter);
  router.get("/profiles/:jobId", validate({ params: shared.jobParams }), a(shared.sharedProfiles));
  router.post("/profiles/:jobId/rows", validate({ params: shared.jobParams, body: shared.rowSchema }), a(shared.addRow));
  router.patch(
    "/profiles/:jobId/rows/:rowId",
    validate({ params: shared.rowParams, body: shared.cellSchema }),
    a(shared.updateCell),
  );
  router.delete("/profiles/:jobId/rows/:rowId", validate({ params: shared.rowParams }), a(shared.deleteRow));
  router.post("/profiles/:jobId/columns", validate({ params: shared.jobParams, body: shared.columnSchema }), a(shared.addColumn));
  router.patch(
    "/profiles/:jobId/columns/:key",
    validate({ params: shared.columnParams, body: shared.columnSchema }),
    a(shared.renameColumn),
  );
  router.delete("/profiles/:jobId/columns/:key", validate({ params: shared.columnParams }), a(shared.deleteColumn));
  router.get("/profiles/:jobId/resumes/:ref", validate({ params: shared.resumeParams }), a(shared.sharedResume));
  return router;
}

function eligiblePoolRoutes() {
  const router = Router();
  router.use(requireRole("POOL_MANAGER"));
  router.get("/", validate({ query: admin.poolQuerySchema }), a(admin.eligiblePool));
  router.get("/summary", a(admin.eligiblePoolSummary));
  router.post("/sync", requireRole("ADMIN"), a(admin.syncEligiblePool));
  router.post("/", validate({ body: admin.poolStudentCreateSchema }), a(admin.addPoolStudent));
  router.post("/bulk", validate({ body: admin.poolBulkSchema }), a(admin.importPoolStudentsBulk));
  router.patch(
    "/:studentId",
    validate({ params: admin.poolStudentParams, body: admin.poolStudentUpdateSchema }),
    a(admin.editPoolStudent),
  );
  router.delete("/:studentId", validate({ params: admin.poolStudentParams }), a(admin.removePoolStudent));
  return router;
}

export function adminRoutes() {
  const router = Router();
  router.use(requireAuth);
  router.use("/eligible-pool", eligiblePoolRoutes());
  router.use(requireRole("ADMIN"));
  router.get("/settings", a(admin.appSettings));
  router.get("/audit-logs", validate({ query: admin.auditQuerySchema }), a(admin.auditLogs));
  router.get("/audit-logs/filters", a(admin.auditLogFilterOptions));
  router.patch("/settings", validate({ body: admin.settingsPatchSchema }), a(admin.saveAppSettings));
  router.get("/users", a(admin.listUsers));
  router.post("/users", validate({ body: admin.createUserSchema }), a(admin.createUser));
  router.patch("/users/:email", validate({ params: admin.userParams, body: admin.updateUserSchema }), a(admin.updateUser));
  router.get("/bigquery/datasets", a(admin.bigQueryDatasets));
  router.get("/bigquery/datasets/:dataset/tables", validate({ params: admin.datasetParams }), a(admin.bigQueryTables));
  router.get(
    "/bigquery/datasets/:dataset/tables/:table/rows",
    validate({ params: admin.tableParams, query: admin.tableRowsQuery }),
    a(admin.bigQueryTableRows),
  );
  return router;
}

export function webhookRoutes() {
  const router = Router();
  router.post("/hubspot", a(hubspotWebhook));
  return router;
}

export function devRoutes() {
  const router = Router();
  router.use(requireAuth, requireRole("CRM"));
  router.post(
    "/mock-hubspot/:dealId",
    validate({
      params: z.object({ dealId: z.string().regex(/^\d{1,20}$/) }),
      body: z.object({ properties: z.record(z.string(), z.string().max(2000)) }),
    }),
    a(async (req, res) => {
      if (config.modes.hubspot !== "mock") throw notFound("Only available when HubSpot runs in mock mode");
      await integrations.hubspot.setOverride(req.valid.params.dealId, req.valid.body.properties);
      const job = await Job.findOne({ hubspotDealId: req.valid.params.dealId }).lean();
      if (job) {
        await enqueueTask({
          jobId: job._id,
          type: TASK_TYPE.HUBSPOT_DEAL_UPDATE,
          scheduledFor: now(),
          dedupeKey: `${job._id}:${TASK_TYPE.HUBSPOT_DEAL_UPDATE}:pending`,
          releaseDedupeOnStart: true,
        });
      }
      res.json({ ok: true, queued: Boolean(job) });
    }),
  );
  return router;
}
