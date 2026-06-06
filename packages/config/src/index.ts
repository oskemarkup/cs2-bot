import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SNAPSHOT_STORAGE_MODE: z.enum(["full", "current_and_changes"]).default("full"),
  RAW_SNAPSHOT_MODE: z.enum(["all", "metadata_only", "sample_on_failure"]).default("all"),
  DB_INSERT_BATCH_SIZE: z.coerce.number().int().min(1).default(250),
  FORCE_FULL_HISTORY_EVERY_HOURS: z.coerce.number().int().min(1).default(24),
  CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  RAW_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  HISTORY_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  COLLECTOR_RUN_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  SIGNAL_SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  TRADE_SIGNAL_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  SIGNAL_WATCHLIST: z.string().min(1).optional(),
  SIGNAL_LOOKBACK_HOURS: z.coerce.number().int().min(1).default(168),
  SIGNAL_ROLLING_WINDOW_HOURS: z.coerce.number().int().min(1).default(336),
  SIGNAL_MIN_HISTORY_POINTS: z.coerce.number().int().min(2).default(3),
  SIGNAL_MIN_BASELINE_ITEMS: z.coerce.number().int().min(2).default(3),
  SIGNAL_MIN_PRICE_MINOR: z.coerce.bigint().nonnegative().default(100n),
  SIGNAL_MIN_SALES_COUNT: z.coerce.number().int().min(0).default(3),
  SIGNAL_BUY_RESIDUAL_BPS: z.coerce.number().int().min(1).default(800),
  SIGNAL_BUY_ZSCORE_BPS: z.coerce.number().int().min(0).default(10_000),
  SIGNAL_SELL_RESIDUAL_BPS: z.coerce.number().int().min(0).default(600),
  SIGNAL_TAKE_PROFIT_BPS: z.coerce.number().int().min(0).default(1_200),
  SIGNAL_MIN_EXPECTED_PROFIT_BPS: z.coerce.number().int().min(0).default(500),
  SIGNAL_BUY_FEE_BPS: z.coerce.number().int().min(0).default(0),
  SIGNAL_SELL_FEE_BPS: z.coerce.number().int().min(0).default(500),
  SIGNAL_SAFETY_MARGIN_BPS: z.coerce.number().int().min(0).default(200),
  SIGNAL_COOLDOWN_DAYS: z.coerce.number().int().min(1).default(8),
  SIGNAL_DEDUP_WINDOW_HOURS: z.coerce.number().int().min(1).default(12),
  MARKET_CSGO_API_KEY: z.string().min(1).optional(),
  SKINPORT_API_KEY: z.string().min(1).optional(),
  CSFLOAT_API_KEY: z.string().min(1).optional(),
  DMARKET_API_KEY: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_CHAT_ID: z.string().min(1).optional()
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(stripEmptyStrings(env));

  if (!parsed.success) {
    throw new Error(`Invalid environment: ${formatEnvError(parsed.error)}`);
  }

  return parsed.data;
}

function stripEmptyStrings(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter((entry) => entry[1] !== "")) as NodeJS.ProcessEnv;
}

function formatEnvError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}
