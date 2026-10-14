/**
 * Starts the in-process job scheduler in development (and in production when
 * RUN_JOBS_IN_PROCESS=1). For multi-instance deployments run `pnpm worker`
 * or call /api/internal/cron from a scheduler instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const enabled = process.env.RUN_JOBS_IN_PROCESS ?? (process.env.NODE_ENV === "production" ? "0" : "1");
  if (enabled !== "1" || !process.env.DATABASE_URL) return;
  const { startScheduler } = await import("./server/scheduler");
  startScheduler();
}
