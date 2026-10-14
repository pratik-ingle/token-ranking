import { getDb } from "@/db/client";
import { api, ApiError, assertSameOrigin, json } from "@/server/http";
import { removeIntegration } from "@/server/integrations";
import { getCurrentUser } from "@/server/session";

/** DELETE /api/me/integrations/{id}?delete_data=1 — revoke (and optionally delete its data). */
export const DELETE = api<{ params: Promise<{ id: string }> }>("DELETE /api/me/integrations/:id", async (req, ctx) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(404, "not_found", "No such integration.");
  const deleteData = req.nextUrl.searchParams.get("delete_data") === "1";
  if (!(await removeIntegration(getDb(), me.id, id, deleteData))) throw new ApiError(404, "not_found", "No such integration.");
  return json({ ok: true });
});
