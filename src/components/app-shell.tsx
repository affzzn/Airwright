import Link from "next/link";
import { signOut } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";

/** Minimal top bar + centred content column. Hairline divider, no shadow. */
export function AppShell({
  children,
  showSignOut = true,
}: {
  children: React.ReactNode;
  showSignOut?: boolean;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-content items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
              Airwright
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/"
                className="text-sm font-medium text-ink"
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
                className="text-sm text-ink-subtle transition-colors hover:text-ink"
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
      <main className="mx-auto max-w-content px-6 py-10">{children}</main>
    </div>
  );
}
