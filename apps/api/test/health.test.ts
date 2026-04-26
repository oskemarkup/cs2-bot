import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";

describe("api health", () => {
  it("returns read-only service status", async () => {
    const app = createApp({
      logger: false,
      config: {
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
        API_HOST: "127.0.0.1",
        API_PORT: 3000,
        DATABASE_URL: "postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot",
        REDIS_URL: "redis://localhost:6379"
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "read_only",
      manualExecutionOnly: true
    });

    await app.close();
  });
});
