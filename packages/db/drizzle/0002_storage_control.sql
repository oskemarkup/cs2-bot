CREATE TABLE "item_listing_current" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" NOT NULL,
	"identity_key" text NOT NULL,
	"external_id" text,
	"market_hash_name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"quantity" integer,
	"raw_payload" jsonb,
	"content_hash" char(64) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone NOT NULL,
	"last_history_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_stats_current" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" NOT NULL,
	"identity_key" text NOT NULL,
	"market_hash_name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"sales_count" integer,
	"min_price_minor" bigint,
	"max_price_minor" bigint,
	"avg_price_minor" bigint,
	"raw_payload" jsonb,
	"content_hash" char(64) NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"last_changed_at" timestamp with time zone NOT NULL,
	"last_history_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "item_listing_current_marketplace_identity_key_idx" ON "item_listing_current" USING btree ("marketplace","identity_key");--> statement-breakpoint
CREATE INDEX "item_listing_current_marketplace_name_idx" ON "item_listing_current" USING btree ("marketplace","market_hash_name");--> statement-breakpoint
CREATE INDEX "item_listing_current_last_seen_at_idx" ON "item_listing_current" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_stats_current_marketplace_identity_key_idx" ON "sales_stats_current" USING btree ("marketplace","identity_key");--> statement-breakpoint
CREATE INDEX "sales_stats_current_marketplace_name_idx" ON "sales_stats_current" USING btree ("marketplace","market_hash_name");--> statement-breakpoint
CREATE INDEX "sales_stats_current_last_seen_at_idx" ON "sales_stats_current" USING btree ("last_seen_at");
