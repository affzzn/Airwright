import { AppShell } from "@/components/app-shell";
import { Skeleton, SkeletonHeader, SkeletonCard } from "@/components/ui/skeleton";

/** Fallback while a frozen quote loads. */
export default function Loading() {
  return (
    <AppShell>
      <Skeleton className="h-4 w-24" />
      <SkeletonHeader />
      <SkeletonCard className="mb-6" lines={4} />
      <SkeletonCard lines={6} />
    </AppShell>
  );
}
