import { describe, expect, it } from "vitest";
import { ApiError, TokenRankClient } from "../src/api";

const TOKEN = "tr_SECRET_TOKEN_abc";

function scripted(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const RANK = { username: "a", visibility: "public", include_cache: false, windows: [], profile_url: "u" };

describe("TokenRankClient", () => {
  it("sends the bearer token and the cache flag to /api/v1/me/rank", async () => {
    const s = scripted([json(200, RANK)]);
    const client = new TokenRankClient({ server: "https://x.test/", token: TOKEN, fetch: s.fetch });
    await expect(client.meRank(false)).resolves.toEqual(RANK);
    expect(s.calls[0]!.url).toBe("https://x.test/api/v1/me/rank?cache=false");
    expect(new Headers(s.calls[0]!.init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("honours Retry-After on 429 and retries 5xx with backoff", async () => {
    const sleeps: number[] = [];
    const s = scripted([json(429, { error: "rate_limited" }, { "retry-after": "2" }), json(503, {}), json(200, RANK)]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch, sleep: async (ms) => void sleeps.push(ms), baseDelayMs: 10 });
    await client.meRank();
    expect(sleeps[0]).toBe(2000);
    expect(sleeps).toHaveLength(2);
    expect(s.calls).toHaveLength(3);
  });

  it("gives up after maxRetries with a rate_limited error carrying Retry-After", async () => {
    const s = scripted([json(429, {}, { "retry-after": "1" }), json(429, {}, { "retry-after": "7" })]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch, sleep: async () => {}, maxRetries: 1 });
    const err = await client.meStats().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("rate_limited");
    expect((err as ApiError).details.retryAfterSec).toBe(7);
  });

  it("maps 401 to a re-login hint without leaking the token", async () => {
    const s = scripted([json(401, { error: "invalid_token" })]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch });
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("unauthorized");
    expect(err.message).toMatch(/tokenrank-collector login/);
    expect(err.message).not.toContain(TOKEN);
  });

  it("surfaces invalid_payload issues", async () => {
    const s = scripted([json(400, { error: "invalid_payload", issues: [{ path: "0.model", message: "bad model" }] })]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch });
    const err = (await client.uploadUsage([]).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("invalid_payload");
    expect(err.details.issues).toEqual([{ path: "0.model", message: "bad model" }]);
    expect(err.message).toContain("0.model");
  });

  it("posts the rows as a bare JSON array", async () => {
    const s = scripted([json(200, { accepted: 1, inserted: 1, updated: 0, skipped_verified: 0, flagged: 0 })]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch });
    const row = {
      date: "2026-10-01",
      source: "claude_code" as const,
      model: "m",
      category: "coding" as const,
      input_tokens: 1,
      output_tokens: 1,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      request_count: 1,
      image_count: 0,
    };
    await client.uploadUsage([row]);
    expect(JSON.parse(String(s.calls[0]!.init?.body))).toEqual([row]);
    expect(s.calls[0]!.init?.method).toBe("POST");
  });

  it("retries network errors then reports network_error", async () => {
    const s = scripted([new Error("ECONNREFUSED"), new Error("ECONNREFUSED")]);
    const client = new TokenRankClient({ server: "https://x.test", token: TOKEN, fetch: s.fetch, sleep: async () => {}, maxRetries: 1 });
    const err = (await client.me().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("network_error");
  });

  it("device token: returns RFC 8628 errors instead of throwing, and needs no token", async () => {
    const s = scripted([json(400, { error: "slow_down" }), json(200, { access_token: "tr_x", token_type: "bearer", username: "u", timezone: "UTC" })]);
    const client = new TokenRankClient({ server: "https://x.test", fetch: s.fetch });
    await expect(client.deviceToken("d")).resolves.toEqual({ ok: false, error: "slow_down" });
    await expect(client.deviceToken("d")).resolves.toMatchObject({ ok: true, token: { access_token: "tr_x" } });
    expect(new Headers(s.calls[0]!.init?.headers).get("authorization")).toBeNull();
  });

  it("refuses authenticated calls without a token", async () => {
    const client = new TokenRankClient({ server: "https://x.test", fetch: scripted([]).fetch });
    const err = (await client.meRank().catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe("not_logged_in");
  });
});
