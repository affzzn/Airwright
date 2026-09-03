import { AppShell } from "@/components/app-shell";
import { TestingDashboard } from "@/components/testing-dashboard";

/**
 * Model Testing & Benchmarking — a STATIC front-end mockup for a client demo.
 *
 * ⚠ Wired to nothing: no data fetching, no server actions, no DB, no extraction.
 * All figures live in `testing-dashboard.tsx` as hardcoded placeholder data. This
 * page exists only to show Airwright the shape of the planned testing pipeline.
 */
export default function TestingPage() {
  return (
    <AppShell>
      <TestingDashboard />
    </AppShell>
  );
}
