import { Trophy } from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/server/session";
import { Identicon } from "./identicon";
import { LogoutButton } from "./logout-button";
import { buttonVariants } from "./ui/button";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Trophy className="size-4" />
          </span>
          TokenRank
        </Link>
        <nav className="flex items-center gap-4 text-sm text-muted-foreground">
          <Link href="/leaderboard" className="hover:text-foreground">Leaderboard</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Link href="/settings" className="hidden text-sm text-muted-foreground hover:text-foreground sm:block">Settings</Link>
              <Link href={`/u/${user.username}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted">
                <Identicon username={user.username} size={22} />
                {user.username}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Log in</Link>
              <Link href="/signup" className={buttonVariants({ size: "sm" })}>Join</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
