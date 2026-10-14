import { formatInteger, formatTokens, UNSUPPORTED_INTEGRATIONS, USAGE_ROW_FIELDS } from "@tokenrank/shared";
import { EyeOff, HardDrive, KeyRound, ShieldCheck, Trash2, Terminal } from "lucide-react";
import Link from "next/link";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <section className="grid items-start gap-10 pt-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6 lg:pt-12">
          <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" /> Token counts only. Never prompts.
          </p>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">How many AI tokens do you burn?</h1>
          <p className="max-w-xl text-lg text-muted-foreground">
            A global leaderboard for Claude Code, Cursor, Codex, OpenAI and Anthropic usage, with a GitHub-style heatmap of your
            streaks. Anonymous by default, private by design.
          </p>
          <div className="flex flex-wrap gap-3">
            {user ? (
              <Link href="/onboarding" className={buttonVariants({ size: "lg" })}>Connect a tool</Link>
            ) : (
              <Link href="/signup" className={buttonVariants({ size: "lg" })}>Get your rank</Link>
            )}
            <Link href="/leaderboard" className={buttonVariants({ size: "lg", variant: "outline" })}>See the leaderboard</Link>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 font-mono text-sm text-muted-foreground">
            <Terminal className="size-4" /> npx tokenrank-collector login
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Tokens tracked" value={formatTokens(stats.total_tokens)} hint={`${formatTokens(stats.total_tokens_nocache)} excluding cache`} />
          <Stat label="Members" value={formatInteger(stats.user_count)} hint={`${formatInteger(stats.active_users)} with usage data`} />
          <Card className="col-span-2">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Top 10 · last 30 days</CardTitle>
              <Link href="/leaderboard" className="text-sm text-primary hover:underline">Full board →</Link>
            </CardHeader>
            <CardContent>
              <LeaderboardTable rows={top.map((entry) => ({ kind: "entry" as const, entry }))} compact me={user?.username} topTotal={top[0]?.total_tokens ?? 0} caption="Top 10 in the last 30 days" />
            </CardContent>
          </Card>
        </div>
      </section>

      <section id="privacy" className="space-y-6">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-2xl font-semibold tracking-tight">How privacy works</h2>
          <p className="text-muted-foreground">
            The only usage data we store is one row per day, per source, per model and per category with these fields:
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {USAGE_ROW_FIELDS.map((f) => (
              <code key={f} className="rounded-md border bg-card px-1.5 py-0.5 text-xs">{f}</code>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            The ingestion API rejects any payload with an extra field. <Link href="/privacy" className="text-primary hover:underline">Read the full privacy page</Link>.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRIVACY_POINTS.map((p) => (
            <Card key={p.title}>
              <CardHeader>
                <p.icon className="size-5 text-primary" />
                <CardTitle className="text-base">{p.title}</CardTitle>
                <CardDescription>{p.body}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Not supported yet: </span>
          {UNSUPPORTED_INTEGRATIONS.map((u) => u.name).join(" and ")}. Neither offers a token-usage API, and their data
          exports contain your full conversations, which we will not ask you to upload.
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
