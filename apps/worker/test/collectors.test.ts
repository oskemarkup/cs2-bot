import { describe, expect, it } from "vitest";
import { schema } from "@cs2-bot/db";
import { persistMarketplaceCollection } from "../src/collectors.js";
import type { MarketplaceCollectionResult } from "@cs2-bot/connectors";

describe("persistMarketplaceCollection", () => {
  it("uses batch insert path for Skinport listing and sales snapshots", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, {
      marketplace: "skinport",
      collectedAt: new Date("2026-01-01T00:00:00.000Z"),
      rawSnapshots: [
        {
          marketplace: "skinport",
          endpoint: "items",
          requestUrl: "https://api.skinport.com/v1/items",
          paramsHash: "a".repeat(64),
          statusCode: 200,
          responseHeaders: {},
          responseBody: [],
          fetchedAt: new Date("2026-01-01T00:00:00.000Z")
        },
        {
          marketplace: "skinport",
          endpoint: "sales-history",
          requestUrl: "https://api.skinport.com/v1/sales/history",
          paramsHash: "b".repeat(64),
          statusCode: 200,
          responseHeaders: {},
          responseBody: [],
          fetchedAt: new Date("2026-01-01T00:00:01.000Z")
        }
      ],
      rateLimitObservations: [],
      itemListingSnapshots: Array.from({ length: 501 }, (_, index) => ({
        marketplace: "skinport" as const,
        externalId: `item-${index}`,
        marketHashName: `Item ${index}`,
        priceMinor: 100n,
        currency: "USD",
        quantity: null,
        rawPayload: { index },
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        snapshotIndex: 0
      })),
      salesStatsSnapshots: Array.from({ length: 501 }, (_, index) => ({
        marketplace: "skinport" as const,
        externalId: `item-${index}`,
        marketHashName: `Item ${index}`,
        currency: "USD",
        salesCount: 1,
        minPriceMinor: 100n,
        maxPriceMinor: 200n,
        avgPriceMinor: 150n,
        rawPayload: { index },
        observedAt: new Date("2026-01-01T00:00:01.000Z"),
        snapshotIndex: 1
      }))
    } satisfies MarketplaceCollectionResult);

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([
      250,
      250,
      1
    ]);
    expect(insertedRowCounts.filter((entry) => entry.table === "sales_stats_snapshot").map((entry) => entry.rows)).toEqual([
      250,
      250,
      1
    ]);
  });
});

function createFakeDb(insertedRowCounts: Array<{ table: string; rows: number }>) {
  let rawSnapshotId = 0;

  return {
    insert(table: unknown) {
      return {
        values(value: unknown) {
          const rows = Array.isArray(value) ? value : [value];
          const tableName = tableNameFor(table, rows);

          insertedRowCounts.push({ table: tableName, rows: rows.length });

          return {
            onConflictDoUpdate: async () => undefined,
            returning: async () => {
              if (table === schema.collectorRuns) {
                return [{ id: "collector-run-1" }];
              }

              if (table === schema.rawSnapshots) {
                rawSnapshotId += 1;
                return [{ id: `raw-snapshot-${rawSnapshotId}` }];
              }

              return [{ id: "unused" }];
            }
          };
        }
      };
    },
    update(_table: unknown) {
      return {
        set: (_value: unknown) => ({
          where: async () => undefined
        })
      };
    }
  } as Parameters<typeof persistMarketplaceCollection>[0];
}

function tableNameFor(table: unknown, rows: unknown[]): string {
  if (table === schema.itemListingSnapshots) {
    return "item_listing_snapshot";
  }

  if (table === schema.salesStatsSnapshots) {
    return "sales_stats_snapshot";
  }

  if (table === schema.rawSnapshots) {
    return "raw_snapshot";
  }

  if (table === schema.collectorRuns) {
    return "collector_run";
  }

  if (table === schema.marketplaces) {
    return "marketplace";
  }

  const firstRow = rows[0];

  if (firstRow !== null && typeof firstRow === "object" && "quantity" in firstRow) {
    return "item_listing_snapshot";
  }

  if (firstRow !== null && typeof firstRow === "object" && "salesCount" in firstRow) {
    return "sales_stats_snapshot";
  }

  return "unknown";
}
