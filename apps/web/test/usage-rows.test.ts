import { addDays, localDate, USAGE_ROW_FIELDS, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { ingestRows } from "@/server/ingest";
import { getTodayRows } from "@/server/usage-rows";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const row = (date: string, over: Partial<UsageRow> = {}): UsageRow => ({
  date, source: "claude_code", model: "claude-sonnet-4-5", category: "coding",
  input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 40, request_count: 2, image_count: 0,
  ...over,
});

describe("getTodayRows", () => {
  it("returns only the user's rows for their local today, with exactly the upload fields", async () => {
    await db.execute(sql`TRUNCATE users CASCADE`);
    const tz = "Pacific/Kiritimati"; // UTC+14: local today is usually ahead of UTC
    const u = await createUser(db, "today_user", { timezone: tz });
    const other = await createUser(db, "someone_else", { timezone: tz });
    const today = localDate(Date.now(), tz);
    await ingestRows(db, [row(today), row(today, { source: "openai_api", model: "gpt-5", category: "chat" }), row(addDays(today, -1))], {
      userId: u.id, timeZone: tz, trust: "self_reported", mode: "local",
    });
    await ingestRows(db, [row(today, { input_tokens: 999 })], { userId: other.id, timeZone: tz, trust: "self_reported", mode: "local" });

    const rows = await getTodayRows(db, u);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(Object.keys(r)).toEqual([...USAGE_ROW_FIELDS]);
      expect(r.date).toBe(today);
    }
    expect(rows.map((r) => r.source)).toEqual(["claude_code", "openai_api"]);
    expect(rows[0]).toEqual(row(today));
    expect(JSON.stringify(rows)).not.toMatch(/trust_level|flagged|user_id|updated_at/);
  });

  it("is empty when nothing was uploaded today", async () => {
    const u = await createUser(db, "nothing_today", { timezone: "UTC" });
    expect(await getTodayRows(db, u)).toEqual([]);
  });
});
