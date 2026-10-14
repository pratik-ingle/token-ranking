import { localDate } from "@tokenrank/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rowsOf, type Db } from "@/db/client";
import { decryptCredential, encryptCredential, LocalKms, newDataKey, orgFingerprintHmac } from "@/server/crypto";
import { createDeviceCode, decideDeviceCode, normalizeUserCode, pollDeviceToken } from "@/server/device";
import { connectCloud, heartbeat, revokeCloud, runCloudSync } from "@/server/integrations";
import { parseOtlpMetrics } from "@/server/otlp";
import { verifyIngestToken } from "@/server/tokens";
import { createTestDb, createUser } from "./helpers/db";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await createTestDb()));
afterAll(async () => close());

describe("device authorization flow", () => {
  it("pending → approved → token once → consumed", async () => {
    const u = await createUser(db, "devuser", { timezone: "Europe/Berlin" });
    const code = await createDeviceCode(db, "collector");
    expect(code.user_code).toMatch(/^[B-Z]{4}-[B-Z]{4}$/);
    expect(await pollDeviceToken(db, code.device_code)).toEqual({ ok: false, error: "authorization_pending" });
    expect(await pollDeviceToken(db, code.device_code)).toEqual({ ok: false, error: "slow_down" });
    expect(await decideDeviceCode(db, code.user_code.toLowerCase().replace("-", " "), u.id, true)).toBe(true);
    const later = new Date(Date.now() + 10_000);
    const res = await pollDeviceToken(db, code.device_code, later);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).toMatchObject({ token_type: "bearer", username: "devuser", timezone: "Europe/Berlin" });
    expect((await verifyIngestToken(db, res.body.access_token))?.user.id).toBe(u.id);
    expect(await pollDeviceToken(db, code.device_code, later)).toEqual({ ok: false, error: "invalid_grant" });
    // The plaintext token is never stored.
    const stored = rowsOf<{ token_hash: string }>(await db.execute(sql`SELECT token_hash FROM ingest_tokens WHERE user_id = ${u.id}`));
    expect(JSON.stringify(stored)).not.toContain(res.body.access_token);
  });

  it("denied and expired codes", async () => {
    const u = await createUser(db, "denier");
    const code = await createDeviceCode(db, "mcp");
    await decideDeviceCode(db, code.user_code, u.id, false);
    expect(await pollDeviceToken(db, code.device_code)).toEqual({ ok: false, error: "access_denied" });
    expect(await pollDeviceToken(db, code.device_code, new Date(Date.now() + 3600_000))).toEqual({ ok: false, error: "expired_token" });
    expect(await pollDeviceToken(db, "nonsense-code-123")).toEqual({ ok: false, error: "invalid_grant" });
    expect(normalizeUserCode("abcd-efgh")).toBeNull(); // vowels never appear
  });
});

describe("OTLP metrics", () => {
  const point = (type: string, value: number | string, extra: object[] = []) => ({
    attributes: [
      { key: "type", value: { stringValue: type } },
      { key: "model", value: { stringValue: "claude-sonnet-5-5" } },
      { key: "user.email", value: { stringValue: "person@example.com" } },
      { key: "organization.id", value: { stringValue: "org-secret" } },
      { key: "session.id", value: { stringValue: "sess-1" } },
      ...extra,
    ],
    timeUnixNano: String(Date.parse("2026-03-04T23:30:00Z") * 1e6),
    asInt: typeof value === "string" ? value : undefined,
    asDouble: typeof value === "number" ? value : undefined,
  });
  const body = (temporality: number) => ({
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "user.account_uuid", value: { stringValue: "acct-1" } }] },
        scopeMetrics: [
          {
            metrics: [
              { name: "claude_code.token.usage", sum: { aggregationTemporality: temporality, dataPoints: [point("input", 100), point("output", "50"), point("cacheRead", 1000), point("cacheCreation", 10)] } },
              { name: "claude_code.cost.usage", sum: { aggregationTemporality: 1, dataPoints: [point("input", 0.5)] } },
            ],
          },
        ],
      },
    ],
  });

  it("reads only the token metric and drops identity attributes", () => {
    const r = parseOtlpMetrics(body(1), "Asia/Kolkata");
    expect(r.rows).toEqual([
      { date: "2026-03-05", source: "claude_code", model: "claude-sonnet-5-5", category: "coding", input_tokens: 100, output_tokens: 50, cache_read_tokens: 1000, cache_write_tokens: 10, request_count: 0, image_count: 0 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/example\.com|org-secret|sess-1|acct-1/);
  });

  it("rejects cumulative temporality", () => {
    const r = parseOtlpMetrics(body(2), "UTC");
    expect(r.rows).toEqual([]);
    expect(r.rejected).toBe(4);
    expect(r.reason).toMatch(/delta/);
  });
});

describe("envelope encryption and cloud sync", () => {
  it("round-trips and binds ciphertext to its AAD", async () => {
    const kms = new LocalKms(Buffer.alloc(32, 1).toString("base64"));
    const dk = newDataKey();
    const wrapped = await kms.wrap(dk);
    expect(Buffer.compare(await kms.unwrap(wrapped), dk)).toBe(0);
    const ct = encryptCredential(dk, { apiKey: "sk-admin-SECRET" }, "user-a:openai_api");
    expect(ct).not.toContain("SECRET");
    expect(decryptCredential(dk, ct, "user-a:openai_api")).toEqual({ apiKey: "sk-admin-SECRET" });
    expect(() => decryptCredential(dk, ct, "user-b:openai_api")).toThrow();
    await expect(new LocalKms(Buffer.alloc(32, 2).toString("base64")).unwrap(wrapped)).rejects.toThrow();
  });

  it("connects, de-duplicates orgs, syncs as verified, and revokes with crypto-shredding", async () => {
    const fetchMock = (async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/organizations/me")) return Response.json({ id: "org-shared", name: "Acme", type: "organization" });
      return Response.json({
        has_more: false,
        next_page: null,
        data: [{ starting_at: new Date(Date.now() - 3600_000).toISOString().slice(0, 13) + ":00:00Z", ending_at: "", results: [{ model: "claude-haiku-4-5", uncached_input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0 }] }],
      });
    }) as typeof fetch;
    const a = await createUser(db, "cloud_a", { timezone: "UTC" });
    const b = await createUser(db, "cloud_b", { timezone: "UTC" });
    const ca = await connectCloud(db, a, "anthropic_api", { apiKey: "sk-ant-admin01-SECRETKEY" }, fetchMock);
    const cb = await connectCloud(db, b, "anthropic_api", { apiKey: "sk-ant-admin01-OTHERKEY" }, fetchMock);
    expect(ca.status).toBe("active");
    expect(cb.status).toBe("duplicate");

    const stored = rowsOf<Record<string, string>>(await db.execute(sql`SELECT encrypted_credentials, org_fingerprint_hmac FROM integrations WHERE id = ${ca.id}`))[0]!;
    expect(stored.encrypted_credentials).not.toContain("SECRETKEY");
    expect(stored.org_fingerprint_hmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain("org-shared");

    // Local collector heartbeat for the same org from user b is also a duplicate.
    const { orgFingerprintInput } = await import("@tokenrank/shared/providers");
    expect(orgFingerprintHmac(await orgFingerprintInput("anthropic_api", "org-shared"))).toBe(stored.org_fingerprint_hmac);
    expect((await heartbeat(db, b.id, { source: "anthropic_api", org_fingerprint: await orgFingerprintInput("anthropic_api", "org-shared"), status: "ok" })).status).toBe("duplicate");

    const synced = await runCloudSync(db, ca.id, { fetch: fetchMock });
    expect(synced).toEqual({ ok: true, rows: 1 });
    const usage = rowsOf<{ trust_level: string; date: string }>(await db.execute(sql`SELECT trust_level, date::text FROM daily_usage WHERE user_id = ${a.id}`));
    expect(usage).toEqual([{ trust_level: "verified", date: localDate(Date.now() - 3600_000, "UTC") }]);

    await revokeCloud(db, a.id, "anthropic_api", true);
    expect(rowsOf(await db.execute(sql`SELECT 1 FROM integrations WHERE user_id = ${a.id}`))).toHaveLength(0);
    expect(rowsOf(await db.execute(sql`SELECT 1 FROM user_keys WHERE user_id = ${a.id}`))).toHaveLength(0);
    expect(rowsOf(await db.execute(sql`SELECT 1 FROM daily_usage WHERE user_id = ${a.id}`))).toHaveLength(0);
  });

  it("rejects a key the provider refuses, without echoing it", async () => {
    const u = await createUser(db, "badkey");
    const fetchMock = (async () => new Response(JSON.stringify({ error: { type: "authentication_error" } }), { status: 401 })) as unknown as typeof fetch;
    const err = (await connectCloud(db, u, "anthropic_api", { apiKey: "sk-ant-admin01-WRONGKEY" }, fetchMock).catch((e: Error) => e)) as Error;
    expect(String(err.message)).toContain("HTTP 401");
    expect(String(err.message)).not.toContain("WRONGKEY");
  });
});
