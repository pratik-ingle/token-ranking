import { getDb } from "@/db/client";
import { cleanupExpired, refreshLeaderboards, syncDueIntegrations } from "./jobs";
import { errorSummary, log } from "./logger";

const g = globalThis as unknown as { __tokenrankScheduler?: boolean };

/**
 * Background jobs: leaderboard refresh every few minutes, cloud-sync sweep
 * (each integration syncs every 6 h) and cleanup. Runs in the standalone
 * worker (`pnpm worker`) or in-process during development.
 */
export function startScheduler(opts: { refreshMs?: number; syncSweepMs?: number; cleanupMs?: number } = {}): void {
  if (g.__tokenrankScheduler) return;
  g.__tokenrankScheduler = true;
  const refreshMs = opts.refreshMs ?? Number(process.env.REFRESH_INTERVAL_MS ?? 120_000);
  const syncSweepMs = opts.syncSweepMs ?? 15 * 60_000;
  const cleanupMs = opts.cleanupMs ?? 60 * 60_000;
  const safe = (job: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (e) {
      log.error("job_failed", { job, error: errorSummary(e) });
    }
  };
  const refresh = safe("refresh", () => refreshLeaderboards(getDb()));
  const sync = safe("sync", () => syncDueIntegrations(getDb()));
  const cleanup = safe("cleanup", () => cleanupExpired(getDb()));
  setTimeout(refresh, 5_000);
  setTimeout(sync, 20_000);
  setInterval(refresh, refreshMs).unref?.();
  setInterval(sync, syncSweepMs).unref?.();
  setInterval(cleanup, cleanupMs).unref?.();
  log.info("scheduler_started", { ms: refreshMs });
}
