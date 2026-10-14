import { ingestPayloadSchema } from "@tokenrank/shared";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { ingestRows } from "@/server/ingest";
import { requestRefreshSoon } from "@/server/jobs";
import { LIMITS } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

/**
 * POST /api/me/import — CSV import from the browser. The CSV is parsed
 * client-side; only aggregated rows (same strict schema as the ingest API)
 * arrive here.
 */
export const POST = api("POST /api/me/import", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`ingest-session:${me.id}`, LIMITS.ingestPerToken);
  const parsed = ingestPayloadSchema.safeParse(await readJson(req, 1_000_000));
  if (!parsed.success) {
    throw new ApiError(400, "invalid_payload", "Payload does not match the usage schema.", {
      issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const db = getDb();
  const result = await ingestRows(db, parsed.data, { userId: me.id, timeZone: me.timezone, trust: "self_reported", mode: "upload" });
  requestRefreshSoon(db);
  return json(result);
});
