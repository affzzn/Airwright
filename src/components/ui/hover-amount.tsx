"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface BreakdownRow {
  label: string;
  value: string;
  /** A quieter row (e.g. an inclusion that isn't in the charged total). */
  muted?: boolean;
}

/**
 * A quiet hover/focus breakdown for a money figure. The number gets a dotted
 * underline; hover / focus / tap reveals a small card listing what makes it up.
 * Read-only and self-contained — pass the already-formatted display string plus
 * the rows to show. Matches the Provenance card styling (monochrome, hairline).
 */
export function HoverAmount({
  display,
  title,
  rows,
  note,
  className,
}: {
  display: string;
  title?: string;
  rows?: BreakdownRow[];
  note?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const scheduleClose = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(false), 120);
  };
  const openNow = () => {
    cancel();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) setPlaceAbove(window.innerHeight - r.bottom < 220 && r.top > 220);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => () => cancel(), []);

  const hasContent = (rows && rows.length > 0) || !!note;
  if (!hasContent) return <span className={className}>{display}</span>;

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onFocus={openNow}
        onBlur={scheduleClose}
        onClick={() => (open ? setOpen(false) : openNow())}
        className={cn(
          "cursor-help underline decoration-dotted decoration-hairline-strong underline-offset-4 outline-none focus-visible:decoration-ink",
          className,
        )}
      >
        {display}
      </span>

      {open && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={cancel}
          onMouseLeave={scheduleClose}
          className={cn(
            "absolute right-0 z-50 block w-[240px] cursor-default rounded-lg border border-hairline-strong bg-canvas p-3 text-left",
            placeAbove ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
          )}
        >
          {title && <p className="mb-1.5 text-xs font-semibold text-ink">{title}</p>}
          {rows && rows.length > 0 && (
            <ul className="space-y-1">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-baseline justify-between gap-3 text-xs",
                    r.muted ? "text-ink-subtle" : "text-ink",
                  )}
                >
                  <span className="leading-snug">{r.label}</span>
                  <span className="shrink-0 tabular-nums">{r.value}</span>
                </li>
              ))}
            </ul>
          )}
          {note && (
            <p
              className={cn(
                "text-[11px] leading-snug text-ink-subtle",
                rows && rows.length > 0 && "mt-2 border-t border-hairline pt-2",
              )}
            >
              {note}
            </p>
          )}
        </span>
      )}
    </span>
  );
}
