import { createHash } from "node:crypto";
import type {
  ConnectorItemListingSnapshot,
  ConnectorRawSnapshot,
  ConnectorSalesStatsSnapshot
} from "@cs2-bot/connectors";
import type { AppConfig } from "@cs2-bot/config";

type JsonRecord = Record<string, unknown>;

export type RawSnapshotMode = AppConfig["RAW_SNAPSHOT_MODE"];

export function itemListingIdentityKey(snapshot: ConnectorItemListingSnapshot): string {
  const externalId = normalizeIdentityPart(snapshot.externalId);

  if (externalId !== "") {
    return `external:${externalId}`;
  }

  return stableJsonStringify({
    marketHashName: snapshot.marketHashName,
    currency: snapshot.currency,
    variant: readVariantFields(snapshot.rawPayload)
  });
}

export function salesStatsIdentityKey(snapshot: ConnectorSalesStatsSnapshot): string {
  return stableJsonStringify({
    marketHashName: snapshot.marketHashName,
    currency: snapshot.currency
  });
}

export function itemListingContentHash(snapshot: ConnectorItemListingSnapshot): string {
  return sha256(
    stableJsonStringify({
      externalId: normalizeIdentityPart(snapshot.externalId) || null,
      marketHashName: snapshot.marketHashName,
      priceMinor: snapshot.priceMinor,
      currency: snapshot.currency,
      quantity: snapshot.quantity,
      variant: readVariantFields(snapshot.rawPayload)
    })
  );
}

export function salesStatsContentHash(snapshot: ConnectorSalesStatsSnapshot): string {
  return sha256(
    stableJsonStringify({
      marketHashName: snapshot.marketHashName,
      currency: snapshot.currency,
      salesCount: snapshot.salesCount,
      minPriceMinor: snapshot.minPriceMinor,
      maxPriceMinor: snapshot.maxPriceMinor,
      avgPriceMinor: snapshot.avgPriceMinor,
      stats: readStatsFields(snapshot.rawPayload)
    })
  );
}

export function rawSnapshotResponseBodyForMode(snapshot: ConnectorRawSnapshot, mode: RawSnapshotMode): unknown {
  if (mode === "all") {
    return snapshot.responseBody;
  }

  const metadata = rawSnapshotMetadata(snapshot);

  if (mode === "metadata_only" || snapshot.statusCode < 400) {
    return metadata;
  }

  return {
    ...metadata,
    failurePreview: preview(stableJsonStringify(snapshot.responseBody), 500)
  };
}

export function rawSnapshotMetadata(snapshot: ConnectorRawSnapshot): JsonRecord {
  const canonicalBody = stableJsonStringify(snapshot.responseBody);

  return {
    storageMode: "metadata_only",
    marketplace: snapshot.marketplace,
    endpoint: snapshot.endpoint,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    statusCode: snapshot.statusCode,
    payloadHash: sha256(canonicalBody),
    payloadSizeBytes: Buffer.byteLength(canonicalBody),
    itemCount: countPayloadItems(snapshot.responseBody)
  };
}

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === "object") {
    const record = value as JsonRecord;
    const result: JsonRecord = {};

    for (const key of Object.keys(record).sort()) {
      const child = record[key];

      if (child !== undefined) {
        result[key] = canonicalize(child);
      }
    }

    return result;
  }

  return value;
}

function normalizeIdentityPart(value: string): string {
  return value.trim();
}

function readVariantFields(payload: unknown): JsonRecord {
  const object = readObject(payload);

  if (object === null) {
    return {};
  }

  return pickKnownFields(object, [
    "float",
    "float_value",
    "paint_seed",
    "paintseed",
    "phase",
    "wear",
    "stattrak",
    "stat_trak",
    "souvenir"
  ]);
}

function readStatsFields(payload: unknown): JsonRecord {
  const object = readObject(payload);

  if (object === null) {
    return {};
  }

  return pickKnownFields(object, [
    "volume",
    "sales",
    "sales_7d",
    "sales_30d",
    "min",
    "max",
    "avg",
    "average",
    "mean",
    "median",
    "median_price"
  ]);
}

function pickKnownFields(object: JsonRecord, fields: readonly string[]): JsonRecord {
  const result: JsonRecord = {};

  for (const field of fields) {
    if (object[field] !== undefined && object[field] !== null) {
      result[field] = object[field];
    }
  }

  return result;
}

function readObject(value: unknown): JsonRecord | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord;
  }

  return null;
}

function countPayloadItems(value: unknown): number | null {
  if (Array.isArray(value)) {
    return value.length;
  }

  const object = readObject(value);

  if (object === null) {
    return null;
  }

  const items = object["items"];

  if (Array.isArray(items)) {
    return items.length;
  }

  const itemRecord = readObject(items);

  return itemRecord === null ? null : Object.keys(itemRecord).length;
}

function preview(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
