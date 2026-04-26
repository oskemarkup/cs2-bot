CREATE TYPE "public"."collector_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
ALTER TYPE "public"."marketplace" RENAME TO "marketplace_code";--> statement-breakpoint
CREATE TABLE "api_rate_limit_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_run_id" uuid NOT NULL,
	"raw_snapshot_id" uuid,
	"marketplace" "marketplace_code" NOT NULL,
	"endpoint" text NOT NULL,
	"limit" integer,
	"remaining" integer,
	"reset_at" timestamp with time zone,
	"retry_after_seconds" integer,
	"response_headers" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collector_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"marketplace" "marketplace_code" NOT NULL,
	"status" "collector_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "item_listing_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_run_id" uuid NOT NULL,
	"raw_snapshot_id" uuid,
	"marketplace" "marketplace_code" NOT NULL,
	"external_id" text NOT NULL,
	"market_hash_name" text NOT NULL,
	"price_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"quantity" integer,
	"raw_payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "marketplace_code" NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"base_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_run_id" uuid NOT NULL,
	"marketplace" "marketplace_code" NOT NULL,
	"endpoint" text NOT NULL,
	"request_url" text NOT NULL,
	"params_hash" char(64) NOT NULL,
	"status_code" integer NOT NULL,
	"response_headers" jsonb NOT NULL,
	"response_body" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_stats_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_run_id" uuid NOT NULL,
	"raw_snapshot_id" uuid,
	"marketplace" "marketplace_code" NOT NULL,
	"external_id" text,
	"market_hash_name" text NOT NULL,
	"currency" char(3) NOT NULL,
	"sales_count" integer,
	"min_price_minor" bigint,
	"max_price_minor" bigint,
	"avg_price_minor" bigint,
	"raw_payload" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_rate_limit_observation" ADD CONSTRAINT "api_rate_limit_observation_collector_run_id_collector_run_id_fk" FOREIGN KEY ("collector_run_id") REFERENCES "public"."collector_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_rate_limit_observation" ADD CONSTRAINT "api_rate_limit_observation_raw_snapshot_id_raw_snapshot_id_fk" FOREIGN KEY ("raw_snapshot_id") REFERENCES "public"."raw_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_listing_snapshot" ADD CONSTRAINT "item_listing_snapshot_collector_run_id_collector_run_id_fk" FOREIGN KEY ("collector_run_id") REFERENCES "public"."collector_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_listing_snapshot" ADD CONSTRAINT "item_listing_snapshot_raw_snapshot_id_raw_snapshot_id_fk" FOREIGN KEY ("raw_snapshot_id") REFERENCES "public"."raw_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_snapshot" ADD CONSTRAINT "raw_snapshot_collector_run_id_collector_run_id_fk" FOREIGN KEY ("collector_run_id") REFERENCES "public"."collector_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stats_snapshot" ADD CONSTRAINT "sales_stats_snapshot_collector_run_id_collector_run_id_fk" FOREIGN KEY ("collector_run_id") REFERENCES "public"."collector_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_stats_snapshot" ADD CONSTRAINT "sales_stats_snapshot_raw_snapshot_id_raw_snapshot_id_fk" FOREIGN KEY ("raw_snapshot_id") REFERENCES "public"."raw_snapshot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_rate_limit_observation_marketplace_observed_at_idx" ON "api_rate_limit_observation" USING btree ("marketplace","observed_at");--> statement-breakpoint
CREATE INDEX "collector_run_marketplace_started_at_idx" ON "collector_run" USING btree ("marketplace","started_at");--> statement-breakpoint
CREATE INDEX "item_listing_snapshot_marketplace_name_observed_at_idx" ON "item_listing_snapshot" USING btree ("marketplace","market_hash_name","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "marketplace_code_idx" ON "marketplace" USING btree ("code");--> statement-breakpoint
CREATE INDEX "raw_snapshot_run_endpoint_idx" ON "raw_snapshot" USING btree ("collector_run_id","endpoint");--> statement-breakpoint
CREATE INDEX "raw_snapshot_marketplace_fetched_at_idx" ON "raw_snapshot" USING btree ("marketplace","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_snapshot_params_hash_idx" ON "raw_snapshot" USING btree ("params_hash");--> statement-breakpoint
CREATE INDEX "sales_stats_snapshot_marketplace_name_observed_at_idx" ON "sales_stats_snapshot" USING btree ("marketplace","market_hash_name","observed_at");