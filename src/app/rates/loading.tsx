import { AppShell } from "@/components/app-shell";
import { SkeletonHeader, SkeletonCard } from "@/components/ui/skeleton";

/** Fallback while the rate cards load. */
export default function Loading() {
  return (
    <AppShell>
      <SkeletonHeader />
      <SkeletonCard className="mb-6" lines={6} />
      <SkeletonCard lines={3} />
    </AppShell>
  );
}
