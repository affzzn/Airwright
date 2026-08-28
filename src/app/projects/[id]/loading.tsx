import { AppShell } from "@/components/app-shell";
import { Skeleton, SkeletonHeader, SkeletonCard } from "@/components/ui/skeleton";

/** Fallback while a project (house types, plots, documents) loads. */
export default function Loading() {
  return (
    <AppShell>
      <Skeleton className="h-4 w-24" />
      <SkeletonHeader />
      <SkeletonCard className="mb-6" lines={4} />
      <SkeletonCard className="mb-6" lines={3} />
      <SkeletonCard lines={5} />
    </AppShell>
  );
}
