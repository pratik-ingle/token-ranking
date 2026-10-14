# TokenRank architecture

This document explains how TokenRank keeps its privacy promise, how data flows, and the decisions behind the less obvious parts. The plain-English, user-facing version is the `/privacy` page.

## Contents

- [The data contract](#the-data-contract)
- [Components](#components)
- [Data flow](#data-flow)
- [Identity and authentication](#identity-and-authentication)
- [Trust levels](#trust-levels)
- [Timezones](#timezones)
- [Leaderboards](#leaderboards)
- [Integrity and anti-cheating](#integrity-and-anti-cheating)
- [Cloud sync and key handling](#cloud-sync-and-key-handling)
- [Logging hygiene](#logging-hygiene)
- [Provider APIs (verified 2026-10-14)](#provider-apis-verified-2026-10-14)
- [Deviations from the original brief](#deviations-from-the-original-brief)

## The data contract

TokenRank stores exactly one kind of usage record: a daily aggregate per `(user, date, source, model, category)`. It has these fields:

```
date, source, model, category,
input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
request_count, image_count
```

Everything that enforces this lives in [`packages/shared/src/schemas.ts`](../packages/shared/src/schemas.ts) and [`constants.ts`](../packages/shared/src/constants.ts):

- `usageRowSchema` is a zod `strictObject`, so unknown keys cause a **rejection**, not a silent strip. A client that tries to send `prompt`, `email` or even `trust_level` gets a 400 error.
- `model` must match `^[a-z0-9][a-z0-9._:/@+-]*$` and be at most 64 characters. Free text such as a sentence or a prompt cannot fit.
- `USAGE_ROW_FIELDS` is the single source of truth. The privacy page, the API docs, the collector's dry run and the tests all read from it.
- The four token fields never overlap. `input_tokens` excludes cache reads and cache writes. Providers that report cached tokens inside their input count (OpenAI, Codex) are converted to this layout.
- `total = input + output + cache_read + cache_write`.

The server adds bookkeeping columns to each stored row: `trust_level`, `flagged` and `updated_at`. No table has a column for content, real names, emails, IP addresses, user agents, org ids or billing data. An optional recovery email is stored only as an HMAC.

## Components

| Package | Role |
|---|---|
| `packages/shared` | Zod schemas, enums, and pure helpers: timezones, streaks, heatmap, ranking, formatting, usernames, identicons, CSV parsers. Also the provider API clients for OpenAI, Anthropic and Cursor. Runs in both the browser and Node. |
| `packages/collector` | `tokenrank-collector`, an open-source CLI. It parses local Claude Code and Codex logs, calls provider usage APIs with keys that stay local, aggregates locally and uploads rows. `sync --dry-run` prints the exact payload. |
| `packages/mcp` | `tokenrank-mcp`, an MCP server with three tools: `get_my_rank`, `get_my_stats` and `sync_now`. No tool accepts free-text input. |
| `apps/web` | Next.js 16 App Router: UI, REST API, ingestion, auth, the cloud-sync worker, and the leaderboard materialized views (PostgreSQL + Drizzle). |

## Data flow

```
 local logs / provider usage APIs
            │ (on the user's machine)
            ▼
 tokenrank-collector ──aggregate by local day──► [rows] ──POST /api/v1/usage──► daily_usage
                                                                                    │
 browser CSV parse ──────────────────────────► [rows] ──POST /api/me/import───────┤
 Claude Code OTLP metrics ──────────────► POST /api/v1/otlp/v1/metrics (deltas) ───┤
 cloud sync worker (encrypted admin key) ──► provider API ──► [rows, verified] ────┘
                                                                                    │
                                    REFRESH MATERIALIZED VIEW CONCURRENTLY (every ~2 min)
                                                                                    ▼
                              leaderboard_{today,7d,30d,year,all}, user_streaks, global_stats
```

Ingestion ([`apps/web/src/server/ingest.ts`](../apps/web/src/server/ingest.ts)) works like this:

- It is **idempotent**. The primary key is `(user_id, date, source, model, category)`. An upsert replaces the stored values instead of adding to them, so re-syncing a day can't double count. Because of this, clients must only upload complete days. The collector guarantees that (see the collector README), and the provider integrations round `since` down to local midnight.
- The OTLP receiver is the one exception: it uses increment semantics, because OTel delta points are partial by definition.
- A self-reported upload never overwrites a verified row.
- Rows dated after the user's local tomorrow are rejected.

## Identity and authentication

- **Sign-up** asks only for a username (3–24 chars, `[a-z0-9_]`, with a profanity filter and reserved names) and a **passkey**. A password is the fallback. WebAuthn is implemented with SimpleWebAuthn. The in-flight challenge is kept in a short-lived, HMAC-signed, httpOnly cookie.
- **Sessions** are random 32-byte tokens held in an httpOnly, SameSite=Lax cookie. The database stores only their SHA-256, with no IP address and no user agent. Cookie-authenticated mutations also check the `Origin` header.
- **Passwords** are hashed with scrypt (N=2^15, r=8, p=1).
- **Recovery email** (optional) is stored only as `HMAC(server_secret, lowercase(email))`. To recover, the user types their email; the server looks up the HMAC and mails a one-time link to the address the user just typed. The response is identical whether or not the email matched. The link is redeemed with a button POST, so email link scanners can't consume it.
- **Ingest tokens** look like `tr_<32 random bytes>`. Only the SHA-256 is stored, and they have scopes (`ingest`, `read`).
- **Device login** for the CLI and MCP server follows RFC 8628. The CLI shows a vowel-free code like `BCDF-GHJK`. The user approves it at `/device` while signed in. The CLI's next poll mints a token, which is returned exactly once.
- **Avatars** are identicons derived from FNV-1a(username).

## Trust levels

`trust_level` is decided **by the server, never by the client**:

| How the row arrived | trust |
|---|---|
| Cloud sync: the server itself called the provider with an encrypted admin key | `verified` |
| Collector upload, CSV import, OTLP, community connectors | `self_reported` |

This holds even when the collector pulled the numbers from the OpenAI or Anthropic API. In local mode the key never leaves the user's machine, so the server cannot verify what was uploaded. Calling those rows verified would make the badge meaningless. The leaderboard shows a verified share per row and has a **verified-only** filter.

## Timezones

- Every user picks a timezone; it defaults to the browser's timezone at sign-up. Usage is bucketed into **local calendar dates** before it is stored. Once a date string exists, all date arithmetic is done in UTC, so DST can never shift a day ([`dates.ts`](../packages/shared/src/dates.ts)).
- **Local logs and events** (Claude Code, Codex, the Cursor CSV and Cursor Admin API events, OTLP) have exact timestamps. Each event goes to `localDate(timestamp, tz)`.
- **Provider usage APIs return UTC buckets.** OpenAI and Anthropic are queried with `bucket_width=1h` (at most 168 buckets per page), and each hourly bucket is assigned to the local date of its start time. For whole-hour offsets this is exact. For half-hour and 45-minute offsets (India, Nepal, parts of Australia), the bucket that straddles local midnight is credited to the earlier day, so up to 30–45 minutes of usage can land on the neighbouring day. Daily (`1d`) buckets would be off by up to 14 hours.
- **Changing your timezone** affects future syncs. Re-running `tokenrank-collector sync --full` re-buckets past days. Because upserts replace by key, a re-bucketed day replaces the old values. Rows under the old dates remain until they are re-synced.
- **Streaks** count consecutive active days, where an active day has total ≥ `ACTIVE_DAY_MIN_TOKENS` (default 1). The current streak is the run that ends today or yesterday in the user's timezone. Yesterday counts so that a streak isn't "broken" in the morning before the first sync.
- **Leaderboard windows are per user.** "Today" means each user's own local today, and "7d" means their last seven local dates. Everyone gets exactly the same number of local days.

## Leaderboards

There is one materialized view per window: `leaderboard_today`, `leaderboard_7d`, `leaderboard_30d`, `leaderboard_year` and `leaderboard_all` ([`apps/web/src/db/views.ts`](../apps/web/src/db/views.ts)). Each view contains, for every `(verified_only, source|'*', category|'*', user)`:

- totals with and without cache tokens, and their verified portions;
- the user's top source;
- `RANK()` over both totals (competition ranking: ties share a rank), plus the partition size for percentiles.

`GROUPING SETS` produce the all-sources and all-categories rows in a single pass. `user_streaks` computes current and longest streaks in SQL (gaps-and-islands) for the streak column. `global_stats` powers the landing page and counts the same population as the leaderboards: public users only, with flagged days and duplicate-org integrations excluded.

The same views also feed the leaderboard's extra columns. `board_total_tokens` and `top_total_tokens` come from the partition in one aggregate query. Each row's category mix and source list come from one batched query over the users on the page (category rows: `source = <filter or '*'>, category <> '*'`; source rows: `category = <filter or '*'>, source <> '*'`). Every listing query joins `users` and checks `visibility = 'public'` at query time, so someone who switches to hidden disappears from lists, board totals and mixes immediately, not at the next refresh.

The views are refreshed with `REFRESH … CONCURRENTLY`, which needs the unique index each view has. That happens every two minutes in the worker, and synchronously during account deletion. `ensureViews` hashes the view SQL and re-creates the views when the definition changes.

- **Hidden users** are not in the views. Their rank is computed live as "where you would stand": 1 + the number of public users with a strictly greater total.
- **Percentile label:** `Top ⌈rank/n·100⌉%`. Below 1% it is shown with one decimal, rounded up, so it never overstates a position.
- **"Exclude cache"** ranks by `input + output`, dropping both cache reads and cache writes.

## Integrity and anti-cheating

- **Verified badge and filter:** see [Trust levels](#trust-levels).
- **Sanity limits:** each `(user, date, source)` day is checked against a per-source limit (default 3–10 billion tokens incl. cache; images 100k/day; override with `SANITY_LIMITS_JSON`). A day over the limit is **stored but flagged**. Flagged days are excluded from rankings, streaks and public totals until a moderator approves them at `/admin/review`. An approval covers totals up to the approved value, so a larger re-sync is flagged again. A rejection keeps the day excluded.
- **Org de-duplication:** the collector sends `sha256(source + ":" + org_id)`. Cloud sync computes the same value server-side and then discards the org id. The server stores `HMAC(server_secret, that)`. If a second account claims the same fingerprint, its integration is marked `duplicate`, and that source's usage for the second account is excluded from rankings. The org is counted once.
- **Idempotent ingestion:** see [Data flow](#data-flow).
- **Rate limits:** in-memory fixed windows, keyed by token (60 ingest requests/min) and by IP (120/min). They are never persisted or logged. Auth endpoints allow 10 requests/min per IP and per username. For multi-instance deployments, add an edge or proxy limiter as well.

## Cloud sync and key handling

Cloud sync is optional. The UI recommends the local collector and shows a warning that admin keys are powerful before a user can connect one.

- **Envelope encryption:** each user has a random 32-byte data key. It is stored wrapped (AES-256-GCM) by the master key, which comes from the `MASTER_KEY` env secret through a `Kms` interface that can be swapped for a cloud KMS. Credentials are encrypted with the data key using AES-256-GCM. The AAD is `user_id + source`, so ciphertexts can't be swapped between rows.
- **Validation:** before a key is stored, the server calls the provider. For OpenAI and Anthropic it calls `identify`, which also yields the org fingerprint.
- **Exposure:** keys are never logged, never returned to the client and never included in the data export.
- **Revoke** deletes the credential in one click; optionally it also deletes the verified data that was synced with it. When a user has no cloud credentials left, their data key is deleted too (crypto-shredding).
- **Worker cadence:** the worker syncs each integration every 6 hours. Each sync re-fetches from `last_sync − 2 days` to pick up late-arriving data.

## Logging hygiene

- The server logger ([`logger.ts`](../apps/web/src/server/logger.ts)) writes JSON lines with a **whitelist** of fields: route, method, status, duration and counts. As a second line of defence it scrubs anything that looks like a token, key, Basic/Bearer credential, email or IPv4 address.
- Route handlers never log bodies or headers. A test sends secrets through the real `/api/v1/usage` handler and asserts that none of them reach the console.
- The Next.js dev logging of server-function arguments and the forwarding of browser console output are both disabled. Request lines for `/api/auth/*`, `/api/v1/device/*` and `/recover/*` are not logged.
- Provider error messages contain only the HTTP status and the provider's error type, never the key.

## Provider APIs (verified 2026-10-14)

| Provider | Endpoint | Notes |
|---|---|---|
| OpenAI | `GET /v1/organization/usage/{completions,embeddings,images,audio_speeches,audio_transcriptions}` | Admin key. `input_tokens` **includes** `input_cached_tokens` and cache-write tokens, so we subtract them. `1h` buckets, at most 168 per page; repeated `group_by`. There is no org-id endpoint; the `openai-organization` response header is used when present, otherwise no fingerprint is recorded. |
| Anthropic | `GET /v1/organizations/usage_report/messages` | `x-api-key: sk-ant-admin…`, `anthropic-version: 2023-06-01`. Fields: `uncached_input_tokens`, `cache_read_input_tokens`, `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens`, `output_tokens`. **No request count**, so `request_count` is 0. Org id comes from `GET /v1/organizations/me`. |
| Cursor | `POST https://api.cursor.com/teams/filtered-usage-events` | Basic auth (key as username). Events carry `tokenUsage{inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens}`. Keys are **team-wide**, so filter by the user's own email (kept locally, or inside the encrypted credential) or opt into team-wide totals explicitly. |
| Cursor CSV | dashboard export | No official spec. The parser matches columns by name and handles header variants v1–v3; for team exports the user picks their own row in the browser. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Reads only timestamp, ids, `message.model` and `message.usage.*`. Dedupe key is `message.id + requestId`. `<synthetic>` and API-error entries are skipped. Transcripts are kept 30 days by default. |
| Claude Code OTel | `claude_code.token.usage` | Delta temporality (the default). Only the `type` and `model` attributes are read. |
| Codex CLI | `~/.codex/sessions/**/rollout-*.jsonl` | `event_msg/token_count` with `last_token_usage`, counted only when `total_token_usage` changes. `cached_input_tokens` is part of `input_tokens`. |

## Deviations from the original brief

- **Auth library:** a small custom implementation (SimpleWebAuthn + scrypt + hashed sessions) instead of Better Auth. Better Auth's core user model is email-centric, and its session table stores IP and user agent. The custom version is a few hundred lines that are easy to audit against the privacy rules.
- **Verified means server-pulled**, as explained in [Trust levels](#trust-levels).
- **Next.js 16** (current) instead of 15. Tailwind v4 is used with shadcn-style components written in the repo, rather than the shadcn CLI.
- **Local development database:** real PostgreSQL 18 runs through the `embedded-postgres` npm package (no Docker or sudo). Tests use PGlite (Postgres compiled to WASM) in-process.
- **Recovery email** is HMAC-only, which is stricter than the brief's "never shown" requirement.
