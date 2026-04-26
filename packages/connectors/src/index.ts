import Bottleneck from "bottleneck";
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

export interface ReadOnlyMarketplaceConnector {
  readonly marketplace: Marketplace;
  readonly limiter: Bottleneck;
  fetchListings(): Promise<ConnectorListingsResponse>;
}

export type ConnectorLimiterMap = Record<Marketplace, Bottleneck>;

const limiterDefaults: Record<Marketplace, Bottleneck.ConstructorOptions> = {
  market_csgo: { id: "market-csgo", maxConcurrent: 1, minTime: 1_000 },
  skinport: { id: "skinport", maxConcurrent: 1, minTime: 1_000 },
  csfloat: { id: "csfloat", maxConcurrent: 1, minTime: 1_000 },
  dmarket: { id: "dmarket", maxConcurrent: 1, minTime: 1_000 }
};

export function createConnectorRateLimiters(
  overrides: Partial<Record<Marketplace, Bottleneck.ConstructorOptions>> = {}
): ConnectorLimiterMap {
  return {
    market_csgo: new Bottleneck({ ...limiterDefaults.market_csgo, ...overrides.market_csgo }),
    skinport: new Bottleneck({ ...limiterDefaults.skinport, ...overrides.skinport }),
    csfloat: new Bottleneck({ ...limiterDefaults.csfloat, ...overrides.csfloat }),
    dmarket: new Bottleneck({ ...limiterDefaults.dmarket, ...overrides.dmarket })
  };
}

export function validateConnectorResponse(response: unknown): ConnectorListingsResponse {
  return ConnectorListingsResponseSchema.parse(response);
}
