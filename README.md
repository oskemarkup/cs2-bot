# CS2 Arbitrage Analytics Bot

Read-only analytics skeleton for CS2 skin arbitrage across Market.CSGO, Skinport, CSFloat, and DMarket.

## Scope

This sprint only creates the monorepo foundation: apps, packages, env validation, database schema setup, Docker services, tests, and safety documentation. The project does not automate Steam UI, Steam Guard, marketplace UI, rate-limit bypasses, proxy rotation, captcha handling, or execution of purchases/sales.

## Requirements

- Node.js 24 LTS
- pnpm 10+
- Docker and Docker Compose

## Commands

```bash
corepack enable
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:generate
pnpm db:migrate
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
- `apps/worker` - BullMQ worker skeleton for read-only collection jobs.
- `apps/bot` - manual checklist and alert review entrypoint.
- `packages/core` - shared money and utility types.
- `packages/db` - Drizzle schema and PostgreSQL client setup.
- `packages/connectors` - marketplace connector contracts, Zod validation helpers, and per-connector rate limiters.
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

## Integration Tests

`packages/db/test/db.integration.test.ts` is skipped unless `TEST_DATABASE_URL` is set:

```bash
TEST_DATABASE_URL=postgresql://cs2_bot:cs2_bot@localhost:5432/cs2_bot pnpm test
```
