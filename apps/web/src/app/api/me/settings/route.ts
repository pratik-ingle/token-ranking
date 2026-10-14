import { visibilitySchema } from "@tokenrank/shared";
import { z } from "zod";
import { getDb } from "@/db/client";
import { updateSettings } from "@/server/account";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json, readJson } from "@/server/http";
import { LIMITS } from "@/server/rate-limit";
import { requestRefreshSoon } from "@/server/jobs";
import { getCurrentUser } from "@/server/session";

const bodySchema = z.strictObject({ visibility: visibilitySchema.optional(), timezone: z.string().max(64).optional() });

/** PATCH /api/me/settings — visibility (public | hidden) and timezone. */
export const PATCH = api("PATCH /api/me/settings", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`account:${me.id}`, LIMITS.account);
  const parsed = bodySchema.safeParse(await readJson(req, 2_000));
  if (!parsed.success) throw new ApiError(400, "invalid_request", "Invalid settings.");
  const db = getDb();
  await updateSettings(db, me.id, parsed.data);
  // Leaderboard queries check visibility live; the materialized views catch up here.
  if (parsed.data.visibility && parsed.data.visibility !== me.visibility) requestRefreshSoon(db);
  return json({ ok: true });
});
