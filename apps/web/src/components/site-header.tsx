import Link from "next/link";
import { getCurrentUser } from "@/server/session";
import { LogoutButton } from "./logout-button";
import { SiteNav } from "./site-nav";
import { buttonVariants } from "./ui/button";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 min-[720px]:h-[var(--header-h)] min-[720px]:flex-nowrap">
        <Link href="/" className="order-1 py-3 font-expanded text-lg leading-none tracking-tight min-[720px]:py-0">
          TokenRank
        </Link>
        <SiteNav
          username={user?.username ?? null}
          className="order-3 -mx-4 w-[calc(100%+2rem)] border-t px-4 py-1.5 min-[720px]:order-2 min-[720px]:mx-0 min-[720px]:w-auto min-[720px]:border-t-0 min-[720px]:p-0"
        />
        <div className="order-2 ml-auto flex items-center gap-1 text-sm min-[720px]:order-3">
          {user ? (
            <>
              <span className="mr-2 truncate text-ink-2">
                <span className="hidden sm:inline">Signed in as </span>
                <strong className="font-semibold text-foreground">{user.username}</strong>
              </span>
              <Link href="/settings" className="rounded-md px-2 py-1.5 text-ink-2 hover:bg-card hover:text-foreground">
                Settings
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
