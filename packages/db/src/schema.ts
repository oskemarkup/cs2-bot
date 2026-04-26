import { relations } from "drizzle-orm";
import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const marketplaceCode = pgEnum("marketplace_code", ["market_csgo", "skinport", "csfloat", "dmarket"]);
export const alertStatus = pgEnum("alert_status", ["new", "acknowledged", "dismissed"]);
export const paperTradeSide = pgEnum("paper_trade_side", ["buy", "sell"]);
export const collectorRunStatus = pgEnum("collector_run_status", ["running", "succeeded", "failed"]);

export const marketplaces = pgTable(
  "marketplace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: marketplaceCode("code").notNull(),
    displayName: varchar("display_name", { length: 80 }).notNull(),
    baseUrl: text("base_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    codeIdx: uniqueIndex("marketplace_code_idx").on(table.code)
  })
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketHashName: text("market_hash_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    marketHashNameIdx: uniqueIndex("items_market_hash_name_idx").on(table.marketHashName)
  })
);

export const marketListings = pgTable(
  "market_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull(),
    externalId: text("external_id").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    tradableAt: timestamp("tradable_at", { withTimezone: true }),
    rawPayload: jsonb("raw_payload").$type<unknown>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    marketplaceExternalIdIdx: uniqueIndex("market_listings_marketplace_external_id_idx").on(
      table.marketplace,
      table.externalId
    ),
    itemObservedAtIdx: index("market_listings_item_observed_at_idx").on(table.itemId, table.observedAt)
  })
);

export const arbitrageAlerts = pgTable(
  "arbitrage_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    sourceMarketplace: marketplaceCode("source_marketplace").notNull(),
    targetMarketplace: marketplaceCode("target_marketplace").notNull(),
    sourcePriceMinor: bigint("source_price_minor", { mode: "bigint" }).notNull(),
    targetPriceMinor: bigint("target_price_minor", { mode: "bigint" }).notNull(),
    expectedProfitMinor: bigint("expected_profit_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    status: alertStatus("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    statusCreatedAtIdx: index("arbitrage_alerts_status_created_at_idx").on(table.status, table.createdAt)
  })
);

export const paperTrades = pgTable(
  "paper_trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alertId: uuid("alert_id").references(() => arbitrageAlerts.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    marketplace: marketplaceCode("marketplace").notNull(),
    side: paperTradeSide("side").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    itemCreatedAtIdx: index("paper_trades_item_created_at_idx").on(table.itemId, table.createdAt)
  })
);

export const collectorRuns = pgTable(
  "collector_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull(),
    status: collectorRunStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message")
  },
  (table) => ({
    marketplaceStartedAtIdx: index("collector_run_marketplace_started_at_idx").on(table.marketplace, table.startedAt)
  })
);

export const rawSnapshots = pgTable(
  "raw_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectorRunId: uuid("collector_run_id")
      .notNull()
      .references(() => collectorRuns.id),
    marketplace: marketplaceCode("marketplace").notNull(),
    endpoint: text("endpoint").notNull(),
    requestUrl: text("request_url").notNull(),
    paramsHash: char("params_hash", { length: 64 }).notNull(),
    statusCode: integer("status_code").notNull(),
    responseHeaders: jsonb("response_headers").$type<Record<string, string>>().notNull(),
    responseBody: jsonb("response_body").$type<unknown>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    runEndpointIdx: index("raw_snapshot_run_endpoint_idx").on(table.collectorRunId, table.endpoint),
    marketplaceFetchedAtIdx: index("raw_snapshot_marketplace_fetched_at_idx").on(table.marketplace, table.fetchedAt),
    paramsHashIdx: index("raw_snapshot_params_hash_idx").on(table.paramsHash)
  })
);

export const apiRateLimitObservations = pgTable(
  "api_rate_limit_observation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectorRunId: uuid("collector_run_id")
      .notNull()
      .references(() => collectorRuns.id),
    rawSnapshotId: uuid("raw_snapshot_id").references(() => rawSnapshots.id),
    marketplace: marketplaceCode("marketplace").notNull(),
    endpoint: text("endpoint").notNull(),
    limit: integer("limit"),
    remaining: integer("remaining"),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    retryAfterSeconds: integer("retry_after_seconds"),
    responseHeaders: jsonb("response_headers").$type<Record<string, string>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    marketplaceObservedAtIdx: index("api_rate_limit_observation_marketplace_observed_at_idx").on(
      table.marketplace,
      table.observedAt
    )
  })
);

export const itemListingSnapshots = pgTable(
  "item_listing_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectorRunId: uuid("collector_run_id")
      .notNull()
      .references(() => collectorRuns.id),
    rawSnapshotId: uuid("raw_snapshot_id").references(() => rawSnapshots.id),
    marketplace: marketplaceCode("marketplace").notNull(),
    externalId: text("external_id").notNull(),
    marketHashName: text("market_hash_name").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    quantity: integer("quantity"),
    rawPayload: jsonb("raw_payload").$type<unknown>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    marketplaceNameObservedAtIdx: index("item_listing_snapshot_marketplace_name_observed_at_idx").on(
      table.marketplace,
      table.marketHashName,
      table.observedAt
    )
  })
);

export const itemListingCurrent = pgTable(
  "item_listing_current",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull(),
    identityKey: text("identity_key").notNull(),
    externalId: text("external_id"),
    marketHashName: text("market_hash_name").notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    quantity: integer("quantity"),
    rawPayload: jsonb("raw_payload").$type<unknown>(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull(),
    lastHistoryAt: timestamp("last_history_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    marketplaceIdentityKeyIdx: uniqueIndex("item_listing_current_marketplace_identity_key_idx").on(
      table.marketplace,
      table.identityKey
    ),
    marketplaceNameIdx: index("item_listing_current_marketplace_name_idx").on(table.marketplace, table.marketHashName),
    lastSeenAtIdx: index("item_listing_current_last_seen_at_idx").on(table.lastSeenAt)
  })
);

export const salesStatsSnapshots = pgTable(
  "sales_stats_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectorRunId: uuid("collector_run_id")
      .notNull()
      .references(() => collectorRuns.id),
    rawSnapshotId: uuid("raw_snapshot_id").references(() => rawSnapshots.id),
    marketplace: marketplaceCode("marketplace").notNull(),
    externalId: text("external_id"),
    marketHashName: text("market_hash_name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    salesCount: integer("sales_count"),
    minPriceMinor: bigint("min_price_minor", { mode: "bigint" }),
    maxPriceMinor: bigint("max_price_minor", { mode: "bigint" }),
    avgPriceMinor: bigint("avg_price_minor", { mode: "bigint" }),
    rawPayload: jsonb("raw_payload").$type<unknown>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    marketplaceNameObservedAtIdx: index("sales_stats_snapshot_marketplace_name_observed_at_idx").on(
      table.marketplace,
      table.marketHashName,
      table.observedAt
    )
  })
);

export const salesStatsCurrent = pgTable(
  "sales_stats_current",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull(),
    identityKey: text("identity_key").notNull(),
    marketHashName: text("market_hash_name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    salesCount: integer("sales_count"),
    minPriceMinor: bigint("min_price_minor", { mode: "bigint" }),
    maxPriceMinor: bigint("max_price_minor", { mode: "bigint" }),
    avgPriceMinor: bigint("avg_price_minor", { mode: "bigint" }),
    rawPayload: jsonb("raw_payload").$type<unknown>(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }).notNull(),
    lastHistoryAt: timestamp("last_history_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    marketplaceIdentityKeyIdx: uniqueIndex("sales_stats_current_marketplace_identity_key_idx").on(
      table.marketplace,
      table.identityKey
    ),
    marketplaceNameIdx: index("sales_stats_current_marketplace_name_idx").on(table.marketplace, table.marketHashName),
    lastSeenAtIdx: index("sales_stats_current_last_seen_at_idx").on(table.lastSeenAt)
  })
);

export const itemRelations = relations(items, ({ many }) => ({
  listings: many(marketListings),
  alerts: many(arbitrageAlerts),
  paperTrades: many(paperTrades)
}));

export const marketListingRelations = relations(marketListings, ({ one }) => ({
  item: one(items, {
    fields: [marketListings.itemId],
    references: [items.id]
  })
}));

export const arbitrageAlertRelations = relations(arbitrageAlerts, ({ one, many }) => ({
  item: one(items, {
    fields: [arbitrageAlerts.itemId],
    references: [items.id]
  }),
  paperTrades: many(paperTrades)
}));

export const paperTradeRelations = relations(paperTrades, ({ one }) => ({
  item: one(items, {
    fields: [paperTrades.itemId],
    references: [items.id]
  }),
  alert: one(arbitrageAlerts, {
    fields: [paperTrades.alertId],
    references: [arbitrageAlerts.id]
  })
}));
