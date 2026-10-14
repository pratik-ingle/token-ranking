import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

// Variable Archivo with the width axis (62–125): condensed numbers, expanded wordmark.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  title: { default: "TokenRank — the privacy-first AI token leaderboard", template: "%s · TokenRank" },
  description:
    "See how many AI tokens you burn compared to everyone else. We only ever collect token counts — never prompts, responses, names or emails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="min-h-dvh">
        <ToastProvider>
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
        </ToastProvider>
      </body>
    </html>
  );
}
