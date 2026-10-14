import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { integrations } from "@/db/schema";
import { api, ApiError, assertSameOrigin, enforceRateLimit, json } from "@/server/http";
import { runCloudSync } from "@/server/integrations";
import { getCurrentUser } from "@/server/session";

/** POST /api/me/integrations/{id}/sync — run a cloud sync now. */
export const POST = api<{ params: Promise<{ id: string }> }>("POST /api/me/integrations/:id/sync", async (req, ctx) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  enforceRateLimit(`cloud-sync:${me.id}`, { limit: 5, windowMs: 10 * 60_000 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "No such integration.");
  const db = getDb();
  const row = (await db.select({ id: integrations.id }).from(integrations).where(and(eq(integrations.id, id), eq(integrations.userId, me.id), eq(integrations.mode, "cloud"))).limit(1))[0];
  if (!row) throw new ApiError(404, "not_found", "No such cloud integration.");
  return json(await runCloudSync(db, row.id));
});
