import { cn } from "@/lib/utils";

/** Neutral pill. Monochrome only — filled = strong, outline = weak. */
export function Badge({
  children,
  variant = "outline",
  className,
}: {
  children: React.ReactNode;
  variant?: "solid" | "muted" | "outline" | "dashed";
  className?: string;
}) {
  const styles = {
    solid: "bg-ink text-canvas border-transparent",
    muted: "bg-surface-2 text-ink-muted border-transparent",
    outline: "bg-canvas text-ink-muted border-hairline-strong",
    dashed: "bg-canvas text-ink-subtle border-dashed border-hairline-strong",
  }[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium tracking-tight",
        styles,
        className,
      )}
    >
      {children}
    </span>
  );
}

function confidenceLabel(value: number | null): string {
  if (value === null || value === 0) return "unknown";
  if (value >= 0.85) return "high";
  if (value >= 0.6) return "medium";
  return "low";
}

/**
 * Subtle monochrome confidence indicator: a small dot whose fill encodes
 * certainty. Hover shows the level via a native tooltip — no visible label.
 */
export function ConfidenceDot({ value }: { value: number | null }) {
  const label = confidenceLabel(value);
  const styles: Record<string, string> = {
    high: "bg-ink",
    medium: "bg-ink-subtle",
    low: "border border-hairline-strong",
    unknown: "border border-dashed border-hairline-strong",
  };
  return (
    <span
      title={`Confidence: ${label}`}
      aria-label={`Confidence: ${label}`}
      className={cn("inline-block h-1.5 w-1.5 rounded-full", styles[label])}
    />
  );
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Queued",
  PROCESSING: "Reading…",
  COMPLETED: "Ready",
  FAILED: "Failed",
};

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "COMPLETED"
      ? "solid"
      : status === "FAILED"
        ? "outline"
        : "muted";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}
