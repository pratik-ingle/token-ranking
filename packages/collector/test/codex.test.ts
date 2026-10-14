import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { CodexParser, codexDeltaToCounts, parseCodex } from "../src/parsers/codex";
import { CODEX_FIXTURE, expectNoSecrets, fixtureSecrets, rowSummary } from "./helpers";

const hasZstd = typeof (zlib as unknown as { zstdDecompressSync?: unknown }).zstdDecompressSync === "function";

describe("Codex parser on fixture rollouts", () => {
  it("aggregates token_count deltas per UTC day and model", async () => {
    const res = await parseCodex(CODEX_FIXTURE, { timeZone: "UTC" });
    expect(rowSummary(res.rows)).toEqual([
      // archived-only rollout
      "2026-10-09 codex_cli o4-mini coding in=200 out=30 cr=100 cw=0 req=1",
      // 12000-8000 = 4000; then 13000-12000-500 = 500 with cache_write 500
      "2026-10-11 codex_cli gpt-5-codex coding in=4500 out=900 cr=20000 cw=500 req=2",
      // model switched by turn_context; first event uses the diff of totals (no last_token_usage)
      "2026-10-11 codex_cli gpt-5 coding in=1100 out=110 cr=4000 cw=0 req=2",
      // the fork's own new turn (its replayed history is deduplicated)
      "2026-10-12 codex_cli gpt-5-codex coding in=1000 out=200 cr=1000 cw=0 req=1",
    ]);
    expect(res.stats).toMatchObject({
      filesShadowedByArchive: 1,
      nullInfo: 1 + 1, // parent + its replay in the fork
      replayDuplicates: 4,
      events: 6,
    });
    expect(res.stats.unchangedTotals).toBeGreaterThanOrEqual(2);
    if (!hasZstd) {
      expect(res.stats.compressedSkipped).toBe(1);
      expect(res.warnings.join("\n")).toMatch(/compressed Codex rollout/);
    }
    expect(res.rows.map((r) => r.model).join(" ")).not.toMatch(/decoy/);
  });

  it("buckets by the user's timezone", async () => {
    const res = await parseCodex(CODEX_FIXTURE, { timeZone: "Asia/Kolkata" });
    // The 23:45Z gpt-5 event is 05:15 the next day in IST.
    expect(rowSummary(res.rows).filter((r) => r.includes(" gpt-5 "))).toEqual([
      "2026-10-11 codex_cli gpt-5 coding in=1000 out=100 cr=4000 cw=0 req=1",
      "2026-10-12 codex_cli gpt-5 coding in=100 out=10 cr=0 cw=0 req=1",
    ]);
  });

  it("never outputs any fixture content", async () => {
    const secrets = await fixtureSecrets();
    const res = await parseCodex(CODEX_FIXTURE, { timeZone: "UTC" });
    expectNoSecrets(JSON.stringify(res), secrets);
  });
});

const tokenCount = (ts: string, total: Record<string, number> | null, last?: Record<string, number>) =>
  JSON.stringify({
    timestamp: ts,
    type: "event_msg",
    payload: { type: "token_count", info: total ? { total_token_usage: total, ...(last ? { last_token_usage: last } : {}) } : null, rate_limits: null },
  });
const turnContext = (ts: string, model: string) => JSON.stringify({ timestamp: ts, type: "turn_context", payload: { cwd: "/secret", model } });
const u = (input: number, cached: number, output: number) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: 0,
  total_tokens: input + output,
});

describe("Codex parser line semantics", () => {
  it("skips unchanged totals, null info and uses last_token_usage as the delta", () => {
    const p = new CodexParser();
    const s = p.newFileState();
    p.addLine(s, turnContext("2026-10-12T00:00:00Z", "gpt-5"));
    p.addLine(s, tokenCount("2026-10-12T00:00:01Z", null));
    p.addLine(s, tokenCount("2026-10-12T00:00:02Z", u(100, 40, 10), u(100, 40, 10)));
    p.addLine(s, tokenCount("2026-10-12T00:00:03Z", u(100, 40, 10), u(100, 40, 10)));
    p.addLine(s, tokenCount("2026-10-12T00:00:04Z", u(250, 100, 30), u(150, 60, 20)));
    expect(p.events().map((e) => [e.model, e.input, e.cacheRead, e.output])).toEqual([
      ["gpt-5", 60, 40, 10],
      ["gpt-5", 90, 60, 20],
    ]);
    expect(p.stats).toMatchObject({ nullInfo: 1, unchangedTotals: 1, events: 2 });
  });

  it("falls back to the difference of successive totals when last_token_usage is missing", () => {
    const p = new CodexParser();
    const s = p.newFileState();
    p.addLine(s, tokenCount("2026-10-12T00:00:02Z", u(100, 40, 10)));
    p.addLine(s, tokenCount("2026-10-12T00:00:04Z", u(250, 100, 30)));
    expect(p.events().map((e) => [e.input, e.cacheRead, e.output])).toEqual([
      [60, 40, 10],
      [90, 60, 20],
    ]);
  });

  it("uses model 'unknown' until a turn_context is seen, and tracks the latest one per file", () => {
    const p = new CodexParser();
    const a = p.newFileState();
    p.addLine(a, tokenCount("2026-10-12T00:00:01Z", u(10, 0, 1), u(10, 0, 1)));
    p.addLine(a, turnContext("2026-10-12T00:00:02Z", "gpt-5-codex"));
    p.addLine(a, tokenCount("2026-10-12T00:00:03Z", u(20, 0, 2), u(10, 0, 1)));
    const b = p.newFileState(); // a new file starts unknown again
    p.addLine(b, tokenCount("2026-10-12T00:00:05Z", u(5, 0, 1), u(5, 0, 1)));
    expect(p.events().map((e) => e.model)).toEqual(["unknown", "gpt-5-codex", "unknown"]);
  });

  it("dedupes replayed token_count lines across files (forks)", () => {
    const p = new CodexParser();
    const parent = p.newFileState();
    const fork = p.newFileState();
    const line = tokenCount("2026-10-12T00:00:02Z", u(100, 40, 10), u(100, 40, 10));
    p.addLine(parent, line);
    p.addLine(fork, line);
    expect(p.events()).toHaveLength(1);
    expect(p.stats.replayDuplicates).toBe(1);
  });

  it("ignores token_usage_record and lines that merely mention token_count", () => {
    const p = new CodexParser();
    const s = p.newFileState();
    p.addLine(s, JSON.stringify({ timestamp: "2026-10-12T00:00:00Z", type: "token_usage_record", payload: { type: "token_count", info: { total_token_usage: u(9, 0, 9) } } }));
    p.addLine(s, JSON.stringify({ timestamp: "2026-10-12T00:00:00Z", type: "response_item", payload: { type: "message", content: '"token_count" turn_context' } }));
    expect(p.events()).toHaveLength(0);
  });

  it("maps cache_write inside non-cached input and clamps at zero", () => {
    const d = { input_tokens: 100, cached_input_tokens: 70, cache_write_input_tokens: 50, output_tokens: 9, reasoning_output_tokens: 4, total_tokens: 109 };
    expect(codexDeltaToCounts(d)).toEqual({ input: 0, output: 9, cacheRead: 70, cacheWrite: 30 });
    expect(codexDeltaToCounts({ ...d, cache_write_input_tokens: 0 })).toEqual({ input: 30, output: 9, cacheRead: 70, cacheWrite: 0 });
  });
});
