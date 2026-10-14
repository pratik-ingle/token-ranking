import { leaderboardQuerySchema, localDate, type Category, type Source, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { refreshViews } from "@/db/views";
import { ingestRows } from "@/server/ingest";
import {
  filterFromQuery,
  getContextView,
  getGlobalStats,
  getLeaderboard,
  getNeighbours,
  getUserByUsername,
  partitionSummary,
  type RankFilter,
} from "@/server/leaderboard";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`);
});

const today = () => localDate(Date.now(), "UTC");

function row(source: Source, category: Category, tokens: number, over: Partial<UsageRow> = {}): UsageRow {
  return {
    date: today(), source, model: `${source}-model`, category,
    input_tokens: tokens, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0,
    ...over,
  };
}

async function user(name: string, rows: UsageRow[], opts: { visibility?: "public" | "hidden"; trust?: "verified" | "self_reported" } = {}) {
  const u = await createUser(db, name, { timezone: "UTC", visibility: opts.visibility });
  if (rows.length) {
    await ingestRows(db, rows, { userId: u.id, timeZone: "UTC", trust: opts.trust ?? "self_reported", mode: opts.trust === "verified" ? "cloud" : "local" });
  }
  return u;
}

const q = (over: Record<string, string> = {}) => leaderboardQuerySchema.parse({ window: "all", ...over });
const f = (over: Partial<RankFilter> = {}): RankFilter => ({ window: "all", source: "all", category: "all", verified: false, cache: true, ...over });

describe("category mix and sources", () => {
  it("returns shares that sum to ~1 and sources ordered by tokens", async () => {
    await user("mixer", [
      row("claude_code", "coding", 700),
      row("openai_api", "chat", 100),
      row("openai_api", "agents", 150, { model: "gpt-agents" }),
      row("openai_api", "image_generation", 50, { model: "gpt-image-1" }),
    ]);
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    const e = lb.entries[0]!;
    expect(e.category_mix.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 10);
    expect(e.category_mix.map((c) => c.key)).toEqual(["coding", "agents", "chat", "image_generation"]);
    expect(e.category_mix[0]!.share).toBeCloseTo(0.7, 10);
    expect(e.sources).toEqual(["claude_code", "openai_api"]);
    expect(e.top_source).toBe("claude_code");
  });

  it("orders sources by the current category filter and mixes by the source filter", async () => {
    await user("multi", [
      row("claude_code", "coding", 100),
      row("cursor", "coding", 900),
      row("openai_api", "chat", 5000),
    ]);
    await refreshViews(db);
    const all = (await getLeaderboard(db, q(), null)).entries[0]!;
    expect(all.sources).toEqual(["openai_api", "cursor", "claude_code"]);
    const coding = (await getLeaderboard(db, q({ category: "coding" }), null)).entries[0]!;
    expect(coding.sources).toEqual(["cursor", "claude_code"]);
    expect(coding.total_tokens).toBe(1000);
    // Category filter dims segments in the UI; the mix itself still covers every category.
    expect(coding.category_mix.map((c) => c.key)).toEqual(["chat", "coding"]);
    const cursorOnly = (await getLeaderboard(db, q({ source: "cursor" }), null)).entries[0]!;
    expect(cursorOnly.category_mix).toEqual([{ key: "coding", share: 1 }]);
  });

  it("respects verified-only and the cache toggle", async () => {
    const u = await user("verif", [row("claude_code", "coding", 1000, { cache_read_tokens: 9000 })]);
    await ingestRows(db, [row("openai_api", "chat", 300)], { userId: u.id, timeZone: "UTC", trust: "verified", mode: "cloud" });
    await refreshViews(db);
    const verified = (await getLeaderboard(db, q({ verified: "true" }), null)).entries[0]!;
    expect(verified.sources).toEqual(["openai_api"]);
    expect(verified.category_mix).toEqual([{ key: "chat", share: 1 }]);
    const withCache = (await getLeaderboard(db, q(), null)).entries[0]!;
    expect(withCache.category_mix[0]).toMatchObject({ key: "coding" });
    expect(withCache.category_mix[0]!.share).toBeCloseTo(10000 / 10300, 10);
    const noCache = (await getLeaderboard(db, q({ cache: "false" }), null)).entries[0]!;
    expect(noCache.category_mix[0]!.share).toBeCloseTo(1000 / 1300, 10);
  });

  it("computes a hidden user's own mix live", async () => {
    await user("public1", [row("cursor", "coding", 50)]);
    const hidden = await user("shy", [row("claude_code", "coding", 30), row("gemini", "chat", 70)], { visibility: "hidden" });
    await refreshViews(db);
    const me = (await getUserByUsername(db, "shy"))!;
    const lb = await getLeaderboard(db, q(), me);
    expect(lb.me).toMatchObject({ listed: false, position: null, rank: 1, sources: ["gemini", "claude_code"], top_source: "gemini" });
    expect(lb.me!.category_mix.map((c) => c.key)).toEqual(["chat", "coding"]);
    expect(hidden.id).toBeTruthy();
  });
});

describe("hidden users never leak into others' numbers", () => {
  it("are excluded from entries, board totals, top totals and global stats", async () => {
    await user("pub_a", [row("claude_code", "coding", 100)]);
    await user("pub_b", [row("cursor", "coding", 300)]);
    await user("secret", [row("claude_code", "coding", 1_000_000), row("openai_api", "chat", 500_000)], { visibility: "hidden" });
    await refreshViews(db);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries.map((e) => e.username)).toEqual(["pub_b", "pub_a"]);
    expect(lb.board_total_tokens).toBe(400);
    expect(lb.top_total_tokens).toBe(300);
    expect(lb.total_ranked).toBe(2);
    expect(lb.entries.flatMap((e) => e.sources)).not.toContain("openai_api");
    expect((await getGlobalStats(db)).total_tokens).toBe(400);
  });

  it("are excluded immediately after switching to hidden, before the next refresh", async () => {
    const a = await user("was_public", [row("claude_code", "coding", 5000)]);
    await user("other", [row("cursor", "coding", 10)]);
    await refreshViews(db);
    await db.execute(sql`UPDATE users SET visibility = 'hidden' WHERE id = ${a.id}`);
    const lb = await getLeaderboard(db, q(), null);
    expect(lb.entries.map((e) => e.username)).toEqual(["other"]);
    expect(lb.board_total_tokens).toBe(10);
    expect(lb.top_total_tokens).toBe(10);
    const ctx = await getContextView(db, f(), 1);
    expect(ctx.top.map((e) => e.username)).toEqual(["other"]);
  });

  it("partitionSummary matches the listing under every filter", async () => {
    await user("p1", [row("claude_code", "coding", 10, { cache_read_tokens: 90 }), row("openai_api", "chat", 7)]);
    await user("p2", [row("openai_api", "chat", 20)], { trust: "verified" });
    await user("h1", [row("openai_api", "chat", 999)], { visibility: "hidden" });
    await refreshViews(db);
    for (const filter of [f(), f({ cache: false }), f({ source: "openai_api" }), f({ category: "chat" }), f({ verified: true })]) {
      const lb = await getLeaderboard(db, { ...filter, page: 1, page_size: 50 }, null);
      const summary = await partitionSummary(db, filter);
      expect(summary.ranked).toBe(lb.entries.length);
      expect(summary.total).toBe(lb.entries.reduce((s, e) => s + e.total_tokens, 0));
      expect(summary.top).toBe(lb.entries[0]?.total_tokens ?? 0);
    }
  });
});

describe("neighbours and the context view", () => {
  async function seedLadder(n: number) {
    for (let i = 1; i <= n; i++) {
      await user(`u${String(i).padStart(3, "0")}`, [row("claude_code", "coding", (n - i + 1) * 10)]);
    }
    await refreshViews(db);
  }

  it("returns position ±radius in listing order, clamped at the top", async () => {
    await seedLadder(30);
    const around = await getNeighbours(db, f(), 20, 3);
    expect(around.entries.map((e) => e.rank)).toEqual([17, 18, 19, 20, 21, 22, 23]);
    expect(around.start_position).toBe(17);
    expect(around.in_between).toBe(4); // positions 13..16
    const top = await getNeighbours(db, f(), 2, 3);
    expect(top.entries.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(top.in_between).toBe(0);
    const last = await getNeighbours(db, f(), 30, 3);
    expect(last.entries.map((e) => e.rank)).toEqual([27, 28, 29, 30]);
  });

  it("orders ties by username inside the window", async () => {
    for (const name of ["zed", "amy", "kim"]) await user(name, [row("cursor", "coding", 100)]);
    await user("top", [row("cursor", "coding", 1000)]);
    await refreshViews(db);
    const around = await getNeighbours(db, f(), 3, 1);
    expect(around.entries.map((e) => [e.username, e.rank])).toEqual([["amy", 2], ["kim", 2], ["zed", 2]]);
  });

  it("builds top 12 + gap + neighbours, or a single block inside the top 15", async () => {
    await seedLadder(40);
    const far = await getContextView(db, f(), 30);
    expect(far.top.map((e) => e.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(far.in_between).toBe(14); // 13..26
    expect(far.neighbours.map((e) => e.rank)).toEqual([27, 28, 29, 30, 31, 32, 33]);
    const near = await getContextView(db, f(), 15);
    expect(near.in_between).toBeNull();
    expect(near.neighbours).toEqual([]);
    expect(near.top.map((e) => e.rank)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("feeds the leaderboard me.position", async () => {
    await seedLadder(20);
    const me = (await getUserByUsername(db, "u017"))!;
    const lb = await getLeaderboard(db, q(), me);
    expect(lb.me).toMatchObject({ rank: 17, position: 17, listed: true });
    const ctx = await getContextView(db, filterFromQuery(q()), lb.me!.position!);
    expect(ctx.neighbours.find((e) => e.username === "u017")).toBeTruthy();
  });
});
