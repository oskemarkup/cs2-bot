import { loadConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";
import { createDb } from "@cs2-bot/db";
import { runCollectorCli } from "./collectors.js";
import { cleanupRetention } from "./retention.js";

const command = process.argv.slice(2);

try {
  if (command[0] === "collect") {
    await runCollectCommand(command[1]);
  } else if (command[0] === "cleanup" && command[1] === "retention") {
    await runRetentionCleanup();
  } else if (command[0] === "health") {
    await runHealthCheck();
  } else {
    printUsage();
    process.exitCode = 1;
  }
} catch (error) {
  const logger = createLogger({ level: "error" });
  logger.error({ err: error }, "worker cli command failed");
  process.exitCode = 1;
}

async function runCollectCommand(marketplace: string | undefined): Promise<void> {
  if (marketplace === "market-csgo") {
    await runCollectorCli({ marketplace: "market_csgo" });
    return;
  }

  if (marketplace === "skinport") {
    await runCollectorCli({ marketplace: "skinport" });
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function runRetentionCleanup(): Promise<void> {
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

async function runHealthCheck(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { pool } = createDb(config.DATABASE_URL);

  try {
    await pool.query("select 1");
    logger.info("worker health check succeeded");
  } finally {
    await pool.end();
  }
}

function printUsage(): void {
  console.error(`Usage:
  node apps/worker/dist/cli.js collect market-csgo
  node apps/worker/dist/cli.js collect skinport
  node apps/worker/dist/cli.js cleanup retention
  node apps/worker/dist/cli.js health`);
}
