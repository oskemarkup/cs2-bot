import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export { schema };
export { and, eq, inArray, sql } from "drizzle-orm";
export * from "./schema.js";
export * from "./batch.js";

export function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  return { db, pool };
}
