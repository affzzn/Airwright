import { cn } from "@/lib/utils";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/** Monochrome loading placeholder — a gently pulsing neutral block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-2", className)} />;
}

// Ragged line widths so a block of skeleton text reads as text, not bars.
const LINE_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-3/5", "w-2/3", "w-5/6"];

/** A paragraph's worth of skeleton lines. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3.5", LINE_WIDTHS[i % LINE_WIDTHS.length])}
        />
      ))}
    </div>
  );
}

/** The eyebrow + title block that heads most pages. */
export function SkeletonHeader() {
  return (
    <div className="mt-4 mb-8 space-y-2.5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-3.5 w-40" />
    </div>
  );
}

/** A card with a header row and a few lines of body — the app's staple block. */
export function SkeletonCard({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-8" />
      </CardHeader>
      <CardBody>
        <SkeletonText lines={lines} />
      </CardBody>
    </Card>
  );
}
