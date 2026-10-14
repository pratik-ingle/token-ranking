import { promises as fs } from "node:fs";
import zlib from "node:zlib";
import { UsageAccumulator, localDate, type UsageRow } from "@tokenrank/shared";
import { compileFieldSpec, count, extractFields, getPath, str } from "../json-extract";
import { forEachLineInBuffer, readLines, walkFiles, type FoundFile } from "../files";
import { codexScanDirs } from "../paths";
import type { LocalParseOptions, LocalParseResult, TokenCounts } from "./types";

/**
 * Codex CLI rollouts: `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*.jsonl` and
 * `$CODEX_HOME/archived_sessions/`. Lines are `{timestamp, type, payload}`.
 *
 * Only these fields are read: `timestamp`, `type`, `payload.type`,
 * `payload.model` (used from turn_context lines only) and the numeric
 * counters of `payload.info.total_token_usage` / `last_token_usage`.
 * session_meta (cwd, git, instructions), response_item (messages, tool
 * calls, reasoning) and every other payload are skipped without decoding.
 */
const USAGE_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const;
type UsageKey = (typeof USAGE_KEYS)[number];
export type CodexUsage = Record<UsageKey, number>;

export const CODEX_FIELD_PATHS: readonly string[] = [
  "timestamp",
  "type",
  "payload.type",
  "payload.model",
  ...USAGE_KEYS.map((k) => `payload.info.total_token_usage.${k}`),
  ...USAGE_KEYS.map((k) => `payload.info.last_token_usage.${k}`),
];

const SPEC = compileFieldSpec(CODEX_FIELD_PATHS, { maxStringBytes: 512 });
const TOKEN_COUNT_NEEDLE = Buffer.from('"token_count"');
const TURN_CONTEXT_NEEDLE = Buffer.from('"turn_context"');

export function isCodexRolloutName(name: string): boolean {
  return name.startsWith("rollout-") && (name.endsWith(".jsonl") || name.endsWith(".jsonl.zst"));
}

export interface CodexEvent extends TokenCounts {
  timestampMs: number;
  model: string;
}

export interface CodexStats {
  files: number;
  filesParsed: number;
  filesSkippedByMtime: number;
  filesShadowedByArchive: number;
  compressedSkipped: number;
  lines: number;
  malformedLines: number;
  oversizedLines: number;
  tokenCountLines: number;
  nullInfo: number;
  unchangedTotals: number;
  replayDuplicates: number;
  skippedBadTimestamp: number;
  events: number;
}

function newStats(): CodexStats {
  return {
    files: 0,
    filesParsed: 0,
    filesSkippedByMtime: 0,
    filesShadowedByArchive: 0,
    compressedSkipped: 0,
    lines: 0,
    malformedLines: 0,
    oversizedLines: 0,
    tokenCountLines: 0,
    nullInfo: 0,
    unchangedTotals: 0,
    replayDuplicates: 0,
    skippedBadTimestamp: 0,
    events: 0,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readUsage(v: unknown): CodexUsage | null {
  if (!isObject(v)) return null;
  if (!USAGE_KEYS.some((k) => typeof v[k] === "number")) return null;
  const out = {} as CodexUsage;
  for (const k of USAGE_KEYS) out[k] = count(v[k]);
  return out;
}

function usageKey(u: CodexUsage): string {
  return USAGE_KEYS.map((k) => u[k]).join(",");
}

function diffUsage(total: CodexUsage, prev: CodexUsage | null): CodexUsage {
  const out = {} as CodexUsage;
  for (const k of USAGE_KEYS) out[k] = Math.max(0, total[k] - (prev ? prev[k] : 0));
  return out;
}

/**
 * Map a Codex usage delta onto four disjoint counters.
 * cached_input ⊂ input, reasoning_output ⊂ output, cache_write ⊂ (input − cached).
 */
export function codexDeltaToCounts(d: CodexUsage): TokenCounts {
  const cacheRead = d.cached_input_tokens;
  const cacheWrite = Math.min(d.cache_write_input_tokens, Math.max(0, d.input_tokens - d.cached_input_tokens));
  return {
    input: Math.max(0, d.input_tokens - d.cached_input_tokens - cacheWrite),
    output: d.output_tokens,
    cacheRead,
    cacheWrite,
  };
}

/** Per-file state: the current model and the previous cumulative totals. */
export interface CodexFileState {
  model: string;
  prevTotal: CodexUsage | null;
  prevTotalKey: string | null;
}

export class CodexParser {
  private readonly seen = new Set<string>();
  private readonly collected: CodexEvent[] = [];
  readonly stats: CodexStats = newStats();

  newFileState(): CodexFileState {
    return { model: "unknown", prevTotal: null, prevTotalKey: null };
  }

  addLine(state: CodexFileState, line: string | Uint8Array): void {
    this.stats.lines++;
    const buf = typeof line === "string" ? Buffer.from(line, "utf8") : Buffer.from(line.buffer, line.byteOffset, line.byteLength);
    if (buf.indexOf(TOKEN_COUNT_NEEDLE) < 0 && buf.indexOf(TURN_CONTEXT_NEEDLE) < 0) return;
    const obj = extractFields(buf, SPEC);
    if (!obj) {
      this.stats.malformedLines++;
      return;
    }
    if (obj.type === "turn_context") {
      const model = str(getPath(obj, "payload", "model"));
      if (model) state.model = model;
      return;
    }
    // Only event_msg/token_count lines count. token_usage_record lines (and
    // everything else) are ignored so nothing is double counted.
    if (obj.type !== "event_msg" || getPath(obj, "payload", "type") !== "token_count") return;
    this.stats.tokenCountLines++;
    const info = getPath(obj, "payload", "info");
    if (!isObject(info)) {
      this.stats.nullInfo++;
      return;
    }
    const total = readUsage(info.total_token_usage);
    if (!total) {
      this.stats.nullInfo++;
      return;
    }
    const totalKey = usageKey(total);
    // Codex re-emits token_count with unchanged totals; those are not new usage.
    if (totalKey === state.prevTotalKey) {
      this.stats.unchangedTotals++;
      return;
    }
    const last = readUsage(info.last_token_usage);
    const delta = last ?? diffUsage(total, state.prevTotal);
    state.prevTotal = total;
    state.prevTotalKey = totalKey;

    const timestamp = str(obj.timestamp);
    const timestampMs = timestamp ? Date.parse(timestamp) : Number.NaN;
    if (!timestamp || !Number.isFinite(timestampMs)) {
      this.stats.skippedBadTimestamp++;
      return;
    }
    // Forked / sub-agent rollouts replay the parent's history verbatim.
    const dedupeKey = `${timestamp}|${total.total_tokens}|${last ? last.total_tokens : ""}`;
    if (this.seen.has(dedupeKey)) {
      this.stats.replayDuplicates++;
      return;
    }
    this.seen.add(dedupeKey);
    this.stats.events++;
    this.collected.push({ timestampMs, model: state.model, ...codexDeltaToCounts(delta) });
  }

  async addFile(filePath: string): Promise<void> {
    this.stats.filesParsed++;
    const state = this.newFileState();
    await readLines(filePath, (l) => this.addLine(state, l), { onOversized: () => this.stats.oversizedLines++ });
  }

  addDecompressed(buf: Buffer): void {
    this.stats.filesParsed++;
    const state = this.newFileState();
    forEachLineInBuffer(buf, (l) => this.addLine(state, l));
  }

  events(): CodexEvent[] {
    return [...this.collected];
  }

  toRows(timeZone: string, fromDate?: string): UsageRow[] {
    const acc = new UsageAccumulator();
    for (const ev of this.collected) {
      const date = localDate(ev.timestampMs, timeZone);
      if (fromDate && date < fromDate) continue;
      acc.add({
        date,
        source: "codex_cli",
        model: ev.model,
        category: "coding",
        input_tokens: ev.input,
        output_tokens: ev.output,
        cache_read_tokens: ev.cacheRead,
        cache_write_tokens: ev.cacheWrite,
        request_count: 1,
      });
    }
    return acc.toRows();
  }
}

type ZstdDecompress = (buf: Buffer) => Buffer;

function zstdDecompressor(): ZstdDecompress | null {
  const fn = (zlib as unknown as { zstdDecompressSync?: ZstdDecompress }).zstdDecompressSync;
  return typeof fn === "function" ? fn : null;
}

function stem(name: string): string {
  return name.endsWith(".zst") ? name.slice(0, -4) : name;
}

/** Rollout files to consider; a file in sessions/ shadows the same name in archived_sessions/. */
export async function listCodexRollouts(home: string): Promise<{ files: FoundFile[]; shadowed: number }> {
  const { sessions, archived } = await codexScanDirs(home);
  const files: FoundFile[] = [];
  const names = new Set<string>();
  if (sessions) {
    for (const f of await walkFiles(sessions, isCodexRolloutName)) {
      names.add(stem(f.name));
      files.push(f);
    }
  }
  let shadowed = 0;
  if (archived) {
    for (const f of await walkFiles(archived, isCodexRolloutName)) {
      if (names.has(stem(f.name))) {
        shadowed++;
        continue;
      }
      names.add(stem(f.name));
      files.push(f);
    }
  }
  return { files, shadowed };
}

export async function parseCodex(home: string, opts: LocalParseOptions): Promise<LocalParseResult<CodexStats>> {
  const parser = new CodexParser();
  const warnings: string[] = [];
  const { files, shadowed } = await listCodexRollouts(home);
  parser.stats.filesShadowedByArchive = shadowed;
  const zstd = zstdDecompressor();
  for (const f of files) {
    parser.stats.files++;
    if (opts.minMtimeMs !== undefined && f.mtimeMs < opts.minMtimeMs) {
      parser.stats.filesSkippedByMtime++;
      continue;
    }
    try {
      if (f.name.endsWith(".zst")) {
        if (!zstd) {
          parser.stats.compressedSkipped++;
          continue;
        }
        parser.addDecompressed(zstd(await fs.readFile(f.path)));
      } else {
        await parser.addFile(f.path);
      }
    } catch {
      opts.onWarning?.("could not read a Codex rollout file (skipped)");
    }
  }
  if (parser.stats.compressedSkipped > 0) {
    const w = `skipped ${parser.stats.compressedSkipped} compressed Codex rollout(s) (.jsonl.zst): this Node.js has no built-in zstd`;
    warnings.push(w);
    opts.onWarning?.(w);
  }
  return { rows: parser.toRows(opts.timeZone, opts.fromDate), stats: parser.stats, warnings };
}
