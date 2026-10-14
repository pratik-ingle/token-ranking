import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { env } from "./env";

/** Copies env-configurable values the SQL views depend on into app_settings. */
export async function applyRuntimeSettings(db: Db): Promise<void> {
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES ('active_day_min_tokens', ${String(env.activeDayMinTokens)})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
}
