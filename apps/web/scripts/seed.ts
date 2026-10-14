/**
 * Seeds ~500 fake users with a year of realistic daily usage so the
 * leaderboard, heatmaps and streaks look real in development.
 *
 *   pnpm db:seed            # refuses if users exist
 *   pnpm db:seed --reset    # wipes all users (cascades) first
 *
 * Deterministic (fixed PRNG seed). Also creates a `demo` user with password
 * `demo-password` for local login.
 */
import { addDays, localDate, normalizeModel, validateUsername, type Category, type Source, type TrustLevel } from "@tokenrank/shared";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { dailyUsage, integrations, users } from "../src/db/schema";
import { refreshViews } from "../src/db/views";
import { orgFingerprintHmac, sha256Hex } from "../src/server/crypto";
import { hashPassword } from "../src/server/password";
import { applyRuntimeSettings } from "../src/server/settings";
import { loadEnv } from "./load-env";

loadEnv();

const USER_COUNT = Number(process.env.SEED_USERS ?? 500);
const DAYS = 365;

// --- deterministic PRNG -----------------------------------------------------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261014);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;
function normal(): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
function weighted<T>(items: ReadonlyArray<readonly [T, number]>): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1]![0];
}

// --- vocab ------------------------------------------------------------------
const ADJ = ["quiet", "rapid", "lazy", "brave", "cosmic", "silent", "tiny", "mega", "neon", "lucky", "sleepy", "fuzzy", "hyper", "async", "atomic", "binary", "cached", "clever", "dark", "eager", "golden", "hidden", "iron", "jolly", "keen", "lunar", "mellow", "nimble", "octal", "pixel", "quantum", "rusty", "solar", "turbo", "ultra", "vivid", "wild", "zen", "agile", "bold"];
const NOUN = ["otter", "falcon", "panda", "koala", "lambda", "kernel", "token", "vector", "tensor", "parser", "monad", "pointer", "socket", "daemon", "badger", "heron", "lynx", "raven", "walrus", "yak", "comet", "nebula", "photon", "quasar", "glider", "rocket", "compiler", "linter", "runner", "hacker", "coder", "builder", "tinker", "wizard", "ninja", "pilot", "sage", "smith", "crafter", "dev"];
const TIMEZONES: ReadonlyArray<readonly [string, number]> = [
  ["America/Los_Angeles", 16], ["America/New_York", 16], ["America/Chicago", 6], ["America/Sao_Paulo", 4],
  ["Europe/London", 9], ["Europe/Berlin", 9], ["Europe/Paris", 5], ["Europe/Warsaw", 3],
  ["Asia/Kolkata", 10], ["Asia/Tokyo", 5], ["Asia/Shanghai", 4], ["Asia/Singapore", 3], ["Asia/Seoul", 3],
  ["Australia/Sydney", 3], ["Africa/Lagos", 2], ["UTC", 2],
];

type Persona = "claude_coder" | "cursor_user" | "codex_user" | "api_builder" | "polyglot" | "casual";
const PERSONAS: ReadonlyArray<readonly [Persona, number]> = [
  ["claude_coder", 28], ["cursor_user", 22], ["codex_user", 10], ["api_builder", 14], ["polyglot", 12], ["casual", 14],
];

interface SourcePlan {
  source: Source;
  share: number;
  models: ReadonlyArray<readonly [string, number]>;
}

const MODELS: Record<Source, ReadonlyArray<readonly [string, number]>> = {
  claude_code: [["claude-sonnet-4-5", 5], ["claude-opus-4-5", 3], ["claude-haiku-4-5", 2], ["claude-sonnet-5-5", 4], ["claude-opus-5-5", 3]],
  cursor: [["claude-4.5-sonnet", 4], ["gpt-5", 3], ["auto", 3], ["composer-1", 2], ["gemini-2.5-pro", 1]],
  codex_cli: [["gpt-5-codex", 4], ["gpt-5.1-codex", 3], ["gpt-5", 1]],
  openai_api: [["gpt-4.1-mini", 3], ["gpt-5", 3], ["gpt-5-mini", 4], ["gpt-4o", 2]],
  anthropic_api: [["claude-sonnet-4-5", 4], ["claude-haiku-4-5", 4], ["claude-opus-4-5", 1], ["claude-sonnet-5-5", 2]],
  gemini: [["gemini-2.5-pro", 3], ["gemini-2.5-flash", 4]],
  other: [["llama-3.3-70b", 2], ["qwen3-coder", 2], ["mistral-large", 1]],
};

function plansFor(persona: Persona): SourcePlan[] {
  const p = (source: Source, share: number): SourcePlan => ({ source, share, models: MODELS[source] });
  switch (persona) {
    case "claude_coder":
      return chance(0.3) ? [p("claude_code", 0.85), p("anthropic_api", 0.15)] : [p("claude_code", 1)];
    case "cursor_user":
      return chance(0.35) ? [p("cursor", 0.8), p("openai_api", 0.2)] : [p("cursor", 1)];
    case "codex_user":
      return chance(0.5) ? [p("codex_cli", 0.7), p("openai_api", 0.3)] : [p("codex_cli", 1)];
    case "api_builder":
      return [p("openai_api", 0.55), p("anthropic_api", 0.35), ...(chance(0.4) ? [p("gemini", 0.1)] : [])];
    case "polyglot":
      return [p("claude_code", 0.4), p("cursor", 0.25), p("codex_cli", 0.15), p("openai_api", 0.1), p("other", 0.1)];
    case "casual":
      return [p(pick(["cursor", "openai_api", "gemini", "claude_code"] as const), 1)];
  }
}

interface Row {
  userId: string;
  date: string;
  source: Source;
  model: string;
  category: Category;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  requestCount: number;
  imageCount: number;
  trustLevel: TrustLevel;
  flagged: boolean;
}

function generateUsage(userId: string, persona: Persona, tz: string, verifiedApi: boolean, joinedDaysAgo: number): Row[] {
  const today = localDate(Date.now(), tz);
  const plans = plansFor(persona);
  // Daily non-cache volume: log-normal, heavy-tailed.
  const mu = persona === "casual" ? 10.5 : 12.6;
  const scale = Math.exp(mu + normal() * 1.3);
  const baseActive = persona === "casual" ? 0.15 + rand() * 0.25 : 0.45 + rand() * 0.5;
  const weekendFactor = 0.35 + rand() * 0.6;
  const rows: Row[] = [];
  let activeYesterday = false;
  let vacation = 0;
  const start = Math.min(DAYS - 1, joinedDaysAgo);

  for (let i = start; i >= 0; i--) {
    const date = addDays(today, -i);
    if (vacation > 0) {
      vacation--;
      activeYesterday = false;
      continue;
    }
    if (chance(0.006)) vacation = 3 + Math.floor(rand() * 12);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    let p = baseActive * (dow === 0 || dow === 6 ? weekendFactor : 1);
    p = activeYesterday ? Math.min(0.98, p + 0.25) : p * 0.8;
    if (!chance(p)) {
      activeYesterday = false;
      continue;
    }
    activeYesterday = true;
    // Usage grows through the year; individual days vary a lot.
    const growth = 0.5 + 1.0 * ((DAYS - i) / DAYS);
    const dayVolume = scale * growth * Math.exp(normal() * 0.7);

    for (const plan of plans) {
      if (plan.share < 1 && !chance(0.4 + plan.share)) continue;
      const vol = dayVolume * plan.share;
      const nModels = 1 + (chance(0.35) ? 1 : 0) + (chance(0.1) ? 1 : 0);
      for (let m = 0; m < nModels; m++) {
        const model = normalizeModel(weighted(plan.models));
        const part = vol / nModels;
        const input = Math.round(part * (0.25 + rand() * 0.3));
        const output = Math.round(part - input);
        let cacheRead = 0;
        let cacheWrite = 0;
        if (plan.source === "claude_code") {
          cacheRead = Math.round(part * (12 + rand() * 25));
          cacheWrite = Math.round(part * (1 + rand() * 2.5));
        } else if (plan.source === "cursor" || plan.source === "codex_cli") {
          cacheRead = Math.round(part * (3 + rand() * 8));
          cacheWrite = plan.source === "cursor" ? Math.round(part * rand() * 1.5) : 0;
        } else if (plan.source === "anthropic_api") {
          cacheRead = Math.round(part * rand() * 3);
          cacheWrite = Math.round(part * rand() * 0.5);
        } else if (plan.source === "openai_api") {
          cacheRead = Math.round(input * rand() * 0.6);
        }
        const trust: TrustLevel = verifiedApi && (plan.source === "openai_api" || plan.source === "anthropic_api") ? "verified" : "self_reported";
        const category: Category =
          plan.source === "claude_code" || plan.source === "cursor" || plan.source === "codex_cli"
            ? "coding"
            : weighted([["chat", 6], ["agents", 2], ["coding", 1]] as const);
        rows.push({
          userId, date, source: plan.source, model, category,
          inputTokens: Math.max(0, input), outputTokens: Math.max(0, output),
          cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite,
          requestCount: Math.max(1, Math.round(part / (1500 + rand() * 6000))),
          imageCount: 0, trustLevel: trust, flagged: false,
        });
      }
      if (plan.source === "openai_api" && chance(0.15)) {
        rows.push({
          userId, date, source: "openai_api", model: "text-embedding-3-small", category: "embeddings",
          inputTokens: Math.round(vol * (0.5 + rand())), outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          requestCount: 1 + Math.floor(rand() * 40), imageCount: 0, trustLevel: verifiedApi ? "verified" : "self_reported", flagged: false,
        });
      }
      if (plan.source === "openai_api" && chance(0.06)) {
        const images = 1 + Math.floor(rand() * 12);
        rows.push({
          userId, date, source: "openai_api", model: "gpt-image-1", category: "image_generation",
          inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          requestCount: images, imageCount: images, trustLevel: verifiedApi ? "verified" : "self_reported", flagged: false,
        });
      }
    }
  }
  // Merge rows that landed on the same key (same model picked twice in a day).
  const merged = new Map<string, Row>();
  for (const r of rows) {
    const key = `${r.date}|${r.source}|${r.model}|${r.category}`;
    const prev = merged.get(key);
    if (!prev) {
      merged.set(key, { ...r });
      continue;
    }
    prev.inputTokens += r.inputTokens;
    prev.outputTokens += r.outputTokens;
    prev.cacheReadTokens += r.cacheReadTokens;
    prev.cacheWriteTokens += r.cacheWriteTokens;
    prev.requestCount += r.requestCount;
    prev.imageCount += r.imageCount;
  }
  return [...merged.values()];
}

// --- main -------------------------------------------------------------------
const db = getDb();
const reset = process.argv.includes("--reset");
const existing = Number((await db.execute(sql`SELECT count(*)::int AS n FROM users`) as unknown as { rows: { n: number }[] }).rows[0]?.n ?? 0);
if (existing > 0 && !reset) {
  console.error(`Database already has ${existing} users. Re-run with --reset to wipe and reseed.`);
  await closeDb();
  process.exit(1);
}
if (reset) {
  await db.execute(sql`TRUNCATE users CASCADE`);
  console.log("Wiped existing users.");
}
await applyRuntimeSettings(db);

const usernames = new Set<string>(["demo"]);
while (usernames.size < USER_COUNT) {
  const style = rand();
  const name =
    style < 0.45 ? `${pick(ADJ)}_${pick(NOUN)}`
    : style < 0.75 ? `${pick(NOUN)}${Math.floor(rand() * 999)}`
    : style < 0.9 ? `${pick(ADJ)}${pick(NOUN)}`
    : `${pick(NOUN)}_${pick(NOUN)}_${Math.floor(rand() * 99)}`;
  if (validateUsername(name).ok) usernames.add(name);
}

const demoPassword = await hashPassword("demo-password");
const userRows = [...usernames].map((username, i) => ({
  username,
  passwordHash: username === "demo" ? demoPassword : null,
  webauthnUserId: randomBytes(16).toString("base64url"),
  visibility: (username === "demo" || i % 13 !== 7 ? "public" : "hidden") as "public" | "hidden",
  timezone: username === "demo" ? "Asia/Kolkata" : weighted(TIMEZONES),
  createdAt: new Date(Date.now() - Math.floor(rand() * DAYS) * 86_400_000),
}));
const inserted = await db.insert(users).values(userRows).returning({ id: users.id, username: users.username, timezone: users.timezone, createdAt: users.createdAt });
console.log(`Inserted ${inserted.length} users.`);

let total = 0;
let batch: Row[] = [];
const integrationRows: (typeof integrations.$inferInsert)[] = [];
const flush = async () => {
  if (!batch.length) return;
  await db.insert(dailyUsage).values(batch);
  total += batch.length;
  batch = [];
};

const personaOf = new Map<string, Persona>();
for (const u of inserted) {
  const persona: Persona = u.username === "demo" ? "polyglot" : weighted(PERSONAS);
  personaOf.set(u.id, persona);
  const verifiedApi = (persona === "api_builder" || persona === "polyglot") && chance(0.45);
  const joinedDaysAgo = Math.floor((Date.now() - u.createdAt.getTime()) / 86_400_000) + Math.floor(rand() * 60);
  const rows = generateUsage(u.id, persona, u.timezone, verifiedApi, joinedDaysAgo);
  for (const r of rows) {
    batch.push(r);
    if (batch.length >= 2000) await flush();
  }
  const sources = new Set(rows.map((r) => r.source));
  for (const s of sources) {
    const cloud = verifiedApi && (s === "openai_api" || s === "anthropic_api");
    const last = rows.filter((r) => r.source === s).at(-1)?.date;
    integrationRows.push({
      userId: u.id,
      source: s,
      mode: cloud ? "cloud" : "local",
      status: "active",
      statusDetail: cloud ? "seed data (no credentials)" : null,
      lastSyncedAt: last ? new Date(`${last}T12:00:00Z`) : null,
      orgFingerprintHmac: cloud ? orgFingerprintHmac(sha256Hex(`${s}:seed-org-${u.id}`)) : null,
    });
  }
}
await flush();
await db.insert(integrations).values(integrationRows);
console.log(`Inserted ${total} daily usage rows and ${integrationRows.length} integrations.`);

// --- integrity scenarios ------------------------------------------------------
// 1. Outliers: a few absurd days, flagged for review (excluded from ranking).
const outliers = inserted.filter((u) => u.username !== "demo").slice(10, 13);
for (const u of outliers) {
  const date = addDays(localDate(Date.now(), u.timezone), -3);
  await db
    .insert(dailyUsage)
    .values({
      userId: u.id, date, source: "claude_code", model: "claude-opus-5-5", category: "coding",
      inputTokens: 2_000_000_000, outputTokens: 1_000_000_000, cacheReadTokens: 40_000_000_000, cacheWriteTokens: 5_000_000_000,
      requestCount: 90_000, imageCount: 0, trustLevel: "self_reported", flagged: true,
    })
    .onConflictDoNothing();
}
console.log(`Flagged outlier days for: ${outliers.map((u) => u.username).join(", ")}`);

// 2. Duplicate org: two accounts connected the same OpenAI org; the later one is excluded.
const apiUsers = inserted.filter((u) => personaOf.get(u.id) === "api_builder").slice(0, 2);
if (apiUsers.length === 2) {
  const fp = orgFingerprintHmac(sha256Hex("openai_api:seed-shared-org"));
  for (const [i, u] of apiUsers.entries()) {
    await db.execute(sql`
      UPDATE integrations SET org_fingerprint_hmac = ${fp}, status = ${i === 0 ? "active" : "duplicate"},
        status_detail = ${i === 0 ? null : "This provider organization is already connected to another account."}
      WHERE user_id = ${u.id} AND source = 'openai_api'`);
  }
  console.log(`Duplicate-org scenario: ${apiUsers[1]!.username} duplicates ${apiUsers[0]!.username} (openai_api).`);
}

// 3. Ties: copy one user's usage onto another so they share a rank.
const [tieA, tieB] = inserted.filter((u) => u.username !== "demo" && personaOf.get(u.id) === "claude_coder").slice(5, 7);
if (tieA && tieB) {
  await db.execute(sql`DELETE FROM daily_usage WHERE user_id = ${tieB.id}`);
  await db.execute(sql`
    INSERT INTO daily_usage (user_id, date, source, model, category, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, request_count, image_count, trust_level, flagged)
    SELECT ${tieB.id}, date, source, model, category, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, request_count, image_count, trust_level, flagged
    FROM daily_usage WHERE user_id = ${tieA.id}`);
  await db.execute(sql`UPDATE users SET timezone = ${tieA.timezone}, visibility = 'public' WHERE id IN (${tieA.id}, ${tieB.id})`);
  console.log(`Tie scenario: ${tieA.username} and ${tieB.username} have identical usage.`);
}

const ms = await refreshViews(db);
console.log(`Refreshed leaderboards in ${ms} ms.`);
console.log('Log in locally as "demo" with password "demo-password".');
await closeDb();
