import type {
  ConnectorItemListingSnapshot,
  ConnectorSalesStatsSnapshot,
  Marketplace
} from "./types.js";

export function decimalToMinorUnits(value: unknown, fractionDigits = 2): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const text = String(value).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);

  if (match === null) {
    return null;
  }

  const major = BigInt(match[1] ?? "0");
  const rawFraction = match[2] ?? "";
  const paddedFraction = rawFraction.padEnd(fractionDigits, "0").slice(0, fractionDigits);

  return major * 10n ** BigInt(fractionDigits) + BigInt(paddedFraction || "0");
}

export function normalizeListingSnapshot(input: {
  marketplace: Marketplace;
  endpoint: string;
  marketHashName: string;
  price: unknown;
  currency: string;
  rawPayload: unknown;
  observedAt: Date;
  snapshotIndex: number;
  externalId?: string;
  quantity?: unknown;
}): ConnectorItemListingSnapshot | null {
  const priceMinor = decimalToMinorUnits(input.price);

  if (priceMinor === null) {
    return null;
  }

  const quantity = typeof input.quantity === "number" && Number.isInteger(input.quantity) ? input.quantity : null;

  return {
    marketplace: input.marketplace,
    externalId: input.externalId ?? `${input.endpoint}:${input.marketHashName}`,
    marketHashName: input.marketHashName,
    priceMinor,
    currency: input.currency,
    quantity,
    rawPayload: input.rawPayload,
    observedAt: input.observedAt,
    snapshotIndex: input.snapshotIndex
  };
}

export function normalizeSalesStatsSnapshot(input: {
  marketplace: Marketplace;
  marketHashName: string;
  currency: string;
  rawPayload: unknown;
  observedAt: Date;
  snapshotIndex: number;
  externalId?: string | null;
  salesCount?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
  avgPrice?: unknown;
}): ConnectorSalesStatsSnapshot {
  return {
    marketplace: input.marketplace,
    externalId: input.externalId ?? null,
    marketHashName: input.marketHashName,
    currency: input.currency,
    salesCount: parseSalesCount(input.salesCount),
    minPriceMinor: decimalToMinorUnits(input.minPrice),
    maxPriceMinor: decimalToMinorUnits(input.maxPrice),
    avgPriceMinor: decimalToMinorUnits(input.avgPrice),
    rawPayload: input.rawPayload,
    observedAt: input.observedAt,
    snapshotIndex: input.snapshotIndex
  };
}

export function readObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

export function readStringField(payload: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = payload[field];

    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }

  return null;
}

export function readFirstField(payload: Record<string, unknown>, fields: readonly string[]): unknown {
  for (const field of fields) {
    const value = payload[field];

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function parseSalesCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.length;
  }

  return null;
}
