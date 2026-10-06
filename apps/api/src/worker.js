import { connectDb, disconnectDb } from "./config/db.js";
import { reportMissingSettings } from "./config/startupReport.js";
import { logger } from "./utils/logger.js";
import { startWorker } from "./workers/workflowWorker.js";

async function main() {
  reportMissingSettings();
  await connectDb();
  const worker = startWorker();

  let stopping = false;
  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "Worker shutting down");
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await worker.stop();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "Worker failed to start");
  process.exit(1);
});
