/**
 * tokenrank-collector as a library (used by tokenrank-mcp).
 * Nothing in here writes to stdout; progress goes through `log` callbacks.
 */
export { version } from "../package.json";
export { runSync, ADMIN_FIRST_SYNC_DAYS, ADMIN_OVERLAP_DAYS } from "./sync";
export type { RunSyncOptions, SyncSummary, SourceSummary } from "./sync";
export {
  COLLECTOR_SOURCES,
  LOCAL_SOURCES,
  ADMIN_SOURCES,
  DEFAULT_SERVER,
  ConfigError,
  configDir,
  configPath,
  defaultConfig,
  enabledSources,
  loadConfig,
  normalizeConfig,
  normalizeServerUrl,
  redactConfig,
  resolveAuth,
  saveConfig,
  updateConfig,
} from "./config";
export type { CollectorConfig, CollectorSource, ResolvedAuth } from "./config";
export { ApiError, NotLoggedInError, TokenRankClient, LOGIN_HINT, USER_AGENT, isAuthError } from "./api";
export type { ApiClientOptions, ApiErrorCode, MeResponse, HeartbeatBody, HeartbeatResponse, DeviceTokenResult } from "./api";
export { compileFieldSpec, extractFields } from "./json-extract";
export type { FieldSpec, FieldSpecOptions } from "./json-extract";
export { ClaudeCodeParser, parseClaudeCode, CLAUDE_CODE_FIELD_PATHS, isClaudeTranscriptName } from "./parsers/claude-code";
export type { ClaudeCodeEvent, ClaudeCodeStats } from "./parsers/claude-code";
export { CodexParser, parseCodex, CODEX_FIELD_PATHS, codexDeltaToCounts, isCodexRolloutName } from "./parsers/codex";
export type { CodexEvent, CodexStats } from "./parsers/codex";
export type { LocalParseOptions, LocalParseResult, TokenCounts } from "./parsers/types";
export { claudeRoots, claudeScanDirs, codexHome, tokenrankHome } from "./paths";
export type { Env } from "./paths";
export { detectLocalSources, ADMIN_KEY_ENV } from "./sources";
export { formatRank, formatSyncSummary } from "./format";
export { main } from "./main";
