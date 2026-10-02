"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Loader2, Ruler } from "lucide-react";
import { setBirdcageRooms, setCardValue, toggleAddon, unpinCardLine } from "@/server/actions/constructionCards";
import { updateConstructionLine } from "@/server/actions/construction";
import type { ConstructionElementLibVM, ConstructionLineVM, ConstructionQuoteVM, SheetRef } from "@/server/construction";
import {
  ADDONS,
  readBuildingCard,
  type AddonDef,
  type BuildingCard,
  type CardSection,
  type CardValue,
  type MeasureRow,
} from "@/lib/construction/cards";
import { elementRole } from "@/lib/construction/bindScope";
import { lineAmount } from "@/lib/construction/price";
import { paramNumber } from "@/lib/construction/params";
import { suggestedLiftsFor } from "@/lib/construction/rules";
import { BRACKET_LABEL, type ConstructionUnit, type HeightBracket } from "@/lib/construction/types";
import { TrustBadge } from "@/components/construction/trust-badge";
import { MeasureDialog, type MeasureOutcome, type MeasureTarget } from "@/components/construction/measure-dialog";
import { Panel } from "@/components/construction/parts";
import { cn, formatGBP } from "@/lib/utils";

/**
 * The section cards (2026-10-02) — the quote, built the way Airwright's real quotes
 * are laid out: per building, External / Internal / Birdcage, each with its few key
 * numbers and the add-ons the estimator ticks; plus the job's weekly inspections.
 *
 * A number is filled in only when it was read reliably (see the trust badge: hover
 * it for how and where from). Anything else is the estimator's: type it, or measure
 * it on the drawing. Every number is editable; clearing one goes back to the drawings.
 */

type Measure = (target: MeasureTarget, onDone: (o: MeasureOutcome) => Promise<void>) => void;

const rowsOf = (q: ConstructionQuoteVM): MeasureRow[] =>
  q.measurements.map((m) => ({
    id: m.id,
    key: m.key,
    label: m.label,
    valueNumber: m.valueNumber,
    unit: m.unit,
    lifts: m.lifts,
    confidence: m.confidence,
    source: m.source,
    provenance: m.provenance,
    note: m.note,
    buildingId: m.buildingId,
    runId: m.runId,
    sheetRefs: m.sheetRefs,
  }));

export function SectionCards({
  quote,
  library,
  lines,
  locked,
  onShowSheet,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  locked: boolean;
  onShowSheet: (ref: SheetRef) => void;
}) {
  const rows = useMemo(() => rowsOf(quote), [quote]);
  const hintsBy = useMemo(() => new Map((quote.latestRun?.result?.buildings ?? []).map((b) => [b.id, b.hints ?? []])), [quote.latestRun]);
  const buildings = quote.buildings.length ? quote.buildings : [{ id: null as string | null, name: "This job", code: null }];
  const [active, setActive] = useState<string | null>(buildings[0].id);
  const b = buildings.find((x) => x.id === active) ?? buildings[0];
  const card = readBuildingCard(rows, b.id, quote.params, hintsBy.get(b.id ?? "") ?? [], quote.durationWeeks);
  const [measure, setMeasure] = useState<{ target: MeasureTarget; onDone: (o: MeasureOutcome) => Promise<void> } | null>(null);
  const openMeasure: Measure = (target, onDone) => setMeasure({ target, onDone });

  return (
    <div className="flex flex-col gap-3">
      {buildings.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Building">
          {buildings.map((x) => (
            <button
              key={x.id ?? "job"}
              type="button"
              role="tab"
              aria-selected={x.id === b.id}
              onClick={() => setActive(x.id)}
              className={cn(
                "h-9 rounded-lg border px-3.5 text-[13px] transition-colors",
                x.id === b.id ? "border-ink bg-ink font-semibold text-canvas" : "border-hairline-strong bg-canvas text-ink-muted hover:text-ink",
              )}
            >
              {x.name}
            </button>
          ))}
        </div>
      )}
      <ExternalCard key={`ext-${b.id}`} quote={quote} library={library} lines={lines} card={card} locked={locked} onShowSheet={onShowSheet} onMeasure={openMeasure} />
      <InternalCard key={`int-${b.id}`} quote={quote} library={library} lines={lines} card={card} locked={locked} onShowSheet={onShowSheet} onMeasure={openMeasure} />
      <BirdcageCard key={`bc-${b.id}`} quote={quote} library={library} lines={lines} card={card} locked={locked} onShowSheet={onShowSheet} onMeasure={openMeasure} />
      <JobCard quote={quote} library={library} lines={lines} locked={locked} />
      {measure && (
        <MeasureDialog open onClose={() => setMeasure(null)} quote={quote} target={measure.target} onDone={measure.onDone} />
      )}
    </div>
  );
}

interface CardProps {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  card: BuildingCard;
  locked: boolean;
  onShowSheet: (ref: SheetRef) => void;
  onMeasure: Measure;
}

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | void>) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (r && !r.ok) setError(r.error ?? "Something went wrong.");
      router.refresh();
    });
  return { act, pending, error };
}

/** The section's lines and their total. */
function sectionLines(lines: ConstructionLineVM[], buildingId: string | null, section: string) {
  const ls = lines.filter((l) => l.section === section && (l.buildingId ?? null) === (buildingId ?? null));
  const total = ls.reduce((a, l) => a + lineAmount({ unit: l.unit as ConstructionUnit, quantity: l.quantity, lifts: l.lifts, rate: l.rate }), 0);
  return { ls, total };
}

function CardShell({
  title,
  subtitle,
  total,
  hire,
  onHire,
  locked,
  children,
  open,
  onToggle,
}: {
  title: string;
  subtitle: string;
  total: number;
  hire: CardValue;
  onHire: (v: number | null) => void;
  locked: boolean;
  children: React.ReactNode;
  open: boolean;
  onToggle?: () => void;
}) {
  return (
    <Panel
      title={
        <button type="button" onClick={onToggle} className="flex min-w-0 items-center gap-2 text-left" disabled={!onToggle}>
          {onToggle && (open ? <ChevronDown className="h-4 w-4 text-ink-muted" /> : <ChevronRight className="h-4 w-4 text-ink-muted" />)}
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ink">{title}</span>
            <span className="block text-[11px] font-normal text-ink-muted">{subtitle}</span>
          </span>
        </button>
      }
      action={
        open ? (
          <span className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-ink-muted">
              Hire
              <NumInput value={hire.value} onSave={onHire} disabled={locked} className="w-14" />
              weeks
            </label>
            <span className="text-sm font-semibold tabular-nums text-ink">{formatGBP(total)}</span>
          </span>
        ) : (
          <span className="text-sm tabular-nums text-ink-muted">{total > 0 ? formatGBP(total) : ""}</span>
        )
      }
      bodyClassName={open ? "px-5 pb-4" : "hidden"}
    >
      {children}
    </Panel>
  );
}

/** A number box that saves on blur / Enter; empty = cleared. */
function NumInput({ value, onSave, disabled, className, placeholder }: { value: number | null; onSave: (v: number | null) => void; disabled?: boolean; className?: string; placeholder?: string }) {
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => setV(value != null ? String(value) : ""), [value]);
  return (
    <input
      inputMode="decimal"
      value={v}
      placeholder={placeholder ?? "—"}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v.trim() === "" ? null : Number(v);
        if (next !== null && !Number.isFinite(next)) return setV(value != null ? String(value) : "");
        if (next !== value) onSave(next);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={cn(
        "h-8 rounded-md border border-hairline bg-canvas px-2 text-right text-sm tabular-nums text-ink hover:border-hairline-strong focus-visible:border-ink focus-visible:outline-none disabled:opacity-60",
        className ?? "w-24",
      )}
    />
  );
}

/** One key number: the box, its trust badge, measure, "back to the drawings", and suggestions. */
function ValueRow({
  label,
  unit,
  value,
  onSave,
  locked,
  onShowSheet,
  onMeasure,
  suggestions = [],
  autoExists,
  extra,
}: {
  label: string;
  unit: string;
  value: CardValue;
  onSave: (v: number | null) => void;
  locked: boolean;
  onShowSheet: (r: SheetRef) => void;
  onMeasure?: () => void;
  suggestions?: { text: string; value: number; onUse: () => void }[];
  /** True when the drawings gave a value the estimator has replaced. */
  autoExists?: boolean;
  extra?: React.ReactNode;
}) {
  const own = value.row != null && value.row.runId == null;
  return (
    <div className="border-t border-hairline py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="w-40 shrink-0 text-[13px] font-medium text-ink">{label}</span>
        <span className="flex items-center gap-1.5">
          <NumInput value={value.value} onSave={onSave} disabled={locked} />
          <span className="w-6 text-xs text-ink-muted">{unit}</span>
        </span>
        <TrustBadge trust={value.trust} why={value.why} sources={value.row?.provenance ?? []} sheetRefs={(value.row?.sheetRefs as SheetRef[] | undefined) ?? []} onShowSheet={onShowSheet} />
        {onMeasure && !locked && (
          <button type="button" onClick={onMeasure} className="inline-flex items-center gap-1 rounded-md border border-hairline-strong px-2 py-1 text-[11px] font-semibold text-ink hover:border-ink">
            <Ruler className="h-3 w-3" strokeWidth={2} /> Measure on drawing
          </button>
        )}
        {own && autoExists && !locked && (
          <button type="button" onClick={() => onSave(null)} className="text-[11px] font-semibold text-ink-muted hover:text-ink">
            Back to the drawings&apos; value
          </button>
        )}
        {extra}
      </div>
      {value.value == null && suggestions.length > 0 && !locked && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 pl-0 sm:pl-[10.75rem]">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={s.onUse}
              className="inline-flex items-center rounded-md border border-dashed border-hairline-strong px-2 py-1 text-[11px] text-ink-muted hover:border-ink hover:text-ink"
            >
              {s.text} · <span className="ml-1 font-semibold text-ink">Use</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HintNote({ text }: { text: string }) {
  return <p className="mt-1 text-[11px] leading-relaxed text-ink-muted sm:pl-[10.75rem]">{text}</p>;
}

// --- External ------------------------------------------------------------------------------

function ExternalCard({ quote, library, lines, card, locked, onShowSheet, onMeasure }: CardProps) {
  const { act, pending, error } = useAct();
  const bid = card.buildingId;
  const e = card.external;
  const set = (key: string, v: number | null, opts?: Parameters<typeof setCardValue>[4]) => act(() => setCardValue(quote.id, bid, key, v, opts));
  const { total } = sectionLines(lines, bid, "External");
  const per = card.hints.find((h) => h.target === "ext-perimeter");
  const gab = card.hints.find((h) => h.target === "gables");
  const autoKey = (k: string) => quote.measurements.some((m) => m.key === k && m.runId && (m.buildingId ?? null) === bid);
  const lower = e.heights.slice(1);

  return (
    <CardShell
      title="External scaffold"
      subtitle="Independent scaffold around the building"
      total={total}
      hire={e.hire}
      onHire={(v) => set("hire:External", v)}
      locked={locked}
      open
    >
      <ValueRow
        label="Wall perimeter"
        unit="m"
        value={e.perimeter}
        onSave={(v) => set("ext-perimeter", v)}
        locked={locked}
        onShowSheet={onShowSheet}
        autoExists={autoKey("ext-perimeter")}
        onMeasure={() =>
          onMeasure({ label: "the outside wall line", mode: "outline", buildingId: bid }, async (o) => {
            await setCardValue(quote.id, bid, "ext-perimeter", o.lengthM, { source: "DRAWN", provenance: o.provenance, sheetRefs: [o.sheetRef], note: `Measured on the drawing (${o.scaleNote}).` });
            if (o.corners != null)
              await setCardValue(quote.id, bid, "ext-corners", o.corners, { source: "DRAWN", provenance: o.provenance, sheetRefs: [o.sheetRef], note: `Counted from the outline you drew: ${o.corners} outside corners.` });
            act(async () => {});
          })
        }
        suggestions={
          per?.value != null
            ? [
                {
                  text: `${per.text.split(" — ")[0]} = ${per.value} m, ${per.corners ?? 4} corners`,
                  value: per.value,
                  onUse: () =>
                    act(async () => {
                      await setCardValue(quote.id, bid, "ext-perimeter", per.value, { provenance: per.sources, note: `You used the suggestion: ${per.text}` });
                      return setCardValue(quote.id, bid, "ext-corners", per.corners ?? 4, { provenance: per.sources, note: "A rectangle has 4 outside corners." });
                    }),
                },
              ]
            : []
        }
      />
      {per && e.perimeter.value == null && <HintNote text={per.text} />}
      <ValueRow label="Outside corners" unit="nr" value={e.corners} onSave={(v) => set("ext-corners", v)} locked={locked} onShowSheet={onShowSheet} autoExists={autoKey("ext-corners")} />
      <div className="border-t border-hairline py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="w-40 shrink-0 text-[13px] font-medium text-ink">Scaffold run</span>
          <span className="text-sm font-semibold tabular-nums text-ink">{e.run.value != null ? `${e.run.value} m` : "—"}</span>
          <span className="text-[11px] text-ink-muted">{e.run.why}</span>
        </div>
      </div>
      <ValueRow
        label="Height"
        unit="m"
        value={e.height}
        onSave={(v) => set("ext-height", v)}
        locked={locked}
        onShowSheet={onShowSheet}
        autoExists={e.heights.length > 0}
        extra={e.bracket ? <span className="text-[11px] text-ink-muted">band {BRACKET_LABEL[e.bracket as HeightBracket]}</span> : null}
      />
      {lower.length > 0 && (
        <HintNote text={`Lower parts printed: ${lower.map((h) => `${h.label.replace(/^Height — /, "")} ${h.valueNumber} m (${h.lifts} lift${h.lifts === 1 ? "" : "s"})`).join(" · ")} — tick "Low-level independent" below if they get their own scaffold.`} />
      )}
      <ValueRow label="Lifts" unit="nr" value={e.lifts} onSave={(v) => set("ext-lifts", v)} locked={locked} onShowSheet={onShowSheet} autoExists={e.height.value != null} />
      <ValueRow
        label="Main gables"
        unit="nr"
        value={e.gables}
        onSave={(v) => set("gables", v)}
        locked={locked}
        onShowSheet={onShowSheet}
        autoExists={autoKey("gables")}
        suggestions={gab?.value != null ? [{ text: gab.text, value: gab.value, onUse: () => set("gables", gab.value, { provenance: gab.sources, note: `You used the suggestion: ${gab.text}` }) }] : []}
      />
      {gab && e.gables.value == null && gab.value == null && <HintNote text={gab.text} />}
      {/* In a scope job the scope decides what is priced — its own lines are below. */}
      <Addons section="External" quote={quote} library={library} lines={lines} card={card} locked={locked} onMeasure={onMeasure} />
      {(pending || error) && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink">{pending && <Loader2 className="h-3 w-3 animate-spin" />}{error}</p>}
    </CardShell>
  );
}

// --- Internal ------------------------------------------------------------------------------

function clearSuggestions(card: BuildingCard, liftKey: string, clearKey: string, quote: ConstructionQuoteVM, set: (k: string, v: number | null, o?: Parameters<typeof setCardValue>[4]) => void) {
  const reach = paramNumber(quote.params, "P6_internalReachM");
  const liftH = paramNumber(quote.params, "P1_liftHeightM");
  const clear = card.clearHeights.map((c) => ({
    text: `${c.label.replace(/^Clear height — /, "")} ${c.valueNumber} m`,
    value: c.valueNumber,
    onUse: () => set(clearKey, c.valueNumber, { provenance: c.provenance, note: `You picked the printed clear height: ${c.note ?? ""}`, sheetRefs: c.sheetRefs }),
  }));
  const lifts = (h: number | null) => {
    const n = h != null ? suggestedLiftsFor(Math.max(0.01, h - reach), liftH) : null;
    return n != null ? [{ text: `About ${n} for ${h} m (a guide: (height − ${reach} m reach) ÷ ${liftH} m)`, value: n, onUse: () => set(liftKey, n, { note: `From the clear height ${h} m: (${h} − ${reach}) ÷ ${liftH}, rounded up = ${n}. A guide only.` }) }] : [];
  };
  return { clear, lifts };
}

function InternalCard({ quote, library, lines, card, locked, onShowSheet, onMeasure }: CardProps) {
  const { act, pending, error } = useAct();
  const bid = card.buildingId;
  const i = card.internal;
  const { ls, total } = sectionLines(lines, bid, "Internal");
  const [open, setOpen] = useState(ls.length > 0 || i.run.value != null);
  const set = (key: string, v: number | null, opts?: Parameters<typeof setCardValue>[4]) => act(() => setCardValue(quote.id, bid, key, v, opts));
  const sug = clearSuggestions(card, "int-lifts", "int-clear", quote, set);
  return (
    <CardShell title="Internal scaffold" subtitle={open ? "Independent scaffold inside the building" : "Not added — click to add internal scaffold"} total={total} hire={i.hire} onHire={(v) => set("hire:Internal", v)} locked={locked} open={open} onToggle={() => setOpen((o) => !o)}>
      <ValueRow
        label="Internal run"
        unit="m"
        value={i.run}
        onSave={(v) => set("int-run", v)}
        locked={locked}
        onShowSheet={onShowSheet}
        onMeasure={() =>
          onMeasure({ label: "the internal scaffold run", mode: "run", buildingId: bid }, async (o) => {
            await setCardValue(quote.id, bid, "int-run", o.lengthM, { source: "DRAWN", provenance: o.provenance, sheetRefs: [o.sheetRef], note: `Measured on the drawing (${o.scaleNote}).` });
            act(async () => {});
          })
        }
      />
      <ValueRow label="Clear height" unit="m" value={i.clear} onSave={(v) => set("int-clear", v)} locked={locked} onShowSheet={onShowSheet} suggestions={sug.clear} />
      <ValueRow label="Lifts" unit="nr" value={i.lifts} onSave={(v) => set("int-lifts", v)} locked={locked} onShowSheet={onShowSheet} suggestions={sug.lifts(i.clear.value)} />
      <Addons section="Internal" quote={quote} library={library} lines={lines} card={card} locked={locked} onMeasure={onMeasure} />
      {(pending || error) && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink">{pending && <Loader2 className="h-3 w-3 animate-spin" />}{error}</p>}
    </CardShell>
  );
}

// --- Birdcage ------------------------------------------------------------------------------

function BirdcageCard({ quote, lines, card, locked, onShowSheet, onMeasure }: CardProps) {
  const { act, pending, error } = useAct();
  const bid = card.buildingId;
  const bc = card.birdcage;
  const { ls, total } = sectionLines(lines, bid, "Internal Birdcage");
  const [open, setOpen] = useState(ls.length > 0 || bc.area.value != null);
  const set = (key: string, v: number | null, opts?: Parameters<typeof setCardValue>[4]) => act(() => setCardValue(quote.id, bid, key, v, opts));
  const sug = clearSuggestions(card, "bc-lifts", "bc-clear", quote, set);
  const ticked = new Set(bc.roomIds);
  const byLevel = new Map<string, typeof bc.rooms>();
  for (const r of bc.rooms) {
    const lvl = /\(([^)]+)\)$/.exec(r.label)?.[1] ?? "Rooms";
    byLevel.set(lvl, [...(byLevel.get(lvl) ?? []), r]);
  }
  const toggleRoom = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    act(() => setBirdcageRooms(quote.id, bid, [...next]));
  };
  return (
    <CardShell title="Birdcage (crash deck)" subtitle={open ? "Scaffold filling a room, to work at ceiling height" : "Not added — click to add a birdcage"} total={total} hire={bc.hire} onHire={(v) => set("hire:Internal Birdcage", v)} locked={locked} open={open} onToggle={() => setOpen((o) => !o)}>
      {bc.rooms.length > 0 && (
        <div className="pb-2">
          <p className="mb-1.5 text-[11px] text-ink-muted">Tick the rooms the birdcage covers — their printed areas are added up.</p>
          <div className="flex flex-col gap-2">
            {[...byLevel.entries()].map(([lvl, rs]) => (
              <div key={lvl}>
                <p className="eyebrow mb-1">{lvl}</p>
                <div className="flex flex-wrap gap-1.5">
                  {rs.map((r) => {
                    const on = ticked.has(r.id ?? "");
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={locked || pending}
                        onClick={() => r.id && toggleRoom(r.id)}
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] transition-colors",
                          on ? "border-ink bg-ink text-canvas" : "border-hairline-strong text-ink hover:border-ink",
                        )}
                        title={r.provenance[0]}
                      >
                        {r.label.replace(/\s*\([^)]+\)$/, "")} · {r.valueNumber} m²
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <ValueRow
        label="Area"
        unit="m²"
        value={bc.area}
        onSave={(v) => set("bc-area", v)}
        locked={locked}
        onShowSheet={onShowSheet}
        onMeasure={() =>
          onMeasure({ label: "the birdcage area", mode: "area", buildingId: bid }, async (o) => {
            await setCardValue(quote.id, bid, "bc-area", o.areaM2 ?? 0, { source: "DRAWN", provenance: o.provenance, sheetRefs: [o.sheetRef], note: `The area of the shape you drew (${o.scaleNote}).` });
            act(async () => {});
          })
        }
      />
      <ValueRow label="Clear height" unit="m" value={bc.clear} onSave={(v) => set("bc-clear", v)} locked={locked} onShowSheet={onShowSheet} suggestions={sug.clear} />
      <ValueRow label="Lifts" unit="nr" value={bc.lifts} onSave={(v) => set("bc-lifts", v)} locked={locked} onShowSheet={onShowSheet} suggestions={sug.lifts(bc.clear.value)} />
      {(pending || error) && <p className="mt-2 flex items-center gap-1.5 text-xs text-ink">{pending && <Loader2 className="h-3 w-3 animate-spin" />}{error}</p>}
    </CardShell>
  );
}

// --- Add-ons ---------------------------------------------------------------------------------

function Addons({
  section,
  quote,
  library,
  lines,
  card,
  locked,
  onMeasure,
}: {
  section: CardSection;
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  card: BuildingCard;
  locked: boolean;
  onMeasure: Measure;
}) {
  const list = ADDONS.filter((a) => a.section === section);
  return (
    <div className="mt-3 border-t border-hairline-strong pt-3">
      <p className="eyebrow mb-1.5">Add-ons — your call</p>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {list.map((a) => (
          <AddonRow key={a.key} addon={a} quote={quote} library={library} line={lines.find((l) => l.cardKey === a.key && (l.buildingId ?? null) === (card.buildingId ?? null)) ?? null} card={card} locked={locked} onMeasure={onMeasure} />
        ))}
      </div>
    </div>
  );
}

function AddonRow({
  addon,
  quote,
  library,
  line,
  card,
  locked,
  onMeasure,
}: {
  addon: AddonDef;
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  line: ConstructionLineVM | null;
  card: BuildingCard;
  locked: boolean;
  onMeasure: Measure;
}) {
  const { act, pending } = useAct();
  const on = line != null;
  const el = library.find((e) => elementRole(e.name) === addon.role);
  const derived = addon.qty.kind !== "count" && addon.qty.kind !== "metres";
  const unit = el ? (el.unit.startsWith("LM") ? "m" : el.unit.startsWith("M2") ? "m²" : el.unit === "PER_WEEK" ? "wk" : "nr") : "nr";
  const save = (p: { quantity?: number; lifts?: number | null }) => act(() => updateConstructionLine(line!.id, quote.id, p));
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <input
        type="checkbox"
        checked={on}
        disabled={locked || pending}
        onChange={(e) => act(() => toggleAddon(quote.id, card.buildingId, addon.key, e.target.checked))}
        className="mt-1 h-4 w-4 shrink-0 accent-black"
        aria-label={addon.label}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-ink">
          {addon.label}
          {!el && <span className="ml-1.5 text-[11px] text-ink-muted">(not on the picking list — added at £0)</span>}
        </p>
        <p className="text-[11px] leading-snug text-ink-muted">{addon.help}</p>
        {on && line && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
            <NumInput value={line.quantity} onSave={(v) => save({ quantity: v ?? 0 })} disabled={locked} className="w-20" />
            <span>{unit}</span>
            {line.lifts != null && (
              <>
                <NumInput value={line.lifts} onSave={(v) => save({ lifts: v })} disabled={locked} className="w-12" />
                <span>lifts</span>
              </>
            )}
            {addon.qty.kind === "metres" && !locked && (
              <button
                type="button"
                className="inline-flex items-center gap-1 font-semibold text-ink hover:underline"
                onClick={() =>
                  onMeasure({ label: addon.label.toLowerCase(), mode: "run", buildingId: card.buildingId }, async (o) => {
                    await updateConstructionLine(line.id, quote.id, { quantity: o.lengthM });
                    act(async () => {});
                  })
                }
              >
                <Ruler className="h-3 w-3" /> Measure
              </button>
            )}
            {derived && (line.isAuto ? <span>follows the card</span> : (
              <button type="button" className="font-semibold text-ink hover:underline" onClick={() => act(() => unpinCardLine(quote.id, line.id))}>
                edited — follow the card again
              </button>
            ))}
            {line.quantity <= 0 && <span className="font-semibold text-ink">enter the {unit === "nr" ? "number" : "metres"}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// --- The job: weekly inspections ---------------------------------------------------------

function JobCard({ quote, library, lines, locked }: { quote: ConstructionQuoteVM; library: ConstructionElementLibVM[]; lines: ConstructionLineVM[]; locked: boolean }) {
  const { act, pending } = useAct();
  const addon = ADDONS.find((a) => a.key === "job:inspections")!;
  const line = lines.find((l) => l.cardKey === addon.key) ?? null;
  const el = library.find((e) => elementRole(e.name) === "INSPECTION");
  return (
    <Panel bodyClassName="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          checked={line != null}
          disabled={locked || pending}
          onChange={(e) => act(() => toggleAddon(quote.id, null, addon.key, e.target.checked))}
          className="h-4 w-4 accent-black"
          aria-label="Weekly inspections"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-ink">Weekly inspections</span>
          <span className="block text-[11px] text-ink-muted">
            {line ? `${line.quantity} weeks — the longest hire on the job${el ? "" : " (not on the picking list)"}` : "One a week for the longest hire on the job."}
          </span>
        </span>
        {line && <span className="text-sm font-semibold tabular-nums text-ink">{formatGBP(lineAmount({ unit: line.unit as ConstructionUnit, quantity: line.quantity, lifts: null, rate: line.rate }))}</span>}
      </div>
    </Panel>
  );
}
