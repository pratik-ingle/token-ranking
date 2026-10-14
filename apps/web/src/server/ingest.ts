import { addDays, localDate, SOURCES, usageRowKey, type IngestResponse, type Source, type TrustLevel, type UsageRow } from "@tokenrank/shared";
import { sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";
import { dailyUsage } from "@/db/schema";
import { env } from "./env";
import { ApiError } from "./http";

export interface IngestOptions {
  userId: string;
  /** The user's timezone; rows dated after their local tomorrow are rejected. */
  timeZone: string;
  /** Decided by the server: "verified" only for server-side cloud sync. */
  trust: TrustLevel;
  /** How the data arrived; local/upload integrations are registered automatically. */
  mode: "local" | "cloud" | "upload";
  /**
   * replace (default): idempotent — re-sending a day replaces its values.
   * increment: add to existing values (OTLP delta metrics only).
   */
  semantics?: "replace" | "increment";
  now?: Date;
}

/**
 * Upserts aggregated daily rows for one user.
 *
 * - Idempotent: unique key (user_id, date, source, model, category); values
 *   are replaced, never added, so re-syncing a day cannot double count.
 * - Verified rows (pulled by our own cloud sync) are never overwritten by
 *   self-reported uploads.
 * - Per-source daily totals above the sanity limit are flagged for review and
 *   excluded from rankings instead of being auto-ranked.
 */
export async function ingestRows(db: Db, rows: readonly UsageRow[], opts: IngestOptions): Promise<IngestResponse> {
  if (rows.length === 0) return { accepted: 0, inserted: 0, updated: 0, skipped_verified: 0, flagged: 0 };
  const now = opts.now ?? new Date();
  const maxDate = addDays(localDate(now, opts.timeZone), 1);
  const future = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.date > maxDate)
    .slice(0, 20)
    .map(({ i }) => ({ path: [i, "date"], message: `date is in the future for timezone ${opts.timeZone}` }));
  if (future.length) throw new ApiError(400, "invalid_payload", "Some rows are dated in the future.", { issues: future });

  const keys = new Set<string>();
  for (const r of rows) {
    const k = usageRowKey(r);
    if (keys.has(k)) throw new ApiError(400, "invalid_payload", "Duplicate (date, source, model, category) rows.");
    keys.add(k);
  }

  const increment = opts.semantics === "increment";
  const col = (name: string): SQL =>
    increment ? sql.raw(`daily_usage.${name} + excluded.${name}`) : sql.raw(`excluded.${name}`);

  return db.transaction(async (tx) => {
    const returned = await tx
      .insert(dailyUsage)
      .values(
        rows.map((r) => ({
          userId: opts.userId,
          date: r.date,
          source: r.source,
          model: r.model,
          category: r.category,
          inputTokens: r.input_tokens,
          outputTokens: r.output_tokens,
          cacheReadTokens: r.cache_read_tokens,
          cacheWriteTokens: r.cache_write_tokens,
          requestCount: r.request_count,
          imageCount: r.image_count,
          trustLevel: opts.trust,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [dailyUsage.userId, dailyUsage.date, dailyUsage.source, dailyUsage.model, dailyUsage.category],
        set: {
          inputTokens: col("input_tokens"),
          outputTokens: col("output_tokens"),
          cacheReadTokens: col("cache_read_tokens"),
          cacheWriteTokens: col("cache_write_tokens"),
          requestCount: col("request_count"),
          imageCount: col("image_count"),
          trustLevel: sql`excluded.trust_level`,
          updatedAt: sql`excluded.updated_at`,
        },
        setWhere: sql`NOT (daily_usage.trust_level = 'verified' AND excluded.trust_level = 'self_reported')`,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    const inserted = returned.filter((r) => r.inserted === true || (r.inserted as unknown) === "t").length;
    const updated = returned.length - inserted;
    const flagged = await recomputeFlags(tx as unknown as Db, opts.userId, rows);

    if (opts.mode !== "cloud") {
      const sources = [...new Set(rows.map((r) => r.source))];
      for (const source of sources) {
        await tx.execute(sql`
          INSERT INTO integrations (user_id, source, mode, status, last_synced_at)
          VALUES (${opts.userId}, ${source}::usage_source, ${opts.mode}::integration_mode, 'active', ${now})
          ON CONFLICT (user_id, source, mode) DO UPDATE SET
            last_synced_at = excluded.last_synced_at,
            status = CASE WHEN integrations.status = 'duplicate' THEN 'duplicate'::integration_status ELSE 'active'::integration_status END,
            status_detail = CASE WHEN integrations.status = 'duplicate' THEN integrations.status_detail ELSE NULL END`);
      }
    }

    return { accepted: rows.length, inserted, updated, skipped_verified: rows.length - returned.length, flagged };
  });
}

/**
 * Re-evaluates the review flag for every (date, source) touched by `rows`.
 * A day is flagged when its total exceeds the source's sanity limit (or the
 * image limit), unless a moderator approved at least that total; a rejected
 * day stays flagged. Returns the number of flagged rows in those days.
 */
export async function recomputeFlags(db: Db, userId: string, rows: ReadonlyArray<Pick<UsageRow, "date" | "source">>): Promise<number> {
  const pairs = [...new Map(rows.map((r) => [`${r.date}|${r.source}`, r])).values()];
  if (pairs.length === 0) return 0;
  const limits = env.sanityLimits;
  const limitValues = sql.join(
    SOURCES.map((s: Source) => sql`(${s}::usage_source, ${limits[s]}::float8)`),
    sql`, `,
  );
  const pairList = sql.join(
    pairs.map((p) => sql`(${p.date}::date, ${p.source}::usage_source)`),
    sql`, `,
  );
  await db.execute(sql`
    WITH lim(source, max_total) AS (VALUES ${limitValues}),
    sums AS (
      SELECT d.date, d.source,
             sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens)::float8 AS total,
             sum(d.image_count)::float8 AS images
      FROM daily_usage d
      WHERE d.user_id = ${userId} AND (d.date, d.source) IN (${pairList})
      GROUP BY d.date, d.source
    ),
    decided AS (
      SELECT s.date, s.source,
        (
          (s.total > l.max_total OR s.images > ${env.imageSanityLimit}::float8)
          AND NOT EXISTS (
            SELECT 1 FROM usage_reviews r
            WHERE r.user_id = ${userId} AND r.date = s.date AND r.source = s.source
              AND r.decision = 'approved' AND r.approved_total >= s.total
          )
        ) OR EXISTS (
          SELECT 1 FROM usage_reviews r
          WHERE r.user_id = ${userId} AND r.date = s.date AND r.source = s.source AND r.decision = 'rejected'
        ) AS flag
      FROM sums s JOIN lim l ON l.source = s.source
    )
    UPDATE daily_usage d SET flagged = x.flag
    FROM decided x
    WHERE d.user_id = ${userId} AND d.date = x.date AND d.source = x.source AND d.flagged IS DISTINCT FROM x.flag`);
  const res = rowsOf<{ n: number | string }>(
    await db.execute(sql`
      SELECT count(*)::int AS n FROM daily_usage
      WHERE user_id = ${userId} AND flagged AND (date, source) IN (${pairList})`),
  );
  return Number(res[0]?.n ?? 0);
}
