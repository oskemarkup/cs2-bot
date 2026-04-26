import { describe, expect, it, vi } from "vitest";
import { chunkArray, insertInBatches, type BatchInsertLogger } from "../src/index.js";

describe("chunkArray", () => {
  it("chunks 0, 1, 250, 251, and 501 rows", () => {
    expect(chunkArray([], 250)).toEqual([]);
    expect(chunkArray([1], 250).map((chunk) => chunk.length)).toEqual([1]);
    expect(chunkArray(Array.from({ length: 250 }, (_, index) => index), 250).map((chunk) => chunk.length)).toEqual([250]);
    expect(chunkArray(Array.from({ length: 251 }, (_, index) => index), 250).map((chunk) => chunk.length)).toEqual([250, 1]);
    expect(chunkArray(Array.from({ length: 501 }, (_, index) => index), 250).map((chunk) => chunk.length)).toEqual([250, 250, 1]);
  });
});

describe("insertInBatches", () => {
  it("does nothing for 0 rows and succeeds", async () => {
    const insertRows = vi.fn();

    await insertInBatches({ table: "item_listing_snapshot", rows: [], insertRows });

    expect(insertRows).not.toHaveBeenCalled();
  });

  it("inserts 501 rows as 3 batches with batch size 250", async () => {
    const insertRows = vi.fn(async () => undefined);

    await insertInBatches({
      table: "item_listing_snapshot",
      rows: Array.from({ length: 501 }, (_, index) => ({ index })),
      batchSize: 250,
      insertRows
    });

    expect(insertRows).toHaveBeenCalledTimes(3);
    expect(insertRows.mock.calls.map((call) => call[0].length)).toEqual([250, 250, 1]);
  });

  it("logs batchIndex and table", async () => {
    const logs: Array<{ payload: Record<string, unknown>; message: string }> = [];
    const logger: BatchInsertLogger = {
      info: (payload, message) => logs.push({ payload, message }),
      error: (payload, message) => logs.push({ payload, message })
    };

    await insertInBatches({
      table: "sales_stats_snapshot",
      rows: [{ id: 1 }, { id: 2 }],
      batchSize: 1,
      logger,
      insertRows: async () => undefined
    });

    expect(logs.some((log) => log.payload["table"] === "sales_stats_snapshot" && log.payload["batchIndex"] === 1)).toBe(true);
    expect(logs.some((log) => log.payload["table"] === "sales_stats_snapshot" && log.payload["batchIndex"] === 2)).toBe(true);
  });

  it("propagates DB error with table and batch context", async () => {
    await expect(
      insertInBatches({
        table: "item_listing_snapshot",
        rows: [{ id: 1 }, { id: 2 }],
        batchSize: 1,
        insertRows: async () => {
          throw new Error("db failed");
        }
      })
    ).rejects.toMatchObject({
      name: "BatchInsertError",
      table: "item_listing_snapshot",
      batchIndex: 1,
      batchRows: 1
    });
  });
});
