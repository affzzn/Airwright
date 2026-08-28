import { AppShell } from "@/components/app-shell";
import { Skeleton, SkeletonHeader, SkeletonCard } from "@/components/ui/skeleton";

/** Fallback while the pricing matrix computes per plot. */
export default function Loading() {
  return (
    <AppShell>
      <Skeleton className="h-4 w-28" />
      <SkeletonHeader />
      <SkeletonCard className="mb-6" lines={6} />
      <SkeletonCard lines={3} />
    </AppShell>
  );
}
