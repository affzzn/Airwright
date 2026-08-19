"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { ProvContent } from "@/lib/provenance";
import { cn } from "@/lib/utils";

/**
 * A quiet "how was this derived" affordance. The trigger (a term or a value)
 * gets a dotted underline; hover / focus / tap reveals an interactive card that
 * stays open while the pointer is inside it, so its page links are clickable.
 */
export function Provenance({
  content,
  onGoToPage,
  children,
  className,
}: {
  content: ProvContent;
  onGoToPage?: (page: number) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const [placeRight, setPlaceRight] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };
  const openNow = () => {
    cancelClose();
    // Flip above / to the left when there isn't room below / to the right.
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      setPlaceAbove(window.innerHeight - r.bottom < 300 && r.top > 300);
      setPlaceRight(r.left + 300 > window.innerWidth - 12);
    }
    setOpen(true);
  };

  // Close on outside click (covers tap) and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

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
        onClick={() => (open ? setOpen(false) : openNow())}
        onFocus={openNow}
        onBlur={scheduleClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open ? setOpen(false) : openNow();
          }
        }}
        className={cn(
          "cursor-help underline decoration-dotted decoration-hairline-strong underline-offset-4 outline-none focus-visible:decoration-ink",
          className,
        )}
      >
        {children}
      </span>

      {open && (
        <span
          id={id}
          role="tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          className={cn(
            "absolute z-50 block w-[300px] cursor-default rounded-lg border border-hairline-strong bg-canvas p-3 text-left",
            placeAbove ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
            placeRight ? "right-0" : "left-0",
          )}
        >
          <ProvCard content={content} onGoToPage={onGoToPage} />
        </span>
      )}
    </span>
  );
}

function ProvCard({
  content,
  onGoToPage,
}: {
  content: ProvContent;
  onGoToPage?: (page: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{content.title}</span>
        {content.confidenceLabel && (
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-subtle">
            {content.confidenceLabel}
          </span>
        )}
      </div>
      <p className="text-[11px] text-ink-subtle">{content.summary}</p>

      <ol className="space-y-1.5">
        {content.steps.map((s, i) => (
          <li key={i} className="text-xs leading-snug text-ink">
            <span className="tabular-nums">{s.text}</span>
            {s.source && (s.source.dim || s.source.sheet || s.source.page != null) && (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-subtle">
                {s.source.dim && (
                  <span className="rounded border border-hairline bg-surface px-1.5 py-0.5 tabular-nums">
                    dim {s.source.dim}
                  </span>
                )}
                {s.source.sheet && <span>{s.source.sheet}</span>}
                {s.source.page != null &&
                  (onGoToPage ? (
                    <button
                      type="button"
                      onClick={() => onGoToPage(s.source!.page!)}
                      className="inline-flex items-center gap-0.5 rounded font-medium text-ink underline decoration-hairline-strong underline-offset-2 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      p.{s.source.page}
                      <ArrowUpRight className="h-3 w-3" strokeWidth={1.75} />
                    </button>
                  ) : (
                    <span>p.{s.source.page}</span>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ol>

      {content.footnotes.length > 0 && (
        <div className="space-y-1 border-t border-hairline pt-2">
          {content.footnotes.map((f, i) => (
            <p key={i} className="text-[11px] leading-snug text-ink-subtle">
              {f}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
