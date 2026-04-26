import { loadConfig, type AppConfig } from "@cs2-bot/config";
import {
  type ConnectorLogger,
  createConnectorRateLimiters,
  MarketplaceHttpError,
  MarketCsgoConnector,
  SkinportConnector,
  type Marketplace,
  type MarketplaceCollectionResult,
  type MarketplaceConnector
} from "@cs2-bot/connectors";
import { createLogger } from "@cs2-bot/core";
import { BatchInsertError, createDb, eq, insertInBatches, schema } from "@cs2-bot/db";

interface CollectorCliOptions {
  readonly marketplace: Extract<Marketplace, "market_csgo" | "skinport">;
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
      batchSize: config.DB_INSERT_BATCH_SIZE
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
      await markCollectorRunFailed(db, collectorRunId, error);
    }

    logger.error({ marketplace: connector.marketplace, collectorRunId, err: error }, "collector run failed");
    throw error;
  } finally {
    await pool.end();
  }
}

function createConnector(
  marketplace: Extract<Marketplace, "market_csgo" | "skinport">,
  limiters: ReturnType<typeof createConnectorRateLimiters>,
  logger?: ConnectorLogger
): MarketplaceConnector {
  if (marketplace === "market_csgo") {
    return new MarketCsgoConnector({ limiter: limiters.market_csgo, logger });
  }

  return new SkinportConnector({ limiter: limiters.skinport, logger });
}

interface PersistMarketplaceCollectionOptions {
  readonly collectorRunId?: string | undefined;
  readonly logger?: ConnectorLogger & {
    error(payload: Record<string, unknown>, message: string): void;
  } | undefined;
  readonly batchSize?: number | undefined;
}

export async function persistMarketplaceCollection(
  db: ReturnType<typeof createDb>["db"],
  collection: MarketplaceCollectionResult,
  options: PersistMarketplaceCollectionOptions = {}
): Promise<string> {
  const collectorRunId =
    options.collectorRunId ?? (await startCollectorRun(db, collection.marketplace, collection.collectedAt));

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
          responseBody: snapshot.responseBody,
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

    const itemListingRows = collection.itemListingSnapshots.map((snapshot) => ({
      collectorRunId,
      rawSnapshotId: rawSnapshotIds[snapshot.snapshotIndex] ?? null,
      marketplace: snapshot.marketplace,
      externalId: snapshot.externalId,
      marketHashName: snapshot.marketHashName,
      priceMinor: snapshot.priceMinor,
      currency: snapshot.currency,
      quantity: snapshot.quantity,
      rawPayload: snapshot.rawPayload,
      observedAt: snapshot.observedAt
    }));

    await insertInBatches({
      table: "item_listing_snapshot",
      rows: itemListingRows,
      batchSize: options.batchSize,
      logger: options.logger,
      insertRows: async (rows) => {
        await db.insert(schema.itemListingSnapshots).values([...rows]);
      }
    });

    const salesStatsRows = collection.salesStatsSnapshots.map((snapshot) => ({
      collectorRunId,
      rawSnapshotId: rawSnapshotIds[snapshot.snapshotIndex] ?? null,
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
    }));

    await insertInBatches({
      table: "sales_stats_snapshot",
      rows: salesStatsRows,
      batchSize: options.batchSize,
      logger: options.logger,
      insertRows: async (rows) => {
        await db.insert(schema.salesStatsSnapshots).values([...rows]);
      }
    });

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
