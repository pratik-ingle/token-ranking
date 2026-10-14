import { addDays, localDate, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowsOf, type Db } from "@/db/client";
import { ingestRows } from "@/server/ingest";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`);
  userId = (await createUser(db, "alice")).id;
});

const today = localDate(Date.now(), "UTC");
const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  date: addDays(today, -1),
  source: "claude_code",
  model: "claude-sonnet-4-5",
  category: "coding",
  input_tokens: 100,
  output_tokens: 200,
  cache_read_tokens: 3000,
  cache_write_tokens: 400,
  request_count: 5,
  image_count: 0,
  ...over,
});

async function usage(): Promise<Array<Record<string, unknown>>> {
  return rowsOf(await db.execute(sql`SELECT date::text, source, model, input_tokens::int, output_tokens::int, trust_level, flagged FROM daily_usage WHERE user_id = ${userId} ORDER BY date, model`));
}

describe("ingestRows", () => {
  const opts = () => ({ userId, timeZone: "UTC", trust: "self_reported" as const, mode: "local" as const });

  it("inserts rows and reports counts", async () => {
    const res = await ingestRows(db, [row(), row({ model: "claude-opus-4-5" })], opts());
    expect(res).toEqual({ accepted: 2, inserted: 2, updated: 0, skipped_verified: 0, flagged: 0 });
    expect(await usage()).toHaveLength(2);
  });

  it("is idempotent: re-syncing the same day replaces instead of adding", async () => {
    await ingestRows(db, [row()], opts());
    const again = await ingestRows(db, [row()], opts());
    expect(again).toMatchObject({ inserted: 0, updated: 1 });
    await ingestRows(db, [row()], opts());
    const rows = await usage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ input_tokens: 100, output_tokens: 200 });
  });

  it("replaces values with newer, larger aggregates of the same day", async () => {
    await ingestRows(db, [row()], opts());
    await ingestRows(db, [row({ input_tokens: 150, output_tokens: 250 })], opts());
    expect((await usage())[0]).toMatchObject({ input_tokens: 150, output_tokens: 250 });
  });

  it("supports increment semantics for OTLP deltas", async () => {
    await ingestRows(db, [row()], { ...opts(), semantics: "increment" });
    await ingestRows(db, [row()], { ...opts(), semantics: "increment" });
    expect((await usage())[0]).toMatchObject({ input_tokens: 200, output_tokens: 400 });
  });

  it("never lets a self-reported upload overwrite verified data", async () => {
    await ingestRows(db, [row({ source: "openai_api", model: "gpt-5", category: "chat" })], { ...opts(), trust: "verified", mode: "cloud" });
    const res = await ingestRows(db, [row({ source: "openai_api", model: "gpt-5", category: "chat", input_tokens: 999_999 })], opts());
    expect(res.skipped_verified).toBe(1);
    expect((await usage())[0]).toMatchObject({ input_tokens: 100, trust_level: "verified" });
    // ...but verified data may replace self-reported data.
    await ingestRows(db, [row({ input_tokens: 1 })], opts());
    await ingestRows(db, [row({ input_tokens: 2 })], { ...opts(), trust: "verified", mode: "cloud" });
    expect((await usage()).find((r) => r.source === "claude_code")).toMatchObject({ input_tokens: 2, trust_level: "verified" });
  });

  it("rejects rows dated after the user's local tomorrow", async () => {
    const now = new Date("2026-03-04T20:00:00Z"); // already Mar 5 in Tokyo
    await expect(ingestRows(db, [row({ date: "2026-03-06" })], { ...opts(), timeZone: "Asia/Tokyo", now })).resolves.toBeTruthy();
    await expect(ingestRows(db, [row({ date: "2026-03-07" })], { ...opts(), timeZone: "Asia/Tokyo", now })).rejects.toMatchObject({ status: 400 });
    await expect(ingestRows(db, [row({ date: "2026-03-06" })], { ...opts(), timeZone: "America/Los_Angeles", now })).rejects.toMatchObject({ status: 400 });
  });

  it("flags days above the per-source sanity limit and unflags when corrected", async () => {
    const huge = row({ cache_read_tokens: 6_000_000_000 });
    const res = await ingestRows(db, [huge, row({ model: "claude-haiku-4-5" })], opts());
    expect(res.flagged).toBe(2); // the whole (date, source) day is held for review
    expect((await usage()).every((r) => r.flagged === true)).toBe(true);
    await ingestRows(db, [row()], opts());
    expect((await usage()).every((r) => r.flagged === false)).toBe(true);
  });

  it("respects moderator approval up to the approved total", async () => {
    const date = addDays(today, -1);
    await ingestRows(db, [row({ cache_read_tokens: 6_000_000_000 })], opts());
    await db.execute(sql`INSERT INTO usage_reviews (user_id, date, source, decision, approved_total) VALUES (${userId}, ${date}, 'claude_code', 'approved', 6000000700)`);
    await ingestRows(db, [row({ cache_read_tokens: 6_000_000_000 })], opts());
    expect((await usage())[0]!.flagged).toBe(false);
    await ingestRows(db, [row({ cache_read_tokens: 7_000_000_000 })], opts());
    expect((await usage())[0]!.flagged).toBe(true);
  });

  it("registers the integration and updates last sync", async () => {
    await ingestRows(db, [row(), row({ source: "codex_cli", model: "gpt-5-codex" })], opts());
    const ints = rowsOf<{ source: string; mode: string; status: string }>(
      await db.execute(sql`SELECT source, mode, status FROM integrations WHERE user_id = ${userId} ORDER BY source`),
    );
    expect(ints).toEqual([
      { source: "claude_code", mode: "local", status: "active" },
      { source: "codex_cli", mode: "local", status: "active" },
    ]);
  });
});
