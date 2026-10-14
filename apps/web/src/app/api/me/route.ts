import { getDb } from "@/db/client";
import { deleteAccount } from "@/server/account";
import { api, ApiError, assertSameOrigin, json } from "@/server/http";
import { getCurrentUser, SESSION_COOKIE } from "@/server/session";
import { cookies } from "next/headers";

/** DELETE /api/me — hard-deletes the account and all data in this request. */
export const DELETE = api("DELETE /api/me", async (req) => {
  assertSameOrigin(req);
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const confirm = req.nextUrl.searchParams.get("confirm");
  if (confirm !== me.username) throw new ApiError(400, "confirmation_required", "Type your username to confirm.");
  await deleteAccount(getDb(), me.id);
  (await cookies()).set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return json({ deleted: true });
});
