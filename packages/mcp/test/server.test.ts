import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CreateMessageRequestSchema, ElicitRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createTokenRankMcpServer, TOOL_NAMES, type TokenRankMcpOptions } from "../src/server";

const TOKEN = "tr_mcp_SUPERSECRET_TOKEN";
const SERVER = "http://tokenrank.test";
const NOW = new Date("2026-10-14T12:00:00.000Z");
const SECRET = "SECRET_PROMPT_7f3a";

const RANK = {
  username: "alice",
  visibility: "public",
  include_cache: true,
  windows: [
    { window: "today", total_tokens: 1234, rank: 3, ranked_users: 10, percentile_label: "Top 30%" },
    { window: "30d", total_tokens: 5_600_000, rank: 12, ranked_users: 400, percentile_label: "Top 3%" },
    { window: "all", total_tokens: 9_000_000, rank: null, ranked_users: 400, percentile_label: null },
  ],
  profile_url: "http://tokenrank.test/u/alice",
};

const STATS = {
  username: "alice",
  timezone: "Asia/Kolkata",
  joined: "2026-01-02T00:00:00.000Z",
  totals: {
    total_tokens: 1_500_000,
    input_tokens: 500_000,
    output_tokens: 250_000,
    cache_read_tokens: 700_000,
    cache_write_tokens: 50_000,
    request_count: 4321,
    image_count: 0,
  },
  windows: [{ window: "30d", total_tokens: 900_000, rank: 7, ranked_users: 100, percentile_label: "Top 7%" }],
  streaks: { current: 5, longest: 21, active_days: 64 },
  by_source: [
    { key: "claude_code", label: "Claude Code", total_tokens: 1_200_000 },
    { key: "codex_cli", label: "Codex CLI", total_tokens: 300_000 },
  ],
  by_category: [{ key: "coding", label: "Coding", total_tokens: 1_500_000 }],
  top_models: [{ key: "claude-opus-4-6", label: "claude-opus-4-6", total_tokens: 1_000_000 }],
  daily: [],
  verified_share: 0,
  flagged_days: 0,
};

interface Call {
  method: string;
  url: URL;
  auth: string | null;
  body: unknown;
}

function mockFetch(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      method: init?.method ?? "GET",
      url,
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (overrides[url.pathname]) return overrides[url.pathname]!();
    switch (url.pathname) {
      case "/api/v1/me":
        return json(200, { username: "alice", timezone: "UTC", visibility: "public", profile_url: RANK.profile_url });
      case "/api/v1/me/rank":
        return json(200, { ...RANK, include_cache: url.searchParams.get("cache") !== "false" });
      case "/api/v1/me/stats":
        return json(200, STATS);
      case "/api/v1/usage": {
        const rows = (typeof init?.body === "string" ? JSON.parse(init.body) : []) as unknown[];
        return json(200, { accepted: rows.length, inserted: rows.length, updated: 0, skipped_verified: 0, flagged: 0 });
      }
      case "/api/v1/integrations/heartbeat":
        return json(200, { status: "active" });
      default:
        return json(404, { error: "not_found" });
    }
  };
  return { fetch: fetchImpl as typeof fetch, calls };
}

let root: string;
let env: Record<string, string>;

async function writeTranscript() {
  const dir = path.join(root, "claude", "projects", "-home-alice-proj");
  await fs.mkdir(dir, { recursive: true });
  const line = (id: string, ts: string, out: number) =>
    JSON.stringify({
      cwd: `/home/alice/${SECRET}`,
      gitBranch: `feat/${SECRET}`,
      sessionId: "s1",
      type: "assistant",
      requestId: `req_${id}`,
      timestamp: ts,
      message: {
        id,
        model: "claude-opus-4-6",
        content: [{ type: "text", text: `${SECRET} the answer is 42` }],
        usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 },
      },
    });
  await fs.writeFile(
    path.join(dir, "s1.jsonl"),
    [
      JSON.stringify({ type: "user", cwd: `/home/alice/${SECRET}`, message: { role: "user", content: `${SECRET} please help` }, timestamp: "2026-10-13T09:00:00Z" }),
      line("msg_1", "2026-10-13T09:00:01Z", 3),
      line("msg_1", "2026-10-13T09:00:02Z", 30),
      line("msg_2", "2026-10-14T08:00:00Z", 7),
    ].join("\n") + "\n",
  );
}

async function writeConfig(extra: Record<string, unknown> = {}) {
  await fs.mkdir(env.TOKENRANK_HOME!, { recursive: true, mode: 0o700 });
  await fs.writeFile(
    path.join(env.TOKENRANK_HOME!, "config.json"),
    JSON.stringify({
      version: 1,
      server: SERVER,
      token: TOKEN,
      username: "alice",
      timezone: "UTC",
      sources: { claude_code: { enabled: true }, codex_cli: { enabled: false }, openai_api: { enabled: false }, anthropic_api: { enabled: false }, cursor: { enabled: false } },
      lastSync: {},
      ...extra,
    }),
    { mode: 0o600 },
  );
}

async function connect(opts: TokenRankMcpOptions) {
  const server = createTokenRankMcpServer({ log: () => {}, now: () => NOW, sleep: async () => {}, ...opts });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: { sampling: {}, roots: {}, elicitation: {} } });
  const serverInitiated: string[] = [];
  client.setRequestHandler(CreateMessageRequestSchema, async () => {
    serverInitiated.push("sampling/createMessage");
    throw new Error("sampling must never be requested");
  });
  client.setRequestHandler(ListRootsRequestSchema, async () => {
    serverInitiated.push("roots/list");
    return { roots: [] };
  });
  client.setRequestHandler(ElicitRequestSchema, async () => {
    serverInitiated.push("elicitation/create");
    return { action: "decline" };
  });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server, serverInitiated };
}

function text(result: unknown): string {
  return ((result as { content: Array<{ type: string; text?: string }> }).content ?? []).map((c) => c.text ?? "").join("\n");
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenrank-mcp-test-"));
  env = {
    HOME: path.join(root, "home"),
    TOKENRANK_HOME: path.join(root, "tokenrank"),
    CLAUDE_CONFIG_DIR: path.join(root, "claude"),
    CODEX_HOME: path.join(root, "codex"),
  };
  await fs.mkdir(env.HOME!, { recursive: true });
  await writeTranscript();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("tool surface", () => {
  it("exposes exactly get_my_rank, get_my_stats and sync_now, with no free-text inputs", async () => {
    await writeConfig();
    const { client } = await connect({ env, fetch: mockFetch().fetch });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.map((t) => t.name).sort()).toEqual(["get_my_rank", "get_my_stats", "sync_now"]);
    const allowed: Record<string, Record<string, string>> = {
      get_my_rank: { include_cache: "boolean" },
      get_my_stats: {},
      sync_now: { dry_run: "boolean" },
    };
    for (const tool of tools) {
      const schema = tool.inputSchema as { type: string; properties?: Record<string, { type?: string; enum?: unknown[]; format?: string }>; additionalProperties?: unknown; required?: string[] };
      expect(schema.type).toBe("object");
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required ?? []).toEqual([]);
      const props = schema.properties ?? {};
      expect(Object.keys(props).sort()).toEqual(Object.keys(allowed[tool.name]!).sort());
      for (const [name, prop] of Object.entries(props)) {
        // Only booleans, small enums or dates: never an unconstrained string.
        const ok = prop.type === "boolean" || Array.isArray(prop.enum) || (prop.type === "string" && prop.format === "date");
        expect(ok, `${tool.name}.${name}`).toBe(true);
      }
    }
  });

  it("rejects unexpected arguments (no way to pass conversation text)", async () => {
    await writeConfig();
    const f = mockFetch();
    const { client } = await connect({ env, fetch: f.fetch });
    const res = await client
      .callTool({ name: "get_my_rank", arguments: { include_cache: true, note: `${SECRET} from the chat` } })
      .catch((e: unknown) => ({ isError: true, content: [{ type: "text", text: String(e) }] }));
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(f.calls).toHaveLength(0);
  });
});

describe("get_my_rank", () => {
  it("calls GET /api/v1/me/rank with the bearer token from the collector config", async () => {
    await writeConfig();
    const f = mockFetch();
    const { client, serverInitiated } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "get_my_rank", arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.method).toBe("GET");
    expect(f.calls[0]!.url.origin + f.calls[0]!.url.pathname).toBe(`${SERVER}/api/v1/me/rank`);
    expect(f.calls[0]!.url.searchParams.get("cache")).toBe("true");
    expect(f.calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    const t = text(res);
    expect(t).toContain("@alice");
    expect(t).toContain("Today: #3 of 10 (Top 30%), 1.2K tokens");
    expect(t).toContain("30 days: #12 of 400 (Top 3%), 5.6M tokens");
    expect(t).toContain("All time: not ranked yet");
    expect(t).toContain(RANK.profile_url);
    expect(t).not.toContain(TOKEN);
    expect(res.structuredContent).toMatchObject({ username: "alice", windows: RANK.windows });
    expect(serverInitiated).toEqual([]);
  });

  it("passes include_cache=false", async () => {
    await writeConfig();
    const f = mockFetch();
    const { client } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "get_my_rank", arguments: { include_cache: false } });
    expect(f.calls[0]!.url.searchParams.get("cache")).toBe("false");
    expect(text(res)).toContain("cache tokens excluded");
  });

  it("uses TOKENRANK_TOKEN + TOKENRANK_SERVER when there is no config", async () => {
    const f = mockFetch();
    const { client } = await connect({ env: { ...env, TOKENRANK_TOKEN: "tr_env_token", TOKENRANK_SERVER: "https://other.test" }, fetch: f.fetch });
    await client.callTool({ name: "get_my_rank", arguments: {} });
    expect(f.calls[0]!.url.origin).toBe("https://other.test");
    expect(f.calls[0]!.auth).toBe("Bearer tr_env_token");
  });

  it("returns a helpful error when not logged in, and on 401", async () => {
    const f = mockFetch({ "/api/v1/me/rank": () => new Response(JSON.stringify({ error: "invalid_token" }), { status: 401 }) });
    const { client } = await connect({ env, fetch: f.fetch });
    const notLoggedIn = await client.callTool({ name: "get_my_rank", arguments: {} });
    expect(notLoggedIn.isError).toBe(true);
    expect(text(notLoggedIn)).toContain("npx tokenrank-collector login");
    expect(f.calls).toHaveLength(0);

    await writeConfig();
    const unauthorized = await client.callTool({ name: "get_my_rank", arguments: {} });
    expect(unauthorized.isError).toBe(true);
    expect(text(unauthorized)).toContain("npx tokenrank-collector login");
    expect(text(unauthorized)).not.toContain(TOKEN);
  });
});

describe("get_my_stats", () => {
  it("summarises totals, streaks and top sources/models", async () => {
    await writeConfig();
    const f = mockFetch();
    const { client } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "get_my_stats", arguments: {} });
    expect(f.calls[0]!.url.pathname).toBe("/api/v1/me/stats");
    expect(f.calls[0]!.auth).toBe(`Bearer ${TOKEN}`);
    const t = text(res);
    expect(t).toContain("Total: 1.5M tokens");
    expect(t).toContain("4,321 requests");
    expect(t).toContain("current 5 days, longest 21 days");
    expect(t).toContain("Top sources: Claude Code 1.2M, Codex CLI 300K");
    expect(t).toContain("Top models: claude-opus-4-6 1M");
  });
});

describe("sync_now", () => {
  it("dry_run: reads local logs in-process, uploads nothing, returns counts only", async () => {
    await writeConfig();
    const f = mockFetch();
    const stdoutSpy = vi.spyOn(process.stdout, "write");
    const { client, serverInitiated } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "sync_now", arguments: { dry_run: true } });
    expect(res.isError).toBeFalsy();
    expect(f.calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual(["GET /api/v1/me"]);
    expect(res.structuredContent).toEqual({
      dry_run: true,
      ok: true,
      time_zone: "UTC",
      sources: [
        { source: "claude_code", status: "ok", affected_from: null, days: 2, rows: 2, total_tokens: 10 + 30 + 100 + 5 + 10 + 7 + 100 + 5, requests: 2, uploaded: false },
      ],
      totals: { days: 2, rows: 2, total_tokens: 267, requests: 2 },
    });
    const everything = JSON.stringify(res);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("claude-opus-4-6"); // no row-level data
    expect(text(res)).toContain("Dry run");
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(serverInitiated).toEqual([]);
  });

  it("uploads and records lastSync", async () => {
    await writeConfig();
    const f = mockFetch();
    const { client } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "sync_now", arguments: {} });
    expect(res.isError).toBeFalsy();
    const uploads = f.calls.filter((c) => c.url.pathname === "/api/v1/usage");
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(uploads[0]!.body)).not.toContain(SECRET);
    expect(text(res)).toContain("Claude Code: 2 days, 2 rows");
    const cfg = JSON.parse(await fs.readFile(path.join(env.TOKENRANK_HOME!, "config.json"), "utf8"));
    expect(cfg.lastSync.claude_code).toBe(NOW.toISOString());
  });

  it("tells the user to log in when there is no token", async () => {
    const f = mockFetch();
    const { client } = await connect({ env, fetch: f.fetch });
    const res = await client.callTool({ name: "sync_now", arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("npx tokenrank-collector login");
    expect(f.calls).toHaveLength(0);
  });
});
