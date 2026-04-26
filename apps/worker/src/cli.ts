import { loadConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";
import { createDb } from "@cs2-bot/db";
import { cleanupRetention } from "./retention.js";

const command = process.argv.slice(2);

if (command[0] !== "cleanup" || command[1] !== "retention") {
  console.error("Usage: node apps/worker/dist/cli.js cleanup retention");
  process.exitCode = 1;
} else {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { pool } = createDb(config.DATABASE_URL);

  try {
    await cleanupRetention({
      pool,
      config,
      logger,
      batchSize: config.DB_INSERT_BATCH_SIZE
    });
  } catch (error) {
    logger.error({ err: error }, "retention cleanup failed");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
