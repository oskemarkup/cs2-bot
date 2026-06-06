import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
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
export const tradeSignalSide = pgEnum("trade_signal_side", ["buy", "sell"]);
export const tradeSignalStatus = pgEnum("trade_signal_status", ["new", "sent", "dismissed"]);
export const manualPositionStatus = pgEnum("manual_position_status", ["open", "closed"]);

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

export const signalWatchlist = pgTable(
  "signal_watchlist",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull().default("market_csgo"),
    marketHashName: text("market_hash_name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    minPriceMinor: bigint("min_price_minor", { mode: "bigint" }),
    maxPriceMinor: bigint("max_price_minor", { mode: "bigint" }),
    minSalesCount: integer("min_sales_count"),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    marketplaceNameIdx: uniqueIndex("signal_watchlist_marketplace_name_idx").on(table.marketplace, table.marketHashName),
    enabledMarketplaceIdx: index("signal_watchlist_enabled_marketplace_idx").on(table.enabled, table.marketplace)
  })
);

export const marketBaselineSnapshots = pgTable(
  "market_baseline_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull().default("market_csgo"),
    baselineKey: text("baseline_key").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    itemsCount: integer("items_count").notNull(),
    medianReturnBps: integer("median_return_bps").notNull(),
    dispersionBps: integer("dispersion_bps").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    keyObservedAtIdx: index("market_baseline_snapshot_key_observed_at_idx").on(
      table.marketplace,
      table.baselineKey,
      table.observedAt
    )
  })
);

export const itemPriceFeatures = pgTable(
  "item_price_feature",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull().default("market_csgo"),
    marketHashName: text("market_hash_name").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    fairValueMinor: bigint("fair_value_minor", { mode: "bigint" }).notNull(),
    referencePriceMinor: bigint("reference_price_minor", { mode: "bigint" }).notNull(),
    rollingMedianPriceMinor: bigint("rolling_median_price_minor", { mode: "bigint" }).notNull(),
    itemReturnBps: integer("item_return_bps").notNull(),
    baselineReturnBps: integer("baseline_return_bps").notNull(),
    residualBps: integer("residual_bps").notNull(),
    zScoreBps: integer("z_score_bps"),
    volatilityBps: integer("volatility_bps").notNull(),
    liquidityScoreBps: integer("liquidity_score_bps").notNull(),
    salesCount: integer("sales_count"),
    quantity: integer("quantity"),
    cohortKey: text("cohort_key").notNull(),
    baselineKey: text("baseline_key").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    nameObservedAtIdx: index("item_price_feature_name_observed_at_idx").on(
      table.marketplace,
      table.marketHashName,
      table.observedAt
    ),
    residualObservedAtIdx: index("item_price_feature_residual_observed_at_idx").on(table.residualBps, table.observedAt)
  })
);

export const manualPositions = pgTable(
  "manual_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketplace: marketplaceCode("marketplace").notNull().default("market_csgo"),
    marketHashName: text("market_hash_name").notNull(),
    buyPriceMinor: bigint("buy_price_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    quantity: integer("quantity").notNull().default(1),
    boughtAt: timestamp("bought_at", { withTimezone: true }).notNull(),
    expectedUnlockAt: timestamp("expected_unlock_at", { withTimezone: true }).notNull(),
    actualUnlockAt: timestamp("actual_unlock_at", { withTimezone: true }),
    status: manualPositionStatus("status").notNull().default("open"),
    notes: varchar("notes", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    statusUnlockIdx: index("manual_position_status_unlock_idx").on(table.status, table.expectedUnlockAt),
    marketplaceNameIdx: index("manual_position_marketplace_name_idx").on(table.marketplace, table.marketHashName)
  })
);

export const tradeSignals = pgTable(
  "trade_signal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id").references(() => manualPositions.id),
    marketplace: marketplaceCode("marketplace").notNull().default("market_csgo"),
    marketHashName: text("market_hash_name").notNull(),
    side: tradeSignalSide("side").notNull(),
    status: tradeSignalStatus("status").notNull().default("new"),
    priceMinor: bigint("price_minor", { mode: "bigint" }).notNull(),
    fairValueMinor: bigint("fair_value_minor", { mode: "bigint" }).notNull(),
    expectedProfitMinor: bigint("expected_profit_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    expectedEdgeBps: integer("expected_edge_bps").notNull(),
    confidenceBps: integer("confidence_bps").notNull(),
    baselineKey: text("baseline_key").notNull(),
    residualBps: integer("residual_bps").notNull(),
    reason: text("reason").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    statusCreatedAtIdx: index("trade_signal_status_created_at_idx").on(table.status, table.createdAt),
    sideNameObservedAtIdx: index("trade_signal_side_name_observed_at_idx").on(
      table.side,
      table.marketplace,
      table.marketHashName,
      table.observedAt
    )
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

export const manualPositionRelations = relations(manualPositions, ({ many }) => ({
  signals: many(tradeSignals)
}));

export const tradeSignalRelations = relations(tradeSignals, ({ one }) => ({
  position: one(manualPositions, {
    fields: [tradeSignals.positionId],
    references: [manualPositions.id]
  })
}));
