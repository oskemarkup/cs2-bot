import type Bottleneck from "bottleneck";
import { requestEndpoint, type ConnectorFetch, type ConnectorLogger } from "./http.js";
import { MarketCsgoSchemas } from "./schemas.js";
import type {
  ConnectorItemListingSnapshot,
  ConnectorListingsResponse,
  MarketplaceCollectionResult,
  ConnectorRateLimitObservation,
  ConnectorRawSnapshot,
  ConnectorSalesStatsSnapshot,
  MarketplaceConnector
} from "./types.js";
import {
  normalizeListingSnapshot,
  normalizeSalesStatsSnapshot,
  readFirstField,
  readObject,
  readStringField
} from "./normalization.js";

const marketCsgoBaseUrl = "https://market.csgo.com";
const currency = "USD";

interface MarketCsgoConnectorOptions {
  readonly limiter: Bottleneck;
  readonly fetchImpl?: ConnectorFetch | undefined;
  readonly baseUrl?: string | undefined;
  readonly historyItemId?: string | undefined;
  readonly logger?: ConnectorLogger | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
}

type MarketCsgoEndpointConfig = {
  readonly endpoint: string;
  readonly path: string;
  readonly schema: typeof MarketCsgoSchemas[keyof typeof MarketCsgoSchemas];
};

export class MarketCsgoConnector implements MarketplaceConnector {
  readonly marketplace = "market_csgo" as const;
  readonly limiter: Bottleneck;
  private readonly fetchImpl: ConnectorFetch;
  private readonly baseUrl: string;
  private readonly historyItemId: string;
  private readonly logger: ConnectorLogger | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly retries: number | undefined;

  constructor(options: MarketCsgoConnectorOptions) {
    this.limiter = options.limiter;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? marketCsgoBaseUrl;
    this.historyItemId = options.historyItemId ?? "all";
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs;
    this.retries = options.retries;
  }

  async collect(): Promise<MarketplaceCollectionResult> {
    const collectedAt = new Date();
    const rawSnapshots: ConnectorRawSnapshot[] = [];
    const rateLimitObservations: ConnectorRateLimitObservation[] = [];
    const itemListingSnapshots: ConnectorItemListingSnapshot[] = [];
    const salesStatsSnapshots: ConnectorSalesStatsSnapshot[] = [];

    for (const config of marketCsgoEndpoints(this.historyItemId)) {
      const result = await requestEndpoint({
        marketplace: this.marketplace,
        baseUrl: this.baseUrl,
        endpoint: config.endpoint,
        path: config.path,
        schema: config.schema,
        limiter: this.limiter,
        fetchImpl: this.fetchImpl,
        logger: this.logger,
        timeoutMs: this.timeoutMs,
        retries: this.retries
      });
      const snapshotIndex = rawSnapshots.length;

      rawSnapshots.push(result.rawSnapshot);
      rateLimitObservations.push({ ...result.rateLimitObservation, snapshotIndex });
      appendItems(
        itemListingSnapshots,
        normalizeMarketCsgoListings(config.endpoint, result.parsedBody, snapshotIndex, result.rawSnapshot.fetchedAt)
      );
      appendItems(
        salesStatsSnapshots,
        normalizeMarketCsgoSales(config.endpoint, result.parsedBody, snapshotIndex, result.rawSnapshot.fetchedAt)
      );
    }

    return {
      marketplace: this.marketplace,
      collectedAt,
      rawSnapshots,
      rateLimitObservations,
      itemListingSnapshots,
      salesStatsSnapshots
    };
  }

  async fetchListings(): Promise<ConnectorListingsResponse> {
    const collection = await this.collect();

    return {
      marketplace: this.marketplace,
      observedAt: collection.collectedAt,
      listings: collection.itemListingSnapshots.map((snapshot) => ({
        marketplace: snapshot.marketplace,
        externalId: snapshot.externalId,
        marketHashName: snapshot.marketHashName,
        priceMinor: snapshot.priceMinor,
        currency: snapshot.currency,
        tradableAt: null,
        observedAt: snapshot.observedAt,
        rawPayload: snapshot.rawPayload
      }))
    };
  }
}

function appendItems<T>(target: T[], items: readonly T[]): void {
  for (const item of items) {
    target.push(item);
  }
}

function marketCsgoEndpoints(historyItemId: string): readonly MarketCsgoEndpointConfig[] {
  return [
    { endpoint: "prices", path: "/api/v2/prices/USD.json", schema: MarketCsgoSchemas.prices },
    { endpoint: "full-export", path: "/api/full-export/USD.json", schema: MarketCsgoSchemas.fullExport },
    {
      endpoint: "class-instance-prices",
      path: "/api/v2/prices/class_instance/USD.json",
      schema: MarketCsgoSchemas.classInstancePrices
    },
    {
      endpoint: "orders",
      path: "/api/v2/prices/orders/USD.json",
      schema: MarketCsgoSchemas.orders
    },
    {
      endpoint: "full-history-all",
      path: "/api/v2/full-history/all.json",
      schema: MarketCsgoSchemas.fullHistoryAll
    },
    {
      endpoint: "full-history-item",
      path: `/api/v2/full-history/${encodeURIComponent(historyItemId)}.json`,
      schema: MarketCsgoSchemas.fullHistoryItem
    },
    {
      endpoint: "dictionary-names",
      path: "/api/v2/dictionary/names.json",
      schema: MarketCsgoSchemas.dictionaryNames
    }
  ];
}

function normalizeMarketCsgoListings(
  endpoint: string,
  body: unknown,
  snapshotIndex: number,
  observedAt: Date
): ConnectorItemListingSnapshot[] {
  if (endpoint.startsWith("full-history") || endpoint === "dictionary-names") {
    return [];
  }

  const source = readObject(body);
  const items = readObject(source?.["items"]) ?? source;
  const snapshots: ConnectorItemListingSnapshot[] = [];

  if (items === null) {
    return snapshots;
  }

  for (const [key, value] of Object.entries(items)) {
    const objectValue = readObject(value);

    if (objectValue === null) {
      const snapshot = normalizeListingSnapshot({
        marketplace: "market_csgo",
        endpoint,
        marketHashName: key,
        price: value,
        currency,
        rawPayload: value,
        observedAt,
        snapshotIndex
      });

      if (snapshot !== null) {
        snapshots.push(snapshot);
      }

      continue;
    }

    const marketHashName = readStringField(objectValue, ["market_hash_name", "market_name", "name"]) ?? key;
    const price = readFirstField(objectValue, ["price", "min_price", "lowest_price", "best_price"]);
    const externalId = readStringField(objectValue, ["id", "item_id", "class_instance", "classid"]);
    const snapshot = normalizeListingSnapshot({
      marketplace: "market_csgo",
      endpoint,
      marketHashName,
      price,
      currency,
      rawPayload: objectValue,
      observedAt,
      snapshotIndex,
      externalId: externalId ?? `${endpoint}:${key}`,
      quantity: readFirstField(objectValue, ["quantity", "count", "volume"])
    });

    if (snapshot !== null) {
      snapshots.push(snapshot);
    }
  }

  return snapshots;
}

function normalizeMarketCsgoSales(
  endpoint: string,
  body: unknown,
  snapshotIndex: number,
  observedAt: Date
): ConnectorSalesStatsSnapshot[] {
  if (!endpoint.startsWith("full-history")) {
    return [];
  }

  const source = readObject(body);
  const items = readObject(source?.["items"]) ?? source;
  const snapshots: ConnectorSalesStatsSnapshot[] = [];

  if (items === null) {
    return snapshots;
  }

  for (const [key, value] of Object.entries(items)) {
    const payload = readObject(value);

    if (payload === null) {
      continue;
    }

    snapshots.push(
      normalizeSalesStatsSnapshot({
        marketplace: "market_csgo",
        marketHashName: readStringField(payload, ["market_hash_name", "market_name", "name"]) ?? key,
        currency,
        rawPayload: payload,
        observedAt,
        snapshotIndex,
        externalId: readStringField(payload, ["id", "item_id"]) ?? key,
        salesCount: readFirstField(payload, ["sales", "count", "volume"]),
        minPrice: readFirstField(payload, ["min_price", "lowest_price"]),
        maxPrice: readFirstField(payload, ["max_price", "highest_price"]),
        avgPrice: readFirstField(payload, ["avg_price", "average_price", "mean_price"])
      })
    );
  }

  return snapshots;
}
