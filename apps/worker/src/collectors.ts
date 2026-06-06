import { loadConfig, type AppConfig } from "@cs2-bot/config";
import {
  type ConnectorItemListingSnapshot,
  type ConnectorLogger,
  type ConnectorSalesStatsSnapshot,
  createConnectorRateLimiters,
  MarketplaceHttpError,
  MarketCsgoConnector,
  type Marketplace,
  type MarketplaceCollectionResult,
  type MarketplaceConnector
} from "@cs2-bot/connectors";
import { createLogger } from "@cs2-bot/core";
import { and, BatchInsertError, createDb, eq, inArray, insertInBatches, schema, sql } from "@cs2-bot/db";
import {
  itemListingContentHash,
  itemListingIdentityKey,
  rawSnapshotResponseBodyForMode,
  salesStatsContentHash,
  salesStatsIdentityKey
} from "./storage.js";

interface CollectorCliOptions {
  readonly marketplace: Extract<Marketplace, "market_csgo">;
  readonly config?: AppConfig;
}

export async function runCollectorCli(options: CollectorCliOptions): Promise<void> {
  const config = options.config ?? loadConfig();
  const logger = createLogger({ level: config.LOG_LEVEL });
  const { db, pool } = createDb(config.DATABASE_URL);
  const limiters = createConnectorRateLimiters();
  const connector = createConnector(options.marketplace, limiters, logger);
  let collectorRunId: string | null = null;

  try {
    logger.info({ marketplace: connector.marketplace }, "collector run started");
    collectorRunId = await startCollectorRun(db, connector.marketplace, new Date());
    const collection = await connector.collect();
    collectorRunId = await persistMarketplaceCollection(db, collection, {
      collectorRunId,
      logger,
      batchSize: config.DB_INSERT_BATCH_SIZE,
      snapshotStorageMode: config.SNAPSHOT_STORAGE_MODE,
      rawSnapshotMode: config.RAW_SNAPSHOT_MODE,
      forceFullHistoryEveryHours: config.FORCE_FULL_HISTORY_EVERY_HOURS,
      currentLastSeenUpdateIntervalMinutes: config.CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES
    });

    logger.info(
      {
        marketplace: connector.marketplace,
        collectorRunId,
        rawSnapshots: collection.rawSnapshots.length,
        listingSnapshots: collection.itemListingSnapshots.length,
        salesStatsSnapshots: collection.salesStatsSnapshots.length
      },
      "collector run succeeded"
    );
  } catch (error) {
    if (collectorRunId !== null) {
      if (config.RAW_SNAPSHOT_MODE === "sample_on_failure") {
        await persistFailureRawSnapshot(db, collectorRunId, connector.marketplace, error);
      }

      await markCollectorRunFailed(db, collectorRunId, error);
    }

    logger.error({ marketplace: connector.marketplace, collectorRunId, err: error }, "collector run failed");
    throw error;
  } finally {
    await pool.end();
  }
}

function createConnector(
  marketplace: Extract<Marketplace, "market_csgo">,
  limiters: ReturnType<typeof createConnectorRateLimiters>,
  logger?: ConnectorLogger
): MarketplaceConnector {
  return new MarketCsgoConnector({ limiter: limiters[marketplace], logger });
}

interface PersistMarketplaceCollectionOptions {
  readonly collectorRunId?: string | undefined;
  readonly logger?: ConnectorLogger & {
    debug?(payload: Record<string, unknown>, message: string): void;
    error(payload: Record<string, unknown>, message: string): void;
  } | undefined;
  readonly batchSize?: number | undefined;
  readonly snapshotStorageMode?: AppConfig["SNAPSHOT_STORAGE_MODE"] | undefined;
  readonly rawSnapshotMode?: AppConfig["RAW_SNAPSHOT_MODE"] | undefined;
  readonly forceFullHistoryEveryHours?: number | undefined;
  readonly currentLastSeenUpdateIntervalMinutes?: number | undefined;
}

export async function persistMarketplaceCollection(
  db: ReturnType<typeof createDb>["db"],
  collection: MarketplaceCollectionResult,
  options: PersistMarketplaceCollectionOptions = {}
): Promise<string> {
  const collectorRunId =
    options.collectorRunId ?? (await startCollectorRun(db, collection.marketplace, collection.collectedAt));
  const snapshotStorageMode = options.snapshotStorageMode ?? "full";
  const rawSnapshotMode = options.rawSnapshotMode ?? "all";
  const forceFullHistoryEveryHours = options.forceFullHistoryEveryHours ?? 24;
  const currentLastSeenUpdateIntervalMinutes = options.currentLastSeenUpdateIntervalMinutes ?? 60;

  try {
    const rawSnapshotIds: string[] = [];

    for (const snapshot of collection.rawSnapshots) {
      const [rawSnapshot] = await db
        .insert(schema.rawSnapshots)
        .values({
          collectorRunId,
          marketplace: snapshot.marketplace,
          endpoint: snapshot.endpoint,
          requestUrl: snapshot.requestUrl,
          paramsHash: snapshot.paramsHash,
          statusCode: snapshot.statusCode,
          responseHeaders: snapshot.responseHeaders,
          responseBody: rawSnapshotResponseBodyForMode(snapshot, rawSnapshotMode),
          fetchedAt: snapshot.fetchedAt
        })
        .returning({ id: schema.rawSnapshots.id });

      if (rawSnapshot === undefined) {
        throw new Error(`Failed to create raw snapshot for ${snapshot.endpoint}`);
      }

      rawSnapshotIds.push(rawSnapshot.id);
    }

    if (collection.rateLimitObservations.length > 0) {
      await db.insert(schema.apiRateLimitObservations).values(
        collection.rateLimitObservations.map((observation) => ({
          collectorRunId,
          rawSnapshotId: rawSnapshotIds[observation.snapshotIndex] ?? null,
          marketplace: observation.marketplace,
          endpoint: observation.endpoint,
          limit: observation.limit,
          remaining: observation.remaining,
          resetAt: observation.resetAt,
          retryAfterSeconds: observation.retryAfterSeconds,
          responseHeaders: observation.responseHeaders,
          observedAt: observation.observedAt
        }))
      );
    }

    if (snapshotStorageMode === "full") {
      await persistFullSnapshots(db, collection, {
        collectorRunId,
        rawSnapshotIds,
        batchSize: options.batchSize,
        logger: options.logger
      });
    } else {
      await persistCurrentAndChanges(db, collection, {
        collectorRunId,
        rawSnapshotIds,
        batchSize: options.batchSize,
        logger: options.logger,
        marketplace: collection.marketplace,
        forceFullHistoryEveryHours,
        currentLastSeenUpdateIntervalMinutes
      });
    }

    await db
      .update(schema.collectorRuns)
      .set({ status: "succeeded", finishedAt: new Date() })
      .where(eq(schema.collectorRuns.id, collectorRunId));

    return collectorRunId;
  } catch (error) {
    await markCollectorRunFailed(db, collectorRunId, error);
    throw error;
  }
}

interface PersistSnapshotRowsOptions {
  readonly collectorRunId: string;
  readonly rawSnapshotIds: readonly string[];
  readonly logger?: PersistMarketplaceCollectionOptions["logger"];
  readonly batchSize?: number | undefined;
}

interface PersistCurrentAndChangesOptions extends PersistSnapshotRowsOptions {
  readonly marketplace: Marketplace;
  readonly forceFullHistoryEveryHours: number;
  readonly currentLastSeenUpdateIntervalMinutes: number;
}

type ItemListingSnapshotRow = typeof schema.itemListingSnapshots.$inferInsert;
type SalesStatsSnapshotRow = typeof schema.salesStatsSnapshots.$inferInsert;
type ItemListingCurrentRow = typeof schema.itemListingCurrent.$inferInsert;
type SalesStatsCurrentRow = typeof schema.salesStatsCurrent.$inferInsert;
type CurrentWriteSummary = {
  readonly marketplace: Marketplace;
  readonly table: "item_listing_current" | "sales_stats_current";
  readonly totalRows: number;
  inserted: number;
  changed: number;
  seenOnlyUpdated: number;
  skippedUnchanged: number;
  historyInserted: number;
  periodicHistoryInserted: number;
};

async function persistFullSnapshots(
  db: ReturnType<typeof createDb>["db"],
  collection: MarketplaceCollectionResult,
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertItemListingHistoryRows(db, itemListingHistoryRows(collection.itemListingSnapshots, options), options);
  await insertSalesStatsHistoryRows(db, salesStatsHistoryRows(collection.salesStatsSnapshots, options), options);
}

async function persistCurrentAndChanges(
  db: ReturnType<typeof createDb>["db"],
  collection: MarketplaceCollectionResult,
  options: PersistCurrentAndChangesOptions
): Promise<void> {
  await persistItemListingCurrentAndChanges(db, collection.itemListingSnapshots, options);
  await persistSalesStatsCurrentAndChanges(db, collection.salesStatsSnapshots, options);
}

async function persistItemListingCurrentAndChanges(
  db: ReturnType<typeof createDb>["db"],
  snapshots: readonly ConnectorItemListingSnapshot[],
  options: PersistCurrentAndChangesOptions
): Promise<void> {
  const preparedRows = latestByIdentity(
    snapshots.map((snapshot) => {
      const identityKey = itemListingIdentityKey(snapshot);
      const contentHash = itemListingContentHash(snapshot);

      return {
        identityKey,
        contentHash,
        snapshot,
        historyRow: itemListingHistoryRow(snapshot, options),
        currentRow: itemListingCurrentRow(snapshot, identityKey, contentHash)
      };
    })
  );
  const upsertCurrentRows: ItemListingCurrentRow[] = [];
  const seenOnlyCurrentRows: ItemListingCurrentRow[] = [];
  const historyRows: ItemListingSnapshotRow[] = [];
  const summary: CurrentWriteSummary = emptyCurrentWriteSummary({
    marketplace: options.marketplace,
    table: "item_listing_current",
    totalRows: preparedRows.length
  });

  for (const batch of chunk(preparedRows, options.batchSize ?? 250)) {
    const existingRows = await db
      .select({
        identityKey: schema.itemListingCurrent.identityKey,
        contentHash: schema.itemListingCurrent.contentHash,
        lastSeenAt: schema.itemListingCurrent.lastSeenAt,
        lastChangedAt: schema.itemListingCurrent.lastChangedAt,
        lastHistoryAt: schema.itemListingCurrent.lastHistoryAt
      })
      .from(schema.itemListingCurrent)
      .where(
        and(
          eq(schema.itemListingCurrent.marketplace, batch[0]?.snapshot.marketplace ?? "skinport"),
          inArray(
            schema.itemListingCurrent.identityKey,
            batch.map((row) => row.identityKey)
          )
        )
      );
    const existingByIdentity = new Map(existingRows.map((row) => [row.identityKey, row]));

    for (const row of batch) {
      const existing = existingByIdentity.get(row.identityKey);

      if (existing === undefined) {
        summary.inserted += 1;
        summary.historyInserted += 1;
        upsertCurrentRows.push(row.currentRow);
        historyRows.push(row.historyRow);
        continue;
      }

      const changed = existing.contentHash !== row.contentHash;
      const periodicHistory = !changed && shouldForceHistory(row.snapshot.observedAt, existing.lastHistoryAt, options.forceFullHistoryEveryHours);
      const staleLastSeen = shouldUpdateLastSeen(
        row.snapshot.observedAt,
        existing.lastSeenAt,
        options.currentLastSeenUpdateIntervalMinutes
      );

      if (changed) {
        summary.changed += 1;
        summary.historyInserted += 1;
        upsertCurrentRows.push({
          ...row.currentRow,
          lastHistoryAt: row.snapshot.observedAt
        });
        historyRows.push(row.historyRow);
        continue;
      }

      if (periodicHistory) {
        summary.periodicHistoryInserted += 1;
        summary.historyInserted += 1;
        historyRows.push(row.historyRow);
      }

      if (staleLastSeen || periodicHistory) {
        if (staleLastSeen) {
          summary.seenOnlyUpdated += 1;
        } else {
          summary.skippedUnchanged += 1;
        }

        seenOnlyCurrentRows.push({
          ...row.currentRow,
          lastSeenAt: staleLastSeen ? row.snapshot.observedAt : existing.lastSeenAt,
          lastChangedAt: existing.lastChangedAt,
          lastHistoryAt: periodicHistory ? row.snapshot.observedAt : existing.lastHistoryAt
        });
      } else {
        summary.skippedUnchanged += 1;
      }
    }
  }

  await insertItemListingHistoryRows(db, historyRows, options);
  await upsertItemListingCurrentRows(db, upsertCurrentRows, options);
  await touchUnchangedItemListingCurrentRows(db, seenOnlyCurrentRows, options);
  logCurrentWriteSummary(options.logger, summary);
}

async function persistSalesStatsCurrentAndChanges(
  db: ReturnType<typeof createDb>["db"],
  snapshots: readonly ConnectorSalesStatsSnapshot[],
  options: PersistCurrentAndChangesOptions
): Promise<void> {
  const preparedRows = latestByIdentity(
    snapshots.map((snapshot) => {
      const identityKey = salesStatsIdentityKey(snapshot);
      const contentHash = salesStatsContentHash(snapshot);

      return {
        identityKey,
        contentHash,
        snapshot,
        historyRow: salesStatsHistoryRow(snapshot, options),
        currentRow: salesStatsCurrentRow(snapshot, identityKey, contentHash)
      };
    })
  );
  const upsertCurrentRows: SalesStatsCurrentRow[] = [];
  const seenOnlyCurrentRows: SalesStatsCurrentRow[] = [];
  const historyRows: SalesStatsSnapshotRow[] = [];
  const summary: CurrentWriteSummary = emptyCurrentWriteSummary({
    marketplace: options.marketplace,
    table: "sales_stats_current",
    totalRows: preparedRows.length
  });

  for (const batch of chunk(preparedRows, options.batchSize ?? 250)) {
    const existingRows = await db
      .select({
        identityKey: schema.salesStatsCurrent.identityKey,
        contentHash: schema.salesStatsCurrent.contentHash,
        lastSeenAt: schema.salesStatsCurrent.lastSeenAt,
        lastChangedAt: schema.salesStatsCurrent.lastChangedAt,
        lastHistoryAt: schema.salesStatsCurrent.lastHistoryAt
      })
      .from(schema.salesStatsCurrent)
      .where(
        and(
          eq(schema.salesStatsCurrent.marketplace, batch[0]?.snapshot.marketplace ?? "skinport"),
          inArray(
            schema.salesStatsCurrent.identityKey,
            batch.map((row) => row.identityKey)
          )
        )
      );
    const existingByIdentity = new Map(existingRows.map((row) => [row.identityKey, row]));

    for (const row of batch) {
      const existing = existingByIdentity.get(row.identityKey);

      if (existing === undefined) {
        summary.inserted += 1;
        summary.historyInserted += 1;
        upsertCurrentRows.push(row.currentRow);
        historyRows.push(row.historyRow);
        continue;
      }

      const changed = existing.contentHash !== row.contentHash;
      const periodicHistory = !changed && shouldForceHistory(row.snapshot.observedAt, existing.lastHistoryAt, options.forceFullHistoryEveryHours);
      const staleLastSeen = shouldUpdateLastSeen(
        row.snapshot.observedAt,
        existing.lastSeenAt,
        options.currentLastSeenUpdateIntervalMinutes
      );

      if (changed) {
        summary.changed += 1;
        summary.historyInserted += 1;
        upsertCurrentRows.push({
          ...row.currentRow,
          lastHistoryAt: row.snapshot.observedAt
        });
        historyRows.push(row.historyRow);
        continue;
      }

      if (periodicHistory) {
        summary.periodicHistoryInserted += 1;
        summary.historyInserted += 1;
        historyRows.push(row.historyRow);
      }

      if (staleLastSeen || periodicHistory) {
        if (staleLastSeen) {
          summary.seenOnlyUpdated += 1;
        } else {
          summary.skippedUnchanged += 1;
        }

        seenOnlyCurrentRows.push({
          ...row.currentRow,
          lastSeenAt: staleLastSeen ? row.snapshot.observedAt : existing.lastSeenAt,
          lastChangedAt: existing.lastChangedAt,
          lastHistoryAt: periodicHistory ? row.snapshot.observedAt : existing.lastHistoryAt
        });
      } else {
        summary.skippedUnchanged += 1;
      }
    }
  }

  await insertSalesStatsHistoryRows(db, historyRows, options);
  await upsertSalesStatsCurrentRows(db, upsertCurrentRows, options);
  await touchUnchangedSalesStatsCurrentRows(db, seenOnlyCurrentRows, options);
  logCurrentWriteSummary(options.logger, summary);
}

async function upsertItemListingCurrentRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly ItemListingCurrentRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "item_listing_current",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db
        .insert(schema.itemListingCurrent)
        .values([...batch])
        .onConflictDoUpdate({
          target: [schema.itemListingCurrent.marketplace, schema.itemListingCurrent.identityKey],
          set: {
            externalId: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.external_id else ${schema.itemListingCurrent.externalId} end`,
            marketHashName: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.market_hash_name else ${schema.itemListingCurrent.marketHashName} end`,
            priceMinor: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.price_minor else ${schema.itemListingCurrent.priceMinor} end`,
            currency: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.currency else ${schema.itemListingCurrent.currency} end`,
            quantity: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.quantity else ${schema.itemListingCurrent.quantity} end`,
            rawPayload: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.raw_payload else ${schema.itemListingCurrent.rawPayload} end`,
            contentHash: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.content_hash else ${schema.itemListingCurrent.contentHash} end`,
            lastSeenAt: sql`excluded.last_seen_at`,
            lastChangedAt: sql`case when ${schema.itemListingCurrent.contentHash} <> excluded.content_hash then excluded.last_changed_at else ${schema.itemListingCurrent.lastChangedAt} end`,
            lastHistoryAt: sql`greatest(${schema.itemListingCurrent.lastHistoryAt}, excluded.last_history_at)`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }
  });
}

async function upsertSalesStatsCurrentRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly SalesStatsCurrentRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "sales_stats_current",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db
        .insert(schema.salesStatsCurrent)
        .values([...batch])
        .onConflictDoUpdate({
          target: [schema.salesStatsCurrent.marketplace, schema.salesStatsCurrent.identityKey],
          set: {
            marketHashName: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.market_hash_name else ${schema.salesStatsCurrent.marketHashName} end`,
            currency: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.currency else ${schema.salesStatsCurrent.currency} end`,
            salesCount: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.sales_count else ${schema.salesStatsCurrent.salesCount} end`,
            minPriceMinor: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.min_price_minor else ${schema.salesStatsCurrent.minPriceMinor} end`,
            maxPriceMinor: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.max_price_minor else ${schema.salesStatsCurrent.maxPriceMinor} end`,
            avgPriceMinor: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.avg_price_minor else ${schema.salesStatsCurrent.avgPriceMinor} end`,
            rawPayload: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.raw_payload else ${schema.salesStatsCurrent.rawPayload} end`,
            contentHash: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.content_hash else ${schema.salesStatsCurrent.contentHash} end`,
            lastSeenAt: sql`excluded.last_seen_at`,
            lastChangedAt: sql`case when ${schema.salesStatsCurrent.contentHash} <> excluded.content_hash then excluded.last_changed_at else ${schema.salesStatsCurrent.lastChangedAt} end`,
            lastHistoryAt: sql`greatest(${schema.salesStatsCurrent.lastHistoryAt}, excluded.last_history_at)`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }
  });
}

async function touchUnchangedItemListingCurrentRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly ItemListingCurrentRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "item_listing_current",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db
        .insert(schema.itemListingCurrent)
        .values([...batch])
        .onConflictDoUpdate({
          target: [schema.itemListingCurrent.marketplace, schema.itemListingCurrent.identityKey],
          set: {
            lastSeenAt: sql`excluded.last_seen_at`,
            lastHistoryAt: sql`greatest(${schema.itemListingCurrent.lastHistoryAt}, excluded.last_history_at)`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }
  });
}

async function touchUnchangedSalesStatsCurrentRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly SalesStatsCurrentRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "sales_stats_current",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db
        .insert(schema.salesStatsCurrent)
        .values([...batch])
        .onConflictDoUpdate({
          target: [schema.salesStatsCurrent.marketplace, schema.salesStatsCurrent.identityKey],
          set: {
            lastSeenAt: sql`excluded.last_seen_at`,
            lastHistoryAt: sql`greatest(${schema.salesStatsCurrent.lastHistoryAt}, excluded.last_history_at)`,
            updatedAt: sql`excluded.updated_at`
          }
        });
    }
  });
}

async function insertItemListingHistoryRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly ItemListingSnapshotRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "item_listing_snapshot",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db.insert(schema.itemListingSnapshots).values([...batch]);
    }
  });
}

async function insertSalesStatsHistoryRows(
  db: ReturnType<typeof createDb>["db"],
  rows: readonly SalesStatsSnapshotRow[],
  options: PersistSnapshotRowsOptions
): Promise<void> {
  await insertInBatches({
    table: "sales_stats_snapshot",
    rows,
    batchSize: options.batchSize,
    logger: options.logger,
    insertRows: async (batch) => {
      await db.insert(schema.salesStatsSnapshots).values([...batch]);
    }
  });
}

function itemListingHistoryRows(
  snapshots: readonly ConnectorItemListingSnapshot[],
  options: PersistSnapshotRowsOptions
): ItemListingSnapshotRow[] {
  return snapshots.map((snapshot) => itemListingHistoryRow(snapshot, options));
}

function itemListingHistoryRow(
  snapshot: ConnectorItemListingSnapshot,
  options: PersistSnapshotRowsOptions
): ItemListingSnapshotRow {
  return {
    collectorRunId: options.collectorRunId,
    rawSnapshotId: options.rawSnapshotIds[snapshot.snapshotIndex] ?? null,
    marketplace: snapshot.marketplace,
    externalId: snapshot.externalId,
    marketHashName: snapshot.marketHashName,
    priceMinor: snapshot.priceMinor,
    currency: snapshot.currency,
    quantity: snapshot.quantity,
    rawPayload: snapshot.rawPayload,
    observedAt: snapshot.observedAt
  };
}

function salesStatsHistoryRows(
  snapshots: readonly ConnectorSalesStatsSnapshot[],
  options: PersistSnapshotRowsOptions
): SalesStatsSnapshotRow[] {
  return snapshots.map((snapshot) => salesStatsHistoryRow(snapshot, options));
}

function salesStatsHistoryRow(
  snapshot: ConnectorSalesStatsSnapshot,
  options: PersistSnapshotRowsOptions
): SalesStatsSnapshotRow {
  return {
    collectorRunId: options.collectorRunId,
    rawSnapshotId: options.rawSnapshotIds[snapshot.snapshotIndex] ?? null,
    marketplace: snapshot.marketplace,
    externalId: snapshot.externalId,
    marketHashName: snapshot.marketHashName,
    currency: snapshot.currency,
    salesCount: snapshot.salesCount,
    minPriceMinor: snapshot.minPriceMinor,
    maxPriceMinor: snapshot.maxPriceMinor,
    avgPriceMinor: snapshot.avgPriceMinor,
    rawPayload: snapshot.rawPayload,
    observedAt: snapshot.observedAt
  };
}

function itemListingCurrentRow(
  snapshot: ConnectorItemListingSnapshot,
  identityKey: string,
  contentHash: string
): ItemListingCurrentRow {
  return {
    marketplace: snapshot.marketplace,
    identityKey,
    externalId: snapshot.externalId,
    marketHashName: snapshot.marketHashName,
    priceMinor: snapshot.priceMinor,
    currency: snapshot.currency,
    quantity: snapshot.quantity,
    rawPayload: snapshot.rawPayload,
    contentHash,
    firstSeenAt: snapshot.observedAt,
    lastSeenAt: snapshot.observedAt,
    lastChangedAt: snapshot.observedAt,
    lastHistoryAt: snapshot.observedAt,
    updatedAt: new Date()
  };
}

function salesStatsCurrentRow(
  snapshot: ConnectorSalesStatsSnapshot,
  identityKey: string,
  contentHash: string
): SalesStatsCurrentRow {
  return {
    marketplace: snapshot.marketplace,
    identityKey,
    marketHashName: snapshot.marketHashName,
    currency: snapshot.currency,
    salesCount: snapshot.salesCount,
    minPriceMinor: snapshot.minPriceMinor,
    maxPriceMinor: snapshot.maxPriceMinor,
    avgPriceMinor: snapshot.avgPriceMinor,
    rawPayload: snapshot.rawPayload,
    contentHash,
    firstSeenAt: snapshot.observedAt,
    lastSeenAt: snapshot.observedAt,
    lastChangedAt: snapshot.observedAt,
    lastHistoryAt: snapshot.observedAt,
    updatedAt: new Date()
  };
}

function latestByIdentity<T extends { readonly identityKey: string; readonly snapshot: { readonly observedAt: Date } }>(
  rows: readonly T[]
): T[] {
  const byIdentity = new Map<string, T>();

  for (const row of rows) {
    const existing = byIdentity.get(row.identityKey);

    if (existing === undefined || existing.snapshot.observedAt <= row.snapshot.observedAt) {
      byIdentity.set(row.identityKey, row);
    }
  }

  return [...byIdentity.values()];
}

function shouldForceHistory(observedAt: Date, lastHistoryAt: Date, forceFullHistoryEveryHours: number): boolean {
  return observedAt.getTime() - lastHistoryAt.getTime() >= forceFullHistoryEveryHours * 60 * 60 * 1_000;
}

function shouldUpdateLastSeen(observedAt: Date, lastSeenAt: Date, intervalMinutes: number): boolean {
  if (intervalMinutes === 0) {
    return true;
  }

  return observedAt.getTime() - lastSeenAt.getTime() >= intervalMinutes * 60 * 1_000;
}

function emptyCurrentWriteSummary(input: {
  readonly marketplace: Marketplace;
  readonly table: CurrentWriteSummary["table"];
  readonly totalRows: number;
}): CurrentWriteSummary {
  return {
    marketplace: input.marketplace,
    table: input.table,
    totalRows: input.totalRows,
    inserted: 0,
    changed: 0,
    seenOnlyUpdated: 0,
    skippedUnchanged: 0,
    historyInserted: 0,
    periodicHistoryInserted: 0
  };
}

function logCurrentWriteSummary(
  logger: PersistMarketplaceCollectionOptions["logger"],
  summary: CurrentWriteSummary
): void {
  logger?.info({ ...summary }, "current snapshot write summary");
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function persistFailureRawSnapshot(
  db: ReturnType<typeof createDb>["db"],
  collectorRunId: string,
  marketplace: Marketplace,
  error: unknown
): Promise<void> {
  const fetchedAt = new Date();
  const endpoint = error instanceof MarketplaceHttpError ? error.endpoint : "unknown";
  const statusCode = error instanceof MarketplaceHttpError && error.status !== null ? error.status : 0;
  const responsePreview = error instanceof MarketplaceHttpError ? error.responsePreview : null;

  await db.insert(schema.rawSnapshots).values({
    collectorRunId,
    marketplace,
    endpoint,
    requestUrl: "unavailable",
    paramsHash: "0".repeat(64),
    statusCode,
    responseHeaders: {},
    responseBody: {
      storageMode: "sample_on_failure",
      marketplace,
      endpoint,
      fetchedAt: fetchedAt.toISOString(),
      statusCode,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? truncate(error.message, 500) : "Unknown collector failure",
      errorCode: error instanceof MarketplaceHttpError ? error.code : null,
      failurePreview: responsePreview === null ? null : truncate(responsePreview, 500)
    },
    fetchedAt
  });
}

async function startCollectorRun(
  db: ReturnType<typeof createDb>["db"],
  marketplace: Marketplace,
  startedAt: Date
): Promise<string> {
  const seed = marketplaceSeed(marketplace);

  await db
    .insert(schema.marketplaces)
    .values(seed)
    .onConflictDoUpdate({
      target: schema.marketplaces.code,
      set: {
        displayName: seed.displayName,
        baseUrl: seed.baseUrl,
        updatedAt: new Date()
      }
    });

  const [collectorRun] = await db
    .insert(schema.collectorRuns)
    .values({
      marketplace,
      status: "running",
      startedAt
    })
    .returning({ id: schema.collectorRuns.id });

  if (collectorRun === undefined) {
    throw new Error("Failed to create collector run");
  }

  return collectorRun.id;
}

async function markCollectorRunFailed(
  db: ReturnType<typeof createDb>["db"],
  collectorRunId: string,
  error: unknown
): Promise<void> {
  await db
    .update(schema.collectorRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      errorMessage: errorMessageForCollectorRun(error)
    })
    .where(eq(schema.collectorRuns.id, collectorRunId));
}

function errorMessageForCollectorRun(error: unknown): string {
  if (error instanceof MarketplaceHttpError) {
    return truncate(
      JSON.stringify({
        marketplace: error.marketplace,
        endpoint: error.endpoint,
        status: error.status,
        code: error.code,
        message: error.message
      }),
      2_000
    );
  }

  if (error instanceof BatchInsertError) {
    return truncate(
      JSON.stringify({
        table: error.table,
        batchIndex: error.batchIndex,
        batchRows: error.batchRows,
        message: error.message
      }),
      2_000
    );
  }

  return truncate(error instanceof Error ? error.message : "Unknown collector failure", 2_000);
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function marketplaceSeed(marketplace: Marketplace) {
  switch (marketplace) {
    case "market_csgo":
      return {
        code: marketplace,
        displayName: "Market.CSGO",
        baseUrl: "https://market.csgo.com"
      };
    case "skinport":
      return {
        code: marketplace,
        displayName: "Skinport",
        baseUrl: "https://api.skinport.com"
      };
    case "csfloat":
      return {
        code: marketplace,
        displayName: "CSFloat",
        baseUrl: "https://csfloat.com"
      };
    case "dmarket":
      return {
        code: marketplace,
        displayName: "DMarket",
        baseUrl: "https://api.dmarket.com"
      };
  }
}
