import { version } from "../package.json";
import { ApiError } from "./api";
import { ConfigError } from "./config";
import { defaultIO, type CliIO } from "./io";
import { UsageError } from "./commands/args";
import { loginCommand } from "./commands/login";
import {
  categoryMapCommand,
  configCommand,
  disableCommand,
  enableCommand,
  logoutCommand,
  sourcesCommand,
  statusCommand,
} from "./commands/manage";
import { scheduleSnippets } from "./commands/schedule";
import { syncCommand } from "./commands/sync";

export const HELP = `tokenrank-collector ${version} — upload daily AI token usage aggregates to TokenRank.

Reads token COUNTS (never prompts, responses or file contents) from your AI
tools, aggregates them per day/model, and uploads only these fields:
date, source, model, category, input_tokens, output_tokens, cache_read_tokens,
cache_write_tokens, request_count, image_count.

Usage: tokenrank-collector <command> [options]

Commands:
  login [--server URL] [--no-sync]     Sign in (device code), enable local sources, first sync
  sync [--dry-run] [--since DATE] [--source a,b] [--full]
                                       Aggregate and upload (--dry-run prints the exact payload)
  status                               Server, account, enabled sources, last sync
  sources                              All sources: detected / enabled / how to enable
  enable <source> [...]                Enable a source (admin-key sources read the key from env or a hidden prompt)
  disable <source>                     Disable a source (deletes its stored admin key)
  config path | show                   Config file location / contents (secrets redacted)
  category-map <source> <id> <cat>     Map a provider project/workspace/key id to a category (local only)
  schedule                             Print cron / launchd / systemd snippets to sync every 6h
  logout                               Remove the token from the local config

Options:
  -h, --help       Help (also: tokenrank-collector <command> --help)
  -v, --version    Version

Environment:
  TOKENRANK_SERVER   Server for login (default http://localhost:3000)
  TOKENRANK_HOME     Config directory (default ~/.tokenrank)
  TOKENRANK_TOKEN    Use this token instead of the saved one (with TOKENRANK_SERVER)
  CLAUDE_CONFIG_DIR, CODEX_HOME, OPENAI_ADMIN_KEY, ANTHROPIC_ADMIN_KEY, CURSOR_ADMIN_KEY

Start here:  npx tokenrank-collector login --server https://your-tokenrank-host
`;

/**
 * Run the CLI in-process. Returns the exit code instead of exiting, and does
 * all I/O through `io` so tests can drive it.
 */
export async function main(argv: string[], ioOverrides: Partial<CliIO> = {}): Promise<number> {
  const io: CliIO = { ...defaultIO(), ...ioOverrides };
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        io.stdout(HELP);
        return command === undefined ? 2 : 0;
      case "--version":
      case "-v":
      case "version":
        io.stdout(`${version}\n`);
        return 0;
      case "login":
        return await loginCommand(rest, io);
      case "sync":
        return await syncCommand(rest, io);
      case "status":
        return await statusCommand(rest, io);
      case "sources":
        return await sourcesCommand(rest, io);
      case "enable":
        return await enableCommand(rest, io);
      case "disable":
        return await disableCommand(rest, io);
      case "config":
        return await configCommand(rest, io);
      case "category-map":
        return await categoryMapCommand(rest, io);
      case "schedule":
        if (rest.includes("--help") || rest.includes("-h")) {
          io.stdout("Usage: tokenrank-collector schedule\n\nPrint snippets to run `sync` every 6 hours (nothing is installed).\n");
          return 0;
        }
        io.stdout(scheduleSnippets(io.env));
        return 0;
      case "logout":
        return await logoutCommand(rest, io);
      default:
        io.stderr(`Unknown command: ${command}\n\n${HELP}`);
        return 2;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`error: ${err.message}\n`);
      return 2;
    }
    if (err instanceof ApiError || err instanceof ConfigError) {
      io.stderr(`error: ${err.message}\n`);
      return 1;
    }
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
