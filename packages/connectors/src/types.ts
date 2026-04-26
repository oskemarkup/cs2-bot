import type Bottleneck from "bottleneck";
import { z } from "zod";

export const MarketplaceSchema = z.enum(["market_csgo", "skinport", "csfloat", "dmarket"]);
export type Marketplace = z.infer<typeof MarketplaceSchema>;

export const ConnectorListingSchema = z.object({
  marketplace: MarketplaceSchema,
  externalId: z.string().min(1),
  marketHashName: z.string().min(1),
  priceMinor: z.bigint().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  tradableAt: z.date().nullable(),
  observedAt: z.date(),
  rawPayload: z.unknown()
});

export const ConnectorListingsResponseSchema = z.object({
  marketplace: MarketplaceSchema,
  observedAt: z.date(),
  listings: z.array(ConnectorListingSchema)
});

export type ConnectorListing = z.infer<typeof ConnectorListingSchema>;
export type ConnectorListingsResponse = z.infer<typeof ConnectorListingsResponseSchema>;

export interface ConnectorRawSnapshot {
  readonly marketplace: Marketplace;
  readonly endpoint: string;
  readonly requestUrl: string;
  readonly paramsHash: string;
  readonly statusCode: number;
  readonly responseHeaders: Record<string, string>;
  readonly responseBody: unknown;
  readonly fetchedAt: Date;
}

export interface ConnectorRateLimitObservation {
  readonly marketplace: Marketplace;
  readonly endpoint: string;
  readonly limit: number | null;
  readonly remaining: number | null;
  readonly resetAt: Date | null;
  readonly retryAfterSeconds: number | null;
  readonly responseHeaders: Record<string, string>;
  readonly observedAt: Date;
  readonly snapshotIndex: number;
}

export interface ConnectorItemListingSnapshot {
  readonly marketplace: Marketplace;
  readonly externalId: string;
  readonly marketHashName: string;
  readonly priceMinor: bigint;
  readonly currency: string;
  readonly quantity: number | null;
  readonly rawPayload: unknown;
  readonly observedAt: Date;
  readonly snapshotIndex: number;
}

export interface ConnectorSalesStatsSnapshot {
  readonly marketplace: Marketplace;
  readonly externalId: string | null;
  readonly marketHashName: string;
  readonly currency: string;
  readonly salesCount: number | null;
  readonly minPriceMinor: bigint | null;
  readonly maxPriceMinor: bigint | null;
  readonly avgPriceMinor: bigint | null;
  readonly rawPayload: unknown;
  readonly observedAt: Date;
  readonly snapshotIndex: number;
}

export interface MarketplaceCollectionResult {
  readonly marketplace: Marketplace;
  readonly collectedAt: Date;
  readonly rawSnapshots: readonly ConnectorRawSnapshot[];
  readonly rateLimitObservations: readonly ConnectorRateLimitObservation[];
  readonly itemListingSnapshots: readonly ConnectorItemListingSnapshot[];
  readonly salesStatsSnapshots: readonly ConnectorSalesStatsSnapshot[];
}

export interface MarketplaceConnector {
  readonly marketplace: Marketplace;
  readonly limiter: Bottleneck;
  collect(): Promise<MarketplaceCollectionResult>;
  fetchListings(): Promise<ConnectorListingsResponse>;
}

export type ConnectorLimiterMap = Record<Marketplace, Bottleneck>;

export function validateConnectorResponse(response: unknown): ConnectorListingsResponse {
  return ConnectorListingsResponseSchema.parse(response);
}
