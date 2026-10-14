/**
 * Selective JSON field extractor.
 *
 * AI tool logs (Claude Code, Codex) store whole conversations as JSONL: every
 * line holds prompt text, model output, tool inputs, file contents. We need a
 * handful of numbers from each line and must never look at the rest.
 *
 * `extractFields` scans the raw UTF-8 bytes of a line and materialises ONLY
 * values found at whitelisted paths. Every other value is skipped in place:
 *   - strings: jump to the closing quote with `Buffer#indexOf`, honouring
 *     backslash escapes, without decoding the bytes into a JS string;
 *   - objects / arrays: depth counting (strings inside are skipped the same way);
 *   - numbers / literals: scanned over.
 * The whole line is never handed to `JSON.parse` and never decoded to a JS
 * string, so prompt/response text never exists as a JS value in this process.
 *
 * Path syntax (dotted):
 *   "timestamp"                       scalar at a top-level key
 *   "message.usage.input_tokens"      nested scalar
 *   "message.usage.iterations[].type" scalar inside every element of an array
 *   "message.usage.**"                the whole subtree (any JSON) at a path
 * A plain path only accepts scalars (string, number, boolean, null): if an
 * object or array sits there it is skipped, so a renamed field can't make us
 * swallow a content blob.
 *
 * Output mirrors the input structure, pruned to the whitelisted paths. For
 * duplicate keys the last occurrence wins, exactly like `JSON.parse`.
 * Malformed input never throws: it returns `null`.
 */

export interface FieldSpecOptions {
  /**
   * Whitelisted string scalars longer than this many bytes (raw, escaped) are
   * dropped instead of decoded. A guard so that a field we expect to hold an
   * id or a model name can never carry a large blob of text. Default: no limit.
   */
  maxStringBytes?: number;
}

interface PathNode {
  scalar: boolean;
  subtree: boolean;
  keys: Map<string, PathNode> | null;
  keyList: Array<{ key: string; bytes: Buffer; node: PathNode }>;
  items: PathNode | null;
}

export interface FieldSpec {
  readonly paths: readonly string[];
  readonly maxStringBytes: number;
  /** @internal */
  readonly root: PathNode;
}

function newNode(): PathNode {
  return { scalar: false, subtree: false, keys: null, keyList: [], items: null };
}

function childOf(node: PathNode, key: string): PathNode {
  node.keys ??= new Map();
  let child = node.keys.get(key);
  if (!child) {
    child = newNode();
    node.keys.set(key, child);
    node.keyList.push({ key, bytes: Buffer.from(key, "utf8"), node: child });
  }
  return child;
}

/** Compile a list of dotted paths into a matcher. Throws on invalid syntax. */
export function compileFieldSpec(paths: readonly string[], options: FieldSpecOptions = {}): FieldSpec {
  const root = newNode();
  for (const path of paths) {
    const segments = path.split(".");
    let node = root;
    for (let i = 0; i < segments.length; i++) {
      let seg = segments[i]!;
      const last = i === segments.length - 1;
      if (seg === "**") {
        if (!last) throw new Error(`invalid path "${path}": "**" must be the last segment`);
        node.subtree = true;
        break;
      }
      let arrays = 0;
      while (seg.endsWith("[]")) {
        seg = seg.slice(0, -2);
        arrays++;
      }
      if (seg.length === 0 || seg.includes("[") || seg.includes("]") || seg === "*") {
        throw new Error(`invalid path "${path}"`);
      }
      node = childOf(node, seg);
      for (let a = 0; a < arrays; a++) {
        node.items ??= newNode();
        node = node.items;
      }
      if (last) node.scalar = true;
    }
  }
  return { paths: [...paths], maxStringBytes: options.maxStringBytes ?? Number.POSITIVE_INFINITY, root };
}

const FAIL: unique symbol = Symbol("fail");
type Result = unknown | typeof FAIL;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const LBRACKET = 0x5b;
const RBRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const TRUE_BYTES = Buffer.from("true");
const FALSE_BYTES = Buffer.from("false");
const NULL_BYTES = Buffer.from("null");

function isWs(c: number | undefined): boolean {
  return c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
}

function isNumberChar(c: number | undefined): boolean {
  return c !== undefined && ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2b || c === 0x2e || c === 0x65 || c === 0x45);
}

/**
 * Index of the closing quote of a string whose first content byte is at
 * `from` (i.e. just after the opening quote), or -1 if unterminated. A quote
 * preceded by an odd number of backslashes is escaped.
 */
export function findStringEnd(b: Buffer, from: number): number {
  let i = from;
  for (;;) {
    const q = b.indexOf(QUOTE, i);
    if (q < 0) return -1;
    let k = q - 1;
    let backslashes = 0;
    while (k >= from && b[k] === BACKSLASH) {
      backslashes++;
      k--;
    }
    if ((backslashes & 1) === 0) return q;
    i = q + 1;
  }
}

class Scanner {
  pos = 0;
  constructor(
    private readonly b: Buffer,
    private readonly maxStringBytes: number,
  ) {}

  ws(): void {
    const b = this.b;
    let p = this.pos;
    while (p < b.length && isWs(b[p])) p++;
    this.pos = p;
  }

  atEnd(): boolean {
    return this.pos >= this.b.length;
  }

  peek(): number | undefined {
    return this.b[this.pos];
  }

  skipBom(): void {
    const b = this.b;
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) this.pos = 3;
  }

  readValue(node: PathNode): Result {
    this.ws();
    const c = this.b[this.pos];
    if (c === undefined) return FAIL;
    if (node.subtree) {
      const start = this.pos;
      if (!this.skipValue()) return FAIL;
      // Only whitelisted subtrees reach JSON.parse, and only their own bytes.
      return JSON.parse(this.b.toString("utf8", start, this.pos));
    }
    if (c === LBRACE) {
      if (node.keys) return this.readObject(node);
      return this.skipValue() ? undefined : FAIL;
    }
    if (c === LBRACKET) {
      if (node.items) return this.readArray(node.items);
      return this.skipValue() ? undefined : FAIL;
    }
    const start = this.pos;
    if (!this.skipScalar()) return FAIL;
    if (!node.scalar) return undefined;
    return this.decodeScalar(start, this.pos);
  }

  readObject(node: PathNode): Result {
    const b = this.b;
    this.pos++; // {
    const out: Record<string, unknown> = {};
    this.ws();
    if (b[this.pos] === RBRACE) {
      this.pos++;
      return out;
    }
    for (;;) {
      if (b[this.pos] !== QUOTE) return FAIL;
      const keyStart = this.pos + 1;
      const keyEnd = findStringEnd(b, keyStart);
      if (keyEnd < 0) return FAIL;
      this.pos = keyEnd + 1;
      const match = this.matchKey(node, keyStart, keyEnd);
      this.ws();
      if (b[this.pos] !== COLON) return FAIL;
      this.pos++;
      this.ws();
      if (match) {
        const v = this.readValue(match.node);
        if (v === FAIL) return FAIL;
        if (v === undefined) delete out[match.key];
        else out[match.key] = v;
      } else if (!this.skipValue()) {
        return FAIL;
      }
      this.ws();
      const c = b[this.pos];
      if (c === COMMA) {
        this.pos++;
        this.ws();
        continue;
      }
      if (c === RBRACE) {
        this.pos++;
        return out;
      }
      return FAIL;
    }
  }

  readArray(itemNode: PathNode): Result {
    const b = this.b;
    this.pos++; // [
    const out: unknown[] = [];
    this.ws();
    if (b[this.pos] === RBRACKET) {
      this.pos++;
      return out;
    }
    for (;;) {
      const v = this.readValue(itemNode);
      if (v === FAIL) return FAIL;
      if (v !== undefined) out.push(v);
      this.ws();
      const c = b[this.pos];
      if (c === COMMA) {
        this.pos++;
        continue;
      }
      if (c === RBRACKET) {
        this.pos++;
        return out;
      }
      return FAIL;
    }
  }

  /** Compare the raw key bytes against the whitelisted keys of this node. */
  private matchKey(node: PathNode, start: number, end: number): { key: string; node: PathNode } | null {
    if (!node.keys) return null;
    const b = this.b;
    const len = end - start;
    const escaped = b.indexOf(BACKSLASH, start);
    if (escaped >= 0 && escaped < end) {
      // Rare: a key spelled with escapes ("timestamp"). Keys are short
      // identifiers, never content, so decoding this one is fine.
      const key = JSON.parse(b.toString("utf8", start - 1, end + 1)) as string;
      const child = node.keys.get(key);
      return child ? { key, node: child } : null;
    }
    for (const cand of node.keyList) {
      if (cand.bytes.length === len && b.compare(cand.bytes, 0, len, start, end) === 0) return cand;
    }
    return null;
  }

  skipValue(): boolean {
    const b = this.b;
    const c = b[this.pos];
    if (c === LBRACE || c === LBRACKET) {
      let depth = 0;
      let i = this.pos;
      const n = b.length;
      while (i < n) {
        const ch = b[i];
        if (ch === QUOTE) {
          const e = findStringEnd(b, i + 1);
          if (e < 0) return false;
          i = e + 1;
          continue;
        }
        if (ch === LBRACE || ch === LBRACKET) depth++;
        else if (ch === RBRACE || ch === RBRACKET) {
          depth--;
          if (depth === 0) {
            this.pos = i + 1;
            return true;
          }
        }
        i++;
      }
      return false;
    }
    return this.skipScalar();
  }

  skipScalar(): boolean {
    const b = this.b;
    const c = b[this.pos];
    if (c === QUOTE) {
      const e = findStringEnd(b, this.pos + 1);
      if (e < 0) return false;
      this.pos = e + 1;
      return true;
    }
    if (c === 0x74) return this.literal(TRUE_BYTES);
    if (c === 0x66) return this.literal(FALSE_BYTES);
    if (c === 0x6e) return this.literal(NULL_BYTES);
    if (c === 0x2d || (c !== undefined && c >= 0x30 && c <= 0x39)) {
      let i = this.pos + 1;
      while (i < b.length && isNumberChar(b[i])) i++;
      this.pos = i;
      return true;
    }
    return false;
  }

  private literal(bytes: Buffer): boolean {
    const end = this.pos + bytes.length;
    if (end > this.b.length || this.b.compare(bytes, 0, bytes.length, this.pos, end) !== 0) return false;
    this.pos = end;
    return true;
  }

  private decodeScalar(start: number, end: number): Result {
    const b = this.b;
    const c = b[start];
    if (c === QUOTE) {
      if (end - start - 2 > this.maxStringBytes) return undefined;
      return JSON.parse(b.toString("utf8", start, end)) as string;
    }
    if (c === 0x74) return true;
    if (c === 0x66) return false;
    if (c === 0x6e) return null;
    // Number: JSON.parse validates the grammar ("01", "1.", "--1" throw → null line).
    return JSON.parse(b.toString("latin1", start, end)) as number;
  }
}

function toBuffer(input: string | Uint8Array): Buffer {
  if (typeof input === "string") return Buffer.from(input, "utf8");
  if (Buffer.isBuffer(input)) return input;
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

/**
 * Extract the whitelisted fields of one JSON object (one JSONL line).
 * Returns the pruned object, or null when the line is not a single valid
 * JSON object (malformed, truncated, an array, trailing garbage, …).
 */
export function extractFields(line: string | Uint8Array, spec: FieldSpec): Record<string, unknown> | null {
  const b = toBuffer(line);
  try {
    const s = new Scanner(b, spec.maxStringBytes);
    s.skipBom();
    s.ws();
    if (s.peek() !== LBRACE) return null;
    const out = s.readValue(spec.root);
    if (out === FAIL) return null;
    if (out !== undefined && (out === null || typeof out !== "object" || Array.isArray(out))) return null;
    s.ws();
    if (!s.atEnd()) return null;
    return (out ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Cheap pre-filter: does the raw line contain this byte sequence anywhere? */
export function lineContains(line: Uint8Array, needle: Buffer): boolean {
  return toBuffer(line).indexOf(needle) >= 0;
}

// ---------------------------------------------------------------------------
// Small typed accessors for extracted objects.
// ---------------------------------------------------------------------------

export function getPath(obj: unknown, ...keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** A non-negative finite count, or 0. */
export function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

export function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
