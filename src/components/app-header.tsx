"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Loader2, LogOut } from "lucide-react";
import { signOut } from "@/server/actions/auth";
import { cn } from "@/lib/utils";

/** Submit button for the sign-out form, with an in-flight spinner. Distinct from
 *  the Rates nav link: an icon-led account action, not a section tab. */
function SignOutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
      ) : (
        <LogOut className="h-3.5 w-3.5" strokeWidth={1.75} />
      )}
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

/**
 * The app top bar. Client-side so the active section reads from the current
 * route (`usePathname`) and gets a flush 2px ink underline — the one nav cue.
 * `usePathname` resolves the same value on the server render and the client, so
 * there is no hydration mismatch.
 */
export function AppHeader({ showSignOut = true }: { showSignOut?: boolean }) {
  const pathname = usePathname() ?? "/";
  const onRates = pathname.startsWith("/rates");
  const onDocs = pathname.startsWith("/docs");
  const onQuote = !onRates && !onDocs;

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
                onQuote
                  ? "border-ink font-medium text-ink"
                  : "border-transparent font-medium text-ink-muted hover:text-ink",
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
          <div className="flex items-center gap-4">
            <Link
              href="/q/AW-Q-2609-042"
              className={cn(tab, "border-transparent text-ink-subtle hover:text-ink")}
            >
              Client view
            </Link>
            <Link
              href="/docs"
              className={cn(
                tab,
                onDocs
                  ? "border-ink font-medium text-ink"
                  : "border-transparent text-ink-subtle hover:text-ink",
              )}
            >
              Docs
            </Link>
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
            <span className="h-4 w-px bg-hairline" aria-hidden />
            <form action={signOut}>
              <SignOutButton />
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
