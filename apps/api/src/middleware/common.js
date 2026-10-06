import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { config } from "../config/env.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

export function validate(schemas) {
  return (req, res, next) => {
    try {
      req.valid = {};
      for (const part of ["body", "query", "params"]) {
        if (schemas[part]) req.valid[part] = schemas[part].parse(req[part] ?? {});
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function csrfGuard(req, res, next) {
  if (!MUTATING.has(req.method)) return next();
  if (req.path.startsWith("/public/") || req.path.startsWith("/webhooks/")) return next();
  if (req.get("x-requested-with") !== "XMLHttpRequest") {
    return next(new AppError(403, "CSRF_REJECTED", "Missing X-Requested-With header"));
  }
  next();
}

const limiter = (windowMs, limit) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: () => config.isTest,
    handler: (req, res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests, please slow down")),
  });

export const apiLimiter = limiter(60_000, 300);
export const authLimiter = limiter(60_000, 20);
export const publicLimiter = limiter(60_000, 60);
export const webhookLimiter = limiter(60_000, 600);

export function notFoundHandler(req, res, next) {
  next(new AppError(404, "NOT_FOUND", "Route not found"));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: error.issues[0]?.message ?? "Invalid request",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
  }
  if (error instanceof AppError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
  }
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" } });
  }
  if (error?.name === "CastError") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  (req.log ?? logger).error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } });
}
