import { after } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { CLOUD_SOURCES, connectCloud, runCloudSync } from "@/server/integrations";
import { LIMITS } from "@/server/rate-limit";
import { getCurrentUser } from "@/server/session";

const bodySchema = z.strictObject({
  source: z.enum(CLOUD_SOURCES),
  api_key: z.string().trim().min(10).max(500),
  email: z.string().trim().max(254).optional(),
  team_wide: z.boolean().optional(),
  acknowledge_risk: z.literal(true),
});

/**
 * POST /api/me/integrations/cloud — opt-in cloud sync with a pasted admin key.
 * The key is validated against the provider, envelope-encrypted, never logged
 * and never sent back. The first sync runs right after the response.
 */
export const POST = api("POST /api/me/integrations/cloud", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`account:${me.id}`, LIMITS.auth);
  const parsed = bodySchema.safeParse(await readJson(req, 4_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Choose a provider, paste the key and confirm the warning.");
  const { source, api_key, email, team_wide } = parsed.data;
  const db = getDb();
  const res = await connectCloud(db, me, source, { apiKey: api_key, email: email || undefined, teamWide: team_wide });
  after(async () => {
    await runCloudSync(db, res.id);
  });
  return json({ id: res.id, status: res.status }, { status: 201 });
});
