import { sourceSchema } from "@tokenrank/shared";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireToken } from "@/server/auth";
import { api, ApiError, enforceRateLimit, json, readJson } from "@/server/http";
import { heartbeat } from "@/server/integrations";
import { LIMITS } from "@/server/rate-limit";

const bodySchema = z.strictObject({
  source: sourceSchema,
  /** sha256(source + ":" + org_id) computed by the collector; we HMAC it again. */
  org_fingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  status: z.enum(["ok", "error"]),
});

/** POST /api/v1/integrations/heartbeat — the collector registers a source before uploading. */
export const POST = api("POST /api/v1/integrations/heartbeat", async (req) => {
  const user = await requireToken(req, "ingest");
  enforceRateLimit(`ingest-token:${user.tokenId}`, LIMITS.ingestPerToken);
  const parsed = bodySchema.safeParse(await readJson(req, 10_000));
  if (!parsed.success) throw new ApiError(400, "invalid_payload", "Invalid heartbeat.");
  return json(await heartbeat(getDb(), user.id, parsed.data));
});
