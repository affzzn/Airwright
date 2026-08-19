import { cn } from "@/lib/utils";

/**
 * A hairline-thin, monochrome progress bar. Fill = `--ink`, track = `--surface-2`.
 * `value` is a 0–100 percentage.
 */
export function ProgressBar({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1 w-full overflow-hidden rounded-full bg-surface-2",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-ink transition-[width] duration-200 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
