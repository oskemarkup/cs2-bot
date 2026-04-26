import Bottleneck from "bottleneck";
import { describe, expect, it, vi } from "vitest";
import { SkinportConnector } from "../src/index.js";

describe("SkinportConnector", () => {
  it("collects read-only items and sales history with br encoding", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/v1/items")) {
        expect(url).toContain("app_id=730");
        expect(url).toContain("currency=USD");
        expect(url).toContain("tradable=1");
        expect(init?.headers).toEqual({ "Accept-Encoding": "br" });

        return new Response(
          JSON.stringify([
            {
              market_hash_name: "AK-47 | Redline (Field-Tested)",
              currency: "USD",
              min_price: "12.34",
              suggested_price: "12.50",
              quantity: 3
            }
          ]),
          { status: 200, headers: { "x-ratelimit-limit": "8", "x-ratelimit-remaining": "7" } }
        );
      }

      expect(url).toContain("/v1/sales/history");
      expect(url).toContain("app_id=730");
      expect(url).toContain("currency=USD");
      expect(init?.headers).toEqual({ "Accept-Encoding": "br" });

      return new Response(
        JSON.stringify([
          {
            market_hash_name: "AK-47 | Redline (Field-Tested)",
            currency: "USD",
            sales: 42,
            min_price: "11.00",
            max_price: "14.00",
            avg_price: "12.10"
          }
        ]),
        { status: 200, headers: { "x-ratelimit-limit": "8", "x-ratelimit-remaining": "6" } }
      );
    });
    const connector = new SkinportConnector({
      limiter: new Bottleneck({ maxConcurrent: 1, minTime: 0 }),
      fetchImpl
    });

    const collection = await connector.collect();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(collection.rawSnapshots).toHaveLength(2);
    expect(collection.itemListingSnapshots).toHaveLength(1);
    expect(collection.itemListingSnapshots[0]?.priceMinor).toBe(1234n);
    expect(collection.itemListingSnapshots[0]?.quantity).toBe(3);
    expect(collection.salesStatsSnapshots).toHaveLength(1);
    expect(collection.salesStatsSnapshots[0]?.salesCount).toBe(42);
    expect(collection.salesStatsSnapshots[0]?.avgPriceMinor).toBe(1210n);
    expect(collection.rateLimitObservations[0]?.limit).toBe(8);
  });

  it("rejects invalid API responses with Zod", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([{ currency: "USD" }]), { status: 200 }));
    const connector = new SkinportConnector({
      limiter: new Bottleneck({ maxConcurrent: 1, minTime: 0 }),
      fetchImpl
    });

    await expect(connector.collect()).rejects.toThrow();
  });
});
