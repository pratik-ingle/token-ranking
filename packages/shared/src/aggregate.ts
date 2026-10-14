import type { Category, Source } from "./constants";
import { usageRowKey, type UsageRow } from "./schemas";
import { normalizeModel } from "./models";

export interface UsageDelta {
  date: string;
  source: Source;
  model: string;
  category: Category;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  request_count?: number;
  image_count?: number;
}

const COUNTERS = [
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "request_count",
  "image_count",
] as const;

function safeCount(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * Sums usage deltas into one row per (date, source, model, category).
 * Every integration funnels through this, so the output can only ever
 * contain the ten allowed fields.
 */
export class UsageAccumulator {
  private rows = new Map<string, UsageRow>();

  add(delta: UsageDelta): void {
    const model = normalizeModel(delta.model);
    const keyFields = { date: delta.date, source: delta.source, model, category: delta.category };
    const key = usageRowKey(keyFields);
    let row = this.rows.get(key);
    if (!row) {
      row = {
        ...keyFields,
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        request_count: 0,
        image_count: 0,
      };
      this.rows.set(key, row);
    }
    for (const c of COUNTERS) row[c] += safeCount(delta[c]);
  }

  get size(): number {
    return this.rows.size;
  }

  /** Rows sorted by date, then source/model/category; zero rows dropped. */
  toRows(): UsageRow[] {
    return [...this.rows.values()]
      .filter((r) => COUNTERS.some((c) => r[c] > 0))
      .sort((a, b) => usageRowKey(a).localeCompare(usageRowKey(b)));
  }
}

export function totalTokens(row: Pick<UsageRow, "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens">): number {
  return row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens;
}

/** Total without cache reads/writes: what the leaderboard's "exclude cache" toggle uses. */
export function totalTokensNoCache(row: Pick<UsageRow, "input_tokens" | "output_tokens">): number {
  return row.input_tokens + row.output_tokens;
}

/** Split rows into chunks that respect the ingestion API's per-request limit. */
export function chunkRows<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
