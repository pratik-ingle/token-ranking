# tokenrank-mcp

[MCP](https://modelcontextprotocol.io) server for [TokenRank](../../README.md). It lets your AI assistant tell you your rank and stats, and trigger a sync of your local usage. It **never forwards conversation content**:

* The tools take no free-text input. Each takes at most one optional boolean, and unknown arguments are rejected.
* The server never requests sampling or elicitation, never lists roots and never reads client resources.
* `sync_now` uploads exactly what [`tokenrank-collector`](../collector/README.md) uploads: daily token counts per model.

## Setup

1. Sign in once with the collector. This stores a token in `~/.tokenrank/config.json`:

   ```sh
   npx tokenrank-collector login --server https://your-tokenrank-host
   ```

2. Add the MCP server.

   **Claude Code:**

   ```sh
   claude mcp add tokenrank -- npx tokenrank-mcp
   ```

   (`npx -y tokenrank-mcp` also works; `-y` just skips npx's install prompt, which npx already skips when stdin isn't a terminal.)

   **Any MCP client with a JSON config** (Claude Desktop, Cursor, …):

   ```json
   {
     "mcpServers": {
       "tokenrank": {
         "command": "npx",
         "args": ["-y", "tokenrank-mcp"]
       }
     }
   }
   ```

   To skip the config file, for example on CI or a shared machine, pass the token through the environment instead:

   ```json
   {
     "mcpServers": {
       "tokenrank": {
         "command": "npx",
         "args": ["-y", "tokenrank-mcp"],
         "env": { "TOKENRANK_TOKEN": "tr_…", "TOKENRANK_SERVER": "https://your-tokenrank-host" }
       }
     }
   }
   ```

## Tools

| Tool | Input | What it does |
| --- | --- | --- |
| `get_my_rank` | `include_cache?: boolean` (default `true`) | Calls `GET /api/v1/me/rank`. Returns a short summary per window (today, 7 days, 30 days, year, all time): rank, ranked users, percentile and tokens, plus your profile URL. The raw response is in `structuredContent`. |
| `get_my_stats` | none | Calls `GET /api/v1/me/stats`. Returns totals (input, output, cache, requests), streaks, and top sources, categories and models. |
| `sync_now` | `dry_run?: boolean` (default `false`) | Runs the collector's `runSync` in-process: it reads the enabled sources, aggregates and uploads. It returns only per-source counts (days, rows, tokens, requests) and never row-level data. With `dry_run`, nothing is uploaded. |

If you are not logged in, or the token was revoked, the tools return an error that tells you to run `npx tokenrank-collector login`.

## Configuration

The server reads the same config as the collector:

* `TOKENRANK_HOME` sets the config directory (default `~/.tokenrank`).
* Alternatively, set `TOKENRANK_TOKEN` and `TOKENRANK_SERVER`.

The config is re-read on every call, so a `login` done while the server is running is picked up. Which sources `sync_now` reads is controlled by `tokenrank-collector enable` / `disable`.

stdout carries MCP protocol messages only. All diagnostics go to stderr.

## Development

```sh
pnpm --filter tokenrank-mcp build      # bundles the collector (from source) and @tokenrank/shared
npx tsc -p packages/mcp/tsconfig.json --noEmit
npx vitest run --project mcp           # from the repo root
```

The tests drive the server through a real MCP client over an in-memory transport, with a mocked `fetch`.
