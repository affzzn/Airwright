"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The app top bar. Client-side so the active section reads from the current
 * route (`usePathname`) and gets a flush 2px ink underline — the one nav cue.
 * `usePathname` resolves the same value on the server render and the client, so
 * there is no hydration mismatch.
 */
export function AppHeader({ showSignOut = true }: { showSignOut?: boolean }) {
  const pathname = usePathname() ?? "/";
  const onRates = pathname.startsWith("/rates");

  // Full-height tab: a bottom border that overlaps the header's own hairline
  // (`-mb-px`) so the active underline sits flush on the divider.
  const tab = "inline-flex h-14 items-center border-b-2 -mb-px text-sm transition-colors";

  return (
    <header className="sticky top-0 z-10 border-b border-hairline bg-page/90 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-content items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            Airwright
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/"
              className={cn(
                tab,
                onRates
                  ? "border-transparent font-medium text-ink-muted hover:text-ink"
                  : "border-ink font-medium text-ink",
              )}
            >
              Quote &amp; Take-off
            </Link>
            <span className="cursor-default text-sm text-ink-subtle">
              Gang Pay &amp; Viability
            </span>
            <span className="cursor-default text-sm text-ink-subtle">
              House-Type Bank
            </span>
          </nav>
        </div>
        {showSignOut && (
          <div className="flex items-center gap-5">
            <Link
              href="/rates"
              className={cn(
                tab,
                onRates
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-ink-subtle hover:text-ink",
              )}
            >
              Rates
            </Link>
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
