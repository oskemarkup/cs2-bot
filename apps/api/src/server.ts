import Fastify, { type FastifyServerOptions } from "fastify";
import type { AppConfig } from "@cs2-bot/config";

export interface CreateAppOptions {
  config: AppConfig;
  logger?: FastifyServerOptions["logger"];
}

export function createApp(options: CreateAppOptions) {
  const app = Fastify({
    logger: options.logger ?? {
      level: options.config.LOG_LEVEL
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    mode: "read_only",
    manualExecutionOnly: true
  }));

  app.get("/ready", async () => ({
    status: "ready",
    postgresConfigured: options.config.DATABASE_URL.length > 0,
    redisConfigured: options.config.REDIS_URL.length > 0
  }));

  return app;
}
