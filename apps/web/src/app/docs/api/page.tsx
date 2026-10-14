import { CATEGORIES, MAX_ROWS_PER_REQUEST, SOURCES, USAGE_ROW_FIELDS } from "@tokenrank/shared";
import type { Metadata } from "next";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "API & connectors" };

export default function ApiDocsPage() {
  const origin = env.appOrigin;
  const example = JSON.stringify(
    [
      {
        date: "2026-10-13",
        source: "gemini",
        model: "gemini-2.5-pro",
        category: "chat",
        input_tokens: 120000,
        output_tokens: 8000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        request_count: 42,
        image_count: 0,
      },
    ],
    null,
    2,
  );
  return (
    <article className="mx-auto max-w-3xl space-y-6 [&_h2]:text-xl [&_h2]:font-semibold [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs">
      <h1 className="text-3xl font-semibold tracking-tight">API &amp; community connectors</h1>
      <p className="text-muted-foreground">
        Write a connector for any tool (Gemini, OpenRouter, LiteLLM, local models…). Aggregate locally, then upload daily rows with a
        personal ingest token from Settings → Ingest tokens.
      </p>
      <section className="space-y-2">
        <h2>POST /api/v1/usage</h2>
        <p className="text-sm">
          Body: a JSON array of 1–{MAX_ROWS_PER_REQUEST} rows. Each row must contain exactly these fields — unknown fields are rejected:{" "}
          {USAGE_ROW_FIELDS.map((f) => <code key={f} className="mr-1 rounded bg-muted px-1 text-xs">{f}</code>)}
        </p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li><code>date</code>: YYYY-MM-DD in your TokenRank timezone (not later than your local tomorrow).</li>
          <li><code>source</code>: {SOURCES.join(", ")}.</li>
          <li><code>category</code>: {CATEGORIES.join(", ")}.</li>
          <li><code>model</code>: lowercase, no spaces, ≤ 64 chars (a–z 0–9 . _ : / @ + -).</li>
          <li>Counters: non-negative integers. <code>input_tokens</code> excludes cache tokens.</li>
          <li>Idempotent: (date, source, model, category) is the key; re-sending replaces the values. Always send complete days.</li>
          <li>Uploads are marked <em>self-reported</em>. Rate limit: 60 requests/minute per token.</li>
        </ul>
        <pre>{`curl -X POST ${origin}/api/v1/usage \\
  -H "Authorization: Bearer tr_..." \\
  -H "Content-Type: application/json" \\
  -d '${example.replace(/\n\s*/g, " ")}'`}</pre>
        <p className="text-sm">Response: <code>{`{"accepted":1,"inserted":1,"updated":0,"skipped_verified":0,"flagged":0}`}</code></p>
      </section>
      <section className="space-y-2">
        <h2>Read endpoints</h2>
        <pre>{`GET /api/v1/leaderboard?window=today|7d|30d|year|all&source=&category=&verified=true&cache=false&page=1
GET /api/v1/users/{username}/stats
GET /api/v1/users/{username}/heatmap?year=2026
GET /api/v1/me            (Bearer token or session)
GET /api/v1/me/rank       (Bearer token or session)
GET /api/v1/me/stats      (Bearer token or session)
GET /api/v1/stats`}</pre>
      </section>
      <section className="space-y-2">
        <h2>Device login (CLI / MCP)</h2>
        <pre>{`POST /api/v1/device/code   {"client":"collector"}  → device_code, user_code, verification_uri
POST /api/v1/device/token  {"device_code":"..."}   → access_token once approved at /device`}</pre>
      </section>
      <section className="space-y-2">
        <h2>OpenTelemetry (Claude Code)</h2>
        <pre>{`CLAUDE_CODE_ENABLE_TELEMETRY=1
OTEL_METRICS_EXPORTER=otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_ENDPOINT=${origin}/api/v1/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer tr_..."`}</pre>
        <p className="text-sm text-muted-foreground">Only <code>claude_code.token.usage</code> (delta temporality) is read. Use this or the collector for Claude Code, not both.</p>
      </section>
    </article>
  );
}
