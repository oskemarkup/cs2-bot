import type pg from "pg";
import type { AppConfig } from "@cs2-bot/config";

export interface RetentionLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface RetentionCleanupOptions {
  readonly pool: Pick<pg.Pool, "query">;
  readonly config: Pick<
    AppConfig,
    | "RAW_SNAPSHOT_RETENTION_DAYS"
    | "HISTORY_SNAPSHOT_RETENTION_DAYS"
    | "COLLECTOR_RUN_RETENTION_DAYS"
    | "SIGNAL_SNAPSHOT_RETENTION_DAYS"
    | "TRADE_SIGNAL_RETENTION_DAYS"
  >;
  readonly logger: RetentionLogger;
  readonly batchSize?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupTarget {
  readonly table: string;
  readonly cutoff: Date;
  readonly sql: string;
  readonly skippedReason?: string | undefined;
}

export async function cleanupRetention(options: RetentionCleanupOptions): Promise<void> {
  const batchSize = options.batchSize ?? 1_000;
  const now = options.now ?? new Date();
  const rawCutoff = daysBefore(now, options.config.RAW_SNAPSHOT_RETENTION_DAYS);
  const historyCutoff = daysBefore(now, options.config.HISTORY_SNAPSHOT_RETENTION_DAYS);
  const collectorRunCutoff = daysBefore(now, options.config.COLLECTOR_RUN_RETENTION_DAYS);
  const signalSnapshotCutoff = daysBefore(now, options.config.SIGNAL_SNAPSHOT_RETENTION_DAYS);
  const tradeSignalCutoff = daysBefore(now, options.config.TRADE_SIGNAL_RETENTION_DAYS);

  await clearOldRawSnapshotReferences(options.pool, rawCutoff);

  const targets: CleanupTarget[] = [
    {
      table: "item_listing_snapshot",
      cutoff: historyCutoff,
      sql: deleteByTimestampSql("item_listing_snapshot", "observed_at")
    },
    {
      table: "sales_stats_snapshot",
      cutoff: historyCutoff,
      sql: deleteByTimestampSql("sales_stats_snapshot", "observed_at")
    },
    {
      table: "api_rate_limit_observation",
      cutoff: rawCutoff,
      sql: deleteByTimestampSql("api_rate_limit_observation", "observed_at")
    },
    {
      table: "market_baseline_snapshot",
      cutoff: signalSnapshotCutoff,
      sql: deleteByTimestampSql("market_baseline_snapshot", "observed_at")
    },
    {
      table: "item_price_feature",
      cutoff: signalSnapshotCutoff,
      sql: deleteByTimestampSql("item_price_feature", "observed_at")
    },
    {
      table: "trade_signal",
      cutoff: tradeSignalCutoff,
      sql: deleteOldResolvedTradeSignalsSql(),
      skippedReason: "new signals are kept until they are sent or dismissed"
    },
    {
      table: "raw_snapshot",
      cutoff: rawCutoff,
      sql: deleteByTimestampSql("raw_snapshot", "fetched_at")
    },
    {
      table: "collector_run",
      cutoff: collectorRunCutoff,
      sql: deleteCollectorRunsSql(),
      skippedReason: "rows with remaining dependent records are kept"
    }
  ];

  for (const target of targets) {
    const deletedRows = await deleteInBatches(options.pool, target.sql, target.cutoff, batchSize);

    options.logger.info(
      {
        table: target.table,
        deletedRows,
        cutoff: target.cutoff.toISOString(),
        skippedReason: target.skippedReason
      },
      "retention cleanup deleted rows"
    );
  }
}

function deleteOldResolvedTradeSignalsSql(): string {
  return `
    with doomed as (
      select id
      from trade_signal
      where created_at < $1
        and status <> 'new'
      order by created_at
      limit $2
    )
    delete from trade_signal
    using doomed
    where trade_signal.id = doomed.id
    returning trade_signal.id
  `;
}

export async function deleteInBatches(
  pool: Pick<pg.Pool, "query">,
  queryText: string,
  cutoff: Date,
  batchSize: number
): Promise<number> {
  let totalDeleted = 0;

  for (;;) {
    const result = await pool.query<{ id: string }>(queryText, [cutoff, batchSize]);
    const deletedRows = result.rowCount ?? result.rows.length;

    totalDeleted += deletedRows;

    if (deletedRows < batchSize) {
      return totalDeleted;
    }
  }
}

function deleteByTimestampSql(table: string, timestampColumn: string): string {
  return `
    with doomed as (
      select id
      from ${table}
      where ${timestampColumn} < $1
      order by ${timestampColumn}
      limit $2
    )
    delete from ${table}
    using doomed
    where ${table}.id = doomed.id
    returning ${table}.id
  `;
}

function deleteCollectorRunsSql(): string {
  return `
    with doomed as (
      select id
      from collector_run cr
      where cr.started_at < $1
        and not exists (select 1 from raw_snapshot rs where rs.collector_run_id = cr.id)
        and not exists (select 1 from api_rate_limit_observation ao where ao.collector_run_id = cr.id)
        and not exists (select 1 from item_listing_snapshot ils where ils.collector_run_id = cr.id)
        and not exists (select 1 from sales_stats_snapshot sss where sss.collector_run_id = cr.id)
      order by cr.started_at
      limit $2
    )
    delete from collector_run
    using doomed
    where collector_run.id = doomed.id
    returning collector_run.id
  `;
}

async function clearOldRawSnapshotReferences(pool: Pick<pg.Pool, "query">, cutoff: Date): Promise<void> {
  const params = [cutoff];

  await pool.query(
    `
      update api_rate_limit_observation ao
      set raw_snapshot_id = null
      from raw_snapshot rs
      where ao.raw_snapshot_id = rs.id
        and rs.fetched_at < $1
    `,
    params
  );
  await pool.query(
    `
      update item_listing_snapshot ils
      set raw_snapshot_id = null
      from raw_snapshot rs
      where ils.raw_snapshot_id = rs.id
        and rs.fetched_at < $1
    `,
    params
  );
  await pool.query(
    `
      update sales_stats_snapshot sss
      set raw_snapshot_id = null
      from raw_snapshot rs
      where sss.raw_snapshot_id = rs.id
        and rs.fetched_at < $1
    `,
    params
  );
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);
}
