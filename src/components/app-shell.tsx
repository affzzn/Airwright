import { AppHeader } from "@/components/app-header";

/**
 * Minimal top bar + content area. Hairline divider, no shadow.
 *
 * `variant="default"` (the norm): a centred column that scrolls with the page.
 * `variant="workspace"`: on desktop the main fills exactly the viewport below
 * the 3.5rem header and does NOT scroll — its children own their own scrolling
 * (the review screen: drawing fixed, take-off pane scrolls). Below `lg` it
 * falls back to natural height + page scroll, so mobile is unaffected.
 */
export function AppShell({
  children,
  showSignOut = true,
  variant = "default",
}: {
  children: React.ReactNode;
  showSignOut?: boolean;
  variant?: "default" | "workspace";
}) {
  return (
    <div className="min-h-screen bg-page">
      <AppHeader showSignOut={showSignOut} />
      {variant === "workspace" ? (
        <main className="lg:h-[calc(100vh-3.5rem)] lg:overflow-hidden">
          {children}
        </main>
      ) : (
        <main className="mx-auto max-w-content px-6 py-10">{children}</main>
      )}
    </div>
  );
}
