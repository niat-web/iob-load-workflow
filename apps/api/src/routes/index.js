import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "../config/env.js";
import { isDbReady } from "../config/db.js";
import { TASK_TYPE } from "../config/statuses.js";
import * as admin from "../controllers/adminController.js";
import * as auth from "../controllers/authController.js";
import * as crm from "../controllers/crmController.js";
import * as psm from "../controllers/psmController.js";
import * as publicPool from "../controllers/publicController.js";
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
  router.get("/companies", a(crm.listCompanies));
  router.get("/hubspot-owners", crm.hubspotOwners);
  router.get("/deals/:jobId", validate({ params: crm.jobIdParams }), a(crm.dealDetail));
  router.get("/deals/:jobId/logs", validate({ params: crm.jobIdParams }), a(crm.dealLogs));
  router.post("/deals/:jobId/retry", validate({ params: crm.jobIdParams }), a(crm.retryDeal));
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
  return router;
}

export function publicRoutes() {
  const router = Router();
  router.use(publicLimiter);
  router.get("/candidate-pools/:token", validate({ params: publicPool.tokenParams }), a(publicPool.publicPool));
  router.get(
    "/candidate-pools/:token/candidates/:ref/resume",
    validate({ params: publicPool.publicResumeParams }),
    a(publicPool.publicResume),
  );
  return router;
}

export function adminRoutes() {
  const router = Router();
  router.use(requireAuth, requireRole("ADMIN"));
  router.get("/users", a(admin.listUsers));
  router.post("/users", validate({ body: admin.createUserSchema }), a(admin.createUser));
  router.patch("/users/:email", validate({ params: admin.userParams, body: admin.updateUserSchema }), a(admin.updateUser));
  router.get("/eligible-pool", validate({ query: admin.poolQuerySchema }), a(admin.eligiblePool));
  router.get("/eligible-pool/summary", a(admin.eligiblePoolSummary));
  router.post("/eligible-pool/sync", a(admin.syncEligiblePool));
  router.post("/eligible-pool", validate({ body: admin.poolStudentCreateSchema }), a(admin.addPoolStudent));
  router.patch(
    "/eligible-pool/:studentId",
    validate({ params: admin.poolStudentParams, body: admin.poolStudentUpdateSchema }),
    a(admin.editPoolStudent),
  );
  router.delete("/eligible-pool/:studentId", validate({ params: admin.poolStudentParams }), a(admin.removePoolStudent));
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
