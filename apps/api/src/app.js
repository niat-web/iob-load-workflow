import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { isDbReady } from "./config/db.js";
import { config } from "./config/env.js";
import { apiLimiter, csrfGuard, errorHandler, notFoundHandler, webhookLimiter } from "./middleware/common.js";
import {
  adminRoutes,
  authRoutes,
  crmRoutes,
  devRoutes,
  healthRoutes,
  psmRoutes,
  publicRoutes,
  webhookRoutes,
} from "./routes/index.js";
import { logger } from "./utils/logger.js";

const SECRET_PATH = /(\/candidate-pools\/)[^/?#]+/g;

export function requestFields(req, res, ms) {
  const fields = {
    method: req.method,
    url: (req.originalUrl ?? req.url).replace(SECRET_PATH, "$1***"),
    status: res.writableEnded ? res.statusCode : "cancelled",
    ms,
  };
  if (req.user?.email) fields.user = req.user.email;
  return fields;
}

const requestMessage = (req, res, ms) => {
  const { method, url, status } = requestFields(req, res, ms);
  return `${method} ${url} ${status} ${ms}ms`;
};

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);

  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      quietResLogger: true,
      autoLogging: { ignore: (req) => req.url === "/health" || req.url === "/ready" },
      customLogLevel: (req, res, error) => {
        if (!res.writableEnded) return "debug";
        return error || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      },
      customSuccessObject: (req, res, value) => ({ http: requestFields(req, res, value.responseTime) }),
      customErrorObject: (req, res, error, value) => ({ http: requestFields(req, res, value.responseTime) }),
      customSuccessMessage: requestMessage,
      customErrorMessage: (req, res, error, ms) => requestMessage(req, res, ms),
    }),
  );
  app.use(helmet());
  app.use(compression({ threshold: 1024 }));
  app.use(
    cors({
      origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)),
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "X-Requested-With"],
      maxAge: 600,
    }),
  );

  app.use(healthRoutes());

  app.use("/api/webhooks", webhookLimiter, express.raw({ type: "*/*", limit: "1mb" }), webhookRoutes());

  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use("/api", apiLimiter, csrfGuard);
  app.use("/api", (req, res, next) => {
    if (isDbReady()) return next();
    res.set("Retry-After", "5");
    return res.status(503).json({
      error: { code: "DATABASE_CONNECTING", message: "The server is still connecting to the database. Please try again in a moment." },
    });
  });
  app.use("/api/auth", authRoutes());
  app.use("/api/crm", crmRoutes());
  app.use("/api/psm", psmRoutes());
  app.use("/api/admin", adminRoutes());
  app.use("/api/public", publicRoutes());
  if (!config.isProduction) app.use("/api/dev", devRoutes());

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
