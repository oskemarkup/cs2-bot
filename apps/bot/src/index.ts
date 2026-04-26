import { loadConfig } from "@cs2-bot/config";
import { createLogger } from "@cs2-bot/core";
import { allowedSystemModes } from "@cs2-bot/risk";

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL });

logger.info(
  {
    allowedSystemModes,
    manualChecklist: [
      "verify item identity",
      "verify fees and withdrawal limits",
      "verify trade lock and liquidity",
      "record paper-trade outcome before any manual action"
    ]
  },
  "manual review bot started"
);
