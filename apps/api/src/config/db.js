import mongoose from "mongoose";
import { config } from "./env.js";
import { logger } from "../utils/logger.js";

mongoose.set("strictQuery", true);

export async function connectDb(uri = config.mongodbUri) {
  if (!uri) throw new Error("MONGODB_URI is not set");
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20,
    autoIndex: true,
  });
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()));
  logger.info({ db: mongoose.connection.name }, "MongoDB connected");
  return mongoose.connection;
}

const DB_RETRY_MS = 10_000;

export function connectDbInBackground({ onConnected, retryMs = DB_RETRY_MS } = {}) {
  let stopped = false;
  let timer = null;
  const attempt = async () => {
    if (stopped) return;
    if (!config.mongodbUri) {
      logger.error("MONGODB_URI is not set: add it to apps/api/.env and restart. The API is running without a database.");
      return;
    }
    try {
      await connectDb();
    } catch (error) {
      if (stopped) return;
      logger.warn(
        { err: error.message },
        `MongoDB is not reachable yet; retrying in ${retryMs / 1000}s. Pages that need data answer "still connecting" until then.`,
      );
      timer = setTimeout(() => void attempt(), retryMs);
      timer.unref?.();
      return;
    }
    try {
      await onConnected?.();
    } catch (error) {
      logger.error({ err: error }, "Startup step after the MongoDB connection failed");
    }
  };
  void attempt();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}
