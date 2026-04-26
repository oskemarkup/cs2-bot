export interface BatchInsertLogger {
  info(payload: Record<string, unknown>, message: string): void;
  debug?(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface InsertInBatchesOptions<Row> {
  readonly table: string;
  readonly rows: readonly Row[];
  readonly batchSize?: number | undefined;
  readonly logger?: BatchInsertLogger | undefined;
  readonly insertRows: (rows: readonly Row[]) => Promise<unknown>;
}

export class BatchInsertError extends Error {
  readonly table: string;
  readonly batchIndex: number;
  readonly batchRows: number;

  constructor(options: {
    readonly table: string;
    readonly batchIndex: number;
    readonly batchRows: number;
    readonly cause: unknown;
  }) {
    const message = options.cause instanceof Error ? options.cause.message : "Unknown batch insert failure";

    super(`Failed to insert ${options.table} batch ${options.batchIndex}: ${message}`, { cause: options.cause });
    this.name = "BatchInsertError";
    this.table = options.table;
    this.batchIndex = options.batchIndex;
    this.batchRows = options.batchRows;
  }
}

export function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("chunk size must be a positive integer");
  }

  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

export async function insertInBatches<Row>(options: InsertInBatchesOptions<Row>): Promise<void> {
  const batchSize = options.batchSize ?? 250;
  const batches = chunkArray(options.rows, batchSize);

  options.logger?.info(
    {
      table: options.table,
      totalRows: options.rows.length,
      batchSize,
      batchIndex: null,
      batchRows: 0,
      durationMs: 0
    },
    "db batch insert started"
  );

  for (const [index, batch] of batches.entries()) {
    const batchIndex = index + 1;
    const startedAt = Date.now();

    try {
      await options.insertRows(batch);

      options.logger?.debug?.(
        {
          table: options.table,
          totalRows: options.rows.length,
          batchSize,
          batchIndex,
          batchRows: batch.length,
          durationMs: Date.now() - startedAt
        },
        "db batch inserted"
      );
    } catch (error) {
      options.logger?.error(
        {
          table: options.table,
          totalRows: options.rows.length,
          batchSize,
          batchIndex,
          batchRows: batch.length,
          durationMs: Date.now() - startedAt,
          err: error
        },
        "db batch insert failed"
      );

      throw new BatchInsertError({
        table: options.table,
        batchIndex,
        batchRows: batch.length,
        cause: error
      });
    }
  }

  options.logger?.info(
    {
      table: options.table,
      totalRows: options.rows.length,
      batchSize,
      batchCount: batches.length
    },
    "db batch insert finished"
  );
}
