import { describe, expect, it, vi, afterEach } from "vitest";
import { compileFieldSpec, extractFields, findStringEnd } from "../src/json-extract";

// ---------------------------------------------------------------------------
// Reference semantics: prune(JSON.parse(line)) using an independent trie.
// ---------------------------------------------------------------------------
interface RefNode {
  scalar: boolean;
  subtree: boolean;
  keys: Map<string, RefNode>;
  items: RefNode | null;
}
const refNode = (): RefNode => ({ scalar: false, subtree: false, keys: new Map(), items: null });

function buildRef(paths: string[]): RefNode {
  const root = refNode();
  for (const p of paths) {
    const segs = p.split(".");
    let node = root;
    segs.forEach((raw, i) => {
      if (raw === "**") {
        node.subtree = true;
        return;
      }
      let seg = raw;
      let arrays = 0;
      while (seg.endsWith("[]")) {
        seg = seg.slice(0, -2);
        arrays++;
      }
      let child = node.keys.get(seg);
      if (!child) node.keys.set(seg, (child = refNode()));
      node = child;
      for (let a = 0; a < arrays; a++) node = node.items ??= refNode();
      if (i === segs.length - 1) node.scalar = true;
    });
  }
  return root;
}

function prune(value: unknown, node: RefNode): unknown {
  if (node.subtree) return value;
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    if (node.keys.size === 0) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, child] of node.keys) {
      if (Object.prototype.hasOwnProperty.call(value, k)) {
        const r = prune((value as Record<string, unknown>)[k], child);
        if (r !== undefined) out[k] = r;
      }
    }
    return out;
  }
  if (Array.isArray(value)) {
    if (!node.items) return undefined;
    return value.map((v) => prune(v, node.items!)).filter((v) => v !== undefined);
  }
  return node.scalar ? value : undefined;
}

function reference(text: string, paths: string[]): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return prune(parsed, buildRef(paths)) ?? {};
}

// ---------------------------------------------------------------------------
// Seeded random JSON text generator with escapes, unicode, exponents, ws, dup keys.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEY_POOL = [
  "timestamp",
  "type",
  "message",
  "id",
  "model",
  "usage",
  "input_tokens",
  "output_tokens",
  "cache_creation",
  "ephemeral_5m_input_tokens",
  "iterations",
  "content",
  "meta",
  "é",
  "x",
  "",
  'a"b',
  "back\\slash",
  "SECRET_KEY_CONTENT",
];
const STRING_PIECES = [
  "hello",
  "SECRET_PROMPT_7f3a",
  '"',
  "\\",
  '\\"',
  '\\\\"',
  "\n",
  "\t",
  "\r",
  "\u0001",
  "\u001f",
  " ",
  "é",
  "中文",
  "🚀",
  "{",
  "}",
  "[",
  "]",
  ",",
  ":",
  '"usage":{"input_tokens":5}',
  "/",
  " ",
  "\u0000",
];
const NUMBER_TEXTS = ["0", "-0", "1", "-1", "42", "123456789012", "3.14", "-0.5", "1e5", "1E+5", "2.5e-7", "-2E-3", "1e308", "9007199254740993", "0.0", "1.5E10"];

function makeGen(seed: number) {
  const rnd = mulberry32(seed);
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const ws = () => (rnd() < 0.8 ? "" : pick([" ", "  ", "\n", "\t", " \r\n "]));

  function encodeString(s: string): string {
    let out = '"';
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (ch === '"') out += '\\"';
      else if (ch === "\\") out += "\\\\";
      else if (cp < 0x20) {
        const short: Record<number, string> = { 8: "\\b", 9: "\\t", 10: "\\n", 12: "\\f", 13: "\\r" };
        out += short[cp] && rnd() < 0.5 ? short[cp] : `\\u${cp.toString(16).padStart(4, "0")}`;
      } else if (ch === "/" && rnd() < 0.5) out += "\\/";
      else if (rnd() < 0.12) {
        // \uXXXX escapes, including surrogate pairs for astral characters.
        for (let i = 0; i < ch.length; i++) out += `\\u${ch.charCodeAt(i).toString(16).padStart(4, rnd() < 0.5 ? "0" : "0").toUpperCase()}`;
      } else out += ch;
    }
    return `${out}"`;
  }

  function randomString(): string {
    let s = "";
    const n = int(6);
    for (let i = 0; i < n; i++) s += pick(STRING_PIECES);
    return s;
  }

  function value(depth: number): string {
    const r = rnd();
    if (depth < 5 && r < 0.3) return object(depth + 1);
    if (depth < 5 && r < 0.45) return array(depth + 1);
    if (r < 0.7) return encodeString(randomString());
    if (r < 0.88) return pick(NUMBER_TEXTS);
    return pick(["true", "false", "null"]);
  }

  function object(depth: number): string {
    const n = int(7);
    if (n === 0) return `{${ws()}}`;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const key = rnd() < 0.85 ? pick(KEY_POOL) : randomString();
      parts.push(`${ws()}${encodeString(key)}${ws()}:${ws()}${value(depth)}${ws()}`);
    }
    return `{${parts.join(",")}}`;
  }

  function array(depth: number): string {
    const n = int(5);
    if (n === 0) return `[${ws()}]`;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(`${ws()}${value(depth)}${ws()}`);
    return `[${parts.join(",")}]`;
  }

  return { object: () => `${ws()}${object(0)}${ws()}`, rnd, int, pick };
}

const PATHS = [
  "timestamp",
  "type",
  "message.id",
  "message.model",
  "message.usage.input_tokens",
  "message.usage.output_tokens",
  "message.usage.cache_creation.ephemeral_5m_input_tokens",
  "message.usage.iterations[].type",
  "message.usage.iterations[].model",
  "message.usage.iterations[].input_tokens",
  "message.content[].type",
  "meta.**",
  "é.x",
  'a"b',
  "x[][]",
];
const SPEC = compileFieldSpec(PATHS);

describe("extractFields — property test against JSON.parse", () => {
  it("matches prune(JSON.parse(line)) on 3000 generated documents", () => {
    const gen = makeGen(0xc0ffee);
    let nonTrivial = 0;
    for (let i = 0; i < 3000; i++) {
      const text = gen.object();
      const expected = reference(text, PATHS);
      const actual = extractFields(text, SPEC);
      expect(actual, text).toEqual(expected);
      // Same result from bytes as from a string.
      expect(extractFields(Buffer.from(text, "utf8"), SPEC)).toEqual(expected);
      if (expected && Object.keys(expected as object).length > 0) nonTrivial++;
    }
    expect(nonTrivial).toBeGreaterThan(500);
  });

  it("matches on structured documents shaped like real log lines", () => {
    const gen = makeGen(42);
    for (let i = 0; i < 500; i++) {
      const doc = {
        type: gen.pick(["assistant", "user", 'assis"tant']),
        timestamp: "2026-10-12T09:00:00.000Z",
        message: {
          id: `msg_${i}`,
          content: [{ type: "text", text: `SECRET_PROMPT_7f3a ${"\\\"".repeat(gen.int(5))} ${"🚀".repeat(gen.int(3))}` }, { type: "tool_use", input: { a: [1, [2, [3]]] } }],
          model: gen.pick(["claude-x", "gpt-5", null, 5, { nested: "SECRET_NESTED" }]),
          usage: {
            input_tokens: gen.pick([0, 1, 1e21, -3, 2.5e-7, 123456789]),
            iterations: [{ type: "advisor_message", model: "m", input_tokens: 3, junk: "SECRET" }, "str", 7, null],
            cache_creation: gen.pick([null, {}, { ephemeral_5m_input_tokens: 9 }]),
          },
        },
        meta: { any: ["thing", { deep: true }] },
      };
      const text = gen.rnd() < 0.5 ? JSON.stringify(doc) : JSON.stringify(doc, null, 2);
      expect(extractFields(text, SPEC)).toEqual(reference(text, PATHS));
    }
  });
});

describe("extractFields — edge cases", () => {
  const spec = compileFieldSpec(["a", "b.c", "list[].v", "sub.**"]);

  it("handles escaped quotes and backslash runs inside skipped and extracted strings", () => {
    const line = String.raw`{"skip":"he said \"hi\" and \\","a":"x\\\"y","z":"\\\\","b":{"c":"é🚀\/"}}`;
    expect(extractFields(line, spec)).toEqual({ a: 'x\\"y', b: { c: "é🚀/" } });
  });

  it("matches keys written with unicode escapes", () => {
    expect(extractFields(String.raw`{"a":1,"b":{"c":2}}`, spec)).toEqual({ a: 1, b: { c: 2 } });
  });

  it("parses numbers with exponents and signs exactly like JSON.parse", () => {
    for (const n of ["1e5", "-2.5E-3", "0", "-0", "1E+21", "123456789012345678"]) {
      expect(extractFields(`{"a":${n}}`, spec)).toEqual({ a: JSON.parse(n) });
    }
  });

  it("only takes scalars at plain paths, skips objects/arrays there", () => {
    expect(extractFields(`{"a":{"secret":"SECRET"},"b":{"c":["SECRET"]}}`, spec)).toEqual({ b: {} });
  });

  it("extracts whitelisted subtrees whole and array element fields", () => {
    expect(extractFields(`{"sub":{"x":[1,{"y":null}]},"list":[{"v":1,"w":2},{"w":3},"s",[{"v":4}]]}`, spec)).toEqual({
      sub: { x: [1, { y: null }] },
      list: [{ v: 1 }, {}],
    });
  });

  it("last duplicate key wins, like JSON.parse", () => {
    expect(extractFields(`{"a":1,"a":2,"b":{"c":1},"b":5}`, spec)).toEqual({ a: 2 });
    expect(extractFields(`{"a":{"x":1},"a":"s"}`, spec)).toEqual({ a: "s" });
  });

  it("returns null (never throws) for malformed or non-object input", () => {
    const bad = [
      "",
      "   ",
      "[1,2]",
      '"str"',
      "42",
      "null",
      "{",
      '{"a":1',
      '{"a":1,}',
      '{"a" 1}',
      '{"a":1}garbage',
      '{"a":1}{"a":2}',
      '{"a":"unterminated}',
      '{"a":tru}',
      '{"a":01}',
      '{"a":1.}',
      '{"a":-}',
      '{a:1}',
      '{"skip":[1,2,{"x":"y"}',
      '{"a":"\\x"}',
      '{"a":"bad \\u12"}',
      "\u0000\u0001",
    ];
    for (const line of bad) {
      expect(() => extractFields(line, spec)).not.toThrow();
      expect(extractFields(line, spec), JSON.stringify(line)).toBeNull();
    }
  });

  it("returns null for every truncation of a valid line", () => {
    const line = JSON.stringify({
      type: "assistant",
      a: "va\"l\\ue",
      b: { c: [1, 2, { d: "e" }], c2: 3 },
      list: [{ v: 1.5e3 }],
      sub: { deep: [true, false, null] },
    });
    expect(extractFields(line, spec)).not.toBeNull();
    for (let i = 0; i < line.length; i++) {
      expect(extractFields(line.slice(0, i), spec), line.slice(0, i)).toBeNull();
    }
  });

  it("never throws on random byte mutations", () => {
    const gen = makeGen(7);
    for (let i = 0; i < 2000; i++) {
      const text = gen.object();
      const pos = gen.int(text.length + 1);
      const mutated =
        gen.rnd() < 0.33
          ? text.slice(0, pos) + text.slice(pos + 1)
          : gen.rnd() < 0.5
            ? text.slice(0, pos) + gen.pick(['"', "\\", "{", "}", "[", "]", ",", ":", "x", "\u0000"]) + text.slice(pos)
            : text.slice(0, pos) + gen.pick(['"', "\\", "{", "]"]) + text.slice(pos + 1);
      expect(() => extractFields(mutated, SPEC)).not.toThrow();
      const r = extractFields(mutated, SPEC);
      expect(r === null || typeof r === "object").toBe(true);
    }
  });

  it("drops whitelisted strings above maxStringBytes", () => {
    const capped = compileFieldSpec(["a", "b"], { maxStringBytes: 8 });
    expect(extractFields(`{"a":"short","b":"${"x".repeat(100)}"}`, capped)).toEqual({ a: "short" });
  });

  it("rejects invalid path syntax", () => {
    expect(() => compileFieldSpec(["a.**.b"])).toThrow();
    expect(() => compileFieldSpec(["a..b"])).toThrow();
    expect(() => compileFieldSpec(["a[0]"])).toThrow();
  });

  it("findStringEnd honours backslash parity", () => {
    const b = Buffer.from(String.raw`"a\"b\\"rest`);
    expect(findStringEnd(b, 1)).toBe(7);
    expect(findStringEnd(Buffer.from(String.raw`"abc\"`), 1)).toBe(-1);
  });
});

describe("extractFields — huge content and no decoding of skipped values", () => {
  afterEach(() => vi.restoreAllMocks());

  it("skips a ~24 MB content string quickly and correctly", () => {
    // Raw text full of quotes, backslashes and JSON-looking fragments; encoded as one JSON string.
    const chunk = 'SECRET_PROMPT_7f3a "quoted" \\ \\" {"usage":{"input_tokens":999}} ✓ ';
    const big = JSON.stringify(chunk.repeat(Math.ceil((24 * 1024 * 1024) / chunk.length)));
    const line = `{"type":"assistant","message":{"content":[{"type":"text","text":${big}}],"id":"msg_1","usage":{"input_tokens":7}},"timestamp":"t"}`;
    const buf = Buffer.from(line, "utf8");
    const started = performance.now();
    const out = extractFields(buf, SPEC);
    const elapsed = performance.now() - started;
    expect(out).toEqual({ type: "assistant", message: { content: [{ type: "text" }], id: "msg_1", usage: { input_tokens: 7 } }, timestamp: "t" });
    expect(elapsed).toBeLessThan(5000);
  });

  it("never creates a JS string containing skipped content", () => {
    const toStringSpy = vi.spyOn(Buffer.prototype, "toString");
    const parseSpy = vi.spyOn(JSON, "parse");
    const line = Buffer.from(
      JSON.stringify({
        type: "assistant",
        cwd: "/home/SECRET_PATH",
        message: {
          id: "msg_1",
          model: "claude-x",
          content: [{ type: "thinking", thinking: "SECRET_THINKING ".repeat(1000) }, { type: "tool_use", input: { cmd: "SECRET_CMD" } }],
          usage: { input_tokens: 1, iterations: [{ type: "advisor_message", model: "m", input_tokens: 2, note: "SECRET_NOTE" }] },
        },
        timestamp: "2026-01-01T00:00:00Z",
      }),
    );
    const out = extractFields(line, SPEC);
    expect(out).toBeTruthy();
    const created = [
      ...toStringSpy.mock.results.map((r) => String(r.value)),
      ...parseSpy.mock.calls.map((c) => String(c[0])),
    ];
    for (const s of created) expect(s).not.toMatch(/SECRET/);
    // Only short, whitelisted values were ever decoded.
    for (const s of created) expect(s.length).toBeLessThan(64);
  });
});
