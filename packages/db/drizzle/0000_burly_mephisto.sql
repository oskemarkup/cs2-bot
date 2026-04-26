CREATE TYPE "public"."alert_status" AS ENUM('new', 'acknowledged', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."marketplace" AS ENUM('market_csgo', 'skinport', 'csfloat', 'dmarket');--> statement-breakpoint
CREATE TYPE "public"."paper_trade_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "arbitrage_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"source_marketplace" "marketplace" NOT NULL,
	"target_marketplace" "marketplace" NOT NULL,
	"source_price_minor" bigint NOT NULL,
	"target_price_minor" bigint NOT NULL,
	"expected_profit_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"confidence_bps" integer NOT NULL,
	"status" "alert_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_hash_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"external_id" text NOT NULL,
	"item_id" uuid NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"tradable_at" timestamp with time zone,
	"raw_payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid,
	"item_id" uuid NOT NULL,
	"marketplace" "marketplace" NOT NULL,
	"side" "paper_trade_side" NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arbitrage_alerts" ADD CONSTRAINT "arbitrage_alerts_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_listings" ADD CONSTRAINT "market_listings_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_alert_id_arbitrage_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."arbitrage_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arbitrage_alerts_status_created_at_idx" ON "arbitrage_alerts" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_market_hash_name_idx" ON "items" USING btree ("market_hash_name");--> statement-breakpoint
CREATE UNIQUE INDEX "market_listings_marketplace_external_id_idx" ON "market_listings" USING btree ("marketplace","external_id");--> statement-breakpoint
CREATE INDEX "market_listings_item_observed_at_idx" ON "market_listings" USING btree ("item_id","observed_at");--> statement-breakpoint
CREATE INDEX "paper_trades_item_created_at_idx" ON "paper_trades" USING btree ("item_id","created_at");