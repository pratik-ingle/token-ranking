# TokenRank

A privacy-first global leaderboard for AI token usage. Create an anonymous account (a username plus a passkey), connect Claude Code, Codex, Cursor, OpenAI or Anthropic, and see:

- your rank and percentile on a global leaderboard (today, 7 days, 30 days, this year, all time);
- a GitHub-style heatmap of your daily usage, with streaks;
- a breakdown by source, category and model.

**TokenRank only ever collects token counts.** It never collects prompts, responses, file contents, real names, emails, billing details or organization member information. The only usage data stored is one row per day, per source, per model and per category:

```
date, source, model, category, input_tokens, output_tokens,
cache_read_tokens, cache_write_tokens, request_count, image_count
```

Any upload containing another field is rejected. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how each privacy rule is enforced; the site's `/privacy` page has the plain-English version.

## Repository layout

```
apps/web            Next.js 16 app: UI, REST API, auth, ingestion, cloud-sync worker, leaderboards
packages/shared     zod schemas and types, timezone/streak/heatmap/ranking helpers, CSV parsers,
                    OpenAI / Anthropic / Cursor usage-API clients (browser + Node safe)
packages/collector  tokenrank-collector: open-source local CLI that aggregates usage on your machine
packages/mcp        tokenrank-mcp: MCP server (get_my_rank, get_my_stats, sync_now)
docs/               architecture, privacy design, provider API notes
```

## Quick start (local development)

Requirements: Node 20.9+ and pnpm 9 (`npm i -g pnpm@9`). You don't need Docker: `pnpm db:start` runs a real PostgreSQL 18 from npm-provided binaries.

```bash
pnpm install
pnpm setup:env     # writes apps/web/.env.local with random secrets
pnpm db:start      # local Postgres on 127.0.0.1:54329 (leave running in its own terminal)
pnpm db:migrate    # tables, enums and the leaderboard materialized views
pnpm db:seed       # 500 fake users with a year of realistic usage (--reset to redo)
pnpm dev           # http://localhost:3000
```

Log in as `demo` with the password `demo-password`, or create your own account. Passkeys work on `localhost`.

To put your real usage on your local board:

```bash
pnpm --filter tokenrank-collector build
node packages/collector/dist/cli.js login --server http://localhost:3000
node packages/collector/dist/cli.js sync --dry-run   # print the exact payload, upload nothing
```

## Connecting tools

| Tool | How | Trust |
|---|---|---|
| Claude Code | collector parses `~/.claude/projects/**/*.jsonl`, reading only timestamps, ids, model and usage numbers. Alternative: OpenTelemetry → `POST /api/v1/otlp/v1/metrics` | self-reported |
| OpenAI Codex CLI | collector parses `~/.codex/sessions/**/rollout-*.jsonl` `token_count` events | self-reported |
| OpenAI API | Organization Usage API with an admin key: in the collector (key stays local), or cloud sync (key stored encrypted) | self-reported / **verified** |
| Anthropic API | Usage & Cost Admin API (`sk-ant-admin…`): collector or cloud sync | self-reported / **verified** |
| Cursor | individuals: usage CSV, parsed in the browser at `/import`; teams: Admin API via the collector or cloud sync | self-reported / **verified** |
| Anything else | generic CSV import, or `POST /api/v1/usage` with a personal ingest token | self-reported |
| ChatGPT / Claude.ai apps | **not supported**: there is no usage API, and their exports contain full conversations | — |

"Verified" means the TokenRank server pulled the data from the provider itself. Uploads from clients can't be verified, so they are always marked self-reported, even when the collector fetched them from a provider API.

The one-command path for a new user is:

```bash
npx tokenrank-collector login --server https://your-tokenrank-host
```

The command opens a device-code page, auto-detects Claude Code and Codex logs, runs the first sync and prints your rank. See [packages/collector/README.md](packages/collector/README.md) for scheduling, admin-key sources and the exact list of fields read from each source. For the MCP server (`claude mcp add tokenrank -- npx tokenrank-mcp`), see [packages/mcp/README.md](packages/mcp/README.md).

## API

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /api/v1/usage` | Bearer ingest token | Upload 1–1000 rows (bare JSON array, strict schema) |
| `POST /api/v1/integrations/heartbeat` | Bearer | Collector registers a source and an optional org fingerprint |
| `POST /api/v1/otlp/v1/metrics` | Bearer | Claude Code OTLP/HTTP JSON metrics (deltas) |
| `GET /api/v1/leaderboard?window=&source=&category=&verified=&cache=&page=` | optional | Ranked list, plus your own row |
| `GET /api/v1/users/{username}/stats` | public profiles | Totals, ranks per window, streaks, breakdowns, trend |
| `GET /api/v1/users/{username}/heatmap?year=` | public profiles | Daily totals in the user's timezone |
| `GET /api/v1/me`, `/api/v1/me/rank`, `/api/v1/me/stats` | Bearer or session | Your own data (also when your profile is hidden) |
| `POST /api/v1/device/code`, `POST /api/v1/device/token` | — | Device login for the CLI and MCP server (RFC 8628) |
| `POST /api/internal/cron?job=refresh\|sync\|cleanup` | `CRON_SECRET` | For serverless schedulers |

The site also serves human-readable docs at `/docs/api`.

## Production

1. Provision PostgreSQL. Set `DATABASE_URL`, `APP_ORIGIN`, `WEBAUTHN_RP_ID`, `SERVER_SECRET`, `MASTER_KEY` (base64 of 32 bytes; keep it in a secret manager) and `CRON_SECRET`. Optionally set `SMTP_URL`/`MAIL_FROM` and `ADMIN_USERNAMES`. All options are listed in [apps/web/.env.example](apps/web/.env.example).
2. Run `pnpm db:migrate`, then `pnpm build`, then `pnpm --filter @tokenrank/web start`.
3. Run background jobs with **one** of these:
   - `pnpm worker`, which refreshes leaderboards every 2 minutes, syncs cloud integrations every 6 hours and cleans up expired rows;
   - a scheduler that calls `/api/internal/cron?job=refresh` every few minutes and `?job=sync` every 15 minutes;
   - `RUN_JOBS_IN_PROCESS=1` on a single instance.
4. Put the app behind TLS. Set `TRUST_PROXY=1` only if your proxy sets `X-Forwarded-For`; that IP is used solely for in-memory rate limiting.
5. Publish `tokenrank-collector` and `tokenrank-mcp` to npm, so users can audit the exact code they run.

## Tests

```bash
pnpm test          # vitest across shared, collector, mcp and web
pnpm typecheck
```

The suites include:

- every parser run against fixture logs that contain prompt text, asserting no content reaches the output, the dry-run payload or stdout;
- streak maths across timezones and DST transitions (US spring-forward and fall-back, Europe/London, Lord Howe's 30-minute shift, Havana's missing midnight);
- rank ties (`1224`) and percentile labels, in pure functions and through the real materialized views;
- ingestion idempotency, protection of verified rows, sanity-limit flagging and moderator review;
- strict-schema rejection of extra fields (`prompt`, `email`, `trust_level`, …);
- the heatmap: 365 days, zero-activity days and user timezones;
- account deletion removing every row and every leaderboard copy in the same call;
- a log-hygiene test that pushes secrets through the real ingest route handler and checks the console;
- envelope encryption, org de-duplication, the device flow and OTLP parsing.

Web tests run against PGlite (in-process Postgres), so they need no database server.
