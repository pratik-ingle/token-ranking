import {
  addDays,
  CATEGORY_LABELS,
  computeStreaks,
  dateRange,
  formatPercentile,
  heatmapRange,
  localDate,
  SOURCE_LABELS,
  WINDOWS,
  type BreakdownItem,
  type Category,
  type HeatmapResponse,
  type LeaderboardEntry,
  type LeaderboardQuery,
  type LeaderboardResponse,
  type LeaderboardWindow,
  type Source,
  type UserStatsResponse,
  type WindowRank,
} from "@tokenrank/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";
import { leaderboardViewName, WINDOW_FILTER } from "@/db/views";

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));

export interface RankFilter {
  window: LeaderboardWindow;
  source: Source | "all";
  category: Category | "all";
  verified: boolean;
  cache: boolean;
}

export interface PublicUser {
  id: string;
  username: string;
  visibility: "public" | "hidden";
  timezone: string;
  createdAt: Date;
}

function view(window: LeaderboardWindow): SQL {
  // Whitelisted identifiers only; never interpolate user input here.
  if (!WINDOWS.includes(window)) throw new Error("bad window");
  return sql.raw(`"${leaderboardViewName(window)}"`);
}

function partition(f: RankFilter): SQL {
  const source = f.source === "all" ? "*" : f.source;
  const category = f.category === "all" ? "*" : f.category;
  return sql`l.verified_only = ${f.verified} AND l.source = ${source} AND l.category = ${category}`;
}

const totalCol = (cache: boolean) => sql.raw(cache ? "l.t_all" : "l.t_nocache");
const rankCol = (cache: boolean) => sql.raw(cache ? "l.rank_all" : "l.rank_nocache");
const verifiedCol = (cache: boolean) => sql.raw(cache ? "l.v_all" : "l.v_nocache");

export async function getUserByUsername(db: Db, username: string): Promise<PublicUser | null> {
  const rows = rowsOf<{ id: string; username: string; visibility: "public" | "hidden"; timezone: string; created_at: string | Date }>(
    await db.execute(sql`SELECT id, username, visibility, timezone, created_at FROM users WHERE username = ${username.toLowerCase()} LIMIT 1`),
  );
  const u = rows[0];
  return u ? { id: u.id, username: u.username, visibility: u.visibility, timezone: u.timezone, createdAt: new Date(u.created_at) } : null;
}

export interface GlobalStats {
  total_tokens: number;
  total_tokens_nocache: number;
  user_count: number;
  active_users: number;
  refreshed_at: string | null;
}

export async function getGlobalStats(db: Db): Promise<GlobalStats> {
  const r = rowsOf<Record<string, unknown>>(await db.execute(sql`SELECT * FROM global_stats LIMIT 1`))[0];
  return {
    total_tokens: num(r?.total_tokens),
    total_tokens_nocache: num(r?.total_tokens_nocache),
    user_count: num(r?.user_count),
    active_users: num(r?.active_users),
    refreshed_at: r?.refreshed_at ? new Date(r.refreshed_at as string).toISOString() : null,
  };
}

async function refreshedAt(db: Db): Promise<string | null> {
  const r = rowsOf<{ value: string }>(await db.execute(sql`SELECT value FROM app_settings WHERE key = 'views_refreshed_at'`))[0];
  return r?.value ?? null;
}

interface MvRow {
  rank: number | string;
  username: string;
  total: number | string;
  verified: number | string;
  top_source: string | null;
  current_streak: number | string | null;
}

function toEntry(r: MvRow): LeaderboardEntry {
  const total = num(r.total);
  return {
    rank: num(r.rank),
    username: r.username,
    total_tokens: total,
    top_source: r.top_source,
    current_streak: num(r.current_streak),
    verified_share: total > 0 ? Math.min(1, num(r.verified) / total) : 0,
  };
}

/** Number of ranked (public) users in a partition. */
async function rankedCount(db: Db, f: RankFilter): Promise<number> {
  const r = rowsOf<{ n: number | string }>(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM ${view(f.window)} l JOIN users u ON u.id = l.user_id AND u.visibility = 'public'
      WHERE ${partition(f)} AND ${totalCol(f.cache)} > 0`),
  );
  return num(r[0]?.n);
}

/** The user's own total for a filter, computed live (used for hidden users and fresh data). */
async function liveTotal(db: Db, userId: string, f: RankFilter): Promise<{ total: number; verified: number }> {
  const conds: SQL[] = [sql`d.user_id = ${userId}`, sql`NOT d.flagged`, sql.raw(WINDOW_FILTER[f.window])];
  if (f.source !== "all") conds.push(sql`d.source = ${f.source}`);
  if (f.category !== "all") conds.push(sql`d.category = ${f.category}`);
  if (f.verified) conds.push(sql`d.trust_level = 'verified'`);
  const expr = f.cache
    ? sql.raw("d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens")
    : sql.raw("d.input_tokens + d.output_tokens");
  const r = rowsOf<{ total: string | number; verified: string | number }>(
    await db.execute(sql`
      SELECT coalesce(sum(${expr}), 0)::float8 AS total,
             coalesce(sum(${expr}) FILTER (WHERE d.trust_level = 'verified'), 0)::float8 AS verified
      FROM daily_usage d JOIN users u ON u.id = d.user_id
      WHERE ${sql.join(conds, sql` AND `)}
        AND NOT EXISTS (SELECT 1 FROM integrations i WHERE i.user_id = d.user_id AND i.source = d.source AND i.status = 'duplicate')`),
  );
  return { total: num(r[0]?.total), verified: num(r[0]?.verified) };
}

export interface MyRank {
  rank: number | null;
  total: number;
  verified: number;
  ranked_users: number;
  listed: boolean;
  /** 1-based position in the listing order (rank, then username) — for "jump to my rank". */
  position: number | null;
  top_source: string | null;
  current_streak: number;
}

/**
 * Rank for one user under a filter. Public users are read from the view.
 * Hidden users aren't in the view; their rank is where they *would* stand
 * among public users (1 + number of strictly greater totals).
 */
export async function getMyRank(db: Db, user: Pick<PublicUser, "id" | "username" | "visibility">, f: RankFilter): Promise<MyRank> {
  const n = await rankedCount(db, f);
  if (user.visibility === "public") {
    const r = rowsOf<MvRow & { position: number | string }>(
      await db.execute(sql`
        SELECT ${rankCol(f.cache)} AS rank, u.username, ${totalCol(f.cache)} AS total, ${verifiedCol(f.cache)} AS verified,
               l.top_source, s.current_streak,
               (SELECT count(*) FROM ${view(f.window)} l2 JOIN users u2 ON u2.id = l2.user_id AND u2.visibility = 'public'
                WHERE l2.verified_only = l.verified_only AND l2.source = l.source AND l2.category = l.category
                  AND ${sql.raw(f.cache ? "l2.t_all" : "l2.t_nocache")} > 0
                  AND (${sql.raw(f.cache ? "l2.rank_all" : "l2.rank_nocache")} < ${rankCol(f.cache)}
                       OR (${sql.raw(f.cache ? "l2.rank_all" : "l2.rank_nocache")} = ${rankCol(f.cache)} AND u2.username < u.username))
               ) + 1 AS position
        FROM ${view(f.window)} l
        JOIN users u ON u.id = l.user_id
        LEFT JOIN user_streaks s ON s.user_id = l.user_id
        WHERE ${partition(f)} AND l.user_id = ${user.id} AND ${totalCol(f.cache)} > 0`),
    )[0];
    if (r) {
      return {
        rank: num(r.rank), total: num(r.total), verified: num(r.verified), ranked_users: n, listed: true,
        position: num(r.position), top_source: r.top_source, current_streak: num(r.current_streak),
      };
    }
  }
  const mine = await liveTotal(db, user.id, f);
  const streak = rowsOf<{ current_streak: number }>(await db.execute(sql`SELECT current_streak FROM user_streaks WHERE user_id = ${user.id}`))[0];
  if (mine.total <= 0) {
    return { rank: null, total: 0, verified: 0, ranked_users: n, listed: false, position: null, top_source: null, current_streak: num(streak?.current_streak) };
  }
  const greater = rowsOf<{ n: number | string }>(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM ${view(f.window)} l JOIN users u ON u.id = l.user_id AND u.visibility = 'public'
      WHERE ${partition(f)} AND l.user_id <> ${user.id} AND ${totalCol(f.cache)} > ${mine.total}`),
  )[0];
  return {
    rank: num(greater?.n) + 1,
    total: mine.total,
    verified: mine.verified,
    ranked_users: n + 1,
    listed: false,
    position: null,
    top_source: null,
    current_streak: num(streak?.current_streak),
  };
}

export async function getLeaderboard(
  db: Db,
  q: LeaderboardQuery,
  me: Pick<PublicUser, "id" | "username" | "visibility"> | null,
): Promise<LeaderboardResponse> {
  const f: RankFilter = { window: q.window, source: q.source, category: q.category, verified: q.verified, cache: q.cache };
  const offset = (q.page - 1) * q.page_size;
  const rows = rowsOf<MvRow>(
    await db.execute(sql`
      SELECT ${rankCol(f.cache)} AS rank, u.username, ${totalCol(f.cache)} AS total, ${verifiedCol(f.cache)} AS verified,
             l.top_source, s.current_streak
      FROM ${view(f.window)} l
      JOIN users u ON u.id = l.user_id AND u.visibility = 'public'
      LEFT JOIN user_streaks s ON s.user_id = l.user_id
      WHERE ${partition(f)} AND ${totalCol(f.cache)} > 0
      ORDER BY ${rankCol(f.cache)}, u.username
      LIMIT ${q.page_size} OFFSET ${offset}`),
  );
  const total = await rankedCount(db, f);
  let meEntry: LeaderboardResponse["me"] = null;
  if (me) {
    const r = await getMyRank(db, me, f);
    if (r.rank !== null) {
      meEntry = {
        rank: r.rank,
        username: me.username,
        total_tokens: r.total,
        top_source: r.top_source,
        current_streak: r.current_streak,
        verified_share: r.total > 0 ? Math.min(1, r.verified / r.total) : 0,
        percentile_label: formatPercentile(r.rank, r.ranked_users),
        listed: r.listed,
        page: r.position ? Math.ceil(r.position / q.page_size) : Math.max(1, Math.ceil(r.rank / q.page_size)),
      };
    }
  }
  return {
    window: q.window,
    source: q.source,
    category: q.category,
    verified_only: q.verified,
    include_cache: q.cache,
    page: q.page,
    page_size: q.page_size,
    total_ranked: total,
    entries: rows.map(toEntry),
    me: meEntry,
    refreshed_at: await refreshedAt(db),
  };
}

export async function getWindowRanks(
  db: Db,
  user: Pick<PublicUser, "id" | "username" | "visibility">,
  opts: { cache?: boolean } = {},
): Promise<WindowRank[]> {
  const cache = opts.cache ?? true;
  const out: WindowRank[] = [];
  for (const window of WINDOWS) {
    const r = await getMyRank(db, user, { window, source: "all", category: "all", verified: false, cache });
    out.push({
      window,
      total_tokens: r.total,
      rank: r.rank,
      ranked_users: r.ranked_users,
      percentile_label: r.rank !== null ? formatPercentile(r.rank, r.ranked_users) : null,
    });
  }
  return out;
}

async function activeDayThreshold(db: Db): Promise<number> {
  const r = rowsOf<{ value: string }>(await db.execute(sql`SELECT value FROM app_settings WHERE key = 'active_day_min_tokens'`))[0];
  return Math.max(1, Number(r?.value ?? 1) || 1);
}

/** Per-day totals (excluding flagged days) for a user over a date range. */
async function dailyTotals(db: Db, userId: string, start?: string, end?: string): Promise<{ date: string; total_tokens: number }[]> {
  const rows = rowsOf<{ date: string; total: string | number }>(
    await db.execute(sql`
      SELECT date::text AS date, sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)::float8 AS total
      FROM daily_usage
      WHERE user_id = ${userId} AND NOT flagged
        ${start ? sql`AND date >= ${start}` : sql``}
        ${end ? sql`AND date <= ${end}` : sql``}
      GROUP BY date ORDER BY date`),
  );
  return rows.map((r) => ({ date: r.date, total_tokens: num(r.total) }));
}

export async function getUserStats(db: Db, user: PublicUser, opts: { cache?: boolean; now?: Date } = {}): Promise<UserStatsResponse> {
  const now = opts.now ?? new Date();
  const today = localDate(now, user.timezone);
  const totals = rowsOf<Record<string, string | number>>(
    await db.execute(sql`
      SELECT coalesce(sum(input_tokens), 0)::float8 AS input_tokens,
             coalesce(sum(output_tokens), 0)::float8 AS output_tokens,
             coalesce(sum(cache_read_tokens), 0)::float8 AS cache_read_tokens,
             coalesce(sum(cache_write_tokens), 0)::float8 AS cache_write_tokens,
             coalesce(sum(request_count), 0)::float8 AS request_count,
             coalesce(sum(image_count), 0)::float8 AS image_count,
             coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)
               FILTER (WHERE trust_level = 'verified'), 0)::float8 AS verified_total
      FROM daily_usage WHERE user_id = ${user.id} AND NOT flagged`),
  )[0] ?? {};
  const t = {
    input_tokens: num(totals.input_tokens),
    output_tokens: num(totals.output_tokens),
    cache_read_tokens: num(totals.cache_read_tokens),
    cache_write_tokens: num(totals.cache_write_tokens),
    request_count: num(totals.request_count),
    image_count: num(totals.image_count),
  };
  const totalTokens = t.input_tokens + t.output_tokens + t.cache_read_tokens + t.cache_write_tokens;

  const breakdown = async (column: "source" | "category" | "model", limit?: number): Promise<BreakdownItem[]> => {
    const rows = rowsOf<{ key: string; total: string | number }>(
      await db.execute(sql`
        SELECT ${sql.raw(column)}::text AS key,
               sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens)::float8 AS total
        FROM daily_usage WHERE user_id = ${user.id} AND NOT flagged
        GROUP BY 1 HAVING sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) > 0
        ORDER BY 2 DESC ${limit ? sql`LIMIT ${limit}` : sql``}`),
    );
    return rows.map((r) => ({
      key: r.key,
      label:
        column === "source" ? (SOURCE_LABELS[r.key as Source] ?? r.key)
        : column === "category" ? (CATEGORY_LABELS[r.key as Category] ?? r.key)
        : r.key,
      total_tokens: num(r.total),
    }));
  };

  const all = await dailyTotals(db, user.id);
  const streaks = computeStreaks({ days: all, today, minTokens: await activeDayThreshold(db) });
  const trendStart = addDays(today, -89);
  const byDate = new Map(all.map((d) => [d.date, d.total_tokens]));
  const daily = dateRange(trendStart, today).map((date) => ({ date, total_tokens: byDate.get(date) ?? 0 }));
  const flagged = rowsOf<{ n: number | string }>(
    await db.execute(sql`SELECT count(DISTINCT (date, source))::int AS n FROM daily_usage WHERE user_id = ${user.id} AND flagged`),
  )[0];

  return {
    username: user.username,
    timezone: user.timezone,
    joined: user.createdAt.toISOString(),
    totals: { total_tokens: totalTokens, ...t },
    windows: await getWindowRanks(db, user, { cache: opts.cache }),
    streaks: { current: streaks.current, longest: streaks.longest, active_days: streaks.active_days },
    by_source: await breakdown("source"),
    by_category: await breakdown("category"),
    top_models: await breakdown("model", 5),
    daily,
    verified_share: totalTokens > 0 ? Math.min(1, num(totals.verified_total) / totalTokens) : 0,
    flagged_days: num(flagged?.n),
  };
}

export async function getHeatmap(db: Db, user: PublicUser, year: number | null, now: Date = new Date()): Promise<HeatmapResponse> {
  const today = localDate(now, user.timezone);
  const { start, end } = heatmapRange(today, year);
  const days = await dailyTotals(db, user.id, start, end);
  const years = rowsOf<{ y: number | string }>(
    await db.execute(sql`SELECT DISTINCT extract(year FROM date)::int AS y FROM daily_usage WHERE user_id = ${user.id} AND NOT flagged ORDER BY 1 DESC`),
  ).map((r) => num(r.y));
  const currentYear = Number(today.slice(0, 4));
  const available = [...new Set([currentYear, ...years])].sort((a, b) => b - a);
  return { username: user.username, timezone: user.timezone, year, start, end, days, available_years: available };
}

/** Top N for the landing page preview. */
export async function getTopUsers(db: Db, n = 10, window: LeaderboardWindow = "30d"): Promise<LeaderboardEntry[]> {
  const res = await getLeaderboard(
    db,
    { window, source: "all", category: "all", verified: false, cache: true, page: 1, page_size: Math.max(10, n) },
    null,
  );
  return res.entries.slice(0, n);
}
