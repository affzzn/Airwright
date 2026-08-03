import { cn } from "@/lib/utils";

/** Monochrome loading placeholder — a gently pulsing neutral block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-2", className)} />;
}
