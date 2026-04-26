import { describe, expect, it } from "vitest";
import { createConnectorRateLimiters, validateConnectorResponse } from "../src/index.js";

describe("connectors", () => {
  it("creates an independent limiter for each marketplace", () => {
    const limiters = createConnectorRateLimiters();

    expect(limiters.market_csgo).not.toBe(limiters.skinport);
    expect(limiters.skinport).not.toBe(limiters.csfloat);
    expect(limiters.csfloat).not.toBe(limiters.dmarket);
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
