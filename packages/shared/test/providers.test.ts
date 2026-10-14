import { describe, expect, it } from "vitest";
import { createAnthropicIntegration, createCursorIntegration, createOpenAIIntegration, orgFingerprintInput } from "../src/providers";

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown; headers?: Record<string, string> };

function mockFetch(handler: Handler) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const { status = 200, body, headers = {} } = handler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }) as typeof fetch;
  return { fn, calls };
}

const hour = (iso: string) => Date.parse(iso) / 1000;

describe("OpenAI integration", () => {
  it("normalises cached tokens, re-buckets hours into local days and paginates", async () => {
    const { fn, calls } = mockFetch((url) => {
      const path = url.pathname.split("/").pop();
      if (path === "completions") {
        if (!url.searchParams.get("page")) {
          return {
            headers: { "openai-organization": "org-abc" },
            body: {
              object: "page",
              has_more: true,
              next_page: "p2",
              data: [
                {
                  start_time: hour("2026-03-04T17:00:00Z"), // 22:30 IST on Mar 4
                  end_time: hour("2026-03-04T18:00:00Z"),
                  results: [
                    { object: "organization.usage.completions.result", model: "gpt-4o", input_tokens: 1000, output_tokens: 50, input_cached_tokens: 600, input_cache_write_tokens: 100, num_model_requests: 3, project_id: null },
                  ],
                },
              ],
            },
          };
        }
        return {
          body: {
            object: "page",
            has_more: false,
            next_page: null,
            data: [
              {
                start_time: hour("2026-03-04T19:00:00Z"), // 00:30 IST on Mar 5
                end_time: hour("2026-03-04T20:00:00Z"),
                results: [{ model: "gpt-4o", input_tokens: 10, output_tokens: 5, num_model_requests: 1 }],
              },
            ],
          },
        };
      }
      if (path === "images") {
        return { body: { has_more: false, next_page: null, data: [{ start_time: hour("2026-03-04T17:00:00Z"), results: [{ model: "gpt-image-1", images: 4, num_model_requests: 2 }] }] } };
      }
      if (path === "embeddings") {
        return { body: { has_more: false, next_page: null, data: [{ start_time: hour("2026-03-04T17:00:00Z"), results: [{ model: "text-embedding-3-small", input_tokens: 500, num_model_requests: 1 }] }] } };
      }
      return { body: { has_more: false, next_page: null, data: [] } };
    });

    const integ = createOpenAIIntegration({ adminKey: "sk-admin-test", timeZone: "Asia/Kolkata", trust: "self_reported", fetch: fn });
    const rows = await integ.fetchUsage(new Date("2026-03-04T12:00:00Z"), new Date("2026-03-05T12:00:00Z"));

    expect(rows).toEqual([
      { date: "2026-03-04", source: "openai_api", model: "gpt-4o", category: "chat", input_tokens: 300, output_tokens: 50, cache_read_tokens: 600, cache_write_tokens: 100, request_count: 3, image_count: 0, trust_level: "self_reported" },
      { date: "2026-03-04", source: "openai_api", model: "gpt-image-1", category: "image_generation", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 2, image_count: 4, trust_level: "self_reported" },
      { date: "2026-03-04", source: "openai_api", model: "text-embedding-3-small", category: "embeddings", input_tokens: 500, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0, trust_level: "self_reported" },
      { date: "2026-03-05", source: "openai_api", model: "gpt-4o", category: "chat", input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0, trust_level: "self_reported" },
    ]);

    const first = calls[0]!;
    expect(first.url.pathname).toBe("/v1/organization/usage/completions");
    expect(first.url.searchParams.get("bucket_width")).toBe("1h");
    expect(first.url.searchParams.getAll("group_by")).toEqual(["model"]);
    // since rounded down to local midnight (Mar 4 00:00 IST = Mar 3 18:30Z), floored to the hour.
    expect(first.url.searchParams.get("start_time")).toBe(String(hour("2026-03-03T18:00:00Z")));
    expect((first.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-admin-test");
    expect(calls[1]!.url.searchParams.get("page")).toBe("p2");
    expect(await integ.identify()).toEqual({ orgId: "org-abc" });
  });

  it("applies the local category map without uploading ids", async () => {
    const { fn, calls } = mockFetch((url) => ({
      body: {
        has_more: false,
        next_page: null,
        data: url.pathname.endsWith("completions")
          ? [{ start_time: hour("2026-03-04T10:00:00Z"), results: [
              { model: "gpt-5", input_tokens: 10, output_tokens: 1, project_id: "proj_agents", api_key_id: "key_1" },
              { model: "gpt-5", input_tokens: 20, output_tokens: 2, project_id: "proj_other", api_key_id: "key_2" },
            ] }]
          : [],
      },
    }));
    const rows = await createOpenAIIntegration({
      adminKey: "k", timeZone: "UTC", trust: "self_reported", fetch: fn, categoryMap: { proj_agents: "agents" },
    }).fetchUsage(new Date("2026-03-04T00:00:00Z"), new Date("2026-03-05T00:00:00Z"));
    expect(rows.map((r) => [r.category, r.input_tokens])).toEqual([["agents", 10], ["chat", 20]]);
    expect(JSON.stringify(rows)).not.toMatch(/proj_|key_/);
    expect(calls[0]!.url.searchParams.getAll("group_by")).toEqual(["model", "project_id", "api_key_id"]);
  });

  it("retries on 429 and surfaces auth errors without the key", async () => {
    let n = 0;
    const { fn } = mockFetch(() => {
      n++;
      if (n === 1) return { status: 429, body: {}, headers: { "retry-after": "0" } };
      return { status: 401, body: { error: { type: "invalid_request_error", message: "bad key sk-admin-SECRET" } } };
    });
    const integ = createOpenAIIntegration({ adminKey: "sk-admin-SECRET", timeZone: "UTC", trust: "verified", fetch: fn });
    const err = await integ.fetchUsage(new Date("2026-03-04"), new Date("2026-03-05")).catch((e: Error) => e);
    expect(String(err)).toContain("HTTP 401");
    expect(String(err)).not.toContain("SECRET");
  });
});

describe("Anthropic integration", () => {
  it("maps usage fields, has zero request counts and identifies the org", async () => {
    const { fn, calls } = mockFetch((url) => {
      if (url.pathname.endsWith("/organizations/me")) return { body: { id: "org-uuid", name: "Secret Org", type: "organization" } };
      return {
        body: {
          has_more: false,
          next_page: null,
          data: [
            {
              starting_at: "2026-03-04T10:00:00Z",
              ending_at: "2026-03-04T11:00:00Z",
              results: [
                { model: "claude-opus-4-1", uncached_input_tokens: 100, cache_read_input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 200 }, output_tokens: 50, server_tool_use: { web_search_requests: 2 }, workspace_id: null },
              ],
            },
            { starting_at: "2026-03-04T11:00:00Z", ending_at: "2026-03-04T12:00:00Z", results: [] },
          ],
        },
      };
    });
    const integ = createAnthropicIntegration({ adminKey: "sk-ant-admin01-x", timeZone: "UTC", trust: "verified", fetch: fn });
    const rows = await integ.fetchUsage(new Date("2026-03-04T00:00:00Z"), new Date("2026-03-05T00:00:00Z"));
    expect(rows).toEqual([
      { date: "2026-03-04", source: "anthropic_api", model: "claude-opus-4-1", category: "chat", input_tokens: 100, output_tokens: 50, cache_read_tokens: 5000, cache_write_tokens: 500, request_count: 0, image_count: 0, trust_level: "verified" },
    ]);
    const u = calls[0]!.url;
    expect(u.pathname).toBe("/v1/organizations/usage_report/messages");
    expect(u.searchParams.getAll("group_by[]")).toEqual(["model"]);
    expect(u.searchParams.get("starting_at")).toBe("2026-03-04T00:00:00.000Z");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["x-api-key"]).toBe("sk-ant-admin01-x");
    expect(h["anthropic-version"]).toBe("2023-06-01");
    expect(await integ.identify()).toEqual({ orgId: "org-uuid" });
  });
});

describe("Cursor integration", () => {
  it("requires an email filter or explicit team-wide opt-in", () => {
    expect(() => createCursorIntegration({ adminKey: "k", timeZone: "UTC", trust: "self_reported" })).toThrow(/whole team/);
  });

  it("aggregates token-based events, discards identifying fields and filters by email", async () => {
    const { fn, calls } = mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body)) as { page: number };
      return {
        body: {
          usageEvents:
            body.page === 1
              ? [
                  { timestamp: String(Date.parse("2026-03-04T10:00:00Z")), userEmail: "me@corp.com", conversationId: "c1", model: "claude-4.5-sonnet", isTokenBasedCall: true, tokenUsage: { inputTokens: 126, outputTokens: 450, cacheWriteTokens: 6112, cacheReadTokens: 11964, totalCents: 20 } },
                  { timestamp: String(Date.parse("2026-03-04T11:00:00Z")), userEmail: "me@corp.com", model: "auto", isTokenBasedCall: false },
                ]
              : [],
          pagination: { hasNextPage: body.page === 1 },
        },
      };
    });
    const rows = await createCursorIntegration({ adminKey: "crsr_x", email: "me@corp.com", timeZone: "UTC", trust: "self_reported", fetch: fn })
      .fetchUsage(new Date("2026-03-04T00:00:00Z"), new Date("2026-03-05T00:00:00Z"));
    expect(rows).toEqual([
      { date: "2026-03-04", source: "cursor", model: "auto", category: "coding", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, request_count: 1, image_count: 0, trust_level: "self_reported" },
      { date: "2026-03-04", source: "cursor", model: "claude-4.5-sonnet", category: "coding", input_tokens: 126, output_tokens: 450, cache_read_tokens: 11964, cache_write_tokens: 6112, request_count: 1, image_count: 0, trust_level: "self_reported" },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(/@|c1/);
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({ email: "me@corp.com", page: 1, pageSize: 1000 });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa("crsr_x:")}`);
  });
});

describe("orgFingerprintInput", () => {
  it("is a stable sha256 hex", async () => {
    const a = await orgFingerprintInput("openai_api", "org-abc");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await orgFingerprintInput("openai_api", "org-abc")).toBe(a);
    expect(await orgFingerprintInput("anthropic_api", "org-abc")).not.toBe(a);
  });
});
