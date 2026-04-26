import pino from "pino";
import { loadConfig } from "@cs2-bot/config";
import { allowedSystemModes } from "@cs2-bot/risk";

const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL });

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
