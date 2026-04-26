import Bottleneck from "bottleneck";
import { describe, expect, it, vi } from "vitest";
import { MarketCsgoConnector } from "../src/index.js";

describe("MarketCsgoConnector", () => {
  it("collects read-only Market.CSGO endpoints and normalizes snapshots", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/api/v2/prices/USD.json")) {
        return jsonResponse({ items: { "AK-47 | Redline (Field-Tested)": "12.34" } });
      }

      if (url.includes("/api/full-export/USD.json")) {
        return jsonResponse({
          items: {
            listing_1: {
              market_hash_name: "M4A1-S | Cyrex (Minimal Wear)",
              price: "15.01",
              quantity: 2
            }
          }
        });
      }

      if (url.includes("/api/v2/prices/class_instance/USD.json")) {
        return jsonResponse({ items: {} });
      }

      if (url.includes("/api/v2/prices/orders/USD.json")) {
        return jsonResponse({ items: {} });
      }

      if (url.includes("/api/v2/full-history/12345.json")) {
        return jsonResponse({
          items: {
            "AK-47 | Redline (Field-Tested)": {
              sales: 2,
              min_price: "10.00",
              max_price: "13.00",
              avg_price: "11.50"
            }
          }
        });
      }

      if (url.includes("/api/v2/full-history/all.json")) {
        return jsonResponse({ items: {} });
      }

      if (url.includes("/api/v2/dictionary/names.json")) {
        return jsonResponse({ "1_1": "AK-47 | Redline (Field-Tested)" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });
    const connector = new MarketCsgoConnector({
      limiter: new Bottleneck({ maxConcurrent: 1, minTime: 0 }),
      fetchImpl,
      historyItemId: "12345"
    });

    const collection = await connector.collect();

    expect(fetchImpl).toHaveBeenCalledTimes(7);
    expect(collection.rawSnapshots.map((snapshot) => snapshot.endpoint)).toEqual([
      "prices",
      "full-export",
      "class-instance-prices",
      "orders",
      "full-history-all",
      "full-history-item",
      "dictionary-names"
    ]);
    expect(collection.itemListingSnapshots).toHaveLength(2);
    expect(collection.itemListingSnapshots[0]?.priceMinor).toBe(1234n);
    expect(collection.itemListingSnapshots[1]?.priceMinor).toBe(1501n);
    expect(collection.salesStatsSnapshots).toHaveLength(1);
    expect(collection.salesStatsSnapshots[0]?.avgPriceMinor).toBe(1150n);
  });

  it("rejects invalid dictionary responses with Zod", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/api/v2/dictionary/names.json")) {
        return jsonResponse([123]);
      }

      return jsonResponse({ items: {} });
    });
    const connector = new MarketCsgoConnector({
      limiter: new Bottleneck({ maxConcurrent: 1, minTime: 0 }),
      fetchImpl
    });

    await expect(connector.collect()).rejects.toThrow();
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "x-ratelimit-limit": "5", "x-ratelimit-remaining": "4" }
  });
}
