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

export async function disconnectDb() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}
