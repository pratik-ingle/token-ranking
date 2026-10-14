import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, json } from "@/server/http";
import { getCurrentUser } from "@/server/session";
import { revokeIngestToken } from "@/server/tokens";

export const DELETE = api<{ params: Promise<{ id: string }> }>("DELETE /api/me/tokens/:id", async (req, ctx) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "No such token.");
  if (!(await revokeIngestToken(getDb(), me.id, id))) throw new ApiError(404, "not_found", "No such token.");
  return json({ ok: true });
});
