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
    expect(config.SNAPSHOT_STORAGE_MODE).toBe("full");
    expect(config.RAW_SNAPSHOT_MODE).toBe("all");
    expect(config.DB_INSERT_BATCH_SIZE).toBe(250);
    expect(config.FORCE_FULL_HISTORY_EVERY_HOURS).toBe(24);
    expect(config.CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES).toBe(60);
    expect(config.SIGNAL_SNAPSHOT_RETENTION_DAYS).toBe(30);
    expect(config.TRADE_SIGNAL_RETENTION_DAYS).toBe(90);
    expect(config.SIGNAL_LOOKBACK_HOURS).toBe(168);
    expect(config.SIGNAL_COOLDOWN_DAYS).toBe(8);
    expect(config.SIGNAL_SELL_FEE_BPS).toBe(500);
  });

  it("rejects missing database configuration", () => {
    expect(() => loadConfig({ REDIS_URL: "redis://localhost:6379" })).toThrow("DATABASE_URL");
  });

  it("accepts the recommended production storage settings", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot",
      REDIS_URL: "redis://localhost:6379",
      SNAPSHOT_STORAGE_MODE: "current_and_changes",
      RAW_SNAPSHOT_MODE: "metadata_only"
    });

    expect(config.SNAPSHOT_STORAGE_MODE).toBe("current_and_changes");
    expect(config.RAW_SNAPSHOT_MODE).toBe("metadata_only");
  });

  it("rejects invalid storage modes", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot",
        REDIS_URL: "redis://localhost:6379",
        SNAPSHOT_STORAGE_MODE: "append_everything"
      })
    ).toThrow("SNAPSHOT_STORAGE_MODE");
  });

  it("allows disabling the current last_seen_at update interval", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot",
      REDIS_URL: "redis://localhost:6379",
      CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES: "0"
    });

    expect(config.CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES).toBe(0);
  });
});
