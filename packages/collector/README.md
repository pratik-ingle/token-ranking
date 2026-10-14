# tokenrank-collector

Local, auditable collector for [TokenRank](../../README.md), a privacy-first global leaderboard for AI token usage.

It reads **token counts, never content** from the AI tools on your machine. It aggregates them into one row per day, model and category, then uploads those rows. Run `sync --dry-run` to see the exact bytes that would leave your machine.

```sh
npx tokenrank-collector login --server https://your-tokenrank-host
```

That single command signs you in with a one-time code, enables the local sources it finds (Claude Code, Codex CLI), runs the first sync and prints your rank.

---

## Commands

| Command | What it does |
| --- | --- |
| `login [--server URL] [--no-sync] [--no-browser]` | Device-code sign-in. It prints a URL and a code and tries to open your browser. It saves the token, auto-enables the local sources it detects and runs the first sync. Default server: `$TOKENRANK_SERVER`, else the saved server, else `http://localhost:3000`. |
| `sync [--dry-run] [--since YYYY-MM-DD] [--source a,b] [--full] [--claude-dir DIR]… [--codex-home DIR]` | Reads the enabled sources, aggregates them and uploads in chunks of at most 1000 rows. It then prints a per-source table (days, rows, tokens, requests) and your current rank. |
| `status` | Shows the server, account, timezone, enabled sources and the last sync time of each source. |
| `sources` | Lists every source with its detected and enabled state, and how to enable it. |
| `enable <source>` / `disable <source>` | Turns a source on or off (see below). `disable` deletes a stored admin key. |
| `config path` / `config show` | Prints the config file location, or its contents with the token and keys redacted. |
| `category-map <source> <id> <category\|none>` | Maps an OpenAI project/API-key id, or an Anthropic workspace/API-key id, to a category. The mapping is applied locally and ids are never uploaded. `config category-map …` also works. |
| `schedule` | Prints cron, launchd and systemd-timer snippets that run `npx tokenrank-collector sync` every 6 hours. It only prints them and installs nothing. |
| `logout` | Removes the token from the local config. |
| `--help`, `--version` | Help and version. `<command> --help` gives help for one command. |

### Enabling sources

```sh
tokenrank-collector enable claude_code [--path ~/.claude]...   # default: $CLAUDE_CONFIG_DIR or ~/.claude, plus ~/.config/claude
tokenrank-collector enable codex_cli [--home ~/.codex]         # default: $CODEX_HOME or ~/.codex

OPENAI_ADMIN_KEY=sk-admin-…        tokenrank-collector enable openai_api
ANTHROPIC_ADMIN_KEY=sk-ant-admin…  tokenrank-collector enable anthropic_api
CURSOR_ADMIN_KEY=…                 tokenrank-collector enable cursor --email you@example.com   # or --team-wide
tokenrank-collector enable openai_api --key-env MY_KEY_VAR     # read the key from another variable
tokenrank-collector enable anthropic_api                       # no variable set → hidden prompt
```

Admin keys are stored only in your config file (mode 0600). They are only ever sent to their own provider (`api.openai.com`, `api.anthropic.com`, `api.cursor.com`), never to TokenRank. They are never printed. A Cursor admin key covers the whole team, so you must either pass `--email` or opt into `--team-wide`. The email is used only as a local filter on the request to Cursor and is never uploaded to TokenRank.

---

## Exactly what is uploaded

`POST /api/v1/usage` receives a bare JSON array of rows. Each row has **exactly** these ten fields and nothing else; the server's strict schema rejects unknown keys:

```json
{
  "date": "2026-10-12",
  "source": "claude_code",
  "model": "claude-sonnet-4-5-20250929",
  "category": "coding",
  "input_tokens": 11,
  "output_tokens": 414,
  "cache_read_tokens": 5000,
  "cache_write_tokens": 2000,
  "request_count": 2,
  "image_count": 0
}
```

* `date` is a calendar day in **your TokenRank timezone**. The timezone comes from the server: it is saved at login and refreshed from `GET /api/v1/me` at the start of every sync.
* `model` is normalised to `[a-z0-9._:/@+-]`, at most 64 characters. It cannot contain spaces, so it cannot carry free text.
* The four token counters are disjoint: `input_tokens` excludes cache reads and writes.
* Before upload, rows are validated client-side against the same strict schema the server uses (`ingestPayloadSchema`).

Nothing else ever leaves your machine, with one exception: the integration heartbeat (`POST /api/v1/integrations/heartbeat`), which is `{ "source", "status": "ok"|"error", "org_fingerprint"? }`. `org_fingerprint` is sent only for the OpenAI and Anthropic admin APIs. It is `sha256("<source>:<provider org id>")`, which the server HMACs again. The raw org id is hashed as soon as it is read and then discarded. Org, project, workspace and API-key ids and emails are never uploaded. If the server answers `duplicate` (that provider org is already linked to another account), your usage is still uploaded, but it won't count on the public leaderboard, and the collector tells you so.

## Exactly what is read

Log files are scanned with a **selective JSON field extractor** (`src/json-extract.ts`). It walks the raw bytes of each JSONL line and decodes **only** the whitelisted fields below. Every other value (prompt text, responses, thinking, tool inputs and outputs, file contents, paths, git info) is skipped in place, by scanning to the closing quote or bracket. It is never decoded into a JS string, never `JSON.parse`d, never logged and never sent. A whitelisted string longer than 512 bytes is dropped rather than decoded.

### Claude Code: `claude_code`, category `coding`

* Roots: `$CLAUDE_CONFIG_DIR` (comma-separated allowed), else `~/.claude`, plus the legacy `~/.config/claude`. `--claude-dir` and the config `paths` setting replace these defaults.
* The collector scans **only** `<root>/projects/**/*.jsonl`, which includes sub-agent transcripts in `<session>/subagents/`. It never reads `history.jsonl`, settings or any other file. File names starting with `.orphaned-`, and anything not ending exactly in `.jsonl` (for example `*.jsonl.superseded-*`), are skipped.
* Fields read: `type`, `timestamp`, `requestId`, `sessionId` (dedupe fallback only), `isSidechain`, `isApiErrorMessage`, `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation.ephemeral_5m_input_tokens, cache_creation.ephemeral_1h_input_tokens}`, and for each `message.usage.iterations[]` item: `type`, `model` and the same counters, either directly on the item or nested under `usage`. **Never** `message.content`, `cwd`, `gitBranch` or `uuid`.
* Mapping:
  * `input = input_tokens`, which already excludes cache.
  * `cache_read = cache_read_input_tokens`.
  * `cache_write = ephemeral_5m + ephemeral_1h` when the nested `cache_creation` object is present, else `cache_creation_input_tokens`.
* Skipped: entries with `message.model == "<synthetic>"` or `isApiErrorMessage: true`.
* Dedupe across all files:
  * Claude Code writes one line per content block, all with the same ids. Lines are keyed by `message.id:requestId`. Without a `requestId` the key is `message.id:sessionId`, plus the timestamp when the id isn't a `msg_` id.
  * Duplicates keep the **per-field maximum**, because the last line carries the final `output_tokens`.
  * A sidechain entry whose `message.id` also appears in a non-sidechain entry is a replay and is dropped, even when it has a different `requestId`.
* Each deduplicated API response counts as one request.
* Advisor tool: the top-level usage is the executor only. Each `iterations[]` item with `type: "advisor_message"` is counted as a separate request under its own `model`.

### Codex CLI: `codex_cli`, category `coding`

* Reads `${CODEX_HOME:-~/.codex}/sessions/**/rollout-*.jsonl` and `$CODEX_HOME/archived_sessions/`. If the same file name exists in both, `sessions/` wins.
* `rollout-*.jsonl.zst` files come from Codex's optional compression, which is off by default. Node 20 has no zstd, so these files are skipped and a one-line warning gives the count. If the running Node has `zlib.zstdDecompressSync`, they are read.
* Fields read: `timestamp`, `type`, `payload.type`, `payload.model` (used from `turn_context` lines only), and the counters of `payload.info.total_token_usage` and `payload.info.last_token_usage` (`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `total_tokens`). It **never** reads `session_meta` (cwd, git, instructions), `response_item` (messages, tool calls, reasoning) or any other payload.
* The model is the latest `turn_context.payload.model` seen in that file. Until one is seen, it is `unknown`.
* A `token_count` event counts only when `total_token_usage` changed since the previous one in that file, because Codex re-emits identical totals.
  * The delta is `last_token_usage`, or, if that is missing, the difference between successive totals. Totals are never summed.
  * `info: null` is skipped.
* Mapping:
  * `cache_read = cached_input_tokens`.
  * `cache_write = min(cache_write_input_tokens, input − cached)`.
  * `input = input − cached − cache_write`, clamped at 0.
  * `output = output_tokens`, which already includes reasoning.
* Forked and sub-agent rollouts replay their parent's history. Events are deduped across files by `timestamp|total.total_tokens|last.total_tokens`.
* `token_usage_record` lines are ignored, so nothing is double counted.

### Admin APIs: `openai_api`, `anthropic_api`, `cursor`

These sources use the shared provider integrations in `@tokenrank/shared/providers` with your admin key, and only the aggregated rows are uploaded. `openai_api` and `anthropic_api` default to category `chat`, unless a `category-map` entry maps the project, workspace or key to another category; `cursor` is `coding`. The Anthropic usage report has no request count, so `request_count` is 0 for that source.

---

## Dry run

```sh
npx tokenrank-collector sync --dry-run > payload.json
```

* **STDOUT** contains exactly the request bodies that would be sent to `POST /api/v1/usage`, as **one JSON array whose elements are the request bodies**: `[[row, …], [row, …]]`. Each element is one POST body of at most 1000 rows. `[]` means there is nothing to send. Example: `jq '.[0]' payload.json` is the first request body.
* **STDERR** contains the human-readable summary.
* Nothing is uploaded, no heartbeat is sent, and no state changes: `lastSync` is untouched. If you are logged in, the only request is `GET /api/v1/me`, to learn your timezone. It works before `login` too: it then uses the local sources it detects and your system timezone.

## Incremental sync and complete days

The server **replaces** a row per `(date, source, model, category)`. Re-uploading is therefore idempotent, but every uploaded day must be complete. The collector guarantees this:

* **Local logs.**
  * The first affected day is `--since`, else the local date of the last successful sync minus one day, else everything (first sync or `--full`).
  * Every file whose mtime is at or after the start of that day is parsed. Transcripts are append-only, so a file holding an event at time *t* has an mtime of at least *t*.
  * Only days on or after the first affected day are uploaded. Dedupe state spans all parsed files.
* **Admin APIs.** The window starts at the last sync minus two days, to catch late-arriving data, or 90 days back on the first sync or with `--full`. The integrations round down to local midnight.
* `lastSync` (per source) is updated only after that source's upload fully succeeds. A failed source is retried from the same point next time.
* If your TokenRank timezone changes, local history is re-read in full so days are re-bucketed.

## Scheduling

`tokenrank-collector schedule` prints ready-to-paste snippets: a crontab line, a launchd plist and a systemd user service plus timer. Each runs `npx -y tokenrank-collector sync` every 6 hours. Syncs are incremental and idempotent, so the exact cadence doesn't matter.

## Config file

The config lives at `~/.tokenrank/config.json`; set `$TOKENRANK_HOME` to use another directory. The directory is mode 0700 and the file 0600, and it is written atomically (temp file, fsync, rename). Loosened permissions are tightened again on every load and save.

```jsonc
{
  "version": 1,
  "server": "https://tokenrank.example",       // the server the token belongs to
  "token": "tr_…",                              // bearer token from `login`
  "username": "alice",
  "timezone": "Asia/Kolkata",                   // from the server; days are bucketed here
  "sources": {
    "claude_code":   { "enabled": true, "paths": ["/custom/claude"] },        // paths optional
    "codex_cli":     { "enabled": true, "home": "/custom/codex" },            // home optional
    "openai_api":    { "enabled": false, "adminKey": "…", "categoryMap": { "proj_abc": "coding" } },
    "anthropic_api": { "enabled": false, "adminKey": "…", "categoryMap": { "wrkspc_1": "agents" } },
    "cursor":        { "enabled": false, "adminKey": "…", "email": "you@example.com" }  // or "teamWide": true
  },
  "lastSync": { "claude_code": "2026-10-14T12:00:00.000Z" }
}
```

Environment variables:

* `TOKENRANK_SERVER`: the server used by `login`.
* `TOKENRANK_HOME`: the config directory.
* `TOKENRANK_TOKEN`: overrides the saved token. It is paired with `TOKENRANK_SERVER` and meant for CI.
* `CLAUDE_CONFIG_DIR` and `CODEX_HOME`: the log locations.
* `OPENAI_ADMIN_KEY`, `ANTHROPIC_ADMIN_KEY`, `CURSOR_ADMIN_KEY`: used by `enable`, and as a fallback at sync time.

## Trust model

Everything this collector uploads is **`self_reported`**. The server cannot verify data computed on your machine, and the client never sends a trust level: `trust_level` is stripped before upload. Only usage that the TokenRank **server itself** pulls from a provider API (cloud sync, configured on the website) is marked **verified**. That includes usage from your admin keys if you configure them on the website. Admin-key sources synced through this collector are still `self_reported`.

## Library

The package entry (`import { … } from "tokenrank-collector"`) exports:

* `runSync(opts)`: returns a structured summary, including the exact payloads (for dry-run) and per-source counts.
* `loadConfig`, `saveConfig`, `updateConfig`, `resolveAuth`.
* `TokenRankClient` and `ApiError`.
* The parsers: `ClaudeCodeParser`, `parseClaudeCode`, `CodexParser`, `parseCodex`, `extractFields`.

Nothing in the library writes to stdout; progress goes through a `log` callback. `tokenrank-mcp` uses this entry.

## Known limitations

* **Claude Code retention.** Claude Code deletes transcripts older than `cleanupPeriodDays` (default **30**). Sync at least that often; scheduling every 6 hours is plenty. Days uploaded earlier stay on the server. Avoid `sync --full` or an old `--since` long after logs were cleaned up: a day whose transcripts were only partly deleted would be re-uploaded with a smaller total, replacing the complete value.
* **Codex.** `token_usage_record` lines are ignored to avoid double counting, so usage of auto-compaction turns that only appears there is slightly undercounted. Compressed `.jsonl.zst` rollouts are skipped on Node versions without built-in zstd. Events before the first `turn_context` in a file are attributed to model `unknown`.
* **Sidechain replays and incremental syncs.** A sub-agent replay is dropped when its parent message is in a parsed file. If the parent's file is older than the incremental window and the replay is newer, the replay is counted (rare).
* **Timezone changes.** If you change your timezone, rows bucketed under the old timezone stay on the server for keys that no longer exist after re-bucketing.
* **Anthropic Admin API.** The report has no request counts, so `request_count` is 0 for `anthropic_api`.
* **Bundle size.** `@tokenrank/shared` and zod are bundled in, and zod v4 pulls in all of its locales, so the shared chunk is about 840 KB unminified. It is deliberately not minified, so it can be audited.

## Development

```sh
pnpm --filter tokenrank-collector build             # tsup → dist/
pnpm --filter tokenrank-collector dev -- sync --dry-run
npx tsc -p packages/collector/tsconfig.json --noEmit
npx vitest run --project collector                  # from the repo root
```

The tests use realistic fixture logs in `test/fixtures/`. The fixtures contain planted prompt text, paths, branches and emails (`SECRET_*`). The tests assert that none of these strings ever appear in parser output, in dry-run payloads, or in the CLI's stdout and stderr.
