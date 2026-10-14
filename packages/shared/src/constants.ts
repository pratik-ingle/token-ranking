/**
 * Canonical enums shared by the web app, the collector and the MCP server.
 * Adding a value here is a schema change: update the DB enum migration too.
 */

export const SOURCES = [
  "openai_api",
  "anthropic_api",
  "claude_code",
  "cursor",
  "codex_cli",
  "gemini",
  "other",
] as const;
export type Source = (typeof SOURCES)[number];

export const CATEGORIES = [
  "coding",
  "chat",
  "image_generation",
  "audio",
  "embeddings",
  "agents",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const TRUST_LEVELS = ["verified", "self_reported"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export const WINDOWS = ["today", "7d", "30d", "year", "all"] as const;
export type LeaderboardWindow = (typeof WINDOWS)[number];

export const VISIBILITIES = ["public", "hidden"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  openai_api: "OpenAI API",
  anthropic_api: "Anthropic API",
  claude_code: "Claude Code",
  cursor: "Cursor",
  codex_cli: "Codex CLI",
  gemini: "Gemini",
  other: "Other",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  coding: "Coding",
  chat: "Chat",
  image_generation: "Image generation",
  audio: "Audio",
  embeddings: "Embeddings",
  agents: "Agents",
  other: "Other",
};

export const WINDOW_LABELS: Record<LeaderboardWindow, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  year: "This year",
  all: "All time",
};

/** Coding tools are always categorised as coding; no content is ever inspected. */
export const DEFAULT_CATEGORY_BY_SOURCE: Partial<Record<Source, Category>> = {
  claude_code: "coding",
  cursor: "coding",
  codex_cli: "coding",
};

/** Hard limits on the ingestion API. */
export const MAX_ROWS_PER_REQUEST = 1000;
export const MAX_MODEL_LENGTH = 64;
/** Earliest date we accept. Nothing meaningful predates this. */
export const MIN_USAGE_DATE = "2020-01-01";
/** Upper bound for any single counter in one daily row (1 trillion). */
export const MAX_COUNTER = 1_000_000_000_000;

/** A day counts as "active" when total tokens >= this. Server can override. */
export const DEFAULT_ACTIVE_DAY_MIN_TOKENS = 1;

/**
 * Per-source, per-day sanity limits on total tokens (incl. cache).
 * Days above the limit are stored but flagged for review and excluded from
 * the public leaderboard until a moderator approves them.
 */
export const DEFAULT_SANITY_LIMITS: Record<Source, number> = {
  openai_api: 10_000_000_000,
  anthropic_api: 10_000_000_000,
  claude_code: 5_000_000_000,
  cursor: 3_000_000_000,
  codex_cli: 3_000_000_000,
  gemini: 5_000_000_000,
  other: 5_000_000_000,
};
export const DEFAULT_IMAGE_SANITY_LIMIT = 100_000;

/** Integrations we deliberately do not support, shown in the UI with the reason. */
export const UNSUPPORTED_INTEGRATIONS = [
  {
    name: "ChatGPT (consumer app)",
    reason:
      "OpenAI offers no token-usage API for ChatGPT, and the data export contains your full conversation history. We will not ask you to upload that.",
  },
  {
    name: "Claude.ai (consumer app)",
    reason:
      "Anthropic offers no token-usage API for Claude.ai, and the data export contains your full conversation history. We will not ask you to upload that.",
  },
] as const;

/**
 * The exact fields a usage row may contain. Used by the strict schema, the
 * privacy page and the collector's dry-run output so they can never drift.
 */
export const USAGE_ROW_FIELDS = [
  "date",
  "source",
  "model",
  "category",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "request_count",
  "image_count",
] as const;
export type UsageRowField = (typeof USAGE_ROW_FIELDS)[number];
