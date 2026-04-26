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

Collectors save every validated API response to `raw_snapshot` with status, headers, endpoint, params hash, and fetch timestamp. Normalized read-only data is stored in `item_listing_snapshot` and `sales_stats_snapshot`; ambiguous fields remain available in the raw JSON payload.

Collectors log every marketplace API request with `marketplace`, endpoint name, method, attempt, status, duration, and retryability. URLs in logs are sanitized so query params such as `key`, `token`, `api_key`, and `authorization` are redacted. Set `LOG_LEVEL=debug` before the command when you need more verbose logs.

`DB_INSERT_BATCH_SIZE` controls normalized snapshot insert batch size and defaults to `250`.

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
