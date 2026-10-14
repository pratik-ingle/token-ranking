import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { setDb, type Db } from "@/db/client";
import * as schema from "@/db/schema";
import { ensureViews } from "@/db/views";
import { applyRuntimeSettings } from "@/server/settings";

/** A fresh in-memory Postgres (PGlite) with migrations and views applied. */
export async function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: resolve(import.meta.dirname, "..", "..", "drizzle") });
  await applyRuntimeSettings(db);
  await ensureViews(db);
  setDb(db);
  return {
    db,
    close: async () => {
      setDb(undefined);
      await client.close();
    },
  };
}

export async function createUser(
  db: Db,
  username: string,
  opts: { timezone?: string; visibility?: "public" | "hidden" } = {},
): Promise<{ id: string; username: string; timezone: string }> {
  const [u] = await db
    .insert(schema.users)
    .values({
      username,
      webauthnUserId: randomBytes(16).toString("base64url"),
      timezone: opts.timezone ?? "UTC",
      visibility: opts.visibility ?? "public",
    })
    .returning({ id: schema.users.id, username: schema.users.username, timezone: schema.users.timezone });
  return u!;
}
