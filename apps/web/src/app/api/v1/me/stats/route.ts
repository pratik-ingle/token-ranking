import { getDb } from "@/db/client";
import { requireUser } from "@/server/auth";
import { api, ApiError, json } from "@/server/http";
import { getUserByUsername, getUserStats } from "@/server/leaderboard";

/** GET /api/v1/me/stats — your own stats (also when your profile is hidden). */
export const GET = api("GET /api/v1/me/stats", async (req) => {
  const db = getDb();
  const me = await requireUser(req, "read", db);
  const user = await getUserByUsername(db, me.username);
  if (!user) throw new ApiError(404, "not_found", "Account not found.");
  const cache = req.nextUrl.searchParams.get("cache") !== "false";
  return json(await getUserStats(db, user, { cache }));
});
