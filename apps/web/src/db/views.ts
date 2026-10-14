import { WINDOWS, type LeaderboardWindow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { rowsOf } from "./client";

/**
 * Leaderboards are materialized views, one per time window, refreshed every
 * few minutes (REFRESH ... CONCURRENTLY, so reads never block).
 *
 * Windows are evaluated per user in THEIR timezone: "today" is each user's
 * own local today, "7d" their last 7 local dates, "year" their local
 * calendar year. Every user gets exactly the same number of local days.
 *
 * Each view holds, per (verified_only, source|'*', category|'*', user):
 * totals with and without cache tokens, the verified share, the user's top
 * source and RANK()s for both totals. Only public users are ranked; flagged
 * days and duplicate-org integrations are excluded.
 */

const LOCAL_TODAY = "(now() AT TIME ZONE u.timezone)::date";

export const WINDOW_FILTER: Record<LeaderboardWindow, string> = {
  today: `d.date = ${LOCAL_TODAY}`,
  "7d": `d.date BETWEEN ${LOCAL_TODAY} - 6 AND ${LOCAL_TODAY}`,
  "30d": `d.date BETWEEN ${LOCAL_TODAY} - 29 AND ${LOCAL_TODAY}`,
  year: `d.date BETWEEN date_trunc('year', now() AT TIME ZONE u.timezone)::date AND ${LOCAL_TODAY}`,
  all: "TRUE",
};

export function leaderboardViewName(window: LeaderboardWindow): string {
  return `leaderboard_${window === "7d" ? "7d" : window === "30d" ? "30d" : window}`;
}

function leaderboardViewSql(window: LeaderboardWindow): string {
  const name = leaderboardViewName(window);
  return `
CREATE MATERIALIZED VIEW "${name}" AS
WITH base AS (
  SELECT d.user_id, d.source::text AS source, d.category::text AS category, d.trust_level,
         sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens)::float8 AS t_all,
         sum(d.input_tokens + d.output_tokens)::float8 AS t_nocache
  FROM daily_usage d
  JOIN users u ON u.id = d.user_id AND u.visibility = 'public'
  WHERE NOT d.flagged
    AND ${WINDOW_FILTER[window]}
    AND NOT EXISTS (
      SELECT 1 FROM integrations i
      WHERE i.user_id = d.user_id AND i.source = d.source AND i.status = 'duplicate'
    )
  GROUP BY d.user_id, d.source, d.category, d.trust_level
),
expanded AS (
  SELECT false AS verified_only, b.* FROM base b
  UNION ALL
  SELECT true AS verified_only, b.* FROM base b WHERE b.trust_level = 'verified'
),
agg AS (
  SELECT verified_only, user_id,
         coalesce(source, '*') AS source,
         coalesce(category, '*') AS category,
         sum(t_all) AS t_all,
         sum(t_nocache) AS t_nocache,
         coalesce(sum(t_all) FILTER (WHERE trust_level = 'verified'), 0) AS v_all,
         coalesce(sum(t_nocache) FILTER (WHERE trust_level = 'verified'), 0) AS v_nocache
  FROM expanded
  GROUP BY GROUPING SETS (
    (verified_only, user_id),
    (verified_only, user_id, source),
    (verified_only, user_id, category),
    (verified_only, user_id, source, category)
  )
  HAVING sum(t_all) > 0
),
top_src AS (
  SELECT DISTINCT ON (verified_only, user_id) verified_only, user_id, source AS top_source
  FROM agg
  WHERE source <> '*' AND category = '*'
  ORDER BY verified_only, user_id, t_all DESC, source
)
SELECT a.verified_only, a.user_id, a.source, a.category,
       a.t_all, a.t_nocache, a.v_all, a.v_nocache, t.top_source,
       rank() OVER w_all AS rank_all,
       rank() OVER w_nocache AS rank_nocache,
       count(*) OVER w_part AS n_all,
       count(*) FILTER (WHERE a.t_nocache > 0) OVER w_part AS n_nocache
FROM agg a
LEFT JOIN top_src t ON t.verified_only = a.verified_only AND t.user_id = a.user_id
WINDOW w_part AS (PARTITION BY a.verified_only, a.source, a.category),
       w_all AS (PARTITION BY a.verified_only, a.source, a.category ORDER BY a.t_all DESC),
       w_nocache AS (PARTITION BY a.verified_only, a.source, a.category ORDER BY a.t_nocache DESC);
CREATE UNIQUE INDEX "${name}_pk" ON "${name}" (verified_only, source, category, user_id);
CREATE INDEX "${name}_rank_all_idx" ON "${name}" (verified_only, source, category, rank_all);
CREATE INDEX "${name}_rank_nocache_idx" ON "${name}" (verified_only, source, category, rank_nocache);
`;
}

const USER_STREAKS_SQL = `
CREATE MATERIALIZED VIEW user_streaks AS
WITH params AS (
  SELECT coalesce((SELECT value::bigint FROM app_settings WHERE key = 'active_day_min_tokens'), 1) AS min_tokens
),
local_today AS (
  SELECT id AS user_id, (now() AT TIME ZONE timezone)::date AS today FROM users
),
active AS (
  SELECT d.user_id, d.date
  FROM daily_usage d
  JOIN local_today t ON t.user_id = d.user_id
  CROSS JOIN params p
  WHERE NOT d.flagged AND d.date <= t.today
  GROUP BY d.user_id, d.date, p.min_tokens
  HAVING sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens) >= p.min_tokens
),
islands AS (
  SELECT user_id, date, date - (row_number() OVER (PARTITION BY user_id ORDER BY date))::int AS grp
  FROM active
),
runs AS (
  SELECT user_id, max(date) AS last_date, count(*)::int AS len
  FROM islands GROUP BY user_id, grp
)
SELECT t.user_id,
       coalesce(max(r.len) FILTER (WHERE r.last_date >= t.today - 1), 0)::int AS current_streak,
       coalesce(max(r.len), 0)::int AS longest_streak,
       coalesce(sum(r.len), 0)::int AS active_days,
       max(r.last_date) AS last_active
FROM local_today t
LEFT JOIN runs r ON r.user_id = t.user_id
GROUP BY t.user_id, t.today;
CREATE UNIQUE INDEX user_streaks_pk ON user_streaks (user_id);
`;

/**
 * Site-wide totals. Same population as the leaderboards: public users only,
 * flagged days and duplicate-org integrations excluded, so hidden users never
 * show up in anyone's numbers.
 */
const GLOBAL_STATS_SQL = `
CREATE MATERIALIZED VIEW global_stats AS
SELECT 1 AS id,
       coalesce(sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens), 0)::float8 AS total_tokens,
       coalesce(sum(d.input_tokens + d.output_tokens), 0)::float8 AS total_tokens_nocache,
       (SELECT count(*) FROM users WHERE visibility = 'public')::int AS user_count,
       count(DISTINCT d.user_id)::int AS active_users,
       now() AS refreshed_at
FROM daily_usage d
JOIN users u ON u.id = d.user_id AND u.visibility = 'public'
WHERE NOT d.flagged
  AND NOT EXISTS (
    SELECT 1 FROM integrations i
    WHERE i.user_id = d.user_id AND i.source = d.source AND i.status = 'duplicate'
  );
CREATE UNIQUE INDEX global_stats_pk ON global_stats (id);
`;

export const MATERIALIZED_VIEWS = [...WINDOWS.map(leaderboardViewName), "user_streaks", "global_stats"];

export function viewsSql(): string {
  return [...WINDOWS.map(leaderboardViewSql), USER_STREAKS_SQL, GLOBAL_STATS_SQL].join("\n");
}

async function sha256Hex(s: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create the views, or drop and re-create them when their SQL changed.
 * The definition hash is stored in app_settings.
 */
export async function ensureViews(db: Db): Promise<"created" | "unchanged"> {
  const definition = viewsSql();
  const hash = await sha256Hex(definition);
  const current = rowsOf<{ value: string }>(
    await db.execute(sql`SELECT value FROM app_settings WHERE key = 'views_hash'`),
  )[0]?.value;
  const existing = rowsOf<{ matviewname: string }>(
    await db.execute(sql`SELECT matviewname FROM pg_matviews WHERE schemaname = current_schema()`),
  ).map((r) => r.matviewname);
  if (current === hash && MATERIALIZED_VIEWS.every((v) => existing.includes(v))) return "unchanged";

  await db.transaction(async (tx) => {
    for (const v of MATERIALIZED_VIEWS) await tx.execute(sql.raw(`DROP MATERIALIZED VIEW IF EXISTS "${v}"`));
    for (const stmt of splitStatements(definition)) await tx.execute(sql.raw(stmt));
    await tx.execute(sql`
      INSERT INTO app_settings (key, value) VALUES ('views_hash', ${hash})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  });
  return "created";
}

function splitStatements(script: string): string[] {
  return script
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Refresh every view without blocking readers. Returns the duration in ms. */
export async function refreshViews(db: Db, which: readonly string[] = MATERIALIZED_VIEWS): Promise<number> {
  const started = Date.now();
  for (const v of which) {
    await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY "${v}"`));
  }
  await db.execute(sql`
    INSERT INTO app_settings (key, value) VALUES ('views_refreshed_at', ${new Date().toISOString()})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  return Date.now() - started;
}
