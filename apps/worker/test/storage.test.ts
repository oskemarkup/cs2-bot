import { describe, expect, it } from "vitest";
import type { ConnectorItemListingSnapshot, ConnectorRawSnapshot, ConnectorSalesStatsSnapshot } from "@cs2-bot/connectors";
import {
  itemListingContentHash,
  rawSnapshotResponseBodyForMode,
  salesStatsContentHash,
  stableJsonStringify
} from "../src/storage.js";

describe("stableJsonStringify", () => {
  it("canonicalizes object keys deterministically", () => {
    expect(stableJsonStringify({ b: 2, a: { d: 4, c: 3 } })).toBe(stableJsonStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

describe("content hashing", () => {
  it("keeps the same logical listing hash when observed_at changes", () => {
    expect(itemListingContentHash(listing({ observedAt: new Date("2026-01-01T00:00:00.000Z") }))).toBe(
      itemListingContentHash(listing({ observedAt: new Date("2026-01-02T00:00:00.000Z") }))
    );
  });

  it("changes listing hash when price changes", () => {
    expect(itemListingContentHash(listing({ priceMinor: 100n }))).not.toBe(
      itemListingContentHash(listing({ priceMinor: 101n }))
    );
  });

  it("changes listing hash when quantity changes", () => {
    expect(itemListingContentHash(listing({ quantity: 1 }))).not.toBe(itemListingContentHash(listing({ quantity: 2 })));
  });

  it("changes sales stats hash when stats change and ignores fetched timestamps", () => {
    const first = stats({ salesCount: 1, rawPayload: { fetched_at: "first", median: "1.00" } });
    const sameLogical = stats({ salesCount: 1, rawPayload: { fetched_at: "second", median: "1.00" } });
    const changed = stats({ salesCount: 2, rawPayload: { fetched_at: "second", median: "1.00" } });

    expect(salesStatsContentHash(first)).toBe(salesStatsContentHash(sameLogical));
    expect(salesStatsContentHash(first)).not.toBe(salesStatsContentHash(changed));
  });
});

describe("raw snapshot storage modes", () => {
  it("all stores the raw payload", () => {
    const raw = rawSnapshot({ responseBody: [{ id: 1 }] });

    expect(rawSnapshotResponseBodyForMode(raw, "all")).toEqual([{ id: 1 }]);
  });

  it("metadata_only stores payload metadata instead of the full body", () => {
    const body = Array.from({ length: 10 }, (_, index) => ({ index, name: `Item ${index}` }));
    const stored = rawSnapshotResponseBodyForMode(rawSnapshot({ responseBody: body }), "metadata_only") as Record<
      string,
      unknown
    >;

    expect(stored["payloadHash"]).toEqual(expect.any(String));
    expect(stored["payloadSizeBytes"]).toEqual(expect.any(Number));
    expect(stored["itemCount"]).toBe(10);
    expect(JSON.stringify(stored)).not.toContain("Item 9");
  });

  it("sample_on_failure stores metadata for success and a capped preview for failure", () => {
    const success = rawSnapshotResponseBodyForMode(rawSnapshot({ statusCode: 200, responseBody: [{ id: 1 }] }), "sample_on_failure");
    const failure = rawSnapshotResponseBodyForMode(
      rawSnapshot({ statusCode: 500, responseBody: { message: "x".repeat(1_000) } }),
      "sample_on_failure"
    ) as Record<string, unknown>;

    expect(success).not.toHaveProperty("failurePreview");
    expect(String(failure["failurePreview"])).toHaveLength(500);
  });
});

function listing(overrides: Partial<ConnectorItemListingSnapshot> = {}): ConnectorItemListingSnapshot {
  return {
    marketplace: "skinport",
    externalId: "AK-47 | Redline",
    marketHashName: "AK-47 | Redline (Field-Tested)",
    priceMinor: 100n,
    currency: "USD",
    quantity: 1,
    rawPayload: { observed_at: "ignored", paint_seed: 123 },
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    snapshotIndex: 0,
    ...overrides
  };
}

function stats(overrides: Partial<ConnectorSalesStatsSnapshot> = {}): ConnectorSalesStatsSnapshot {
  return {
    marketplace: "skinport",
    externalId: "AK-47 | Redline",
    marketHashName: "AK-47 | Redline (Field-Tested)",
    currency: "USD",
    salesCount: 1,
    minPriceMinor: 100n,
    maxPriceMinor: 200n,
    avgPriceMinor: 150n,
    rawPayload: {},
    observedAt: new Date("2026-01-01T00:00:00.000Z"),
    snapshotIndex: 0,
    ...overrides
  };
}

function rawSnapshot(overrides: Partial<ConnectorRawSnapshot> = {}): ConnectorRawSnapshot {
  return {
    marketplace: "skinport",
    endpoint: "items",
    requestUrl: "https://api.skinport.com/v1/items",
    paramsHash: "a".repeat(64),
    statusCode: 200,
    responseHeaders: {},
    responseBody: [],
    fetchedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides
  };
}
