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
          <Link href="/" className="flex items-baseline gap-2">
            <span className="text-sm font-700 font-semibold tracking-tight text-ink">
              Airwright
            </span>
            <span className="text-sm text-ink-subtle">Quote &amp; Take-off</span>
          </Link>
          {showSignOut && (
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-content px-6 py-10">{children}</main>
    </div>
  );
}
