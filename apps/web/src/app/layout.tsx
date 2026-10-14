import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TokenRank — the privacy-first AI token leaderboard", template: "%s · TokenRank" },
  description:
    "See how many AI tokens you burn compared to everyone else. We only ever collect token counts — never prompts, responses, names or emails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <SiteHeader />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="border-t">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground">
            <span>TokenRank collects token counts only. Never prompts, responses, names or emails.</span>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/docs/api" className="hover:text-foreground">API &amp; connectors</Link>
            <Link href="/onboarding" className="hover:text-foreground">Open-source collector</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
