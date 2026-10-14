import { getDb } from "@/db/client";
import { optionalUser } from "@/server/auth";
import { api, ApiError, clientIp, enforceRateLimit, json } from "@/server/http";
import { getHeatmap, getUserByUsername } from "@/server/leaderboard";
import { LIMITS } from "@/server/rate-limit";

/** GET /api/v1/users/{username}/heatmap?year=2026 — daily totals in the user's timezone. */
export const GET = api<{ params: Promise<{ username: string }> }>("GET /api/v1/users/:username/heatmap", async (req, ctx) => {
  enforceRateLimit(`public:${clientIp(req)}`, LIMITS.publicApi);
  const { username } = await ctx.params;
  const db = getDb();
  const user = await getUserByUsername(db, username);
  const me = await optionalUser(req);
  if (!user || (user.visibility === "hidden" && me?.id !== user.id)) throw new ApiError(404, "not_found", "No such public profile.");
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : null;
  if (year !== null && (!Number.isInteger(year) || year < 2020 || year > 2100)) throw new ApiError(400, "invalid_year", "Invalid year.");
  return json(await getHeatmap(db, user, year));
});
