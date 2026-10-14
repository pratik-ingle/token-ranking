import path from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeParser, parseClaudeCode } from "../src/parsers/claude-code";
import { CLAUDE_FIXTURE, expectNoSecrets, fixtureSecrets, rowSummary } from "./helpers";

const PROJECTS = path.join(CLAUDE_FIXTURE, "projects");

describe("Claude Code parser on fixture transcripts", () => {
  it("aggregates deduplicated API responses per UTC day and model", async () => {
    const res = await parseClaudeCode([PROJECTS], { timeZone: "UTC" });
    expect(rowSummary(res.rows)).toEqual([
      // msg_01D (23:30Z) + subagent msg_01S1
      "2026-10-12 claude_code claude-haiku-4-5-20251001 coding in=140 out=70 cr=0 cw=0 req=2",
      // flat cache_creation_input_tokens (no nested object)
      "2026-10-12 claude_code claude-opus-4-6 coding in=3 out=250 cr=7000 cw=1500 req=1",
      // advisor iteration counted under its own model
      "2026-10-12 claude_code claude-opus-5-5 coding in=823 out=1612 cr=0 cw=0 req=1",
      // msg_01A (3 content-block lines, max output 412, copied into another file) + msg_01E (no requestId)
      "2026-10-12 claude_code claude-sonnet-4-5-20250929 coding in=11 out=414 cr=5000 cw=2000 req=2",
      // top-level usage = executor only
      "2026-10-12 claude_code claude-sonnet-5-5 coding in=1760 out=531 cr=412 cw=0 req=1",
      "2026-10-13 claude_code claude-sonnet-4-5-20250929 coding in=7 out=70 cr=0 cw=0 req=1",
    ]);
    expect(res.stats).toMatchObject({
      files: 3, // .orphaned-* and *.jsonl.superseded-* are not transcripts
      filesParsed: 3,
      skippedSynthetic: 1,
      skippedApiError: 1,
      sidechainReplaysDropped: 1,
      duplicateLines: 6,
      messages: 7,
      advisorEvents: 1,
    });
    expect(res.stats.malformedLines).toBeGreaterThanOrEqual(1); // the truncated last line
    const models = res.rows.map((r) => r.model).join(" ");
    expect(models).not.toMatch(/decoy|truncated/);
  });

  it("buckets by the user's timezone: 23:30Z lands on the next day in Asia/Kolkata", async () => {
    const res = await parseClaudeCode([PROJECTS], { timeZone: "Asia/Kolkata" });
    const haiku = rowSummary(res.rows).filter((r) => r.includes("haiku"));
    expect(haiku).toEqual([
      "2026-10-12 claude_code claude-haiku-4-5-20251001 coding in=40 out=20 cr=0 cw=0 req=1",
      "2026-10-13 claude_code claude-haiku-4-5-20251001 coding in=100 out=50 cr=0 cw=0 req=1",
    ]);
  });

  it("drops days before fromDate", async () => {
    const res = await parseClaudeCode([PROJECTS], { timeZone: "UTC", fromDate: "2026-10-13" });
    expect(res.rows.map((r) => r.date)).toEqual(["2026-10-13"]);
  });

  it("never outputs any fixture content", async () => {
    const secrets = await fixtureSecrets();
    const parser = new ClaudeCodeParser();
    const res = await parseClaudeCode([PROJECTS], { timeZone: "UTC" });
    for (const f of [
      "-home-alice-SECRET_PATH_9c2e-webapp/5f1c2a3b-9d8e-4f7a-b6c5-1d2e3f4a5b6c.jsonl",
      "-home-alice-other/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d.jsonl",
    ]) {
      await parser.addFile(path.join(PROJECTS, f));
    }
    expectNoSecrets(JSON.stringify({ rows: res.rows, stats: res.stats, events: parser.events(), warnings: res.warnings }), secrets);
  });
});

const assistantLine = (o: {
  id?: string;
  requestId?: string;
  sessionId?: string;
  ts?: string;
  model?: string;
  usage?: Record<string, unknown>;
  sidechain?: boolean;
}) =>
  JSON.stringify({
    isSidechain: o.sidechain ?? false,
    sessionId: o.sessionId ?? "s1",
    cwd: "/secret/cwd",
    type: "assistant",
    message: { id: o.id ?? "msg_1", model: o.model ?? "claude-test", content: [{ type: "text", text: "hello" }], usage: o.usage ?? { input_tokens: 1, output_tokens: 1 } },
    ...(o.requestId === undefined ? { requestId: "req_1" } : o.requestId ? { requestId: o.requestId } : {}),
    timestamp: o.ts ?? "2026-10-12T12:00:00.000Z",
  });

describe("Claude Code parser line semantics", () => {
  it("cache_write uses the nested 5m+1h split when present, else the flat field", () => {
    const p = new ClaudeCodeParser();
    p.addLine(
      assistantLine({
        id: "msg_a",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 999, cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 12 } },
      }),
    );
    p.addLine(assistantLine({ id: "msg_b", requestId: "req_b", usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 500 } }));
    const ev = p.events();
    expect(ev.map((e) => e.cacheWrite)).toEqual([42, 500]);
  });

  it("takes the per-field max across duplicate content-block lines regardless of order", () => {
    const lines = [
      assistantLine({ usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100 } }),
      assistantLine({ usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 100 } }),
      assistantLine({ usage: { input_tokens: 5, output_tokens: 300, cache_read_input_tokens: 100 } }),
    ];
    for (const order of [lines, [...lines].reverse()]) {
      const p = new ClaudeCodeParser();
      order.forEach((l) => p.addLine(l));
      expect(p.toRows("UTC")).toEqual([
        {
          date: "2026-10-12",
          source: "claude_code",
          model: "claude-test",
          category: "coding",
          input_tokens: 5,
          output_tokens: 300,
          cache_read_tokens: 100,
          cache_write_tokens: 0,
          request_count: 1,
          image_count: 0,
        },
      ]);
    }
  });

  it("dedupes without requestId by message id + session (+ timestamp for non-msg_ ids)", () => {
    const p = new ClaudeCodeParser();
    p.addLine(assistantLine({ id: "msg_x", requestId: "", sessionId: "s1", ts: "2026-10-12T01:00:00Z" }));
    p.addLine(assistantLine({ id: "msg_x", requestId: "", sessionId: "s1", ts: "2026-10-12T01:00:01Z" }));
    p.addLine(assistantLine({ id: "msg_x", requestId: "", sessionId: "s2", ts: "2026-10-12T01:00:01Z" }));
    p.addLine(assistantLine({ id: "uuid-like", requestId: "", sessionId: "s1", ts: "2026-10-12T01:00:00Z" }));
    p.addLine(assistantLine({ id: "uuid-like", requestId: "", sessionId: "s1", ts: "2026-10-12T01:00:05Z" }));
    expect(p.events()).toHaveLength(4);
  });

  it("drops sidechain replays of parent messages but keeps genuine sub-agent calls", () => {
    const p = new ClaudeCodeParser();
    // Replay first: order must not matter.
    p.addLine(assistantLine({ id: "msg_parent", requestId: "req_replayed", sidechain: true }));
    p.addLine(assistantLine({ id: "msg_parent", requestId: "req_parent" }));
    p.addLine(assistantLine({ id: "msg_sub", requestId: "req_sub", sidechain: true }));
    const ev = p.events();
    expect(ev).toHaveLength(2);
    expect(p.stats.sidechainReplaysDropped).toBe(1);
  });

  it("skips <synthetic> models, API error messages and lines without usage", () => {
    const p = new ClaudeCodeParser();
    p.addLine(assistantLine({ model: "<synthetic>" }));
    p.addLine(JSON.stringify({ type: "assistant", isApiErrorMessage: true, requestId: "r", timestamp: "2026-10-12T00:00:00Z", message: { id: "m", model: "x", usage: { input_tokens: 5 } } }));
    p.addLine(JSON.stringify({ type: "assistant", requestId: "r2", timestamp: "2026-10-12T00:00:00Z", message: { id: "m2", model: "x" } }));
    p.addLine(JSON.stringify({ type: "user", message: { role: "user", content: "assistant" } }));
    expect(p.events()).toHaveLength(0);
    expect(p.stats).toMatchObject({ skippedSynthetic: 1, skippedApiError: 1, skippedNoUsage: 1 });
  });

  it("counts advisor iterations defensively (counters nested under usage, missing model)", () => {
    const p = new ClaudeCodeParser();
    p.addLine(
      assistantLine({
        model: "claude-sonnet-5-5",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          iterations: [
            { type: "message", input_tokens: 10, output_tokens: 20 },
            { type: "advisor_message", model: "claude-opus-5-5", usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: 9 } },
            { type: "advisor_message", input_tokens: 1, output_tokens: 2 },
            "garbage",
          ],
        },
      }),
    );
    const ev = p.events().map((e) => `${e.kind}:${e.model}:${e.input}/${e.output}/${e.cacheRead}`);
    expect(ev).toEqual(["message:claude-sonnet-5-5:10/20/0", "advisor:claude-opus-5-5:7/8/9", "advisor:unknown:1/2/0"]);
  });

  it("skips malformed and truncated lines without throwing", () => {
    const p = new ClaudeCodeParser();
    const good = assistantLine({});
    for (let i = 0; i < good.length; i += 7) p.addLine(good.slice(0, i));
    p.addLine("not json but mentions \"assistant\"");
    p.addLine(good);
    expect(p.events()).toHaveLength(1);
  });
});
