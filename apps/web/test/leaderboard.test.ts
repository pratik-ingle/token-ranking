import { addDays, leaderboardQuerySchema, localDate, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { refreshViews } from "@/db/views";
import { ingestRows } from "@/server/ingest";
import { getLeaderboard, getMyRank, getUserByUsername, getUserStats } from "@/server/leaderboard";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`);
});

function row(date: string, total: number, over: Partial<UsageRow> = {}): UsageRow {
  return {
    date, source: "claude_code", model: "claude-sonnet-4-5", category: "coding",
    input_tokens: total, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0,
    ...over,
  };
}

async function seedUser(name: string, total: number, opts: { tz?: string; visibility?: "public" | "hidden"; extra?: UsageRow[]; trust?: "verified" | "self_reported" } = {}) {
  const tz = opts.tz ?? "UTC";
  const u = await createUser(db, name, { timezone: tz, visibility: opts.visibility });
  const today = localDate(Date.now(), tz);
  const rows = [row(today, total), ...(opts.extra ?? [])];
  await ingestRows(db, rows, { userId: u.id, timeZone: tz, trust: opts.trust ?? "self_reported", mode: opts.trust === "verified" ? "cloud" : "local" });
  return u;
}

const q = (over: Record<string, string> = {}) => leaderboardQuerySchema.parse({ window: "all", ...over });

describe("leaderboard ranking", () => {
  it("ranks with ties (1224) and gives tied users the same percentile", async () => {
    await seedUser("alice", 1000);
    await seedUser("bob", 800);
    await seedUser("carol", 800);
    await seedUser("dave", 100);
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries.map((e) => [e.username, e.rank])).toEqual([
      ["alice", 1], ["bob", 2], ["carol", 2], ["dave", 4],
    ]);
    expect(lb.total_ranked).toBe(4);
    const bob = await getUserByUsername(db, "bob");
    const carol = await getUserByUsername(db, "carol");
    const lbBob = await getLeaderboard(db, q(), bob);
    const lbCarol = await getLeaderboard(db, q(), carol);
    expect(lbBob.me).toMatchObject({ rank: 2, percentile_label: "Top 50%", listed: true });
    expect(lbCarol.me).toMatchObject({ rank: 2, percentile_label: "Top 50%", listed: true });
  });

  it("toggles cache tokens", async () => {
    await seedUser("cachey", 0, { extra: [] }).then(async (u) => {
      await ingestRows(db, [row(localDate(Date.now(), "UTC"), 10, { cache_read_tokens: 1_000_000 })], { userId: u.id, timeZone: "UTC", trust: "self_reported", mode: "local" });
    });
    await seedUser("fresh", 5000);
    await refreshViews(db);
    expect((await getLeaderboard(db, q(), null)).entries.map((e) => e.username)).toEqual(["cachey", "fresh"]);
    expect((await getLeaderboard(db, q({ cache: "false" }), null)).entries.map((e) => e.username)).toEqual(["fresh", "cachey"]);
  });

  it("filters by source, category and verified-only", async () => {
    await seedUser("coder", 900);
    await seedUser("apiuser", 500, { trust: "verified", extra: [] }).then(async (u) => {
      await ingestRows(db, [row(localDate(Date.now(), "UTC"), 700, { source: "openai_api", model: "gpt-5", category: "chat" })], { userId: u.id, timeZone: "UTC", trust: "verified", mode: "cloud" });
    });
    await refreshViews(db);
    expect((await getLeaderboard(db, q({ source: "openai_api" }), null)).entries.map((e) => e.username)).toEqual(["apiuser"]);
    expect((await getLeaderboard(db, q({ category: "coding" }), null)).entries.map((e) => [e.username, e.total_tokens])).toEqual([["coder", 900], ["apiuser", 500]]);
    const verified = await getLeaderboard(db, q({ verified: "true" }), null);
    expect(verified.entries).toHaveLength(1);
    expect(verified.entries[0]).toMatchObject({ username: "apiuser", total_tokens: 1200, verified_share: 1 });
  });

  it("does not list hidden users but tells them where they would rank", async () => {
    await seedUser("p1", 1000);
    await seedUser("p2", 500);
    await seedUser("shy", 700, { visibility: "hidden" });
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries.map((e) => e.username)).toEqual(["p1", "p2"]);
    const shy = (await getUserByUsername(db, "shy"))!;
    const mine = await getMyRank(db, shy, { window: "all", source: "all", category: "all", verified: false, cache: true });
    expect(mine).toMatchObject({ rank: 2, ranked_users: 3, listed: false, total: 700 });
    expect((await getLeaderboard(db, q(), shy)).me).toMatchObject({ rank: 2, listed: false, percentile_label: "Top 67%" });
  });

  it("excludes flagged days and duplicate-org integrations from rankings", async () => {
    await seedUser("honest", 1000);
    const cheat = await seedUser("cheater", 10);
    await ingestRows(db, [row(addDays(localDate(Date.now(), "UTC"), -1), 9_000_000_000)], { userId: cheat.id, timeZone: "UTC", trust: "self_reported", mode: "local" });
    const dup = await seedUser("dup", 10);
    await ingestRows(db, [row(localDate(Date.now(), "UTC"), 5000, { source: "openai_api", model: "gpt-5", category: "chat" })], { userId: dup.id, timeZone: "UTC", trust: "self_reported", mode: "local" });
    await db.execute(sql`UPDATE integrations SET status = 'duplicate' WHERE user_id = ${dup.id} AND source = 'openai_api'`);
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries.map((e) => [e.username, e.total_tokens])).toEqual([["honest", 1000], ["cheater", 10], ["dup", 10]]);
    const stats = await getUserStats(db, (await getUserByUsername(db, "cheater"))!);
    expect(stats.flagged_days).toBe(1);
  });

  it("evaluates windows in each user's own timezone", async () => {
    // Kiritimati (UTC+14) and Pago Pago (UTC-11) are always on different local dates.
    const east = await createUser(db, "east", { timezone: "Pacific/Kiritimati" });
    const west = await createUser(db, "west", { timezone: "Pacific/Pago_Pago" });
    const eastToday = localDate(Date.now(), "Pacific/Kiritimati");
    const westToday = localDate(Date.now(), "Pacific/Pago_Pago");
    expect(eastToday).not.toBe(westToday);
    await ingestRows(db, [row(eastToday, 100)], { userId: east.id, timeZone: "Pacific/Kiritimati", trust: "self_reported", mode: "local" });
    await ingestRows(db, [row(westToday, 50), row(addDays(westToday, -1), 999)], { userId: west.id, timeZone: "Pacific/Pago_Pago", trust: "self_reported", mode: "local" });
    await refreshViews(db);
    const today = await getLeaderboard(db, q({ window: "today" }), null);
    expect(today.entries.map((e) => [e.username, e.total_tokens])).toEqual([["east", 100], ["west", 50]]);
    const week = await getLeaderboard(db, q({ window: "7d" }), null);
    expect(week.entries.map((e) => [e.username, e.total_tokens])).toEqual([["west", 1049], ["east", 100]]);
  });

  it("computes streaks in the leaderboard view", async () => {
    const tz = "Asia/Kolkata";
    const today = localDate(Date.now(), tz);
    await seedUser("streaky", 10, { tz, extra: [row(addDays(today, -1), 10), row(addDays(today, -2), 10), row(addDays(today, -5), 10)] });
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries[0]).toMatchObject({ username: "streaky", current_streak: 3 });
    const stats = await getUserStats(db, (await getUserByUsername(db, "streaky"))!);
    expect(stats.streaks).toEqual({ current: 3, longest: 3, active_days: 4 });
  });
});
