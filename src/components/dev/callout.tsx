import { cn } from "@/lib/utils";

/**
 * A documentation-style admonition: a left hairline bar + faint surface, with an
 * optional label. Monochrome — emphasis comes from the bar + label, not colour.
 */
export function Callout({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-r-md border-l-2 border-ink/70 bg-surface px-4 py-3 text-sm leading-relaxed text-ink-muted",
        className,
      )}
    >
      {label && <p className="eyebrow mb-1">{label}</p>}
      {children}
    </div>
  );
}
