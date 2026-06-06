import { loadConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";
import { createDb } from "@cs2-bot/db";
import { runCollectorCli } from "./collectors.js";
import { cleanupRetention } from "./retention.js";
import { addManualPositionCli, addWatchlistItemCli, closeManualPositionCli, runSignalCli } from "./signals.js";

const command = process.argv.slice(2);

try {
  if (command[0] === "collect") {
    await runCollectCommand(command[1]);
  } else if (command[0] === "signals") {
    await runSignalsCommand(command.slice(1));
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

async function runSignalsCommand(args: readonly string[]): Promise<void> {
  if (args[0] === "run") {
    await runSignalCli(parseSignalRunOptions(args.slice(1)));
    return;
  }

  if (args[0] === "watchlist" && args[1] === "add" && args[2] !== undefined) {
    await addWatchlistItemCli(args[2], parseFlagOptions(args.slice(3)));
    return;
  }

  if (args[0] === "position" && args[1] === "add" && args[2] !== undefined) {
    await addManualPositionCli(args[2], parseFlagOptions(args.slice(3)));
    return;
  }

  if (args[0] === "position" && args[1] === "close" && args[2] !== undefined) {
    await closeManualPositionCli(args[2]);
    return;
  }

  printUsage();
  process.exitCode = 1;
}

async function runCollectCommand(marketplace: string | undefined): Promise<void> {
  if (marketplace === "market-csgo") {
    await runCollectorCli({ marketplace: "market_csgo" });
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
  node apps/worker/dist/cli.js signals run [--dry-run] [--no-alerts]
  node apps/worker/dist/cli.js signals watchlist add "AK-47 | Redline (Field-Tested)" --min-sales 10
  node apps/worker/dist/cli.js signals position add "AK-47 | Redline (Field-Tested)" --buy-price-minor 12345 --bought-at 2026-06-06T00:00:00.000Z
  node apps/worker/dist/cli.js signals position close <position-id>
  node apps/worker/dist/cli.js cleanup retention
  node apps/worker/dist/cli.js health`);
}

function parseSignalRunOptions(args: readonly string[]): { readonly dryRun: boolean; readonly sendAlerts: boolean } {
  const options = {
    dryRun: false,
    sendAlerts: true
  };

  for (const arg of args) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--no-alerts") {
      options.sendAlerts = false;
      continue;
    }

    throw new Error(`Unknown signals run option: ${arg}`);
  }

  return options;
}

function parseFlagOptions(args: readonly string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {};

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];

    if (flag === undefined || !flag.startsWith("--")) {
      throw new Error(`Expected --flag, got ${flag ?? "<empty>"}`);
    }

    const key = flag.slice(2);
    const value = args[index + 1];

    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Expected value for ${flag}`);
    }

    options[key] = value;
    index += 1;
  }

  return options;
}
