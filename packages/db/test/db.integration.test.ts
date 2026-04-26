import { describe, expect, it } from "vitest";
import { createDb } from "../src/index.js";

const databaseUrl = process.env["TEST_DATABASE_URL"];

describe.skipIf(!databaseUrl)("database integration", () => {
  it("connects to PostgreSQL", async () => {
    const { pool } = createDb(databaseUrl ?? "");

    try {
      const result = await pool.query<{ ok: number }>("select 1::int as ok");
      expect(result.rows[0]?.ok).toBe(1);
    } finally {
      await pool.end();
    }
  });
});
