import { describe, expect, it } from "vitest";
import { createConnectorRateLimiters, getConnectorLimiterDefaults, validateConnectorResponse } from "../src/index.js";

describe("connectors", () => {
  it("creates an independent limiter for each marketplace", () => {
    const limiters = createConnectorRateLimiters();

    expect(limiters.market_csgo).not.toBe(limiters.skinport);
    expect(limiters.skinport).not.toBe(limiters.csfloat);
    expect(limiters.csfloat).not.toBe(limiters.dmarket);
  });

  it("uses conservative per-marketplace limiter defaults", () => {
    const defaults = getConnectorLimiterDefaults();

    expect(defaults.market_csgo.minTime).toBeGreaterThanOrEqual(334);
    expect(defaults.market_csgo.maxConcurrent).toBe(1);
    expect(defaults.skinport.reservoir).toBe(8);
    expect(defaults.skinport.reservoirRefreshAmount).toBe(8);
    expect(defaults.skinport.reservoirRefreshInterval).toBe(300_000);
  });

  it("validates connector responses with Zod", () => {
    const observedAt = new Date("2026-04-26T00:00:00.000Z");

    expect(
      validateConnectorResponse({
        marketplace: "skinport",
        observedAt,
        listings: [
          {
            marketplace: "skinport",
            externalId: "listing-1",
            marketHashName: "AK-47 | Redline (Field-Tested)",
            priceMinor: 12345n,
            currency: "USD",
            tradableAt: null,
            observedAt,
            rawPayload: { id: "listing-1" }
          }
        ]
      }).listings
    ).toHaveLength(1);
  });
});
