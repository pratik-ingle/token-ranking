import { z } from "zod";
import {
  CATEGORIES,
  type Category,
  type Source,
  MAX_COUNTER,
  MAX_MODEL_LENGTH,
  MAX_ROWS_PER_REQUEST,
  MIN_USAGE_DATE,
  SOURCES,
  TRUST_LEVELS,
  VISIBILITIES,
  WINDOWS,
} from "./constants";

export const sourceSchema = z.enum(SOURCES);
export const categorySchema = z.enum(CATEGORIES);
export const trustLevelSchema = z.enum(TRUST_LEVELS);
export const windowSchema = z.enum(WINDOWS);
export const visibilitySchema = z.enum(VISIBILITIES);

/**
 * Model identifiers: no whitespace, so free text (a prompt, a sentence) can
 * never be smuggled through this field. Normalise with `normalizeModel` first.
 */
export const MODEL_PATTERN = /^[a-z0-9][a-z0-9._:/@+-]*$/;

export const counterSchema = z.number().int().min(0).max(MAX_COUNTER);

export const dateStringSchema = z
  .iso.date()
  .refine((d) => d >= MIN_USAGE_DATE, { message: `date must be on or after ${MIN_USAGE_DATE}` });

/**
 * THE privacy contract. A usage row contains exactly these ten fields and
 * nothing else; unknown keys are rejected (not stripped) so a buggy or
 * malicious client finds out immediately instead of silently leaking data.
 */
export const usageRowSchema = z.strictObject({
  date: dateStringSchema,
  source: sourceSchema,
  model: z.string().min(1).max(MAX_MODEL_LENGTH).regex(MODEL_PATTERN, {
    message: "model must be lowercase and contain only a-z 0-9 . _ : / @ + -",
  }),
  category: categorySchema,
  input_tokens: counterSchema,
  output_tokens: counterSchema,
  cache_read_tokens: counterSchema,
  cache_write_tokens: counterSchema,
  request_count: counterSchema,
  image_count: counterSchema,
});
export type UsageRow = z.infer<typeof usageRowSchema>;

/** A row produced by an integration, before upload. Trust is decided server-side. */
export interface AggregatedUsageRow extends UsageRow {
  /**
   * "verified" only when the TokenRank server itself pulled the data from a
   * provider API (cloud sync). Anything uploaded by a client is self_reported,
   * because the server cannot verify it. Never serialised into uploads.
   */
  trust_level: z.infer<typeof trustLevelSchema>;
}

export function usageRowKey(row: Pick<UsageRow, "date" | "source" | "model" | "category">): string {
  return `${row.date}|${row.source}|${row.model}|${row.category}`;
}

/** POST /api/v1/usage body: a bare JSON array of rows. */
export const ingestPayloadSchema = z
  .array(usageRowSchema)
  .min(1, { message: "at least one row is required" })
  .max(MAX_ROWS_PER_REQUEST, { message: `at most ${MAX_ROWS_PER_REQUEST} rows per request` })
  .superRefine((rows, ctx) => {
    const seen = new Map<string, number>();
    rows.forEach((row, i) => {
      const key = usageRowKey(row);
      const prev = seen.get(key);
      if (prev !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: [i],
          message: `duplicate row key (date, source, model, category) also at index ${prev}; aggregate before uploading`,
        });
      } else {
        seen.set(key, i);
      }
    });
  });
export type IngestPayload = z.infer<typeof ingestPayloadSchema>;

/** Strip everything except the allowed fields, e.g. before printing a dry run. */
export function toUploadRow(row: UsageRow): UsageRow {
  return {
    date: row.date,
    source: row.source,
    model: row.model,
    category: row.category,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_tokens,
    request_count: row.request_count,
    image_count: row.image_count,
  };
}

// ---------------------------------------------------------------------------
// API response shapes (shared by the web app, collector and MCP server)
// ---------------------------------------------------------------------------

export const leaderboardQuerySchema = z.object({
  window: windowSchema.default("30d"),
  source: z.union([sourceSchema, z.literal("all")]).default("all"),
  category: z.union([categorySchema, z.literal("all")]).default("all"),
  verified: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .default(false),
  cache: z
    .enum(["true", "false", "1", "0"])
    .transform((v) => v === "true" || v === "1")
    .default(true),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  page_size: z.coerce.number().int().min(10).max(100).default(50),
});
export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

export interface CategoryShare {
  key: Category;
  /** Fraction of the user's tokens in this category (0..1), for the current window/source/verified/cache filter. */
  share: number;
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  total_tokens: number;
  /** Kept for compatibility; equals sources[0]. */
  top_source: string | null;
  current_streak: number;
  /** Share of this row's tokens that came from verified (server-pulled) data, 0..1. */
  verified_share: number;
  /** Category split of this user's tokens (current window, source filter, verified, cache), largest first. */
  category_mix: CategoryShare[];
  /** Sources this user has tokens from (current window, category filter, verified, cache), by tokens descending. */
  sources: Source[];
}

export interface LeaderboardResponse {
  window: string;
  source: string;
  category: string;
  verified_only: boolean;
  include_cache: boolean;
  page: number;
  page_size: number;
  total_ranked: number;
  /** Sum of the selected total (with or without cache) over everyone ranked under this filter. */
  board_total_tokens: number;
  /** The #1 total under this filter (for scaling bars on any page). */
  top_total_tokens: number;
  entries: LeaderboardEntry[];
  me:
    | (LeaderboardEntry & {
        percentile_label: string;
        listed: boolean;
        page: number;
        /** 1-based position in listing order (rank, then username); null when not listed. */
        position: number | null;
      })
    | null;
  refreshed_at: string | null;
}

export interface WindowRank {
  window: string;
  total_tokens: number;
  rank: number | null;
  ranked_users: number;
  percentile_label: string | null;
}

export interface MeRankResponse {
  username: string;
  visibility: string;
  include_cache: boolean;
  windows: WindowRank[];
  profile_url: string;
}

export interface BreakdownItem {
  key: string;
  label: string;
  total_tokens: number;
}

export interface UserStatsResponse {
  username: string;
  timezone: string;
  joined: string;
  totals: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    request_count: number;
    image_count: number;
  };
  windows: WindowRank[];
  streaks: { current: number; longest: number; active_days: number };
  by_source: BreakdownItem[];
  by_category: BreakdownItem[];
  top_models: BreakdownItem[];
  daily: { date: string; total_tokens: number }[];
  verified_share: number;
  flagged_days: number;
  /** All-time busiest local day (flagged days excluded), or null with no usage. */
  busiest_day: { date: string; total_tokens: number } | null;
}

export interface HeatmapDay {
  date: string;
  total_tokens: number;
  /** Tokens per category that day (only categories with usage). */
  by_category?: Partial<Record<Category, number>>;
}

export interface HeatmapResponse {
  username: string;
  timezone: string;
  year: number | null;
  start: string;
  end: string;
  days: HeatmapDay[];
  available_years: number[];
}

export interface IngestResponse {
  accepted: number;
  inserted: number;
  updated: number;
  skipped_verified: number;
  flagged: number;
}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: "bearer";
  username: string;
  timezone: string;
}
