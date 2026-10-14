import { getDb } from "@/db/client";
import { env } from "@/server/env";
import { api, ApiError, json } from "@/server/http";
import { safeEqual } from "@/server/crypto";
import { cleanupExpired, refreshLeaderboards, syncDueIntegrations } from "@/server/jobs";

/**
 * POST /api/internal/cron?job=refresh|sync|cleanup — for serverless cron
 * (e.g. Vercel Cron). Authorization: Bearer $CRON_SECRET.
 * Self-hosted deployments can run `pnpm worker` instead.
 */
export const POST = api("POST /api/internal/cron", async (req) => {
  const secret = env.cronSecret;
  const got = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  if (!secret || !safeEqual(got, secret)) throw new ApiError(401, "unauthorized", "Bad cron secret.");
  const db = getDb();
  const job = req.nextUrl.searchParams.get("job") ?? "refresh";
  if (job === "refresh") return json({ refreshed_ms: await refreshLeaderboards(db) });
  if (job === "sync") return json(await syncDueIntegrations(db));
  if (job === "cleanup") {
    await cleanupExpired(db);
    return json({ ok: true });
  }
  throw new ApiError(400, "unknown_job", "Unknown job.");
});
export const GET = POST;
