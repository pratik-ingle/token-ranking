import type { UsageRow } from "@tokenrank/shared";

/** Four disjoint token counters (input excludes cache reads and writes). */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LocalParseOptions {
  /** IANA timezone used to bucket events into local dates. */
  timeZone: string;
  /** Only open files modified at/after this instant (epoch ms). */
  minMtimeMs?: number;
  /** Only return rows dated on/after this local date (YYYY-MM-DD). */
  fromDate?: string;
  onWarning?: (message: string) => void;
}

export interface LocalParseResult<S> {
  rows: UsageRow[];
  stats: S;
  warnings: string[];
}
