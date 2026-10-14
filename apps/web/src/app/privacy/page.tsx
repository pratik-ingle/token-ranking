import { UNSUPPORTED_INTEGRATIONS, USAGE_ROW_FIELDS } from "@tokenrank/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Privacy" };

const FIELD_DESCRIPTIONS: Record<(typeof USAGE_ROW_FIELDS)[number], string> = {
  date: "The calendar day (in your chosen timezone) the usage happened, e.g. 2026-03-04. No times.",
  source: "Which tool or API: openai_api, anthropic_api, claude_code, cursor, codex_cli, gemini or other.",
  model: "The model name the provider reported, e.g. claude-sonnet-4-5. Restricted to a short identifier with no spaces.",
  category: "coding, chat, image_generation, audio, embeddings, agents or other — decided by the tool or endpoint type, never by reading content.",
  input_tokens: "Number of input tokens (excluding cache).",
  output_tokens: "Number of output tokens.",
  cache_read_tokens: "Number of tokens read from a prompt cache.",
  cache_write_tokens: "Number of tokens written to a prompt cache.",
  request_count: "Number of requests.",
  image_count: "Number of images generated.",
};

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 [&_h2]:mt-2 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_p]:leading-7 [&_ul]:list-disc [&_ul]:pl-5">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy, in plain English</h1>
        <p className="text-muted-foreground">
          TokenRank exists to compare how many AI tokens people use. To do that we need numbers, not words. So numbers are all we take.
        </p>
      </header>

      <section className="space-y-3">
        <h2>Exactly what we collect about your usage</h2>
        <p>
          One row per day, per source, per model, per category. Each row has these ten fields and nothing else. Our upload API rejects
          any row that contains any other field.
        </p>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {USAGE_ROW_FIELDS.map((f) => (
                  <tr key={f} className="border-b last:border-0">
                    <td className="w-44 px-4 py-2 align-top"><code className="text-xs">{f}</code></td>
                    <td className="px-4 py-2 text-muted-foreground">{FIELD_DESCRIPTIONS[f]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Alongside each row we record whether it is <em>verified</em> (we pulled it from a provider API ourselves) or <em>self-reported</em>,
          when it was last updated, and whether it is held for review because it exceeded a sanity limit.
        </p>
      </section>

      <section className="space-y-2">
        <h2>What we never collect</h2>
        <ul>
          <li>Prompts, responses, code, file contents, file paths, tool calls or anything else you typed or an AI wrote.</li>
          <li>Your real name, photo, or (unless you choose to add one for recovery) email address.</li>
          <li>Billing details, costs, or organization / team member information.</li>
          <li>Provider organization ids, project names, API key names or workspace names. If we need to tell whether two accounts connected
            the same organization, we keep only a keyed hash (HMAC-SHA256) of it.</li>
          <li>Your IP address in our database or logs. We use it only in memory for rate limiting, and forget it within minutes.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Your account</h2>
        <ul>
          <li>Sign-up needs only a username plus a passkey (or a password). Your avatar is generated from your username.</li>
          <li>A recovery email is optional. We store only an HMAC of it, so we can match it when you ask for a recovery link but can&apos;t
            read it, show it or use it for anything else.</li>
          <li>Sessions are stored as hashes of a random cookie value. No device fingerprinting, no user-agent, no IP.</li>
          <li>No analytics, ads or third-party trackers.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>How your numbers get here</h2>
        <ul>
          <li><strong>Local collector (default, recommended).</strong> The open-source <code>tokenrank-collector</code> CLI runs on your computer,
            reads only token counts from local logs (Claude Code, Codex CLI) or from provider usage APIs, adds them up per day on your machine,
            and uploads only the rows described above. Provider API keys never leave your machine.{" "}
            <code>tokenrank-collector sync --dry-run</code> prints the exact payload before anything is sent.</li>
          <li><strong>CSV import.</strong> Files (e.g. Cursor&apos;s usage export) are parsed in your browser; only daily totals are uploaded.</li>
          <li><strong>Optional cloud sync.</strong> If you paste a provider admin key, we encrypt it with a key unique to you (envelope encryption with
            a master key held outside the database), never log it, never send it back to your browser, and you can revoke it in one click.
            Admin keys are powerful; we recommend the local collector instead.</li>
          <li><strong>OpenTelemetry.</strong> If you point Claude Code&apos;s metrics at us, we read only the token-usage counter and its model, and
            drop every identity attribute (email, account, organization, session).</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Your choices</h2>
        <ul>
          <li><strong>Public</strong> (default): listed on the leaderboard with your username.</li>
          <li><strong>Hidden</strong>: not listed and your profile isn&apos;t visible to others; you still see the rank you would have.</li>
          <li><strong>Export</strong>: download everything we hold about you as JSON from Settings.</li>
          <li><strong>Delete</strong>: hard-deletes your account and all of its data in the same request, including leaderboard snapshots.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2>What we don&apos;t support, and why</h2>
        <ul>
          {UNSUPPORTED_INTEGRATIONS.map((u) => <li key={u.name}><strong>{u.name}:</strong> {u.reason}</li>)}
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Audit it yourself</h2>
        <p>
          The collector and MCP server are open source, and so is this site. See the <Link href="/docs/api" className="text-primary hover:underline">API docs</Link>{" "}
          for the exact upload schema.
        </p>
      </section>
    </article>
  );
}
