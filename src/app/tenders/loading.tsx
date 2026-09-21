import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Fallback while the projects list loads (force-dynamic → ~700ms DB round-trip). */
export default function Loading() {
  return (
    <AppShell>
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-8 w-52" />
      </div>

      {/* Stat strip */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="space-y-2.5 rounded-lg border border-hairline bg-canvas p-4"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-10" />
          </div>
        ))}
      </div>

      {/* Project rows */}
      <div className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center justify-between px-5 py-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    </AppShell>
  );
}
