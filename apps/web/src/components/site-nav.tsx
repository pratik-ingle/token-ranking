"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

interface Tab {
  href: string;
  label: string;
  match: (path: string) => boolean;
}

/** Tab-style primary navigation; the current route gets a surface tab with an inset line. */
export function SiteNav({ username, className }: { username: string | null; className?: string }) {
  const pathname = usePathname() ?? "/";
  const tabs: Tab[] = [{ href: "/leaderboard", label: "Leaderboard", match: (p) => p.startsWith("/leaderboard") }];
  if (username) {
    tabs.push(
      { href: `/u/${username}`, label: "Your profile", match: (p) => p === `/u/${username}` },
      { href: "/onboarding", label: "Connect apps", match: (p) => p.startsWith("/onboarding") },
    );
  }
  return (
    <nav aria-label="Main" className={cn("overflow-x-auto", className)}>
      <ul className="flex min-w-max items-center gap-1">
        {tabs.map((t) => {
          const active = t.match(pathname);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  active
                    ? "bg-card text-foreground shadow-[inset_0_0_0_1px_var(--line)]"
                    : "text-ink-2 hover:bg-card/60 hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
