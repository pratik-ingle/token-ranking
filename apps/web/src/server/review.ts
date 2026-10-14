import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";
import { recomputeFlags } from "./ingest";

export interface FlaggedDay {
  user_id: string;
  username: string;
  date: string;
  source: string;
  total_tokens: number;
  image_count: number;
  rows: number;
  decision: string | null;
}

export async function listFlagged(db: Db, limit = 100): Promise<FlaggedDay[]> {
  const rows = rowsOf<Record<string, unknown>>(
    await db.execute(sql`
      SELECT d.user_id, u.username, d.date::text AS date, d.source::text AS source,
             sum(d.input_tokens + d.output_tokens + d.cache_read_tokens + d.cache_write_tokens)::float8 AS total_tokens,
             sum(d.image_count)::float8 AS image_count, count(*)::int AS rows, r.decision::text AS decision
      FROM daily_usage d
      JOIN users u ON u.id = d.user_id
      LEFT JOIN usage_reviews r ON r.user_id = d.user_id AND r.date = d.date AND r.source = d.source
      WHERE d.flagged
      GROUP BY d.user_id, u.username, d.date, d.source, r.decision
      ORDER BY d.date DESC LIMIT ${limit}`),
  );
  return rows.map((r) => ({
    user_id: String(r.user_id),
    username: String(r.username),
    date: String(r.date),
    source: String(r.source),
    total_tokens: Number(r.total_tokens),
    image_count: Number(r.image_count),
    rows: Number(r.rows),
    decision: (r.decision as string | null) ?? null,
  }));
}

/** Approve (rank it, up to the current total) or reject (keep excluded) a flagged day. */
export async function decideFlagged(db: Db, userId: string, date: string, source: string, decision: "approved" | "rejected"): Promise<void> {
  await db.execute(sql`
    INSERT INTO usage_reviews (user_id, date, source, decision, approved_total)
    SELECT ${userId}, ${date}::date, ${source}::usage_source, ${decision}::review_decision,
           coalesce(sum(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)
    FROM daily_usage WHERE user_id = ${userId} AND date = ${date}::date AND source = ${source}::usage_source
    ON CONFLICT (user_id, date, source) DO UPDATE SET decision = excluded.decision, approved_total = excluded.approved_total, decided_at = now()`);
  await recomputeFlags(db, userId, [{ date, source: source as never }]);
}
