import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { closeDb, getDb } from "../src/db/client";
import { ensureViews, refreshViews } from "../src/db/views";
import { applyRuntimeSettings } from "../src/server/settings";
import { loadEnv } from "./load-env";

loadEnv();
const db = getDb();
await migrate(db as never, { migrationsFolder: resolve(import.meta.dirname, "..", "drizzle") });
await applyRuntimeSettings(db);
const views = await ensureViews(db);
await refreshViews(db);
console.log(`Migrations applied; materialized views ${views}.`);
await closeDb();
