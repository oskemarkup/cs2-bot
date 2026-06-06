# Production Deploy

This deployment runs PostgreSQL plus one `supercronic` scheduler container. Collector logs go to stdout/stderr and are visible through Docker Compose logs. Operational state remains in PostgreSQL.

## Initial Setup

```bash
git clone <repo-url>
cd cs2-bot
cp .env.example .env
$EDITOR .env
docker compose --env-file .env build
docker compose --env-file .env run --rm scheduler pnpm db:migrate
docker compose --env-file .env up -d
```

PostgreSQL is not exposed publicly by default. The API service is bound to `127.0.0.1:${API_PORT:-3000}`.

## Logs

```bash
docker compose logs -f scheduler
docker compose logs --since=1h scheduler
```

## Status

```bash
docker compose ps
docker compose exec postgres psql -U cs2arb -d cs2arb
```

If you changed `POSTGRES_USER` or `POSTGRES_DB` in `.env`, use those values in the `psql` command.

## Manual Collector Run

```bash
docker compose --env-file .env run --rm scheduler node apps/worker/dist/cli.js collect market-csgo
```

## Manual Signal Run

```bash
docker compose --env-file .env run --rm scheduler node apps/worker/dist/cli.js signals run
```

## Update

```bash
./deploy/deploy.sh
```

The script pulls the latest changes, rebuilds images, runs migrations through the scheduler image, and starts services in detached mode.

## Stop

```bash
docker compose down
```

Danger: `docker compose down -v` deletes the PostgreSQL data volume.

## Troubleshooting

Env not loaded: confirm `.env` exists and run Compose with `--env-file .env`. `docker compose --env-file .env config` should render the final configuration.

DB connection failed: confirm `DATABASE_URL` uses host `postgres`, port `5432`, and matches `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`.

Scheduler exits: run `docker compose logs scheduler` and check for invalid env, failed DB health checks, or crontab parse errors.

Collector fails: inspect recent runs and error messages:

```sql
select id, marketplace, status, started_at, finished_at, error_message
from collector_run
order by started_at desc
limit 20;
```

Check DB growth:

```sql
select pg_size_pretty(pg_database_size(current_database())) as db_size;
```

Check `raw_snapshot` is storing metadata-only bodies:

```sql
select marketplace, endpoint, response_body
from raw_snapshot
order by fetched_at desc
limit 5;
```

The JSON should contain metadata such as hashes, byte counts, and item counts rather than full API payloads.

Check signal snapshot retention:

```sql
select 'market_baseline_snapshot' as table_name, count(*) from market_baseline_snapshot
union all
select 'item_price_feature' as table_name, count(*) from item_price_feature
union all
select 'trade_signal' as table_name, count(*) from trade_signal;
```

`SIGNAL_SNAPSHOT_RETENTION_DAYS` controls baseline/feature snapshots. `TRADE_SIGNAL_RETENTION_DAYS` controls sent/dismissed signal retention; unsent `new` signals are kept.

Check collector runs:

```sql
select marketplace, status, count(*)
from collector_run
group by marketplace, status
order by marketplace, status;
```

Verify the schedule is running:

```bash
docker compose logs --since=2h scheduler
```

You should see hourly Market.CSGO collector logs, hourly signal logs, daily retention logs, and health logs every 10 minutes.
