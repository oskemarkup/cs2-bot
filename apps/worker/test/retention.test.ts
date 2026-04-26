import { describe, expect, it } from "vitest";
import { cleanupRetention, deleteInBatches } from "../src/retention.js";

describe("deleteInBatches", () => {
  it("deletes old rows in batches", async () => {
    const deletedIds = ["1", "2", "3"];
    const batchSizes: number[] = [];
    const pool = {
      query: async (_sql: string, params: unknown[]) => {
        const batchSize = params[1] as number;
        const rows = deletedIds.splice(0, batchSize).map((id) => ({ id }));

        batchSizes.push(rows.length);

        return { rows, rowCount: rows.length };
      }
    };

    await expect(deleteInBatches(pool, "delete sql", new Date("2026-01-01T00:00:00.000Z"), 2)).resolves.toBe(3);
    expect(batchSizes).toEqual([2, 1]);
  });
});

describe("cleanupRetention", () => {
  it("does not delete recent rows and logs deleted counts", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const cutoffs: Date[] = [];
    const pool = {
      query: async (queryText: string, params: unknown[]) => {
        if (queryText.includes("delete from")) {
          cutoffs.push(params[0] as Date);
        }

        return { rows: [], rowCount: 0 };
      }
    };

    await cleanupRetention({
      pool,
      config: {
        RAW_SNAPSHOT_RETENTION_DAYS: 7,
        HISTORY_SNAPSHOT_RETENTION_DAYS: 30,
        COLLECTOR_RUN_RETENTION_DAYS: 90
      },
      logger: {
        info: (payload) => logs.push(payload),
        error: () => undefined
      },
      batchSize: 10,
      now: new Date("2026-04-26T00:00:00.000Z")
    });

    expect(logs).toHaveLength(5);
    expect(logs.map((log) => log["deletedRows"])).toEqual([0, 0, 0, 0, 0]);
    expect(cutoffs.map((date) => date.toISOString())).toContain("2026-04-19T00:00:00.000Z");
    expect(cutoffs.map((date) => date.toISOString())).toContain("2026-03-27T00:00:00.000Z");
    expect(cutoffs.map((date) => date.toISOString())).toContain("2026-01-26T00:00:00.000Z");
  });
});
