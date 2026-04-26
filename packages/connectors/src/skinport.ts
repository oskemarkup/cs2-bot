import type Bottleneck from "bottleneck";
import { requestEndpoint, type ConnectorFetch, type ConnectorLogger } from "./http.js";
import { SkinportSchemas } from "./schemas.js";
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
  readObject
} from "./normalization.js";

const skinportBaseUrl = "https://api.skinport.com";

interface SkinportConnectorOptions {
  readonly limiter: Bottleneck;
  readonly fetchImpl?: ConnectorFetch | undefined;
  readonly baseUrl?: string | undefined;
  readonly logger?: ConnectorLogger | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retries?: number | undefined;
}

export class SkinportConnector implements MarketplaceConnector {
  readonly marketplace = "skinport" as const;
  readonly limiter: Bottleneck;
  private readonly fetchImpl: ConnectorFetch;
  private readonly baseUrl: string;
  private readonly logger: ConnectorLogger | undefined;
  private readonly timeoutMs: number | undefined;
  private readonly retries: number | undefined;

  constructor(options: SkinportConnectorOptions) {
    this.limiter = options.limiter;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? skinportBaseUrl;
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

    const itemsResult = await requestEndpoint({
      marketplace: this.marketplace,
      baseUrl: this.baseUrl,
      endpoint: "items",
      path: "/v1/items",
      searchParams: { app_id: "730", currency: "USD", tradable: "1" },
      headers: { "Accept-Encoding": "br" },
      schema: SkinportSchemas.items,
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      timeoutMs: this.timeoutMs,
      retries: this.retries
    });
    const itemsSnapshotIndex = rawSnapshots.length;

    rawSnapshots.push(itemsResult.rawSnapshot);
    rateLimitObservations.push({ ...itemsResult.rateLimitObservation, snapshotIndex: itemsSnapshotIndex });

    for (const item of itemsResult.parsedBody) {
      const payload = readObject(item) ?? {};
      const snapshot = normalizeListingSnapshot({
        marketplace: this.marketplace,
        endpoint: "items",
        marketHashName: item.market_hash_name,
        price: item.min_price ?? item.suggested_price,
        currency: item.currency,
        rawPayload: item,
        observedAt: itemsResult.rawSnapshot.fetchedAt,
        snapshotIndex: itemsSnapshotIndex,
        externalId: item.market_hash_name,
        quantity: readFirstField(payload, ["quantity"])
      });

      if (snapshot !== null) {
        itemListingSnapshots.push(snapshot);
      }
    }

    const salesResult = await requestEndpoint({
      marketplace: this.marketplace,
      baseUrl: this.baseUrl,
      endpoint: "sales-history",
      path: "/v1/sales/history",
      searchParams: { app_id: "730", currency: "USD" },
      headers: { "Accept-Encoding": "br" },
      schema: SkinportSchemas.salesHistory,
      limiter: this.limiter,
      fetchImpl: this.fetchImpl,
      logger: this.logger,
      timeoutMs: this.timeoutMs,
      retries: this.retries
    });
    const salesSnapshotIndex = rawSnapshots.length;

    rawSnapshots.push(salesResult.rawSnapshot);
    rateLimitObservations.push({ ...salesResult.rateLimitObservation, snapshotIndex: salesSnapshotIndex });

    for (const item of salesResult.parsedBody) {
      salesStatsSnapshots.push(
        normalizeSalesStatsSnapshot({
          marketplace: this.marketplace,
          marketHashName: item.market_hash_name,
          currency: item.currency ?? "USD",
          rawPayload: item,
          observedAt: salesResult.rawSnapshot.fetchedAt,
          snapshotIndex: salesSnapshotIndex,
          externalId: item.market_hash_name,
          salesCount: item.sales,
          minPrice: item.min_price,
          maxPrice: item.max_price,
          avgPrice: item.avg_price ?? item.mean_price
        })
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
