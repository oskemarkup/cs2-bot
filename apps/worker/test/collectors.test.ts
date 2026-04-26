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

  it("current_and_changes inserts current rows and one history row for a new listing", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneListing({ priceMinor: 100n }), {
      snapshotStorageMode: "current_and_changes",
      rawSnapshotMode: "metadata_only"
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_current").map((entry) => entry.rows)).toEqual([1]);
    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([1]);
  });

  it("current_and_changes skips current update and history for unchanged listing with fresh last_seen_at", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-01T00:00:00.000Z") }), {
      snapshotStorageMode: "current_and_changes",
      logger: testLogger(logs)
    });
    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-01T00:05:00.000Z") }), {
      snapshotStorageMode: "current_and_changes",
      logger: testLogger(logs),
      currentLastSeenUpdateIntervalMinutes: 60
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([1]);
    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_current").map((entry) => entry.rows)).toEqual([1]);
    expect(readCurrentListing(db)?.lastSeenAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(lastSummaryFor(logs, "item_listing_current")).toMatchObject({
      skippedUnchanged: 1,
      seenOnlyUpdated: 0,
      historyInserted: 0
    });
  });

  it("current_and_changes updates only seen timestamps for unchanged listing with stale last_seen_at", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(
      db,
      collectionWithOneListing({
        observedAt: new Date("2026-01-01T00:00:00.000Z"),
        rawPayload: { stable: "original" }
      }),
      {
        snapshotStorageMode: "current_and_changes",
        logger: testLogger(logs)
      }
    );
    await persistMarketplaceCollection(
      db,
      collectionWithOneListing({
        observedAt: new Date("2026-01-01T01:01:00.000Z"),
        rawPayload: { stable: "changed but hash ignores this field" }
      }),
      {
        snapshotStorageMode: "current_and_changes",
        logger: testLogger(logs),
        currentLastSeenUpdateIntervalMinutes: 60
      }
    );

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([1]);
    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_current").map((entry) => entry.rows)).toEqual([1, 1]);
    expect(readCurrentListing(db)?.lastSeenAt).toEqual(new Date("2026-01-01T01:01:00.000Z"));
    expect(readCurrentListing(db)?.rawPayload).toEqual({ stable: "original" });
    expect(lastSummaryFor(logs, "item_listing_current")).toMatchObject({
      skippedUnchanged: 0,
      seenOnlyUpdated: 1,
      historyInserted: 0
    });
  });

  it("current_and_changes preserves every-run last_seen_at updates when interval is 0", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-01T00:00:00.000Z") }), {
      snapshotStorageMode: "current_and_changes"
    });
    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-01T00:05:00.000Z") }), {
      snapshotStorageMode: "current_and_changes",
      currentLastSeenUpdateIntervalMinutes: 0
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_current").map((entry) => entry.rows)).toEqual([1, 1]);
    expect(readCurrentListing(db)?.lastSeenAt).toEqual(new Date("2026-01-01T00:05:00.000Z"));
  });

  it("current_and_changes inserts history when listing content changes", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneListing({ priceMinor: 100n }), {
      snapshotStorageMode: "current_and_changes"
    });
    await persistMarketplaceCollection(db, collectionWithOneListing({ priceMinor: 101n }), {
      snapshotStorageMode: "current_and_changes"
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([
      1,
      1
    ]);
    expect(readCurrentListing(db)?.priceMinor).toBe(101n);
  });

  it("current_and_changes inserts periodic forced history without changing last_changed_at", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-01T00:00:00.000Z") }), {
      snapshotStorageMode: "current_and_changes",
      forceFullHistoryEveryHours: 24
    });
    await persistMarketplaceCollection(db, collectionWithOneListing({ observedAt: new Date("2026-01-02T01:00:00.000Z") }), {
      snapshotStorageMode: "current_and_changes",
      forceFullHistoryEveryHours: 24,
      currentLastSeenUpdateIntervalMinutes: 10_000
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "item_listing_snapshot").map((entry) => entry.rows)).toEqual([
      1,
      1
    ]);
    expect(readCurrentListing(db)?.lastChangedAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(readCurrentListing(db)?.lastSeenAt).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(readCurrentListing(db)?.lastHistoryAt).toEqual(new Date("2026-01-02T01:00:00.000Z"));
  });

  it("current_and_changes applies the same new/unchanged/changed behavior to sales stats", async () => {
    const insertedRowCounts: Array<{ table: string; rows: number }> = [];
    const db = createFakeDb(insertedRowCounts);

    await persistMarketplaceCollection(db, collectionWithOneSalesStat({ salesCount: 1 }), {
      snapshotStorageMode: "current_and_changes"
    });
    await persistMarketplaceCollection(db, collectionWithOneSalesStat({ salesCount: 1 }), {
      snapshotStorageMode: "current_and_changes"
    });
    await persistMarketplaceCollection(db, collectionWithOneSalesStat({ salesCount: 2 }), {
      snapshotStorageMode: "current_and_changes"
    });

    expect(insertedRowCounts.filter((entry) => entry.table === "sales_stats_snapshot").map((entry) => entry.rows)).toEqual([
      1,
      1
    ]);
    expect(readCurrentSalesStats(db)?.salesCount).toBe(2);
  });
});

function createFakeDb(insertedRowCounts: Array<{ table: string; rows: number }>) {
  let rawSnapshotId = 0;
  const itemListingCurrentRows: Array<typeof schema.itemListingCurrent.$inferSelect> = [];
  const salesStatsCurrentRows: Array<typeof schema.salesStatsCurrent.$inferSelect> = [];

  return {
    __itemListingCurrentRows: itemListingCurrentRows,
    __salesStatsCurrentRows: salesStatsCurrentRows,
    select(_fields: unknown) {
      return {
        from(table: unknown) {
          return {
            where: async () => {
              if (table === schema.itemListingCurrent) {
                return itemListingCurrentRows;
              }

              if (table === schema.salesStatsCurrent) {
                return salesStatsCurrentRows;
              }

              return itemListingCurrentRows.length > 0 ? itemListingCurrentRows : salesStatsCurrentRows;
            }
          };
        }
      };
    },
    insert(table: unknown) {
      return {
        values(value: unknown) {
          const rows = Array.isArray(value) ? value : [value];
          const tableName = tableNameFor(table, rows);

          insertedRowCounts.push({ table: tableName, rows: rows.length });

          return {
            onConflictDoUpdate: async () => {
              if (tableName === "item_listing_current") {
                upsertCurrentRows(itemListingCurrentRows, rows);
              }

              if (tableName === "sales_stats_current") {
                upsertCurrentRows(salesStatsCurrentRows, rows);
              }
            },
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
  } as Parameters<typeof persistMarketplaceCollection>[0] & {
    __itemListingCurrentRows: Array<typeof schema.itemListingCurrent.$inferSelect>;
    __salesStatsCurrentRows: Array<typeof schema.salesStatsCurrent.$inferSelect>;
  };
}

function tableNameFor(table: unknown, rows: unknown[]): string {
  const firstRow = rows[0];

  if (firstRow !== null && typeof firstRow === "object" && "identityKey" in firstRow) {
    if ("priceMinor" in firstRow) {
      return "item_listing_current";
    }

    return "sales_stats_current";
  }

  if (table === schema.itemListingCurrent) {
    return "item_listing_current";
  }

  if (table === schema.salesStatsCurrent) {
    return "sales_stats_current";
  }

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

  if (firstRow !== null && typeof firstRow === "object" && "quantity" in firstRow) {
    return "item_listing_snapshot";
  }

  if (firstRow !== null && typeof firstRow === "object" && "salesCount" in firstRow) {
    return "sales_stats_snapshot";
  }

  return "unknown";
}

function upsertCurrentRows<T extends { identityKey: string; contentHash: string }>(target: T[], rows: unknown[]): void {
  for (const row of rows as T[]) {
    const index = target.findIndex((existing) => existing.identityKey === row.identityKey);

    if (index === -1) {
      target.push(row);
      continue;
    }

    const existing = target[index];

    if (existing === undefined) {
      continue;
    }

    target[index] =
      existing.contentHash === row.contentHash
        ? { ...existing, lastSeenAt: row["lastSeenAt"], lastHistoryAt: row["lastHistoryAt"], updatedAt: row["updatedAt"] }
        : { ...existing, ...row, firstSeenAt: row["firstSeenAt"] ?? existing["firstSeenAt"] };
  }
}

function readCurrentListing(
  db: ReturnType<typeof createFakeDb>
): (typeof schema.itemListingCurrent.$inferSelect) | undefined {
  return db.__itemListingCurrentRows[0];
}

function readCurrentSalesStats(
  db: ReturnType<typeof createFakeDb>
): (typeof schema.salesStatsCurrent.$inferSelect) | undefined {
  return db.__salesStatsCurrentRows[0];
}

function testLogger(logs: Array<{ payload: Record<string, unknown>; message: string }>) {
  return {
    info: (payload: Record<string, unknown>, message: string) => logs.push({ payload, message }),
    warn: (payload: Record<string, unknown>, message: string) => logs.push({ payload, message }),
    debug: (payload: Record<string, unknown>, message: string) => logs.push({ payload, message }),
    error: (payload: Record<string, unknown>, message: string) => logs.push({ payload, message })
  };
}

function lastSummaryFor(
  logs: Array<{ payload: Record<string, unknown>; message: string }>,
  table: string
): Record<string, unknown> | undefined {
  return logs
    .filter((log) => log.message === "current snapshot write summary" && log.payload["table"] === table)
    .at(-1)?.payload;
}

function collectionWithOneListing(
  overrides: Partial<MarketplaceCollectionResult["itemListingSnapshots"][number]> = {}
): MarketplaceCollectionResult {
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T00:00:00.000Z");

  return {
    marketplace: "skinport",
    collectedAt: observedAt,
    rawSnapshots: [
      {
        marketplace: "skinport",
        endpoint: "items",
        requestUrl: "https://api.skinport.com/v1/items",
        paramsHash: "a".repeat(64),
        statusCode: 200,
        responseHeaders: {},
        responseBody: [{ item: "AK-47" }],
        fetchedAt: observedAt
      }
    ],
    rateLimitObservations: [],
    itemListingSnapshots: [
      {
        marketplace: "skinport",
        externalId: "ak-redline",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        priceMinor: 100n,
        currency: "USD",
        quantity: 1,
        rawPayload: { market_hash_name: "AK-47 | Redline (Field-Tested)" },
        observedAt,
        snapshotIndex: 0,
        ...overrides
      }
    ],
    salesStatsSnapshots: []
  };
}

function collectionWithOneSalesStat(
  overrides: Partial<MarketplaceCollectionResult["salesStatsSnapshots"][number]> = {}
): MarketplaceCollectionResult {
  const observedAt = overrides.observedAt ?? new Date("2026-01-01T00:00:00.000Z");

  return {
    marketplace: "skinport",
    collectedAt: observedAt,
    rawSnapshots: [
      {
        marketplace: "skinport",
        endpoint: "sales-history",
        requestUrl: "https://api.skinport.com/v1/sales/history",
        paramsHash: "b".repeat(64),
        statusCode: 200,
        responseHeaders: {},
        responseBody: [{ item: "AK-47" }],
        fetchedAt: observedAt
      }
    ],
    rateLimitObservations: [],
    itemListingSnapshots: [],
    salesStatsSnapshots: [
      {
        marketplace: "skinport",
        externalId: "ak-redline",
        marketHashName: "AK-47 | Redline (Field-Tested)",
        currency: "USD",
        salesCount: 1,
        minPriceMinor: 100n,
        maxPriceMinor: 200n,
        avgPriceMinor: 150n,
        rawPayload: { median: 150 },
        observedAt,
        snapshotIndex: 0,
        ...overrides
      }
    ]
  };
}
