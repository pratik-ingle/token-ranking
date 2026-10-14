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

// ---------------------------------------------------------------------------
// Random usernames: adjective_noun_NN. Words are short (≤ 9 chars) so every
// combination fits in 24 characters, and they're checked against the
// reserved and profanity rules on generation anyway.
// ---------------------------------------------------------------------------

export const USERNAME_ADJECTIVES = [
  "amber", "brave", "brisk", "calm", "candid", "clever", "cosmic", "crisp", "curious", "dapper", "eager", "fancy",
  "fuzzy", "gentle", "glossy", "golden", "happy", "hasty", "hidden", "humble", "icy", "jolly", "keen", "lively",
  "lucky", "lunar", "mellow", "mighty", "misty", "nimble", "noble", "odd", "plucky", "polar", "proud", "quick",
  "quiet", "rapid", "rustic", "shiny", "silent", "sleepy", "snowy", "solar", "spry", "steady", "sunny", "swift",
  "tidy", "tiny", "turbo", "vivid", "wild", "witty", "zesty",
] as const;

export const USERNAME_NOUNS = [
  "otter", "falcon", "panda", "koala", "badger", "heron", "lynx", "raven", "walrus", "yak", "comet", "nebula",
  "photon", "quasar", "rocket", "glider", "kernel", "token", "vector", "tensor", "parser", "socket", "lambda",
  "pixel", "cactus", "maple", "willow", "pebble", "harbor", "meadow", "canyon", "breeze", "ember", "acorn",
  "puffin", "gecko", "marmot", "beaver", "moose", "orca", "pelican", "sparrow", "tortoise", "wombat", "dingo",
] as const;

function defaultRandom(): number {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } }).crypto;
  if (c?.getRandomValues) return c.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
  return Math.random();
}

/**
 * A random `adjective_noun_NN` that passes validateUsername (pattern,
 * length, reserved names, profanity). `random` is injectable for tests.
 */
export function generateUsername(random: () => number = defaultRandom): string {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length) % xs.length]!;
  for (let attempt = 0; attempt < 50; attempt++) {
    const adjective = pick(USERNAME_ADJECTIVES);
    const noun = pick(USERNAME_NOUNS);
    const n = String(Math.floor(random() * 100) % 100).padStart(2, "0");
    const name = `${adjective}_${noun}_${n}`;
    if (validateUsername(name).ok) return name;
  }
  return `quiet_otter_${String(Math.floor(random() * 100) % 100).padStart(2, "0")}`;
}
