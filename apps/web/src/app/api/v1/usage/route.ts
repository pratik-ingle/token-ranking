import { ingestPayloadSchema } from "@tokenrank/shared";
import { getDb } from "@/db/client";
import { requireToken } from "@/server/auth";
import { api, ApiError, clientIp, enforceRateLimit, json, readJson } from "@/server/http";
import { ingestRows } from "@/server/ingest";
import { requestRefreshSoon } from "@/server/jobs";
import { LIMITS } from "@/server/rate-limit";

/**
 * POST /api/v1/usage — upload aggregated daily rows.
 * Auth: Bearer personal ingest token (scope "ingest").
 * Body: a bare JSON array of 1..1000 rows with EXACTLY the ten allowed
 * fields; unknown fields are rejected. Rows are stored as self_reported.
 */
export const POST = api("POST /api/v1/usage", async (req) => {
  enforceRateLimit(`ingest-ip:${clientIp(req)}`, LIMITS.ingestPerIp);
  const user = await requireToken(req, "ingest");
  enforceRateLimit(`ingest-token:${user.tokenId}`, LIMITS.ingestPerToken);
  const body = await readJson(req, 1_000_000);
  const parsed = ingestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_payload", "Payload does not match the usage schema.", {
      issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path, message: i.message })),
    });
  }
  const db = getDb();
  const result = await ingestRows(db, parsed.data, {
    userId: user.id,
    timeZone: user.timezone,
    trust: "self_reported",
    mode: "local",
  });
  requestRefreshSoon(db);
  return json(result);
});
