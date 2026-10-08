import { config } from "./config/env.js";
import { connectDbInBackground, disconnectDb } from "./config/db.js";
import { reportMissingSettings } from "./config/startupReport.js";
import { createApp } from "./app.js";
import { bootstrapUsers } from "./services/authService.js";
import { logger } from "./utils/logger.js";
import { startWorker } from "./workers/workflowWorker.js";

async function main() {
  reportMissingSettings();

  const server = createApp().listen(config.port, () => {
    logger.info({ port: config.port, modes: config.modes }, "API listening");
  });
  server.keepAliveTimeout = 65_000;

  const withWorker = config.processRole === "all" || process.argv.includes("--with-worker");
  let worker = null;
  let stopping = false;
  const stopConnecting = connectDbInBackground({
    onConnected: async () => {
      await bootstrapUsers();
      if (withWorker && !stopping) worker = startWorker();
    },
  });

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    stopConnecting();
    logger.info({ signal }, "Shutting down");
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await new Promise((resolve) => server.close(resolve));
    if (worker) await worker.stop();
    await disconnectDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
