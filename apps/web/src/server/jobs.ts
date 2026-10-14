import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { refreshViews } from "@/db/views";
import { dueCloudIntegrations, runCloudSync } from "./integrations";
import { errorSummary, log } from "./logger";

let refreshing = false;
let lastRefresh = 0;
let scheduled: ReturnType<typeof setTimeout> | null = null;
const MIN_REFRESH_GAP_MS = 30_000;

/**
 * Debounced refresh after new data arrives, so a first sync shows up on the
 * public board within seconds instead of at the next scheduled refresh.
 */
export function requestRefreshSoon(db: Db): void {
  if (scheduled) return;
  const wait = Math.max(5_000, lastRefresh + MIN_REFRESH_GAP_MS - Date.now());
  scheduled = setTimeout(() => {
    scheduled = null;
    void refreshLeaderboards(db);
  }, wait);
  scheduled.unref?.();
}

/** Refresh all leaderboard views (skips if a refresh is already running in this process). */
export async function refreshLeaderboards(db: Db): Promise<number | null> {
  if (refreshing) return null;
  refreshing = true;
  try {
    const ms = await refreshViews(db);
    lastRefresh = Date.now();
    log.info("views_refreshed", { ms });
    return ms;
  } catch (e) {
    log.error("views_refresh_failed", { error: errorSummary(e) });
    return null;
  } finally {
    refreshing = false;
  }
}

/** Sync every cloud integration that is due (every 6 hours). */
export async function syncDueIntegrations(db: Db): Promise<{ ok: number; failed: number }> {
  const ids = await dueCloudIntegrations(db);
  let ok = 0;
  let failed = 0;
  for (const id of ids) {
    const r = await runCloudSync(db, id);
    if (r.ok) ok++;
    else failed++;
  }
  if (ids.length) log.info("cloud_sync_batch", { ok, failed, integrations: ids.length });
  return { ok, failed };
}

/** Remove expired sessions, device codes and recovery tokens. */
export async function cleanupExpired(db: Db): Promise<void> {
  await db.execute(sql`DELETE FROM sessions WHERE expires_at < now()`);
  await db.execute(sql`DELETE FROM device_codes WHERE expires_at < now() - interval '1 day'`);
  await db.execute(sql`DELETE FROM recovery_tokens WHERE expires_at < now() - interval '1 day'`);
}
