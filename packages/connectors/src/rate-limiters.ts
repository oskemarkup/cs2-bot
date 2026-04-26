import Bottleneck from "bottleneck";
import type { ConnectorLimiterMap, Marketplace } from "./types.js";

const limiterDefaults: Record<Marketplace, Bottleneck.ConstructorOptions> = {
  market_csgo: {
    id: "market-csgo",
    maxConcurrent: 1,
    minTime: 334
  },
  skinport: {
    id: "skinport",
    maxConcurrent: 1,
    reservoir: 8,
    reservoirRefreshAmount: 8,
    reservoirRefreshInterval: 300_000
  },
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

export function getConnectorLimiterDefaults(): Record<Marketplace, Bottleneck.ConstructorOptions> {
  return limiterDefaults;
}
