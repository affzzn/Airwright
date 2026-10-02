"use client";

import { FileText } from "lucide-react";
import { TRUST_TEXT, type Trust } from "@/lib/construction/cards";
import type { SheetRef } from "@/server/construction";
import { cn } from "@/lib/utils";

/**
 * How far a number can be trusted, shown as a small mark + word; hovering (or
 * focusing) opens a card that says, in plain words, what it means, how the number
 * was worked out, and where it came from — each sheet a link to that drawing page.
 * Monochrome on purpose: the shape of the mark carries the meaning.
 */

function Mark({ trust }: { trust: Trust }) {
  const base = "inline-block h-2 w-2 shrink-0";
  switch (trust) {
    case "checked":
      return <span className={cn(base, "rounded-full bg-ink")} aria-hidden />;
    case "printed":
      return <span className={cn(base, "rounded-full border-[1.5px] border-ink")} aria-hidden />;
    case "measured":
    case "entered":
      return <span className={cn(base, "rounded-[2px] bg-ink-muted")} aria-hidden />;
    case "client":
      return <span className={cn(base, "rounded-full border border-dashed border-ink")} aria-hidden />;
    default:
      return <span className={cn(base, "rounded-full border border-hairline-strong")} aria-hidden />;
  }
}

export function TrustBadge({
  trust,
  why,
  sources = [],
  sheetRefs = [],
  onShowSheet,
  align = "left",
}: {
  trust: Trust;
  why?: string | null;
  sources?: string[];
  sheetRefs?: SheetRef[];
  onShowSheet?: (ref: SheetRef) => void;
  align?: "left" | "right";
}) {
  const t = TRUST_TEXT[trust];
  const lines = sources.filter((s) => !s.startsWith("room-id:"));
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-muted outline-none hover:bg-surface hover:text-ink focus-visible:bg-surface focus-visible:text-ink"
        aria-label={`${t.title}: ${t.body}`}
      >
        <Mark trust={trust} />
        {t.title}
      </button>
      <span
        role="tooltip"
        className={cn(
          "invisible absolute top-full z-30 mt-1 w-[300px] rounded-lg border border-hairline-strong bg-canvas p-3 text-left opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
          <Mark trust={trust} />
          {t.title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">{t.body}</span>
        {why && (
          <>
            <span className="eyebrow mt-2.5 block">How we got it</span>
            <span className="mt-0.5 block text-[12px] leading-relaxed text-ink">{why}</span>
          </>
        )}
        {(sheetRefs.length > 0 || lines.length > 0) && (
          <>
            <span className="eyebrow mt-2.5 block">Where it came from</span>
            <span className="mt-1 flex flex-col gap-1">
              {sheetRefs.map((r) => {
                // What that sheet says, from the source line that names it ("…: \"3300 DPC …\"").
                const said = lines.find((s) => s.startsWith(`${r.title}:`))?.slice(r.title.length + 1).trim();
                return (
                  <button
                    key={`${r.sheetId}:${r.page}`}
                    type="button"
                    onClick={() => onShowSheet?.(r)}
                    className="flex flex-col items-start text-left text-[11px] underline-offset-2 hover:underline"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-ink">
                      <FileText className="h-3 w-3 shrink-0" strokeWidth={1.75} />
                      <span className="truncate">
                        {r.title}
                        {r.page > 1 ? ` · page ${r.page}` : ""}
                      </span>
                    </span>
                    {said && <span className="pl-[18px] text-ink-muted">{said}</span>}
                  </button>
                );
              })}
              {lines
                .filter((s) => !sheetRefs.some((r) => s.startsWith(`${r.title}:`)))
                .slice(0, 6)
                .map((s, i) => (
                  <span key={i} className="text-[11px] leading-snug text-ink-muted">
                    {s}
                  </span>
                ))}
            </span>
          </>
        )}
      </span>
    </span>
  );
}
