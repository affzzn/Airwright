"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight } from "lucide-react";
import type { ProvContent } from "@/lib/provenance";
import { cn } from "@/lib/utils";

const TOOLTIP_W = 300;

/**
 * A quiet "how was this derived" affordance. The trigger (a term or a value)
 * gets a dotted underline; hover / focus / tap reveals an interactive card that
 * stays open while the pointer is inside it, so its page links are clickable.
 *
 * The card is PORTALED to <body> with fixed positioning (not an absolute child)
 * so it is never clipped by a scrolling ancestor — the review take-off pane is
 * `overflow-y-auto`, and an in-flow absolute tooltip would be cut at its edges.
 * Position is recomputed on scroll/resize so the card tracks its trigger.
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
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placeAbove: boolean;
  } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();

  useEffect(() => setMounted(true), []);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  // Compute the fixed viewport coordinates for the card from the trigger's rect.
  const computePos = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    const placeAbove = window.innerHeight - r.bottom < 320 && r.top > 320;
    let left = r.left;
    if (left + TOOLTIP_W > window.innerWidth - 12)
      left = window.innerWidth - 12 - TOOLTIP_W;
    if (left < 12) left = 12;
    const top = placeAbove ? r.top - 6 : r.bottom + 6;
    setPos({ top, left, placeAbove });
  };

  const openNow = () => {
    cancelClose();
    computePos();
    setOpen(true);
  };

  // While open: close on outside click / Escape, and keep the card glued to its
  // trigger as the page (or the take-off pane) scrolls or the window resizes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !tipRef.current?.contains(t))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReflow = () => computePos();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    // capture: scroll events don't bubble, so catch them on the way down (the
    // take-off pane is a nested scroll container).
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
  }, [open]);

  useEffect(() => () => cancelClose(), []);

  return (
    <span
      ref={wrapRef}
      className="inline-flex"
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

      {open &&
        mounted &&
        pos &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_W,
              transform: pos.placeAbove ? "translateY(-100%)" : undefined,
            }}
            className="shadow-overlay z-50 block cursor-default rounded-lg border border-hairline-strong bg-canvas p-3 text-left"
          >
            <ProvCard content={content} onGoToPage={onGoToPage} />
          </div>,
          document.body,
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
