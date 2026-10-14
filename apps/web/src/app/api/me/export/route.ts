import { getDb } from "@/db/client";
import { exportAccount } from "@/server/account";
import { api, ApiError } from "@/server/http";
import { getCurrentUser } from "@/server/session";

/** GET /api/me/export — download everything we store about you as JSON. */
export const GET = api("GET /api/me/export", async () => {
  const me = await getCurrentUser();
  if (!me) throw new ApiError(401, "unauthorized", "Sign in required.");
  const data = await exportAccount(getDb(), me.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="tokenrank-${me.username}.json"`,
      "Cache-Control": "no-store",
    },
  });
});
