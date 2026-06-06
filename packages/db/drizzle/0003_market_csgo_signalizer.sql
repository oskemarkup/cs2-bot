CREATE TYPE "public"."manual_position_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."trade_signal_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_signal_status" AS ENUM('new', 'sent', 'dismissed');--> statement-breakpoint
CREATE TABLE "signal_watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" DEFAULT 'market_csgo' NOT NULL,
	"market_hash_name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"min_price_minor" bigint,
	"max_price_minor" bigint,
	"min_sales_count" integer,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "market_baseline_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" DEFAULT 'market_csgo' NOT NULL,
	"baseline_key" text NOT NULL,
	"currency" char(3) NOT NULL,
	"items_count" integer NOT NULL,
	"median_return_bps" integer NOT NULL,
	"dispersion_bps" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "item_price_feature" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" DEFAULT 'market_csgo' NOT NULL,
	"market_hash_name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"price_minor" bigint NOT NULL,
	"fair_value_minor" bigint NOT NULL,
	"reference_price_minor" bigint NOT NULL,
	"rolling_median_price_minor" bigint NOT NULL,
	"item_return_bps" integer NOT NULL,
	"baseline_return_bps" integer NOT NULL,
	"residual_bps" integer NOT NULL,
	"z_score_bps" integer,
	"volatility_bps" integer NOT NULL,
	"liquidity_score_bps" integer NOT NULL,
	"sales_count" integer,
	"quantity" integer,
	"cohort_key" text NOT NULL,
	"baseline_key" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "manual_position" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" DEFAULT 'market_csgo' NOT NULL,
	"market_hash_name" text NOT NULL,
	"buy_price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"bought_at" timestamp with time zone NOT NULL,
	"expected_unlock_at" timestamp with time zone NOT NULL,
	"actual_unlock_at" timestamp with time zone,
	"status" "manual_position_status" DEFAULT 'open' NOT NULL,
	"notes" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "trade_signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"position_id" uuid,
	"marketplace" "marketplace_code" DEFAULT 'market_csgo' NOT NULL,
	"market_hash_name" text NOT NULL,
	"side" "trade_signal_side" NOT NULL,
	"status" "trade_signal_status" DEFAULT 'new' NOT NULL,
	"price_minor" bigint NOT NULL,
	"fair_value_minor" bigint NOT NULL,
	"expected_profit_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"expected_edge_bps" integer NOT NULL,
	"confidence_bps" integer NOT NULL,
	"baseline_key" text NOT NULL,
	"residual_bps" integer NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "trade_signal" ADD CONSTRAINT "trade_signal_position_id_manual_position_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."manual_position"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signal_watchlist_marketplace_name_idx" ON "signal_watchlist" USING btree ("marketplace","market_hash_name");--> statement-breakpoint
CREATE INDEX "signal_watchlist_enabled_marketplace_idx" ON "signal_watchlist" USING btree ("enabled","marketplace");--> statement-breakpoint
CREATE INDEX "market_baseline_snapshot_key_observed_at_idx" ON "market_baseline_snapshot" USING btree ("marketplace","baseline_key","observed_at");--> statement-breakpoint
CREATE INDEX "item_price_feature_name_observed_at_idx" ON "item_price_feature" USING btree ("marketplace","market_hash_name","observed_at");--> statement-breakpoint
CREATE INDEX "item_price_feature_residual_observed_at_idx" ON "item_price_feature" USING btree ("residual_bps","observed_at");--> statement-breakpoint
CREATE INDEX "manual_position_status_unlock_idx" ON "manual_position" USING btree ("status","expected_unlock_at");--> statement-breakpoint
CREATE INDEX "manual_position_marketplace_name_idx" ON "manual_position" USING btree ("marketplace","market_hash_name");--> statement-breakpoint
CREATE INDEX "trade_signal_status_created_at_idx" ON "trade_signal" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trade_signal_side_name_observed_at_idx" ON "trade_signal" USING btree ("side","marketplace","market_hash_name","observed_at");
