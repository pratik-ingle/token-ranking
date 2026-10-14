import { addDays, localDate, type UsageRow } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { refreshViews } from "@/db/views";
import { ingestRows } from "@/server/ingest";
import { connectedSources } from "@/server/integrations";
import { getHeatmap, getUserByUsername, getUserStats } from "@/server/leaderboard";
import { createIngestToken } from "@/server/tokens";
import { createTestDb, createUser } from "./helpers/db";

// Route handlers read the session cookie; there is no request scope in tests.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());
beforeEach(async () => {
  await db.execute(sql`TRUNCATE users CASCADE`);
});

const tz = "Asia/Kolkata";
const today = () => localDate(Date.now(), tz);
const r = (date: string, category: UsageRow["category"], tokens: number, over: Partial<UsageRow> = {}): UsageRow => ({
  date, source: "claude_code", model: `m-${category}`, category,
  input_tokens: tokens, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0,
  ...over,
});

async function seed(name: string, rows: UsageRow[], visibility: "public" | "hidden" = "public") {
  const u = await createUser(db, name, { timezone: tz, visibility });
  await ingestRows(db, rows, { userId: u.id, timeZone: tz, trust: "self_reported", mode: "local" });
  return u;
}

describe("busiest day", () => {
  it("is the biggest non-flagged local day", async () => {
    const t = today();
    const u = await seed("busy", [r(addDays(t, -3), "coding", 500), r(addDays(t, -3), "chat", 200), r(addDays(t, -1), "coding", 600)]);
    // A flagged day (over the claude_code sanity limit) must not count.
    await ingestRows(db, [r(addDays(t, -2), "coding", 9_000_000_000)], { userId: u.id, timeZone: tz, trust: "self_reported", mode: "local" });
    const stats = await getUserStats(db, (await getUserByUsername(db, "busy"))!);
    expect(stats.busiest_day).toEqual({ date: addDays(t, -3), total_tokens: 700 });
    expect(stats.flagged_days).toBe(1);
  });

  it("is null without usage", async () => {
    await createUser(db, "empty", { timezone: tz });
    expect((await getUserStats(db, (await getUserByUsername(db, "empty"))!)).busiest_day).toBeNull();
  });
});

describe("heatmap per-category totals", () => {
  it("splits each day by category, sums to the day total and skips flagged days", async () => {
    const t = today();
    const u = await seed("cats", [
      r(t, "coding", 700),
      r(t, "agents", 220),
      r(t, "chat", 80, { source: "openai_api" }),
      r(addDays(t, -10), "image_generation", 5, { source: "openai_api", model: "gpt-image-1" }),
    ]);
    await ingestRows(db, [r(addDays(t, -5), "coding", 9_000_000_000)], { userId: u.id, timeZone: tz, trust: "self_reported", mode: "local" });
    const heat = await getHeatmap(db, (await getUserByUsername(db, "cats"))!, null);
    const day = heat.days.find((d) => d.date === t)!;
    expect(day.total_tokens).toBe(1000);
    expect(day.by_category).toEqual({ coding: 700, agents: 220, chat: 80 });
    expect(heat.days.find((d) => d.date === addDays(t, -10))?.by_category).toEqual({ image_generation: 5 });
    expect(heat.days.find((d) => d.date === addDays(t, -5))).toBeUndefined();
    for (const d of heat.days) {
      expect(Object.values(d.by_category ?? {}).reduce((a, b) => a + (b ?? 0), 0)).toBe(d.total_tokens);
    }
  });

  it("is served by the heatmap API with the same visibility rules", async () => {
    const t = today();
    await seed("open_user", [r(t, "coding", 10), r(t, "chat", 5)]);
    const secret = await seed("secret_user", [r(t, "coding", 99)], "hidden");
    await refreshViews(db);
    const { GET } = await import("@/app/api/v1/users/[username]/heatmap/route");
    const call = (username: string, auth?: string) =>
      GET(
        new NextRequest(`http://localhost:3000/api/v1/users/${username}/heatmap`, { headers: auth ? { authorization: auth } : {} }),
        { params: Promise.resolve({ username }) },
      );

    const open = await call("open_user");
    expect(open.status).toBe(200);
    const body = (await open.json()) as { days: Array<{ date: string; total_tokens: number; by_category: Record<string, number> }> };
    expect(body.days).toEqual([{ date: t, total_tokens: 15, by_category: { coding: 10, chat: 5 } }]);

    expect((await call("secret_user")).status).toBe(404);
    const { token } = await createIngestToken(db, secret.id, "cli");
    const own = await call("secret_user", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(((await own.json()) as { days: unknown[] }).days).toHaveLength(1);
  });
});

describe("connected sources", () => {
  it("counts integrations and rows from the last 30 local days only", async () => {
    const t = today();
    const u = await seed("conn", [r(addDays(t, -29), "coding", 1), r(addDays(t, -40), "chat", 1, { source: "gemini" })]);
    // ingestRows registered claude_code and gemini as local integrations; drop them to test the row rule alone.
    await db.execute(sql`DELETE FROM integrations WHERE user_id = ${u.id}`);
    expect([...(await connectedSources(db, u))]).toEqual(["claude_code"]);
    await db.execute(sql`INSERT INTO integrations (user_id, source, mode, status) VALUES (${u.id}, 'cursor', 'upload', 'active'), (${u.id}, 'openai_api', 'cloud', 'revoked')`);
    expect([...(await connectedSources(db, u))].sort()).toEqual(["claude_code", "cursor"]);
  });
});
