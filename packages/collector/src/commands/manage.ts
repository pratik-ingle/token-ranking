import path from "node:path";
import { CATEGORIES, type Category } from "@tokenrank/shared";
import {
  COLLECTOR_SOURCES,
  configPath,
  isAdminSource,
  isCollectorSource,
  loadConfig,
  redactConfig,
  resolveAuth,
  saveConfig,
  type AdminSource,
  type CollectorConfig,
  type CollectorSource,
} from "../config";
import { table } from "../format";
import type { CliIO } from "../io";
import { expandHome } from "../paths";
import { ADMIN_KEY_ENV, SOURCE_HELP, adminKeyFor, detectLocalSource, sourceLabel } from "../sources";
import { parse, optString, optStrings, UsageError } from "./args";

function relTime(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function requireSource(raw: string | undefined, command: string): CollectorSource {
  if (!raw) throw new UsageError(`usage: tokenrank-collector ${command} <source>  (one of: ${COLLECTOR_SOURCES.join(", ")})`);
  if (!isCollectorSource(raw)) throw new UsageError(`unknown source "${raw}" (expected one of: ${COLLECTOR_SOURCES.join(", ")})`);
  return raw;
}

// --- status -----------------------------------------------------------------

export async function statusCommand(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {});
  if (values.help) {
    io.stdout("Usage: tokenrank-collector status\n\nShow the server, account, enabled sources and last sync times.\n");
    return 0;
  }
  const config = await loadConfig(io.env);
  const auth = resolveAuth(config, io.env);
  const now = io.now?.() ?? new Date();
  const lines = [
    `Config:    ${configPath(io.env)}`,
    `Server:    ${auth.server}`,
    `Account:   ${
      auth.token
        ? `${config.username ? `@${config.username}` : "(unknown user)"}${auth.from === "env" ? " (token from TOKENRANK_TOKEN)" : ""}`
        : "not logged in — run `tokenrank-collector login`"
    }`,
    `Timezone:  ${config.timezone ?? "(set at login)"}`,
    "",
  ];
  const rows = COLLECTOR_SOURCES.map((s) => {
    const last = config.lastSync[s];
    return [sourceLabel(s), config.sources[s].enabled ? "enabled" : "disabled", last ? `${last} (${relTime(last, now)})` : "never"];
  });
  lines.push(table(["Source", "State", "Last sync"], rows, [false, false, false]));
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

// --- sources ----------------------------------------------------------------

export async function sourcesCommand(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {});
  if (values.help) {
    io.stdout("Usage: tokenrank-collector sources\n\nList every source with its detected/enabled state and how to enable it.\n");
    return 0;
  }
  const config = await loadConfig(io.env);
  const rows: string[][] = [];
  for (const s of COLLECTOR_SOURCES) {
    let detected: string;
    if (isAdminSource(s)) detected = adminKeyFor(s, config, io.env) ? "key set" : "no key";
    else {
      const d = await detectLocalSource(s, io.env, config);
      detected = d.detected ? "found" : "not found";
    }
    rows.push([s, sourceLabel(s), detected, config.sources[s].enabled ? "yes" : "no"]);
  }
  const help = COLLECTOR_SOURCES.map((s) => `  ${s.padEnd(14)} ${SOURCE_HELP[s]}`);
  io.stdout(
    [
      table(["Source", "Name", "Detected", "Enabled"], rows, [false, false, false, false]),
      "",
      "How to enable:",
      ...help,
      "",
      "Admin keys are stored only in your local config file (mode 0600) and are only ever sent to their own provider.",
      "Gemini and other tools have no local logs or admin API the collector can read yet.",
      "",
    ].join("\n"),
  );
  return 0;
}

// --- enable / disable -------------------------------------------------------

export const ENABLE_HELP = `Usage: tokenrank-collector enable <source> [options]

  claude_code    [--path DIR]...       Claude Code config dir(s) (default: $CLAUDE_CONFIG_DIR or ~/.claude, plus ~/.config/claude)
  codex_cli      [--home DIR]          Codex home (default: $CODEX_HOME or ~/.codex)
  openai_api     [--key-env NAME]      Admin key from $NAME (default $OPENAI_ADMIN_KEY), else prompted (hidden)
  anthropic_api  [--key-env NAME]      Admin key from $NAME (default $ANTHROPIC_ADMIN_KEY), else prompted (hidden)
  cursor         [--key-env NAME] (--email you@example.com | --team-wide)
                                       Cursor team admin key (default $CURSOR_ADMIN_KEY). The email is only
                                       used locally to filter the team's events to yours; it is never uploaded.
`;

async function readAdminKey(source: AdminSource, keyEnv: string | undefined, io: CliIO, existing: string | undefined): Promise<string> {
  if (keyEnv) {
    const v = io.env[keyEnv]?.trim();
    if (!v) throw new UsageError(`environment variable ${keyEnv} is empty or not set`);
    return v;
  }
  const fromDefault = io.env[ADMIN_KEY_ENV[source]]?.trim();
  if (fromDefault) return fromDefault;
  const typed = await io.promptSecret(`${sourceLabel(source)} admin key (input hidden, Enter to ${existing ? "keep the current key" : "cancel"}): `);
  if (typed) return typed;
  if (existing) return existing;
  throw new UsageError(
    `no admin key provided. Set ${ADMIN_KEY_ENV[source]}, pass --key-env NAME, or run this in a terminal to be prompted.`,
  );
}

export async function enableCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {
    path: { type: "string", multiple: true },
    home: { type: "string" },
    "key-env": { type: "string" },
    email: { type: "string" },
    "team-wide": { type: "boolean" },
  });
  if (values.help) {
    io.stdout(ENABLE_HELP);
    return 0;
  }
  const source = requireSource(positionals[0], "enable");
  const config = await loadConfig(io.env);
  const label = sourceLabel(source);

  if (source === "claude_code") {
    const paths = optStrings(values.path).map((p) => path.resolve(expandHome(p, io.env)));
    config.sources.claude_code = { enabled: true, ...(paths.length > 0 ? { paths } : config.sources.claude_code.paths ? { paths: config.sources.claude_code.paths } : {}) };
  } else if (source === "codex_cli") {
    const home = optString(values.home);
    config.sources.codex_cli = {
      enabled: true,
      ...(home ? { home: path.resolve(expandHome(home, io.env)) } : config.sources.codex_cli.home ? { home: config.sources.codex_cli.home } : {}),
    };
  } else {
    const keyEnv = optString(values["key-env"]);
    if (source === "cursor") {
      const emailFlag = optString(values.email);
      const teamWideFlag = values["team-wide"] === true;
      if (emailFlag && teamWideFlag) throw new UsageError("use either --email or --team-wide, not both");
      let email: string | undefined;
      if (emailFlag) email = emailFlag;
      else if (!teamWideFlag && config.sources.cursor.email) email = config.sources.cursor.email;
      const teamWide = !email && (teamWideFlag || config.sources.cursor.teamWide === true);
      if (!email && !teamWide) {
        throw new UsageError(
          "Cursor admin keys cover the whole team: pass --email you@example.com (used only locally as a filter) or --team-wide",
        );
      }
      const adminKey = await readAdminKey(source, keyEnv, io, config.sources.cursor.adminKey);
      config.sources.cursor = { enabled: true, adminKey, ...(email ? { email } : { teamWide: true }) };
    } else {
      const adminKey = await readAdminKey(source, keyEnv, io, config.sources[source].adminKey);
      config.sources[source] = { ...config.sources[source], enabled: true, adminKey };
    }
  }
  await saveConfig(config, io.env);
  io.stdout(`Enabled ${label}.\n`);
  if (source === "claude_code" || source === "codex_cli") {
    const d = await detectLocalSource(source, io.env, config);
    if (!d.detected) io.stderr(`warning: no ${label} logs found yet at the configured location.\n`);
  } else {
    io.stdout(
      `The admin key is stored in ${configPath(io.env)} (mode 0600) and is only sent to the provider. The next sync fetches up to the last 90 days.\n`,
    );
  }
  return 0;
}

export async function disableCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {});
  if (values.help) {
    io.stdout("Usage: tokenrank-collector disable <source>\n\nStop syncing a source. For admin-key sources the stored key is deleted.\n");
    return 0;
  }
  const source = requireSource(positionals[0], "disable");
  const config = await loadConfig(io.env);
  if (isAdminSource(source)) {
    const keep: Partial<CollectorConfig["sources"]["openai_api"]> = {};
    if (source !== "cursor") {
      const map = config.sources[source].categoryMap;
      if (map) keep.categoryMap = map;
    }
    (config.sources as Record<string, unknown>)[source] = { enabled: false, ...keep };
  } else {
    config.sources[source] = { ...config.sources[source], enabled: false };
  }
  await saveConfig(config, io.env);
  io.stdout(`Disabled ${sourceLabel(source)}.${isAdminSource(source) ? " Its stored admin key was deleted." : ""}\n`);
  io.stdout("Data already uploaded stays on the server; delete it from your TokenRank settings page if you want it gone.\n");
  return 0;
}

// --- config / category-map ----------------------------------------------------

export const CONFIG_HELP = `Usage:
  tokenrank-collector config path                              Print the config file path
  tokenrank-collector config show                              Print the config with secrets redacted
  tokenrank-collector config category-map <source> <id> <category|none>
                                                               (also: tokenrank-collector category-map …)

category-map maps an OpenAI project / API key id or an Anthropic workspace / API
key id to a category (${CATEGORIES.join(", ")}). The mapping is applied locally;
ids are never uploaded. Use "none" to remove a mapping.
`;

export async function configCommand(args: string[], io: CliIO): Promise<number> {
  const [sub, ...rest] = args;
  if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
    io.stdout(CONFIG_HELP);
    return sub ? 0 : 2;
  }
  if (sub === "path") {
    parse(rest, {});
    io.stdout(`${configPath(io.env)}\n`);
    return 0;
  }
  if (sub === "show") {
    parse(rest, {});
    const config = await loadConfig(io.env);
    io.stdout(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
    return 0;
  }
  if (sub === "category-map") return categoryMapCommand(rest, io);
  throw new UsageError(`unknown config subcommand "${sub}"\n\n${CONFIG_HELP}`);
}

export async function categoryMapCommand(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parse(args, {});
  if (values.help) {
    io.stdout(CONFIG_HELP);
    return 0;
  }
  const [rawSource, id, rawCategory] = positionals;
  if (!rawSource || !id || !rawCategory) throw new UsageError("usage: tokenrank-collector category-map <source> <id> <category|none>");
  if (rawSource !== "openai_api" && rawSource !== "anthropic_api") {
    throw new UsageError("category-map applies to openai_api and anthropic_api only");
  }
  const remove = rawCategory === "none" || rawCategory === "remove";
  if (!remove && !(CATEGORIES as readonly string[]).includes(rawCategory)) {
    throw new UsageError(`unknown category "${rawCategory}" (expected one of: ${CATEGORIES.join(", ")}, or none)`);
  }
  const config = await loadConfig(io.env);
  const map = { ...(config.sources[rawSource].categoryMap ?? {}) };
  if (remove) delete map[id];
  else map[id] = rawCategory as Category;
  config.sources[rawSource] = { ...config.sources[rawSource], categoryMap: Object.keys(map).length > 0 ? map : undefined };
  if (!config.sources[rawSource].categoryMap) delete config.sources[rawSource].categoryMap;
  await saveConfig(config, io.env);
  io.stdout(
    remove
      ? `Removed the category mapping for ${id} (${sourceLabel(rawSource)}).\n`
      : `${sourceLabel(rawSource)}: usage from ${id} will be counted as "${rawCategory}". The id stays on this machine.\n`,
  );
  io.stdout("Run `tokenrank-collector sync --full` to re-categorise past days.\n");
  return 0;
}

// --- logout -----------------------------------------------------------------

export async function logoutCommand(args: string[], io: CliIO): Promise<number> {
  const { values } = parse(args, {});
  if (values.help) {
    io.stdout("Usage: tokenrank-collector logout\n\nRemove the TokenRank token from the local config.\n");
    return 0;
  }
  const config = await loadConfig(io.env);
  if (!config.token) {
    io.stdout("Not logged in.\n");
    return 0;
  }
  delete config.token;
  await saveConfig(config, io.env);
  io.stdout("Logged out: the token was removed from the local config. Revoke it from your TokenRank settings page to invalidate it server-side.\n");
  return 0;
}
