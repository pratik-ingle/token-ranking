import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Driver-agnostic database type: node-postgres in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as unknown as { __tokenrankDb?: Db; __tokenrankPool?: Pool };

export function getDb(): Db {
  if (!globalForDb.__tokenrankDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (run `pnpm setup:env` and `pnpm db:start` for local development)");
    const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
    globalForDb.__tokenrankPool = pool;
    globalForDb.__tokenrankDb = drizzle(pool, { schema }) as unknown as Db;
  }
  return globalForDb.__tokenrankDb;
}

/** Test hook: inject a database (e.g. PGlite) instead of node-postgres. */
export function setDb(db: Db | undefined): void {
  globalForDb.__tokenrankDb = db;
}

export async function closeDb(): Promise<void> {
  await globalForDb.__tokenrankPool?.end();
  globalForDb.__tokenrankPool = undefined;
  globalForDb.__tokenrankDb = undefined;
}

/** Rows from db.execute() — node-postgres and PGlite both expose `.rows`. */
export function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export { schema };
