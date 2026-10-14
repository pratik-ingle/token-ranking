import type { Source } from "@tokenrank/shared";

export interface CatalogEntry {
  id: string;
  name: string;
  source: Source;
  how: "collector" | "collector-or-cloud" | "csv-or-api" | "otel" | "api";
  trust: string;
  description: string;
  details: string[];
}

/** What can be connected and how. Shown on onboarding and settings. */
export const INTEGRATIONS: CatalogEntry[] = [
  {
    id: "claude_code",
    name: "Claude Code",
    source: "claude_code",
    how: "collector",
    trust: "self-reported",
    description: "Reads token counts from Claude Code's local session logs.",
    details: [
      "Reads only timestamp, model and usage numbers from ~/.claude/projects/**/*.jsonl — never message content.",
      "De-duplicated by message id + request id.",
      "Claude Code keeps transcripts for 30 days by default, so the first sync backfills about a month.",
    ],
  },
  {
    id: "codex_cli",
    name: "OpenAI Codex CLI",
    source: "codex_cli",
    how: "collector",
    trust: "self-reported",
    description: "Reads token-count events from ~/.codex/sessions.",
    details: ["Reads only token_count events and the model name; never prompts, tool calls or file contents."],
  },
  {
    id: "cursor",
    name: "Cursor",
    source: "cursor",
    how: "csv-or-api",
    trust: "self-reported (CSV) · verified (cloud sync)",
    description: "Individuals: upload the usage CSV from cursor.com/dashboard. Teams: Admin API.",
    details: [
      "The CSV is parsed in your browser; only daily totals are uploaded.",
      "Admin API keys cover the whole team, so you filter by your own email (kept locally or encrypted with the key).",
    ],
  },
  {
    id: "openai_api",
    name: "OpenAI API",
    source: "openai_api",
    how: "collector-or-cloud",
    trust: "self-reported (collector) · verified (cloud sync)",
    description: "Organization Usage API with an Admin key: completions, embeddings, images and audio.",
    details: [
      "Recommended: keep the admin key on your machine and use the collector.",
      "Endpoint type sets the category (images → image generation, audio → audio, embeddings → embeddings).",
    ],
  },
  {
    id: "anthropic_api",
    name: "Anthropic API",
    source: "anthropic_api",
    how: "collector-or-cloud",
    trust: "self-reported (collector) · verified (cloud sync)",
    description: "Usage & Cost Admin API (sk-ant-admin… keys, organizations only).",
    details: ["Recommended: keep the admin key on your machine and use the collector."],
  },
  {
    id: "claude_code_otel",
    name: "Claude Code via OpenTelemetry",
    source: "claude_code",
    how: "otel",
    trust: "self-reported",
    description: "Alternative to the log parser: point Claude Code's OTLP metrics at TokenRank.",
    details: ["Only claude_code.token.usage is read; identity attributes (email, account, org, session) are dropped.", "Use this or the collector for Claude Code, not both."],
  },
  {
    id: "generic",
    name: "Anything else",
    source: "other",
    how: "api",
    trust: "self-reported",
    description: "Gemini, OpenRouter, LiteLLM, local models… via CSV import or the ingestion API.",
    details: ["POST /api/v1/usage with a personal ingest token. Community connectors welcome."],
  },
];
