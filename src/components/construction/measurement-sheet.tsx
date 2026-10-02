"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ConstructionElementLibVM, ConstructionMeasurementVM, ConstructionQuoteVM, SheetRef } from "@/server/construction";
import { trustOf } from "@/lib/construction/cards";
import { BRACKET_LABEL, type HeightBracket } from "@/lib/construction/types";
import { TrustBadge } from "@/components/construction/trust-badge";
import { EmptyHint } from "@/components/construction/parts";

/**
 * What was read from the drawings (simplified 2026-10-02): only the values read
 * reliably — heights of each part, a confirmed rectangle's perimeter and corners,
 * gables both drawings agree on, printed clear heights and room areas, and numbers
 * written on a client's mark-up — each with its trust badge (hover: how, and from
 * which sheet). Suggestions that were NOT filled are listed under it. The quote is
 * built from these on the Scaffold items step.
 */

export const CONF_VALUE: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.4, unknown: 0 };

const GROUPS: { key: string; title: string; test: (m: ConstructionMeasurementVM) => boolean }[] = [
  { key: "heights", title: "Heights", test: (m) => /^height:/.test(m.key ?? "") },
  { key: "outside", title: "Outside", test: (m) => /^(ext-perimeter|ext-corners|gables)$/.test(m.key ?? "") },
  { key: "markup", title: "Written on the client's mark-up", test: (m) => /:numbers:/.test(m.key ?? "") },
  { key: "clear", title: "Clear heights inside", test: (m) => /^clear:/.test(m.key ?? "") },
];

export function MeasurementSheet({
  quote,
  onShowSheet,
  compact = false,
}: {
  quote: ConstructionQuoteVM;
  library?: ConstructionElementLibVM[];
  locked?: boolean;
  onShowSheet?: (ref: SheetRef) => void;
  title?: string;
  compact?: boolean;
}) {
  const read = quote.measurements.filter((m) => m.runId);
  const hintsBy = useMemo(() => new Map((quote.latestRun?.result?.buildings ?? []).map((b) => [b.id, b.hints ?? []])), [quote.latestRun]);
  const buildings = useMemo(() => {
    const ids = [...new Set([...read.map((m) => m.buildingId ?? ""), ...[...hintsBy.keys()]])];
    return ids.map((id) => ({
      id,
      name: quote.buildings.find((b) => b.id === id)?.name ?? (quote.buildings.length ? "Whole job" : "This job"),
      ms: read.filter((m) => (m.buildingId ?? "") === id),
      hints: hintsBy.get(id) ?? [],
    }));
  }, [read, quote.buildings, hintsBy]);

  if (read.length === 0 && buildings.every((b) => b.hints.length === 0))
    return <EmptyHint title="Nothing read yet">Read the pack, or enter the numbers on the Scaffold items step.</EmptyHint>;

  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <div>
          <h2 className="text-sm font-semibold text-ink">Read from the drawings</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Only numbers that could be read reliably. Hover a badge to see how and from which drawing. Everything else is yours to enter or measure on the Scaffold items step.
          </p>
        </div>
      )}
      {buildings.map((b) => {
        const rooms = b.ms.filter((m) => (m.key ?? "").startsWith("room:"));
        return (
          <section key={b.id || "job"} className="rounded-xl border border-hairline bg-canvas">
            <p className="px-4 pb-1 pt-3 text-[13px] font-semibold text-ink">{b.name}</p>
            {GROUPS.map((g) => {
              const ms = b.ms.filter(g.test);
              if (!ms.length) return null;
              return (
                <div key={g.key}>
                  <p className="eyebrow border-t border-hairline px-4 pb-1 pt-2.5">{g.title}</p>
                  <ul>
                    {ms.map((m) => (
                      <Row key={m.id} m={m} onShowSheet={onShowSheet} />
                    ))}
                  </ul>
                </div>
              );
            })}
            {rooms.length > 0 && <Rooms rooms={rooms} />}
            {b.hints.length > 0 && (
              <div className="border-t border-hairline px-4 py-2.5">
                <p className="eyebrow mb-1">Not filled in — for you to decide</p>
                <ul className="flex flex-col gap-1">
                  {b.hints.map((h, i) => (
                    <li key={i} className="text-[12px] leading-relaxed text-ink-muted">
                      · {h.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Row({ m, onShowSheet }: { m: ConstructionMeasurementVM; onShowSheet?: (r: SheetRef) => void }) {
  return (
    <li className="flex items-start gap-3 border-t border-hairline px-4 py-2 first:border-t-0">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-ink">{m.label}</span>
        {m.note && <span className="block text-[11px] leading-relaxed text-ink-muted">{m.note}</span>}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="text-[13px] font-semibold tabular-nums text-ink">
          {m.valueNumber} {m.unit ?? ""}
        </span>
        {(m.lifts != null || m.heightBracket) && (
          <span className="text-[11px] text-ink-muted">
            {[m.lifts != null ? `${m.lifts} lift${m.lifts === 1 ? "" : "s"}` : null, m.heightBracket ? BRACKET_LABEL[m.heightBracket as HeightBracket] : null].filter(Boolean).join(" · ")}
          </span>
        )}
        <TrustBadge
          align="right"
          trust={trustOf({ ...m, valueNumber: m.valueNumber })}
          why={m.note}
          sources={m.provenance}
          sheetRefs={m.sheetRefs}
          onShowSheet={onShowSheet}
        />
      </span>
    </li>
  );
}

function Rooms({ rooms }: { rooms: ConstructionMeasurementVM[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hairline px-4 py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[12px] font-semibold text-ink">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {rooms.length} printed room areas (for a birdcage)
      </button>
      {open && (
        <ul className="mt-1.5 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
          {rooms.map((r) => (
            <li key={r.id} className="flex justify-between text-[12px] text-ink">
              <span className="truncate">{r.label}</span>
              <span className="tabular-nums text-ink-muted">{r.valueNumber} m²</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
