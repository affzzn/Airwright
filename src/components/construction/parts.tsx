"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Small shared pieces for the construction job screens (docs/19 §8). Monochrome,
 * hairline borders, no shadows — the app's design system (docs/07). Kept here so
 * the four step screens look identical without repeating class strings.
 */

/** A white card with an optional title row and a right-aligned action slot. */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-hairline bg-canvas", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
          {typeof title === "string" ? (
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
          ) : (
            title
          )}
          {action}
        </div>
      )}
      <div className={cn("px-5 pb-4", title || action ? "pt-2" : "pt-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** Label above a control. */
export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-medium text-ink-muted"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A two-state pill button. Used for "Reading / Not read" on an enquiry file —
 * it replaces the old cryptic AI badge with a control that says what it does.
 */
export function ToggleButton({
  on,
  onClick,
  onLabel,
  offLabel,
  disabled,
  title,
  className,
}: {
  on: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-40",
        on
          ? "border-ink bg-ink text-canvas"
          : "border-hairline-strong bg-canvas text-ink-muted hover:border-ink/40 hover:text-ink",
        className,
      )}
    >
      {on && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      )}
      {on ? onLabel : offLabel}
    </button>
  );
}

/** A square icon-only button for row actions. */
export function IconButton({
  label,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * The never-blank state: where there is nothing yet, say what to do next
 * instead of showing an empty box.
 */
export function EmptyHint({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-hairline-strong bg-surface/60 px-4 py-5 text-center",
        className,
      )}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-ink-muted">{children}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/** A dashed, clickable suggestion chip (rule pre-fills). */
export function SuggestionChip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center rounded-lg border border-dashed border-hairline-strong bg-canvas px-3 text-xs font-medium text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** An inline warning strip under a table row (no rate, measure by hand…). */
export function RowNotice({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-hairline bg-surface/70 px-3 py-2">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      <span className="flex-1 text-xs text-ink">{children}</span>
      {action}
    </div>
  );
}

/** A bare number/text cell used inside the item table. */
export const CellInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded-md border border-hairline bg-canvas px-2 text-right text-sm tabular-nums text-ink transition-colors hover:border-hairline-strong focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
CellInput.displayName = "CellInput";
