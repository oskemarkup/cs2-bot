import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

describe("loadConfig", () => {
  it("validates required service URLs and applies defaults", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot",
      REDIS_URL: "redis://localhost:6379"
    });

    expect(config.API_PORT).toBe(3000);
    expect(config.NODE_ENV).toBe("development");
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://localhost:6379" })).toThrow("DATABASE_URL");
  });
});
