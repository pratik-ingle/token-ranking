/**
 * Usernames: 3–24 chars of a–z, 0–9 and underscore. Input is lower-cased.
 * We reject reserved route/brand names and obvious profanity (including
 * simple leetspeak). The list is intentionally small and conservative.
 */

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;

export const RESERVED_USERNAMES = new Set([
  "about", "account", "admin", "administrator", "anonymous", "api", "app", "auth", "billing",
  "blog", "contact", "dashboard", "delete", "device", "docs", "everyone", "explore", "faq",
  "guest", "help", "home", "import", "info", "leaderboard", "login", "logout", "me", "mod",
  "moderator", "new", "nobody", "null", "official", "onboarding", "owner", "privacy", "profile",
  "recover", "register", "report", "root", "security", "settings", "signin", "signout", "signup",
  "staff", "status", "support", "system", "team", "terms", "test", "tokenrank", "tokenrank_admin",
  "u", "undefined", "user", "users", "verify", "www", "you", "openai", "anthropic", "claude",
  "cursor", "codex", "gemini", "chatgpt",
]);

// Strong words are matched as substrings after normalisation; ambiguous ones
// ("cock" in "peacock", "rape" in "grapefruit") only as whole tokens split on
// underscores/digits. Kept short on purpose; moderation handles the rest.
const BLOCKED_SUBSTRINGS = [
  "fuck", "shit", "cunt", "nigg", "faggot", "hitler", "whore", "retard", "pussy", "asshole", "porn",
];
const BLOCKED_TOKENS = new Set([
  "rape", "rapist", "nazi", "slut", "bitch", "kike", "spic", "chink", "pedo", "dick", "cock", "fag", "sex",
]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g" };

function deLeet(s: string): string {
  return s.replace(/[0-9]/g, (ch) => LEET[ch] ?? ch).replace(/_/g, "");
}

function hasBlockedToken(username: string): boolean {
  return username
    .split(/[_0-9]+/)
    .filter(Boolean)
    .some((t) => BLOCKED_TOKENS.has(t) || (t.endsWith("s") && BLOCKED_TOKENS.has(t.slice(0, -1))));
}

export type UsernameError = "length" | "charset" | "reserved" | "profanity";

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function validateUsername(input: string): { ok: true; username: string } | { ok: false; error: UsernameError; message: string } {
  const username = normalizeUsername(input);
  if (username.length < 3 || username.length > 24) {
    return { ok: false, error: "length", message: "Username must be 3–24 characters." };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "charset", message: "Use only lowercase letters, numbers and underscores." };
  }
  if (RESERVED_USERNAMES.has(username) || RESERVED_USERNAMES.has(username.replace(/_/g, ""))) {
    return { ok: false, error: "reserved", message: "That username is reserved." };
  }
  const plain = username.replace(/_/g, "");
  const leet = deLeet(username);
  if (BLOCKED_SUBSTRINGS.some((w) => plain.includes(w) || leet.includes(w)) || hasBlockedToken(username)) {
    return { ok: false, error: "profanity", message: "Please choose a different username." };
  }
  return { ok: true, username };
}
