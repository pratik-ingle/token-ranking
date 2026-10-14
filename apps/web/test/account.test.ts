import { localDate } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf, type Db } from "@/db/client";
import { refreshViews, MATERIALIZED_VIEWS } from "@/db/views";
import { deleteAccount, exportAccount } from "@/server/account";
import { heartbeat } from "@/server/integrations";
import { ingestRows } from "@/server/ingest";
import { createIngestToken } from "@/server/tokens";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

const USER_TABLES = ["daily_usage", "integrations", "ingest_tokens", "sessions", "passkeys", "device_codes", "recovery_tokens", "user_keys", "usage_reviews"];

async function countFor(userId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of USER_TABLES) {
    out[t] = Number(rowsOf<{ n: number }>(await db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${t} WHERE user_id = '${userId}'`)))[0]!.n);
  }
  for (const v of MATERIALIZED_VIEWS.filter((v) => v !== "global_stats")) {
    out[v] = Number(rowsOf<{ n: number }>(await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${v}" WHERE user_id = '${userId}'`)))[0]!.n);
  }
  return out;
}

describe("account deletion", () => {
  it("removes every row and every leaderboard copy in the same call", async () => {
    const u = await createUser(db, "leaver", { timezone: "UTC" });
    const keep = await createUser(db, "stayer", { timezone: "UTC" });
    const today = localDate(Date.now(), "UTC");
    const r = { date: today, source: "claude_code" as const, model: "m", category: "coding" as const, input_tokens: 5, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0 };
    await ingestRows(db, [r], { userId: u.id, timeZone: "UTC", trust: "self_reported", mode: "local" });
    await ingestRows(db, [r], { userId: keep.id, timeZone: "UTC", trust: "self_reported", mode: "local" });
    await createIngestToken(db, u.id, "laptop");
    await heartbeat(db, u.id, { source: "openai_api", org_fingerprint: "a".repeat(64), status: "ok" });
    await db.execute(sql`INSERT INTO sessions (id, user_id, expires_at) VALUES ('s1', ${u.id}, now() + interval '1 day')`);
    await db.execute(sql`INSERT INTO passkeys (id, user_id, public_key) VALUES ('pk1', ${u.id}, 'x')`);
    await db.execute(sql`INSERT INTO device_codes (device_code_hash, user_code, client, status, user_id, expires_at) VALUES ('h', 'BCDF-GHJK', 'collector', 'approved', ${u.id}, now() + interval '5 min')`);
    await db.execute(sql`INSERT INTO recovery_tokens (token_hash, user_id, expires_at) VALUES ('rt', ${u.id}, now() + interval '5 min')`);
    await db.execute(sql`INSERT INTO user_keys (user_id, wrapped_data_key) VALUES (${u.id}, 'wrapped')`);
    await db.execute(sql`INSERT INTO usage_reviews (user_id, date, source, decision) VALUES (${u.id}, ${today}, 'claude_code', 'approved')`);
    await refreshViews(db);

    const before = await countFor(u.id);
    expect(Object.values(before).every((n) => n > 0)).toBe(true);

    await deleteAccount(db, u.id);

    const after = await countFor(u.id);
    expect(after).toEqual(Object.fromEntries(Object.keys(before).map((k) => [k, 0])));
    expect(rowsOf(await db.execute(sql`SELECT 1 FROM users WHERE id = ${u.id}`))).toHaveLength(0);
    // Other users are untouched.
    expect((await countFor(keep.id)).daily_usage).toBe(1);
  });
});

describe("data export", () => {
  it("includes usage rows but no secrets or hashes", async () => {
    const u = await createUser(db, "exporter", { timezone: "UTC" });
    const { token } = await createIngestToken(db, u.id, "cli");
    await ingestRows(db, [{ date: localDate(Date.now(), "UTC"), source: "cursor", model: "auto", category: "coding", input_tokens: 1, output_tokens: 2, cache_read_tokens: 3, cache_write_tokens: 4, request_count: 1, image_count: 0 }], { userId: u.id, timeZone: "UTC", trust: "self_reported", mode: "upload" });
    const data = await exportAccount(db, u.id);
    expect(data.daily_usage).toHaveLength(1);
    expect(data.daily_usage[0]).toMatchObject({ input_tokens: 1, cache_write_tokens: 4 });
    const json = JSON.stringify(data);
    expect(json).not.toContain(token);
    expect(json).not.toMatch(/token_hash|password_hash|webauthn_user_id|encrypted_credentials|fingerprint/);
  });
});
