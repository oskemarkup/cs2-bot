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

export const marketplace = pgEnum("marketplace", ["market_csgo", "skinport", "csfloat", "dmarket"]);
export const alertStatus = pgEnum("alert_status", ["new", "acknowledged", "dismissed"]);
export const paperTradeSide = pgEnum("paper_trade_side", ["buy", "sell"]);

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
    marketplace: marketplace("marketplace").notNull(),
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
    sourceMarketplace: marketplace("source_marketplace").notNull(),
    targetMarketplace: marketplace("target_marketplace").notNull(),
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
    marketplace: marketplace("marketplace").notNull(),
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
