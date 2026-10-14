import { localDate, USAGE_ROW_FIELDS, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { rowsOf } from "@/db/client";

/**
 * The user's stored rows for their local today, shaped exactly like an
 * upload (the ten USAGE_ROW_FIELDS, in order) — what "gets sent".
 */
export async function getTodayRows(db: Db, user: { id: string; timezone: string }, now: Date = new Date()): Promise<UsageRow[]> {
  const date = localDate(now, user.timezone);
  const rows = rowsOf<Record<string, string | number>>(
    await db.execute(sql`
      SELECT date::text AS date, source::text AS source, model, category::text AS category,
             input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, request_count, image_count
      FROM daily_usage
      WHERE user_id = ${user.id} AND date = ${date}
      ORDER BY source, model, category`),
  );
  return rows.map((r) => {
    const out: Record<string, string | number> = {};
    for (const f of USAGE_ROW_FIELDS) out[f] = f === "date" || f === "source" || f === "model" || f === "category" ? String(r[f]) : Number(r[f]);
    return out as unknown as UsageRow;
  });
}
