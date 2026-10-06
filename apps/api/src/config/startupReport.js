import { logger } from "../utils/logger.js";
import { collectConfigProblems, config } from "./env.js";

export function reportMissingSettings(cfg = config) {
  const problems = collectConfigProblems(cfg);
  if (!problems.length) return problems;
  logger.warn(
    `Running without ${problems.length} setting(s). Everything else works; a step that needs one of these stops with a message until you add it to apps/api/.env and restart:`,
  );
  for (const problem of problems) logger.warn(`  - ${problem}`);
  return problems;
}
