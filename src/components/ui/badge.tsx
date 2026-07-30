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

/** Confidence rendered without colour: fill weight encodes certainty. */
export function ConfidenceBadge({ value }: { value: number | null }) {
  if (value === null || value === 0)
    return <Badge variant="dashed">unknown</Badge>;
  if (value >= 0.85) return <Badge variant="solid">high</Badge>;
  if (value >= 0.6) return <Badge variant="muted">medium</Badge>;
  return <Badge variant="outline">low</Badge>;
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
