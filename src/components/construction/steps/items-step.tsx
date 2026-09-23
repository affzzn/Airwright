"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plus, Search, Trash2 } from "lucide-react";
import {
  addConstructionCustomLine,
  addConstructionLineFromElement,
  addConstructionMeasurement,
  deleteConstructionLine,
  deleteConstructionMeasurement,
  duplicateConstructionLine,
  updateConstructionLine,
} from "@/server/actions/construction";
import type {
  ConstructionElementLibVM,
  ConstructionLineVM,
  ConstructionQuoteVM,
} from "@/server/construction";
import { lineAmount, resolveConstructionRate } from "@/lib/construction/price";
import { HAKI_LIFTS, inspectionWeeks, needsScaffoldMat } from "@/lib/construction/rules";
import {
  PER_LIFT_UNITS,
  UNIT_LABEL,
  type ConstructionUnit,
  type HeightBracket,
  type RateBand,
  type SiteType,
} from "@/lib/construction/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  CellInput,
  EmptyHint,
  Field,
  IconButton,
  Panel,
  RowNotice,
  SuggestionChip,
} from "@/components/construction/parts";
import { ReferenceViewerBody, isPreviewable } from "@/components/construction/construction-reference-viewer";
import { cn, formatGBP } from "@/lib/utils";

/**
 * Step 3 — the priced lines. Every line shows the sum behind it, the picking
 * list sits beside the table (no modal), and the drawing and measurements share
 * the same pane so a number can be checked where it came from.
 */

const CATEGORY_ORDER = ["Access", "Protection", "Internal", "Extras", "Other"];

const UNIT_SHORT: Record<ConstructionUnit, string> = {
  LM_PER_LIFT: "m",
  M2_PER_LIFT: "m²",
  NR_PER_LIFT: "nr",
  NR: "nr",
  LM: "m",
  M2: "m²",
  PER_WEEK: "weeks",
  FIXED: "item",
};

const MEAS_KINDS = [
  { value: "PERIMETER_LM", label: "Perimeter (m)" },
  { value: "HANDRAIL_LM", label: "Handrail (m)" },
  { value: "BIRDCAGE_M2", label: "Birdcage (m²)" },
  { value: "AREA_LM", label: "Area (m)" },
  { value: "HEIGHT_M", label: "Height (m)" },
  { value: "LIFTS", label: "Lifts" },
];
const MEAS_SOURCES = [
  { value: "MANUAL", label: "Measured" },
  { value: "GOOGLE_EARTH", label: "Google Earth" },
  { value: "DRAWING", label: "Drawing" },
  { value: "CLIENT_SCOPE", label: "Client scope" },
];

const isPerLift = (u: string) => PER_LIFT_UNITS.has(u as ConstructionUnit);
const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The sum behind a line, shown under its name. */
function formulaFor(l: { unit: string; quantity: number; lifts: number | null; rate: number }): string {
  const unit = UNIT_SHORT[l.unit as ConstructionUnit] ?? "";
  const rate = l.rate > 0 ? formatGBP(l.rate) : "no rate";
  if (isPerLift(l.unit)) {
    const lifts = l.lifts ?? 1;
    return `${l.quantity} ${unit} × ${lifts} lift${lifts === 1 ? "" : "s"} × ${rate}`;
  }
  if (l.unit === "PER_WEEK") return `${l.quantity} weeks × ${rate}`;
  return `${l.quantity} ${unit} × ${rate}`;
}

export function ItemsStep({
  quote,
  library,
  lines,
  setLines,
  locked,
  selectedFileId,
  onSelectFile,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
  locked: boolean;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();

  const byId = useMemo(() => new Map(library.map((e) => [e.id, e])), [library]);
  const bracket = (quote.defaultHeightBracket as HeightBracket | null) ?? null;

  const total = useMemo(
    () =>
      lines.reduce(
        (a, l) =>
          a + lineAmount({ unit: l.unit as ConstructionUnit, quantity: l.quantity, lifts: l.lifts, rate: l.rate }),
        0,
      ),
    [lines],
  );

  const groups = useMemo(() => {
    const map = new Map<string, ConstructionLineVM[]>();
    for (const l of lines) {
      const cat = (l.elementId && byId.get(l.elementId)?.category) || "Other";
      const list = map.get(cat) ?? [];
      list.push(l);
      map.set(cat, list);
    }
    return [...map.entries()].sort(
      (a, b) =>
        (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [lines, byId]);

  const addElement = (elementId: string, quantity: number, lifts: number | null) =>
    start(async () => {
      await addConstructionLineFromElement(quote.id, { elementId, quantity, lifts, bracket });
      router.refresh();
    });

  // Rule suggestions (docs/19 §6), opt in, never auto-added.
  const suggestions: { key: string; label: string; add: () => void }[] = [];
  if (!locked) {
    const weeks = inspectionWeeks(quote.durationWeeks);
    const inspEl = library.find((e) => e.unit === "PER_WEEK" || /inspection/i.test(e.name));
    if (weeks > 0 && inspEl && !lines.some((l) => l.elementId === inspEl.id))
      suggestions.push({
        key: "insp",
        label: `${weeks} weekly inspection${weeks === 1 ? "" : "s"}`,
        add: () => addElement(inspEl.id, weeks, null),
      });
    const matEl = library.find((e) => /mat|dummy/i.test(e.name));
    if (needsScaffoldMat(quote.siteType as SiteType | null) && matEl && !lines.some((l) => l.elementId === matEl.id))
      suggestions.push({
        key: "mat",
        label: "Scaffold mat, first lift",
        add: () => addElement(matEl.id, 1, null),
      });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_336px]">
      <div className="flex min-w-0 flex-col gap-3">
        {suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-muted">Suggested</span>
            {suggestions.map((s) => (
              <SuggestionChip key={s.key} onClick={s.add} disabled={busy}>
                + {s.label}
              </SuggestionChip>
            ))}
          </div>
        )}

        <Panel bodyClassName="px-0 pb-0 pt-0">
          {lines.length === 0 ? (
            <div className="px-5 py-6">
              <EmptyHint title="No items yet">
                Add them from the picking list, or read the enquiry and start from what it found.
              </EmptyHint>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <table className="hidden w-full lg:table">
                <thead>
                  <tr className="text-left">
                    <Th className="pl-5">Item</Th>
                    <Th className="w-[62px] text-right">Lifts</Th>
                    <Th className="w-[92px] text-right">Quantity</Th>
                    <Th className="w-[74px]">Unit</Th>
                    <Th className="w-[86px] text-right">Rate</Th>
                    <Th className="w-[108px] text-right">Amount</Th>
                    <Th className="w-[56px] pr-5" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map(([category, rows]) => (
                    <GroupRows
                      key={category}
                      category={category}
                      rows={rows}
                      quoteId={quote.id}
                      locked={locked}
                      setLines={setLines}
                    />
                  ))}
                </tbody>
              </table>

              {/* Mobile cards */}
              <ul className="lg:hidden">
                {lines.map((l) => (
                  <MobileLine key={l.id} line={l} quoteId={quote.id} locked={locked} setLines={setLines} />
                ))}
              </ul>

              <div className="flex flex-wrap items-end justify-between gap-4 border-t border-hairline-strong px-5 py-4">
                <p className="max-w-sm text-xs text-ink-muted">
                  {quote.durationWeeks
                    ? `Extra hire beyond week ${quote.durationWeeks} is quoted as terms.`
                    : "Set a hire duration on the site facts step."}
                </p>
                <div className="text-right">
                  <p className="eyebrow mb-1">Total excluding VAT</p>
                  <p className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                    {formatGBP(total)}
                  </p>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>

      {/* On a phone the running total follows you down a long list. */}
      {lines.length > 0 && (
        <div className="sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t border-hairline bg-page/95 px-6 py-3 backdrop-blur xl:hidden">
          <span className="text-lg font-semibold tabular-nums tracking-tight text-ink">
            {formatGBP(total)}
          </span>
          {!locked && (
            <a href="#picking-list">
              <Button variant="secondary" size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                Add item
              </Button>
            </a>
          )}
        </div>
      )}

      <SidePane
        quote={quote}
        library={library}
        lines={lines}
        locked={locked}
        bracket={bracket}
        band={quote.band as RateBand}
        busy={busy}
        onAddElement={addElement}
        selectedFileId={selectedFileId}
        onSelectFile={onSelectFile}
      />
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-3 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function GroupRows({
  category,
  rows,
  quoteId,
  locked,
  setLines,
}: {
  category: string;
  rows: ConstructionLineVM[];
  quoteId: string;
  locked: boolean;
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
}) {
  return (
    <>
      <tr>
        <td colSpan={7} className="px-5 pb-1.5 pt-4">
          <span className="eyebrow">{category}</span>
        </td>
      </tr>
      {rows.map((l) => (
        <LineRow key={l.id} line={l} quoteId={quoteId} locked={locked} setLines={setLines} />
      ))}
    </>
  );
}

function LineRow({
  line,
  quoteId,
  locked,
  setLines,
}: {
  line: ConstructionLineVM;
  quoteId: string;
  locked: boolean;
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const perLift = isPerLift(line.unit);
  const amount = lineAmount({
    unit: line.unit as ConstructionUnit,
    quantity: line.quantity,
    lifts: line.lifts,
    rate: line.rate,
  });
  const unpriced = line.rate <= 0 && line.quantity > 0;

  const patch = (p: Partial<ConstructionLineVM>) =>
    setLines((prev) => prev.map((x) => (x.id === line.id ? { ...x, ...p } : x)));
  const save = (p: { quantity?: number; lifts?: number | null; rate?: number; description?: string }) =>
    updateConstructionLine(line.id, quoteId, p);

  return (
    <>
      <tr className="group border-t border-hairline align-middle">
        <td className="min-w-0 py-2.5 pl-5 pr-3">
          <input
            value={line.description}
            disabled={locked}
            aria-label="Item"
            onChange={(e) => patch({ description: e.target.value })}
            onBlur={(e) => save({ description: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-ink hover:border-hairline focus-visible:border-ink focus-visible:outline-none disabled:opacity-80"
          />
          <p className="mt-0.5 truncate px-1.5 text-[11px] tabular-nums text-ink-muted">
            {formulaFor(line)}
            {line.isAuto && <span className="ml-2 text-ink-subtle">from enquiry</span>}
          </p>
        </td>
        <td className="py-2.5 pr-3">
          {perLift ? (
            <CellInput
              inputMode="numeric"
              aria-label="Lifts"
              value={line.lifts ?? ""}
              disabled={locked}
              placeholder="—"
              onChange={(e) => patch({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
              onBlur={(e) => save({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          ) : (
            <span className="block text-right text-sm text-ink-subtle">—</span>
          )}
        </td>
        <td className="py-2.5 pr-3">
          <CellInput
            inputMode="decimal"
            aria-label="Quantity"
            value={line.quantity}
            disabled={locked}
            onChange={(e) => patch({ quantity: num(e.target.value) })}
            onBlur={(e) => save({ quantity: num(e.target.value) })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </td>
        <td className="py-2.5 pr-3 text-xs text-ink-muted">{UNIT_LABEL[line.unit as ConstructionUnit]}</td>
        <td className="py-2.5 pr-3">
          <CellInput
            inputMode="decimal"
            aria-label="Rate"
            value={line.rate}
            disabled={locked}
            className={cn(unpriced && "border-amber-500/60")}
            onChange={(e) => patch({ rate: num(e.target.value) })}
            onBlur={(e) => save({ rate: num(e.target.value) })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </td>
        <td className="py-2.5 pr-3 text-right text-sm font-semibold tabular-nums text-ink">
          {formatGBP(amount)}
        </td>
        <td className="py-2.5 pr-5">
          {!locked && (
            <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconButton
                label="Duplicate item"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await duplicateConstructionLine(line.id, quoteId);
                    router.refresh();
                  })
                }
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton
                label="Remove item"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await deleteConstructionLine(line.id, quoteId);
                    router.refresh();
                  })
                }
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
            </span>
          )}
        </td>
      </tr>
      {(unpriced || line.note) && (
        <tr>
          <td colSpan={7} className="px-5 pb-2.5">
            {unpriced ? (
              <RowNotice
                action={
                  <a href="/rates" className="text-xs font-semibold text-ink">
                    Set a rate
                  </a>
                }
              >
                No rate for this item in the chosen band, so it prices at zero.
              </RowNotice>
            ) : (
              <p className="px-1 text-[11px] leading-relaxed text-ink-muted">{line.note}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function MobileLine({
  line,
  quoteId,
  locked,
  setLines,
}: {
  line: ConstructionLineVM;
  quoteId: string;
  locked: boolean;
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const perLift = isPerLift(line.unit);
  const amount = lineAmount({
    unit: line.unit as ConstructionUnit,
    quantity: line.quantity,
    lifts: line.lifts,
    rate: line.rate,
  });
  const unpriced = line.rate <= 0 && line.quantity > 0;
  const patch = (p: Partial<ConstructionLineVM>) =>
    setLines((prev) => prev.map((x) => (x.id === line.id ? { ...x, ...p } : x)));
  const save = (p: { quantity?: number; lifts?: number | null; rate?: number }) =>
    updateConstructionLine(line.id, quoteId, p);

  return (
    <li className="border-t border-hairline px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">{line.description}</p>
          <p className="mt-0.5 text-[11px] tabular-nums text-ink-muted">{formulaFor(line)}</p>
        </div>
        <p className="shrink-0 text-base font-semibold tabular-nums text-ink">{formatGBP(amount)}</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Field label="Lifts" htmlFor={`m-lifts-${line.id}`}>
          <CellInput
            id={`m-lifts-${line.id}`}
            inputMode="numeric"
            value={perLift ? (line.lifts ?? "") : ""}
            disabled={locked || !perLift}
            placeholder={perLift ? "—" : "n/a"}
            onChange={(e) => patch({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
            onBlur={(e) => save({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
          />
        </Field>
        <Field label="Quantity" htmlFor={`m-qty-${line.id}`}>
          <CellInput
            id={`m-qty-${line.id}`}
            inputMode="decimal"
            value={line.quantity}
            disabled={locked}
            onChange={(e) => patch({ quantity: num(e.target.value) })}
            onBlur={(e) => save({ quantity: num(e.target.value) })}
          />
        </Field>
        <Field label="Rate" htmlFor={`m-rate-${line.id}`}>
          <CellInput
            id={`m-rate-${line.id}`}
            inputMode="decimal"
            value={line.rate}
            disabled={locked}
            onChange={(e) => patch({ rate: num(e.target.value) })}
            onBlur={(e) => save({ rate: num(e.target.value) })}
          />
        </Field>
      </div>
      {unpriced && (
        <div className="mt-2.5">
          <RowNotice
            action={
              <a href="/rates" className="text-xs font-semibold text-ink">
                Set a rate
              </a>
            }
          >
            No rate in this band.
          </RowNotice>
        </div>
      )}
      {!locked && (
        <div className="mt-2 flex justify-end gap-1">
          <IconButton
            label="Duplicate item"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await duplicateConstructionLine(line.id, quoteId);
                router.refresh();
              })
            }
          >
            <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
          <IconButton
            label="Remove item"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await deleteConstructionLine(line.id, quoteId);
                router.refresh();
              })
            }
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </IconButton>
        </div>
      )}
    </li>
  );
}

// --- The side pane: picking list / measurements / drawing -------------------

type Tab = "picking" | "measurements" | "drawing";

function SidePane({
  quote,
  library,
  lines,
  locked,
  bracket,
  band,
  busy,
  onAddElement,
  selectedFileId,
  onSelectFile,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  locked: boolean;
  bracket: HeightBracket | null;
  band: RateBand;
  busy: boolean;
  onAddElement: (elementId: string, quantity: number, lifts: number | null) => void;
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("picking");
  const previewable = quote.attachments.filter(isPreviewable);

  const tabs: { key: Tab; label: string }[] = [
    { key: "picking", label: "Picking list" },
    { key: "measurements", label: `Measurements${quote.measurements.length ? ` (${quote.measurements.length})` : ""}` },
    { key: "drawing", label: "Drawing" },
  ];

  return (
    <aside
      id="picking-list"
      className="flex scroll-mt-20 flex-col rounded-xl border border-hairline bg-canvas xl:sticky xl:top-20 xl:max-h-[calc(100vh-7rem)] xl:self-start"
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-3 pt-2">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px h-10 border-b-2 px-2.5 text-[13px] transition-colors",
              tab === t.key
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "picking" && (
          <PickingList
            library={library}
            lines={lines}
            locked={locked}
            bracket={bracket}
            band={band}
            busy={busy}
            onAdd={onAddElement}
            quoteId={quote.id}
          />
        )}
        {tab === "measurements" && <Measurements quote={quote} locked={locked} />}
        {tab === "drawing" &&
          (previewable.length === 0 ? (
            <div className="p-4">
              <EmptyHint title="No drawings">Add files on the enquiry step to view them here.</EmptyHint>
            </div>
          ) : (
            <div className="h-[520px]">
              <ReferenceViewerBody
                attachments={previewable}
                selectedId={selectedFileId}
                onSelect={onSelectFile}
              />
            </div>
          ))}
      </div>
    </aside>
  );
}

function PickingList({
  library,
  lines,
  locked,
  bracket,
  band,
  busy,
  onAdd,
  quoteId,
}: {
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  locked: boolean;
  bracket: HeightBracket | null;
  band: RateBand;
  busy: boolean;
  onAdd: (elementId: string, quantity: number, lifts: number | null) => void;
  quoteId: string;
}) {
  const [query, setQuery] = useState("");
  const [customOpen, setCustomOpen] = useState(false);

  // The rate the line would resolve to on this quote, same ladder as the engine.
  const rateFor = (e: ConstructionElementLibVM): string => {
    const rate = resolveConstructionRate(
      e.rates.map((r) => ({ band: r.band as RateBand, bracket: r.bracket as HeightBracket, rate: r.rate })),
      band,
      e.usesHeightBracket ? bracket : "ANY",
    );
    if (rate == null || rate <= 0) return "No rate set";
    return `${formatGBP(rate)} per ${UNIT_LABEL[e.unit as ConstructionUnit]}`;
  };

  const filtered = useMemo(() => {
    const s = query.trim().toLowerCase();
    const items = s
      ? library.filter(
          (e) =>
            e.name.toLowerCase().includes(s) ||
            e.aliases.some((a) => a.toLowerCase().includes(s)),
        )
      : library;
    const map = new Map<string, ConstructionElementLibVM[]>();
    for (const e of items) {
      const cat = e.category || "Other";
      const list = map.get(cat) ?? [];
      list.push(e);
      map.set(cat, list);
    }
    return [...map.entries()].sort(
      (a, b) => (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [library, query]);

  const used = useMemo(() => new Set(lines.map((l) => l.elementId).filter(Boolean) as string[]), [lines]);

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-[1] bg-canvas px-4 pb-2 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
            strokeWidth={2}
            aria-hidden
          />
          <label className="sr-only" htmlFor="pick-search">
            Search the picking list
          </label>
          <input
            id="pick-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items or client wording"
            className="h-9 w-full rounded-lg border border-hairline-strong bg-canvas pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
          />
        </div>
      </div>

      <div className="px-4 pb-3">
        {filtered.length === 0 && (
          <p className="py-4 text-center text-xs text-ink-muted">Nothing matches that wording.</p>
        )}
        {filtered.map(([category, items]) => (
          <div key={category}>
            <p className="eyebrow px-1 pb-1.5 pt-3">{category}</p>
            {items.map((e) => (
              <div
                key={e.id}
                className="group -mx-2 flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-surface/70"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {e.name}
                    {used.has(e.id) && <span className="ml-1.5 text-[11px] text-ink-subtle">added</span>}
                  </span>
                  <span className="block truncate text-[11px] tabular-nums text-ink-muted">{rateFor(e)}</span>
                </span>
                <IconButton
                  label={`Add ${e.name}`}
                  disabled={locked || busy}
                  onClick={() => onAdd(e.id, 0, e.usesLifts && /haki/i.test(e.name) ? HAKI_LIFTS : null)}
                  className="h-7 w-7 border border-hairline-strong"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
                </IconButton>
              </div>
            ))}
          </div>
        ))}
      </div>

      {!locked && (
        <div className="border-t border-hairline p-4">
          {customOpen ? (
            <CustomItemForm quoteId={quoteId} onDone={() => setCustomOpen(false)} />
          ) : (
            <Button variant="secondary" size="sm" className="w-full gap-1.5" onClick={() => setCustomOpen(true)}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              Add an item that is not listed
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function CustomItemForm({ quoteId, onDone }: { quoteId: string; onDone: () => void }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState<ConstructionUnit>("NR");
  const [quantity, setQuantity] = useState("");
  const [lifts, setLifts] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () => {
    if (!description.trim()) return setError("Give the item a name.");
    setError(null);
    start(async () => {
      const res = await addConstructionCustomLine(quoteId, {
        description,
        unit,
        quantity: quantity === "" ? 0 : num(quantity),
        lifts: lifts === "" ? null : Math.trunc(num(lifts)),
        rate: rate === "" ? 0 : num(rate),
      });
      if (!res.ok) return setError(res.error ?? "Could not add that item.");
      router.refresh();
      onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <Field label="Item" htmlFor="c-desc">
        <Input
          id="c-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Up and over stair set"
          className="h-9"
        />
      </Field>
      <Field label="Unit" htmlFor="c-unit">
        <Select
          id="c-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value as ConstructionUnit)}
          className="h-9"
        >
          {(Object.keys(UNIT_LABEL) as ConstructionUnit[]).map((u) => (
            <option key={u} value={u}>
              {UNIT_LABEL[u]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Qty" htmlFor="c-qty">
          <CellInput id="c-qty" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </Field>
        <Field label="Lifts" htmlFor="c-lifts">
          <CellInput id="c-lifts" inputMode="numeric" value={lifts} onChange={(e) => setLifts(e.target.value)} />
        </Field>
        <Field label="Rate" htmlFor="c-rate">
          <CellInput id="c-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-xs text-ink">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={add} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Measurements({ quote, locked }: { quote: ConstructionQuoteVM; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);

  return (
    <div className="p-4">
      {quote.measurements.length === 0 ? (
        <EmptyHint title="No measurements">
          Record what you measured, so every quantity on the quote is traceable.
        </EmptyHint>
      ) : (
        <ul className="flex flex-col">
          {quote.measurements.map((m) => (
            <li key={m.id} className="group flex items-center gap-3 border-b border-hairline py-2.5 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink">{m.label}</span>
                <span className="block truncate text-[11px] text-ink-muted">
                  {MEAS_SOURCES.find((s) => s.value === m.source)?.label ?? m.source ?? "Measured"}
                  {m.note ? ` · ${m.note}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                {m.valueNumber}
                {m.lifts ? ` × ${m.lifts}` : ""}
              </span>
              {!locked && (
                <IconButton
                  label="Remove measurement"
                  disabled={pending}
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() =>
                    start(async () => {
                      await deleteConstructionMeasurement(m.id, quote.id);
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {!locked && (
        <div className="mt-3">
          {open ? (
            <AddMeasurement quoteId={quote.id} onDone={() => setOpen(false)} />
          ) : (
            <Button variant="secondary" size="sm" className="w-full gap-1.5" onClick={() => setOpen(true)}>
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              Add a measurement
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddMeasurement({ quoteId, onDone }: { quoteId: string; onDone: () => void }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("PERIMETER_LM");
  const [value, setValue] = useState("");
  const [lifts, setLifts] = useState("");
  const [source, setSource] = useState("MANUAL");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () => {
    if (!label.trim()) return setError("Give it a label.");
    if (value === "") return setError("Enter a value.");
    setError(null);
    start(async () => {
      const res = await addConstructionMeasurement(quoteId, {
        label,
        kind,
        valueNumber: num(value),
        lifts: lifts === "" ? null : Math.trunc(num(lifts)),
        source,
      });
      if (!res.ok) return setError(res.error ?? "Could not add that.");
      router.refresh();
      onDone();
    });
  };

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-hairline p-3">
      <Field label="Label" htmlFor="m-label">
        <Input id="m-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Blue perimeter" className="h-9" />
      </Field>
      <Field label="Kind" htmlFor="m-kind">
        <Select id="m-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="h-9">
          {MEAS_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Value" htmlFor="m-value">
          <CellInput id="m-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Lifts" htmlFor="m-lifts">
          <CellInput id="m-lifts" inputMode="numeric" value={lifts} onChange={(e) => setLifts(e.target.value)} />
        </Field>
      </div>
      <Field label="Source" htmlFor="m-source">
        <Select id="m-source" value={source} onChange={(e) => setSource(e.target.value)} className="h-9">
          {MEAS_SOURCES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
      {error && <p className="text-xs text-ink">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 gap-1.5" onClick={add} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
