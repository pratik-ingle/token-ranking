import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { USAGE_ROW_FIELDS, ingestPayloadSchema, type UsageRow } from "@tokenrank/shared";
import { main } from "../src/main";
import { runSync } from "../src/sync";
import { saveConfig, defaultConfig } from "../src/config";
import {
  capture,
  expectNoSecrets,
  fixtureSecrets,
  makeTestEnv,
  mockServer,
  noSleep,
  readConfigFile,
  rowSummary,
  writeConfig,
  type TestEnv,
} from "./helpers";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const TOKEN = "tr_test_SUPERSECRETTOKEN_0123456789";
const SERVER = "http://tokenrank.test";

function loggedInConfig(extra: Record<string, unknown> = {}) {
  return {
    version: 1,
    server: SERVER,
    token: TOKEN,
    username: "alice",
    timezone: "UTC",
    sources: {
      claude_code: { enabled: true },
      codex_cli: { enabled: true },
      openai_api: { enabled: false },
      anthropic_api: { enabled: false },
      cursor: { enabled: false },
    },
    lastSync: {},
    ...extra,
  };
}

const SORTED_FIELDS = [...USAGE_ROW_FIELDS].sort();

function assertUploadShape(payloads: unknown): UsageRow[] {
  expect(Array.isArray(payloads)).toBe(true);
  const rows: UsageRow[] = [];
  for (const chunk of payloads as unknown[]) {
    const parsed = ingestPayloadSchema.safeParse(chunk);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    for (const row of chunk as Record<string, unknown>[]) {
      expect(Object.keys(row).sort()).toEqual(SORTED_FIELDS);
      rows.push(row as unknown as UsageRow);
    }
  }
  return rows;
}

let t: TestEnv;
let secrets: string[];
beforeEach(async () => {
  t = await makeTestEnv();
  secrets = await fixtureSecrets();
});
afterEach(async () => {
  await t.cleanup();
});

describe("sync --dry-run", () => {
  it("prints exactly the payloads, valid and strictly shaped, and uploads nothing", async () => {
    await writeConfig(t.env, loggedInConfig());
    const server = mockServer({ timezone: "Asia/Kolkata" });
    const out = capture();
    const code = await main(["sync", "--dry-run"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    const stdout = out.stdout.join("");
    const stderr = out.stderr.join("");
    expect(code, stderr).toBe(0);

    const payloads = JSON.parse(stdout) as UsageRow[][];
    const rows = assertUploadShape(payloads);
    expect(rows.length).toBeGreaterThan(0);
    // Bucketed in the timezone refreshed from GET /api/v1/me (Asia/Kolkata).
    expect(rowSummary(rows)).toContain("2026-10-13 claude_code claude-haiku-4-5-20251001 coding in=100 out=50 cr=0 cw=0 req=1");
    expect(new Set(rows.map((r) => r.source))).toEqual(new Set(["claude_code", "codex_cli"]));

    // No upload, no POST of any kind; only GET /api/v1/me.
    expect(server.calls.filter((c) => c.path === "/api/v1/usage")).toHaveLength(0);
    expect(server.calls.every((c) => c.method === "GET")).toBe(true);
    expect(server.uploads).toHaveLength(0);

    // No prompt/response text, paths, branches, emails — and no token — in any output.
    expectNoSecrets(stdout + stderr, secrets);
    expect(stdout + stderr).not.toContain(TOKEN);
    expect(stderr).toMatch(/Dry run: nothing was uploaded/);

    // Dry runs change no state.
    expect((await readConfigFile(t.env)).lastSync).toEqual({});
  });

  it("works before login using detected local sources, without any network access", async () => {
    const server = mockServer();
    const out = capture();
    const code = await main(["sync", "--dry-run"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    expect(code, out.stderr.join("")).toBe(0);
    assertUploadShape(JSON.parse(out.stdout.join("")));
    expect(server.calls).toHaveLength(0);
    expectNoSecrets(out.stdout.join("") + out.stderr.join(""), secrets);
  });

  it("prints [] when there is nothing to upload", async () => {
    const empty = await makeTestEnv({ copyFixtures: false });
    try {
      const out = capture();
      const code = await main(["sync", "--dry-run"], { ...out.io, env: empty.env, fetch: mockServer().fetch, now: () => NOW });
      expect(code).toBe(0);
      expect(JSON.parse(out.stdout.join(""))).toEqual([]);
    } finally {
      await empty.cleanup();
    }
  });
});

describe("sync (upload)", () => {
  it("uploads the same rows the dry run shows, then records lastSync, heartbeats and prints the rank", async () => {
    await writeConfig(t.env, loggedInConfig());
    const dryServer = mockServer();
    const dry = capture();
    await main(["sync", "--dry-run"], { ...dry.io, env: t.env, fetch: dryServer.fetch, now: () => NOW, sleep: noSleep });
    const dryPayloads = JSON.parse(dry.stdout.join("")) as UsageRow[][];

    const server = mockServer();
    const out = capture();
    const code = await main(["sync"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    const all = out.stdout.join("") + out.stderr.join("");
    expect(code, all).toBe(0);
    expect(server.uploads).toEqual(dryPayloads);
    assertUploadShape(server.uploads);
    for (const call of server.calls) expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
    const heartbeats = server.calls.filter((c) => c.path === "/api/v1/integrations/heartbeat").map((c) => c.body);
    expect(heartbeats).toEqual([
      { source: "claude_code", status: "ok" },
      { source: "codex_cli", status: "ok" },
    ]);
    const cfg = await readConfigFile(t.env);
    expect(cfg.lastSync).toEqual({ claude_code: NOW.toISOString(), codex_cli: NOW.toISOString() });
    expect(all).toMatch(/Claude Code/);
    expect(all).toMatch(/http:\/\/tokenrank\.test\/u\/alice/);
    expect(all).not.toContain(TOKEN);
    expectNoSecrets(all, secrets);
  });

  it("does not record lastSync for a source whose upload failed", async () => {
    await writeConfig(t.env, loggedInConfig());
    let n = 0;
    const server = mockServer({
      routes: {
        "/api/v1/usage": (call) => {
          n++;
          const rows = call.body as UsageRow[];
          if (rows[0]?.source === "codex_cli") return new Response(JSON.stringify({ error: "invalid_payload", issues: [{ path: "0.model", message: "bad" }] }), { status: 400 });
          return new Response(JSON.stringify({ accepted: rows.length, inserted: rows.length, updated: 0, skipped_verified: 0, flagged: 0 }), { status: 200 });
        },
      },
    });
    const out = capture();
    const code = await main(["sync"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    expect(code).toBe(1);
    expect(n).toBe(2);
    expect((await readConfigFile(t.env)).lastSync).toEqual({ claude_code: NOW.toISOString() });
    const errorBeat = server.calls.find((c) => c.path === "/api/v1/integrations/heartbeat" && (c.body as { status: string }).status === "error");
    expect(errorBeat?.body).toEqual({ source: "codex_cli", status: "error" });
  });

  it("tells the user to log in again on 401", async () => {
    await writeConfig(t.env, loggedInConfig());
    const server = mockServer({ routes: { "/api/v1/me": () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }) } });
    const out = capture();
    const code = await main(["sync"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    expect(code).toBe(1);
    expect(out.stderr.join("")).toMatch(/tokenrank-collector login/);
    expect(server.uploads).toHaveLength(0);
  });

  it("refuses a real sync when not logged in", async () => {
    const out = capture();
    const code = await main(["sync"], { ...out.io, env: t.env, fetch: mockServer().fetch, now: () => NOW });
    expect(code).toBe(1);
    expect(out.stderr.join("")).toMatch(/Not logged in.*login/);
  });
});

describe("incremental sync", () => {
  async function setMtime(file: string, iso: string) {
    const d = new Date(iso);
    await fs.utimes(file, d, d);
  }

  async function writeJsonl(file: string, lines: unknown[], mtime: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    await setMtime(file, mtime);
  }

  const assistant = (id: string, model: string, ts: string) => ({
    type: "assistant",
    requestId: `req_${id}`,
    sessionId: "s",
    timestamp: ts,
    message: { id, model, content: [{ type: "text", text: "SECRET_PROMPT_7f3a" }], usage: { input_tokens: 1000, output_tokens: 1000 } },
  });

  it("parses only recently modified files and uploads only days >= affectedFrom, idempotently", async () => {
    const projects = path.join(t.claudeDir, "projects");
    const sessA = path.join(projects, "-home-alice-SECRET_PATH_9c2e-webapp", "5f1c2a3b-9d8e-4f7a-b6c5-1d2e3f4a5b6c.jsonl");
    const sub = path.join(projects, "-home-alice-SECRET_PATH_9c2e-webapp", "5f1c2a3b-9d8e-4f7a-b6c5-1d2e3f4a5b6c", "subagents", "agent-a1b2c3d4.jsonl");
    const sessB = path.join(projects, "-home-alice-other", "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.jsonl");
    await setMtime(sessA, "2026-10-12T23:31:00Z");
    await setMtime(sub, "2026-10-12T09:03:00Z");
    await setMtime(sessB, "2026-10-13T10:01:00Z");
    // Inconsistent on purpose: an old mtime but a recent event. Proves the file is never opened.
    await writeJsonl(path.join(projects, "-stale", "stale.jsonl"), [assistant("msg_stale", "claude-stale-mtime-decoy", "2026-10-13T08:00:00Z")], "2026-10-05T00:00:00Z");
    // Recent file containing an event before the window: parsed, but that day is not uploaded.
    await writeJsonl(path.join(projects, "-recent", "recent.jsonl"), [assistant("msg_old_day", "claude-before-window", "2026-10-10T08:00:00Z")], "2026-10-13T00:00:00Z");

    // Last sync 2026-10-13 12:00 UTC → affected from 2026-10-12 (one day back).
    await writeConfig(t.env, loggedInConfig({ lastSync: { claude_code: "2026-10-13T12:00:00.000Z" } }));
    const opts = { env: t.env, fetch: mockServer().fetch, now: () => NOW, sources: ["claude_code" as const], dryRun: true };
    const first = await runSync(opts);
    const s = first.sources[0]!;
    expect(s.affectedFrom).toBe("2026-10-12");
    expect(s.stats).toMatchObject({ files: 5, filesParsed: 4, filesSkippedByMtime: 1 });
    const rows = first.payloads.flat();
    expect(rows.every((r) => r.date >= "2026-10-12")).toBe(true);
    expect(rows.map((r) => r.model).join(" ")).not.toMatch(/stale|before-window/);
    // Day 2026-10-12 is complete: it equals the same day from a full re-read.
    const full = await runSync({ ...opts, full: true });
    const day = (rs: UsageRow[], d: string) => rs.filter((r) => r.date === d);
    expect(day(rows, "2026-10-12")).toEqual(day(full.payloads.flat(), "2026-10-12"));
    expect(full.payloads.flat().map((r) => r.model)).toContain("claude-stale-mtime-decoy");

    // Re-running produces identical payloads.
    const again = await runSync(opts);
    expect(again.payloads).toEqual(first.payloads);

    // Real uploads: a second sync re-sends overlapping days with identical values.
    const server = mockServer();
    await runSync({ ...opts, dryRun: false, fetch: server.fetch });
    const later = new Date("2026-10-14T18:00:00.000Z");
    await runSync({ ...opts, dryRun: false, fetch: server.fetch, now: () => later });
    const [up1, up2] = server.uploads.map((u) => u);
    expect(up2!.every((r) => r.date >= "2026-10-13")).toBe(true);
    expect(day(up2!, "2026-10-13")).toEqual(day(up1!, "2026-10-13"));
    expect(up1).toEqual(first.payloads[0]);
  });

  it("applies the same mtime cut-off to Codex rollouts", async () => {
    const parent = path.join(t.codexDir, "sessions/2026/10/11/rollout-2026-10-11T08-00-00-0199aaaa-1111-7222-8333-444455556666.jsonl");
    await setMtime(parent, "2026-10-11T23:46:00Z");
    await writeConfig(t.env, loggedInConfig({ lastSync: { codex_cli: "2026-10-14T06:00:00.000Z" } }));
    const res = await runSync({ env: t.env, fetch: mockServer().fetch, now: () => NOW, sources: ["codex_cli"], dryRun: true });
    const s = res.sources[0]!;
    expect(s.affectedFrom).toBe("2026-10-13");
    expect(s.stats?.filesSkippedByMtime).toBeGreaterThanOrEqual(1);
    expect(res.payloads.flat().every((r) => r.date >= "2026-10-13")).toBe(true);
  });
});

describe("config file", () => {
  it("is written with mode 0600 in a 0700 directory, atomically", async () => {
    const out = capture();
    expect(await main(["enable", "claude_code"], { ...out.io, env: t.env })).toBe(0);
    const file = path.join(t.tokenrankHome, "config.json");
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(t.tokenrankHome)).mode & 0o777).toBe(0o700);
    // Loosened permissions are tightened again on save.
    await fs.chmod(file, 0o644);
    await saveConfig(defaultConfig(), t.env);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect((await fs.readdir(t.tokenrankHome)).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("config show redacts the token and admin keys; enable never prints the key", async () => {
    await writeConfig(t.env, loggedInConfig());
    const adminKey = "sk-admin-SUPERSECRETADMINKEY";
    const out = capture();
    expect(await main(["enable", "openai_api"], { ...out.io, env: { ...t.env, OPENAI_ADMIN_KEY: adminKey } })).toBe(0);
    expect(await main(["config", "show"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["sources"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["status"], { ...out.io, env: t.env, now: () => NOW })).toBe(0);
    const all = out.stdout.join("") + out.stderr.join("");
    expect(all).not.toContain(adminKey);
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("<redacted>");
    expect((await readConfigFile(t.env)).sources.openai_api).toEqual({ enabled: true, adminKey });
  });

  it("cursor requires --email or --team-wide; disable deletes the key", async () => {
    const out = capture();
    const env = { ...t.env, CURSOR_ADMIN_KEY: "key_cursor_SECRET" };
    expect(await main(["enable", "cursor"], { ...out.io, env, promptSecret: async () => null })).toBe(2);
    expect(await main(["enable", "cursor", "--email", "me@example.com"], { ...out.io, env })).toBe(0);
    expect((await readConfigFile(t.env)).sources.cursor).toEqual({ enabled: true, adminKey: "key_cursor_SECRET", email: "me@example.com" });
    expect(await main(["disable", "cursor"], { ...out.io, env })).toBe(0);
    expect((await readConfigFile(t.env)).sources.cursor).toEqual({ enabled: false });
  });

  it("category-map stores the mapping locally", async () => {
    const out = capture();
    expect(await main(["category-map", "openai_api", "proj_abc", "coding"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["config", "category-map", "anthropic_api", "wrkspc_1", "agents"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["category-map", "openai_api", "proj_abc", "nonsense"], { ...out.io, env: t.env })).toBe(2);
    const cfg = await readConfigFile(t.env);
    expect(cfg.sources.openai_api.categoryMap).toEqual({ proj_abc: "coding" });
    expect(cfg.sources.anthropic_api.categoryMap).toEqual({ wrkspc_1: "agents" });
  });

  it("logout removes the token", async () => {
    await writeConfig(t.env, loggedInConfig());
    expect(await main(["logout"], { ...capture().io, env: t.env })).toBe(0);
    expect((await readConfigFile(t.env)).token).toBeUndefined();
  });
});

describe("login (device flow)", () => {
  it("polls with RFC 8628 back-off, saves the token, enables local sources and runs the first sync", async () => {
    const tokenResponses = [
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }),
      new Response(JSON.stringify({ access_token: TOKEN, token_type: "bearer", username: "alice", timezone: "Asia/Kolkata" }), { status: 200 }),
    ];
    const server = mockServer({
      timezone: "Asia/Kolkata",
      routes: {
        "/api/v1/device/code": () =>
          new Response(
            JSON.stringify({
              device_code: "dev_123",
              user_code: "ABCD-EFGH",
              verification_uri: `${SERVER}/device`,
              verification_uri_complete: `${SERVER}/device?code=ABCD-EFGH`,
              expires_in: 600,
              interval: 5,
            }),
            { status: 200 },
          ),
        "/api/v1/device/token": () => tokenResponses.shift()!,
      },
    });
    const sleeps: number[] = [];
    const opened: string[] = [];
    const out = capture();
    const code = await main(["login", "--server", SERVER], {
      ...out.io,
      env: t.env,
      fetch: server.fetch,
      now: () => NOW,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      openBrowser: (u) => opened.push(u),
    });
    const all = out.stdout.join("") + out.stderr.join("");
    expect(code, all).toBe(0);
    expect(sleeps.slice(0, 3)).toEqual([5000, 5000, 10000]);
    expect(opened).toEqual([`${SERVER}/device?code=ABCD-EFGH`]);
    expect(server.calls.find((c) => c.path === "/api/v1/device/code")?.body).toEqual({ client: "collector" });
    expect(server.calls.find((c) => c.path === "/api/v1/device/token")?.body).toEqual({ device_code: "dev_123" });

    const cfg = await readConfigFile(t.env);
    expect(cfg).toMatchObject({ server: SERVER, token: TOKEN, username: "alice", timezone: "Asia/Kolkata" });
    expect(cfg.sources.claude_code.enabled).toBe(true);
    expect(cfg.sources.codex_cli.enabled).toBe(true);
    expect((await fs.stat(path.join(t.tokenrankHome, "config.json"))).mode & 0o777).toBe(0o600);

    expect(server.uploads.length).toBeGreaterThan(0);
    expect(all).toContain("ABCD-EFGH");
    expect(all).toContain("Logged in as @alice");
    expect(all).toContain("http://tokenrank.test/u/alice");
    expect(all).not.toContain(TOKEN);
    expectNoSecrets(all, secrets);
  });

  it("fails cleanly when the code expires or is denied", async () => {
    const server = mockServer({
      routes: {
        "/api/v1/device/code": () =>
          new Response(JSON.stringify({ device_code: "d", user_code: "U", verification_uri: `${SERVER}/device`, verification_uri_complete: `${SERVER}/device?code=U`, expires_in: 600, interval: 1 }), { status: 200 }),
        "/api/v1/device/token": () => new Response(JSON.stringify({ error: "access_denied" }), { status: 400 }),
      },
    });
    const out = capture();
    const code = await main(["login", "--server", SERVER, "--no-browser"], { ...out.io, env: t.env, fetch: server.fetch, sleep: noSleep });
    expect(code).toBe(1);
    expect(out.stderr.join("")).toMatch(/denied/);
  });
});

describe("admin-key sources", () => {
  it("sends the key only to the provider, uploads self-reported rows without trust_level, and only a hashed org id", async () => {
    const adminKey = "sk-ant-admin01-SUPERSECRETKEY";
    await writeConfig(
      t.env,
      loggedInConfig({
        sources: {
          claude_code: { enabled: false },
          codex_cli: { enabled: false },
          openai_api: { enabled: false },
          anthropic_api: { enabled: true, adminKey },
          cursor: { enabled: false },
        },
      }),
    );
    const server = mockServer({
      routes: {
        "/v1/organizations/usage_report/messages": () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  starting_at: "2026-10-13T10:00:00Z",
                  ending_at: "2026-10-13T11:00:00Z",
                  results: [
                    { model: "claude-opus-4-6", uncached_input_tokens: 100, cache_read_input_tokens: 50, cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 1 }, output_tokens: 70 },
                  ],
                },
              ],
              has_more: false,
              next_page: null,
            }),
            { status: 200 },
          ),
        "/v1/organizations/me": () => new Response(JSON.stringify({ id: "org_SECRETORGID", name: "SECRET_ORG_NAME", type: "organization" }), { status: 200 }),
        "/api/v1/integrations/heartbeat": () => new Response(JSON.stringify({ status: "duplicate" }), { status: 200 }),
      },
    });
    const out = capture();
    const code = await main(["sync"], { ...out.io, env: t.env, fetch: server.fetch, now: () => NOW, sleep: noSleep });
    const all = out.stdout.join("") + out.stderr.join("");
    expect(code, all).toBe(0);

    for (const c of server.calls) {
      const host = new URL(c.url).host;
      if (host === "api.anthropic.com") {
        expect(c.headers["x-api-key"]).toBe(adminKey);
        expect(c.headers.authorization).toBeUndefined();
      } else {
        expect(host).toBe("tokenrank.test");
        expect(JSON.stringify(c)).not.toContain(adminKey);
        expect(JSON.stringify(c)).not.toContain("org_SECRETORGID");
      }
    }
    expect(server.uploads).toEqual([
      [
        {
          date: "2026-10-13",
          source: "anthropic_api",
          model: "claude-opus-4-6",
          category: "chat",
          input_tokens: 100,
          output_tokens: 70,
          cache_read_tokens: 50,
          cache_write_tokens: 6,
          request_count: 0,
          image_count: 0,
        },
      ],
    ]);
    const beat = server.calls.find((c) => c.path === "/api/v1/integrations/heartbeat")!.body as Record<string, string>;
    expect(beat).toEqual({
      source: "anthropic_api",
      status: "ok",
      org_fingerprint: createHash("sha256").update("anthropic_api:org_SECRETORGID").digest("hex"),
    });
    expect(all).toMatch(/already linked to another TokenRank account/);
    expect(all).not.toContain(adminKey);
    // First sync looks back 90 days, rounded to local midnight.
    const usageCall = server.calls.find((c) => c.path === "/v1/organizations/usage_report/messages")!;
    expect(new URL(usageCall.url).searchParams.get("starting_at")).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("misc commands", () => {
  it("--help, --version, schedule and unknown commands", async () => {
    const out = capture();
    expect(await main(["--help"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["--version"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["schedule"], { ...out.io, env: t.env })).toBe(0);
    expect(await main(["sync", "--since", "yesterday"], { ...out.io, env: t.env })).toBe(2);
    expect(await main(["sync", "--source", "gemini"], { ...out.io, env: t.env })).toBe(2);
    expect(await main(["bogus"], { ...out.io, env: t.env })).toBe(2);
    const stdout = out.stdout.join("");
    expect(stdout).toMatch(/OnUnitActiveSec=6h/);
    expect(stdout).toMatch(/StartInterval/);
    expect(stdout).toMatch(/\*\/6 \* \* \*/);
  });
});
