import { z } from "zod";

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  MARKET_CSGO_API_KEY: z.string().min(1).optional(),
  SKINPORT_API_KEY: z.string().min(1).optional(),
  CSFLOAT_API_KEY: z.string().min(1).optional(),
  DMARKET_API_KEY: z.string().min(1).optional(),
  ALERT_WEBHOOK_URL: z.string().url().optional()
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
