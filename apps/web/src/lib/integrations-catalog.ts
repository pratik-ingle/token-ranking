import type { Source } from "@tokenrank/shared";

export type ConnectMethod = "Local agent" | "Usage export" | "Usage API" | "OpenTelemetry" | "Ingestion API";

/** What the primary "Connect" button does. */
export type ConnectAction =
  | { kind: "copy"; command: string }
  | { kind: "link"; href: string; label: string }
  | { kind: "otel" };

export interface CatalogEntry {
  id: string;
  name: string;
  source: Source;
  method: ConnectMethod;
  /** One line: exactly what is read. */
  reads: string;
  /**
   * How the category is decided. Mirrors the real logic in
   * packages/collector/src/parsers and packages/shared/src/providers.
   */
  categoryRule: string;
  trust: string;
  connect: ConnectAction;
  /** Secondary way to connect, shown as a muted link. */
  alt?: { href: string; label: string };
  /** Shares another row's connection status (e.g. OTel uses the Claude Code source). */
  sharesStatusWith?: string;
}

/** `{server}` is replaced with " --server <origin>" when the origin isn't the collector's default. */
export const COLLECTOR_LOGIN = "npx tokenrank-collector login{server}";

/** What can be connected and how. Shown on the connect page, settings and profiles. */
export const INTEGRATIONS: CatalogEntry[] = [
  {
    id: "claude_code",
    name: "Claude Code",
    source: "claude_code",
    method: "Local agent",
    reads: "Timestamp, model and token counts from ~/.claude/projects/**/*.jsonl. Never message content.",
    categoryRule: "Always coding.",
    trust: "self-reported",
    connect: { kind: "copy", command: COLLECTOR_LOGIN },
  },
  {
    id: "codex_cli",
    name: "Codex CLI",
    source: "codex_cli",
    method: "Local agent",
    reads: "token_count events and the model name from ~/.codex/sessions. Never prompts, tool calls or files.",
    categoryRule: "Always coding.",
    trust: "self-reported",
    connect: { kind: "copy", command: COLLECTOR_LOGIN },
  },
  {
    id: "cursor",
    name: "Cursor",
    source: "cursor",
    method: "Usage export",
    reads: "Date, model and the four token columns of the dashboard usage CSV, parsed in your browser.",
    categoryRule: "Always coding.",
    trust: "self-reported (CSV) · verified (team Admin API via cloud sync)",
    connect: { kind: "link", href: "/import", label: "Import CSV" },
    alt: { href: "/settings#integrations", label: "Teams: Admin API via cloud sync" },
  },
  {
    id: "openai_api",
    name: "OpenAI API",
    source: "openai_api",
    method: "Usage API",
    reads: "Hourly token, request and image counts per model from the Organization Usage API (admin key).",
    categoryRule:
      "The endpoint decides: images → images, audio → audio, embeddings → embeddings, otherwise chat. In the collector you can map a project or API key to another category; that map stays on your machine.",
    trust: "self-reported (collector) · verified (cloud sync)",
    connect: { kind: "copy", command: "npx tokenrank-collector enable openai_api" },
    alt: { href: "/settings#integrations", label: "Or use cloud sync" },
  },
  {
    id: "anthropic_api",
    name: "Anthropic API",
    source: "anthropic_api",
    method: "Usage API",
    reads: "Hourly token counts per model from the Usage & Cost Admin API (sk-ant-admin… key, organizations only).",
    categoryRule: "Chat, unless you map a workspace or API key to another category in the collector (kept on your machine).",
    trust: "self-reported (collector) · verified (cloud sync)",
    connect: { kind: "copy", command: "npx tokenrank-collector enable anthropic_api" },
    alt: { href: "/settings#integrations", label: "Or use cloud sync" },
  },
  {
    id: "claude_code_otel",
    name: "Claude Code via OpenTelemetry",
    source: "claude_code",
    method: "OpenTelemetry",
    reads: "Only the claude_code.token.usage counter and its model; identity attributes are dropped.",
    categoryRule: "Always coding.",
    trust: "self-reported",
    connect: { kind: "otel" },
    sharesStatusWith: "claude_code",
  },
  {
    id: "gemini",
    name: "Gemini",
    source: "gemini",
    method: "Ingestion API",
    reads: "Daily token counts you export, uploaded as CSV or sent to POST /api/v1/usage.",
    categoryRule: "The category column you send; a CSV without one defaults to chat.",
    trust: "self-reported",
    connect: { kind: "link", href: "/import", label: "Import CSV" },
    alt: { href: "/docs/api", label: "Or use the ingestion API" },
  },
  {
    id: "generic",
    name: "Anything else",
    source: "other",
    method: "Ingestion API",
    reads: "Daily rows with the ten documented fields: OpenRouter, LiteLLM, local models, your own connector.",
    categoryRule: "The category field you send; a CSV without one defaults to chat.",
    trust: "self-reported",
    connect: { kind: "link", href: "/docs/api", label: "API docs" },
    alt: { href: "/import", label: "Or import a CSV" },
  },
];

/** One entry per app for "Not connected" lists: skips the OTel alternative and the catch-all. */
export const APP_ENTRIES = INTEGRATIONS.filter((i) => i.id !== "claude_code_otel" && i.id !== "generic");

/** Local log sources count as connected with a heartbeat or recent rows (see connectedSources). */
export const LOCAL_LOG_SOURCES: readonly Source[] = ["claude_code", "codex_cli"];
