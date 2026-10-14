import { formatInteger, formatTokens, UNSUPPORTED_INTEGRATIONS, USAGE_ROW_FIELDS } from "@tokenrank/shared";
import { EyeOff, HardDrive, KeyRound, Trash2 } from "lucide-react";
import Link from "next/link";
import { CodeLine } from "@/components/copy-button";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { Odometer } from "@/components/odometer";
import { buttonVariants } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getGlobalStats, getTopUsers } from "@/server/leaderboard";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

const PRIVACY_POINTS = [
  { icon: HardDrive, title: "Counted on your machine", body: "The open-source collector reads token counts from your local logs or provider usage APIs and uploads daily totals. Your API keys stay on your machine." },
  { icon: EyeOff, title: "Never your prompts", body: "We never request, parse, store or log prompt or response text. Integrations that would need it are out of scope." },
  { icon: KeyRound, title: "Username + passkey", body: "No real name, no photo, no email required. Avatars are generated from your username." },
  { icon: Trash2, title: "Leave any time", body: "Hide yourself from the leaderboard, export everything as JSON, or hard-delete your account in one click." },
];

export default async function HomePage() {
  const db = getDb();
  const [stats, top, user] = await Promise.all([getGlobalStats(db), getTopUsers(db, 10, "30d"), getCurrentUser()]);
  return (
    <div className="space-y-16">
      <section aria-labelledby="hero-heading" className="space-y-10 pt-4">
        <div className="max-w-3xl space-y-5">
          <p className="text-sm font-medium text-ink-2">Token counts only. Never prompts.</p>
          <h1 id="hero-heading" className="font-expanded text-[clamp(32px,5.6vw,60px)] leading-[1.02] tracking-tight">
            How many AI tokens do you burn?
          </h1>
          <p className="max-w-2xl text-lg text-ink-2">
            A global leaderboard for Claude Code, Cursor, Codex, OpenAI and Anthropic usage, with a heatmap of your streaks. Anonymous by
            default, private by design.
          </p>
          <div className="flex flex-wrap gap-3">
            {user ? (
              <Link href="/onboarding" className={buttonVariants({ size: "lg" })}>Connect apps</Link>
            ) : (
              <Link href="/signup" className={buttonVariants({ size: "lg" })}>Get your rank</Link>
            )}
            <Link href="/leaderboard" className={buttonVariants({ size: "lg", variant: "outline" })}>See the leaderboard</Link>
          </div>
          <div className="max-w-md">
            <CodeLine code="npx tokenrank-collector login" />
          </div>
        </div>

        <div className="space-y-3">
          <Odometer value={stats.total_tokens} />
          <p className="text-sm text-ink-2">
            tokens burned by everyone on TokenRank so far · {formatInteger(stats.active_users)}{" "}
            {stats.active_users === 1 ? "person" : "people"} · {formatTokens(stats.total_tokens_nocache)} excluding cache
          </p>
        </div>
      </section>

      <section aria-labelledby="top-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="top-heading" className="text-[22px] font-semibold">Top 10 · last 30 days</h2>
          <Link href="/leaderboard" className="text-sm font-medium underline-offset-4 hover:underline">Full leaderboard →</Link>
        </div>
        <LeaderboardTable
          rows={top.map((entry) => ({ kind: "entry" as const, entry }))}
          compact
          me={user?.username}
          topTotal={top[0]?.total_tokens ?? 0}
          caption="Top 10 by tokens in the last 30 days, including cache tokens."
        />
      </section>

      <section id="privacy" aria-labelledby="privacy-heading" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 id="privacy-heading" className="text-[22px] font-semibold">How privacy works</h2>
          <p className="text-ink-2">The only usage data we store is one row per day, per app, per model and per category, with these fields:</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {USAGE_ROW_FIELDS.map((f) => (
              <code key={f} className="rounded-md border bg-card px-1.5 py-0.5 text-xs">{f}</code>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            The ingestion API rejects any payload with an extra field.{" "}
            <Link href="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline">Read the full privacy page</Link>.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRIVACY_POINTS.map((p) => (
            <li key={p.title} className="space-y-2 rounded-xl border bg-card p-5">
              <p.icon className="size-5" aria-hidden />
              <h3 className="font-semibold">{p.title}</h3>
              <p className="text-sm text-ink-2">{p.body}</p>
            </li>
          ))}
        </ul>
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Not available yet: </span>
          {UNSUPPORTED_INTEGRATIONS.map((u) => u.name).join(" and ")}. Neither offers a token-usage API, and their data exports contain your full
          conversations, which we will not ask you to upload.
        </p>
      </section>
    </div>
  );
}
