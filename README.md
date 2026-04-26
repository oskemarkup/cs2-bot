# CS2 Arbitrage Analytics Bot

Read-only analytics skeleton for CS2 skin arbitrage across Market.CSGO, Skinport, CSFloat, and DMarket.

## Scope

Current scope is read-only collection and analytics groundwork. Sprint 1 adds Market.CSGO and Skinport collectors, raw API snapshots, rate-limit observations, normalized listing snapshots, and sales stats snapshots. The project does not automate Steam UI, Steam Guard, marketplace UI, rate-limit bypasses, proxy rotation, captcha handling, or execution of purchases/sales.

## Requirements

- Node.js 24 LTS
- pnpm 10+
- Docker and Docker Compose

Use the repository Node version before running project commands:

```bash
nvm use
```

The version is pinned in `.nvmrc` and should resolve to Node.js 24.

## Commands

```bash
nvm use
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm exec dotenv -e .env -- pnpm collect:market-csgo
pnpm exec dotenv -e .env -- pnpm collect:skinport
pnpm cleanup:retention
pnpm typecheck
pnpm test
pnpm lint
pnpm dev:api
pnpm dev:worker
pnpm dev:bot
```

For local development you can use `pnpm db:push` instead of migrations when you want Drizzle to sync the schema directly. For committed schema changes, prefer `pnpm db:generate` followed by `pnpm db:migrate`.

## Database Check

```bash
cp .env.example .env
docker compose up -d postgres redis
pnpm db:generate
pnpm db:migrate
TEST_DATABASE_URL=postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot pnpm test
```

If migrations already exist, skip `pnpm db:generate` and run only `pnpm db:migrate`.

## Workspace

- `apps/api` - Fastify HTTP API and health checks.
- `apps/worker` - BullMQ worker skeleton and read-only collector CLI entrypoints.
- `apps/bot` - manual checklist and alert review entrypoint.
- `packages/core` - shared money and utility types.
- `packages/db` - Drizzle schema and PostgreSQL client setup.
- `packages/connectors` - marketplace connector contracts, Zod response schemas, Market.CSGO/Skinport read-only connectors, and per-connector Bottleneck limiters.
- `packages/config` - environment validation.
- `packages/risk` - manual-execution-only guardrails.
- `packages/alerts` - alert contracts.
- `packages/backtest` - paper trading/backtest contracts.

## Manual Checklist

Before each sprint ends:

1. Run `pnpm typecheck`, `pnpm test`, and `pnpm lint`.
2. Confirm new marketplace response schemas are validated with Zod.
3. Confirm each connector has its own Bottleneck limiter.
4. Confirm money values are represented as integer minor units or PostgreSQL `numeric`.
5. Confirm new features are read-only, alert-only, paper-trading-only, or manual-checklist-only.
6. Confirm README commands and this checklist still match the implemented behavior.
7. Confirm collector CLI commands only perform GET requests and do not expose buy/sell/execution endpoints.

## Sprint 1 Collectors

Market.CSGO collector endpoints:

- `GET /api/v2/prices/USD.json`
- `GET /api/full-export/USD.json`
- `GET /api/v2/prices/class_instance/USD.json`
- `GET /api/v2/prices/orders/USD.json`
- `GET /api/v2/full-history/all.json`
- `GET /api/v2/full-history/{item_id}.json` through the connector option `historyItemId`
- `GET /api/v2/dictionary/names.json`

Skinport collector endpoints:

- `GET /v1/items?app_id=730&currency=USD&tradable=1`
- `GET /v1/sales/history?app_id=730&currency=USD`

Skinport requests set `Accept-Encoding: br`. Market.CSGO uses a conservative Bottleneck limiter of roughly 3 requests/sec. Skinport uses a reservoir limiter of 8 requests per 5 minutes.

Run collectors after PostgreSQL is available and migrations are applied:

```bash
pnpm db:migrate
pnpm exec dotenv -e .env -- pnpm collect:market-csgo
pnpm exec dotenv -e .env -- pnpm collect:skinport
```

Collectors save validated API response metadata to `raw_snapshot` with status, headers, endpoint, params hash, and fetch timestamp. `RAW_SNAPSHOT_MODE=all` stores the full raw JSON body, `metadata_only` stores hash/size/item-count metadata without the full body, and `sample_on_failure` stores metadata for successful responses plus a 500-character failure preview for failed responses. The development/test default is `all`; production should use `metadata_only`.

Collectors log every marketplace API request with `marketplace`, endpoint name, method, attempt, status, duration, and retryability. URLs in logs are sanitized so query params such as `key`, `token`, `api_key`, and `authorization` are redacted. Set `LOG_LEVEL=debug` before the command when you need more verbose logs.

`SNAPSHOT_STORAGE_MODE=full` preserves the append-only snapshot behavior and is the development/test default. `SNAPSHOT_STORAGE_MODE=current_and_changes` keeps `item_listing_current` and `sales_stats_current` up to date, inserts history only for new rows, changed rows, or unchanged rows whose last history row is older than `FORCE_FULL_HISTORY_EVERY_HOURS`, and skips fresh unchanged rows entirely. Production should use `current_and_changes`.

`CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES` controls how often unchanged current rows are touched and defaults to `60`. Set it to `0` to update `last_seen_at` on every run. This interval exists because PostgreSQL `UPDATE` creates new row versions, so repeatedly updating only `last_seen_at`/`updated_at` can grow the database even when history tables do not grow.

`DB_INSERT_BATCH_SIZE` controls normalized snapshot/current upsert batch size and defaults to `250`. `LOG_LEVEL=debug` enables per-batch insert details; at `info`, collectors only log bulk insert start and finish messages.

To verify unchanged current rows are skipped locally, run the same collector twice against a clean collector dataset:

```bash
SNAPSHOT_STORAGE_MODE=current_and_changes RAW_SNAPSHOT_MODE=metadata_only CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES=60 pnpm exec dotenv -e .env -- pnpm collect:skinport
SNAPSHOT_STORAGE_MODE=current_and_changes RAW_SNAPSHOT_MODE=metadata_only CURRENT_LAST_SEEN_UPDATE_INTERVAL_MINUTES=60 pnpm exec dotenv -e .env -- pnpm collect:skinport
```

The second run should not add duplicate history rows, should log high `skippedUnchanged`, should log `seenOnlyUpdated` near `0` when `last_seen_at` is fresh, and should not grow the database by tens of MB.

Retention cleanup is available after build as:

```bash
node apps/worker/dist/cli.js cleanup retention
```

For development:

```bash
pnpm cleanup:retention
```

Retention is controlled by `RAW_SNAPSHOT_RETENTION_DAYS=7`, `HISTORY_SNAPSHOT_RETENTION_DAYS=30`, and `COLLECTOR_RUN_RETENTION_DAYS=90`. Cleanup deletes in batches and logs deleted counts per table.

## Storage Diagnostics

Row counts by marketplace:

```sql
select marketplace, count(*) from item_listing_snapshot group by marketplace;
select marketplace, count(*) from sales_stats_snapshot group by marketplace;
select marketplace, count(*) from raw_snapshot group by marketplace;
```

Database size:

```sql
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

Table sizes with TOAST separated:

```sql
select
  c.relname as table_name,
  pg_size_pretty(pg_relation_size(c.oid)) as table_size,
  pg_size_pretty(pg_indexes_size(c.oid)) as indexes_size,
  pg_size_pretty(pg_total_relation_size(c.reltoastrelid)) as toast_size,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;
```

## Collector Troubleshooting

Market.CSGO `ECONNRESET` or `TypeError: terminated` means the remote server or network closed the connection mid-request. The HTTP client retries transient network failures with backoff; check the `api request failed` log line for `marketplace`, `endpoint`, `attempt`, and `retryable`.

Drizzle `RangeError: Maximum call stack size exceeded` during collector persistence usually means too many rows were sent to one `insert().values(...)`. Snapshot tables are inserted in batches now, so check `db batch insert failed` logs for `table`, `batchIndex`, and `batchRows` if a DB write fails.

To inspect recent collector runs:

```sql
select id, marketplace, status, started_at, finished_at, error_message
from collector_run
order by started_at desc
limit 20;
```

To run collectors with debug logging:

```bash
LOG_LEVEL=debug pnpm exec dotenv -e .env -- pnpm collect:market-csgo
LOG_LEVEL=debug pnpm exec dotenv -e .env -- pnpm collect:skinport
```

## Integration Tests

`packages/db/test/db.integration.test.ts` is skipped unless `TEST_DATABASE_URL` is set:

```bash
TEST_DATABASE_URL=postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot pnpm test
```
