import { api, assertSameOrigin, json } from "@/server/http";
import { destroySession } from "@/server/session";

export const POST = api("POST /api/auth/logout", async (req) => {
  assertSameOrigin(req);
  await destroySession();
  return json({ ok: true });
});
