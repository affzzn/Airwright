"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import {
  createConstructionElement,
  saveConstructionHireTerms,
  saveConstructionRate,
  updateConstructionElement,
} from "@/server/actions/constructionRates";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { CellInput, EmptyHint, IconButton, Panel } from "@/components/construction/parts";
import {
  BAND_LABEL,
  BRACKET_LABEL,
  UNIT_LABEL,
  type ConstructionUnit,
  type HeightBracket,
  type RateBand,
} from "@/lib/construction/types";
import { cn, formatGBP } from "@/lib/utils";

/**
 * The item library, as a MATRIX (docs/19 §9). Airwright price one item at a rate
 * per height bracket per commercial band, so a flat list cannot show it: this is
 * items down, brackets across, with a band switcher. The hire terms that travel
 * with each rate (base weeks, extra hire per week, the percentage charged) sit at
 * the end of the row, because they vary by item and band but not by bracket.
 *
 * Imported from Airwright's own sheet by `scripts/import-rate-sheet.mts`.
 */

export interface ConstructionRateVM {
  id: string;
  band: string;
  bracket: string;
  rate: number;
  baseHireWeeks: number;
  extraHirePerWeek: number;
  extraHireChargePct: number;
}
export interface ConstructionElementVM {
  id: string;
  line: string;
  name: string;
  aliases: string[];
  category: string | null;
  unit: string;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote: string | null;
  sourceTitle: string | null;
  isActive: boolean;
  rates: ConstructionRateVM[];
}

/**
 * This tab is the CONSTRUCTION library only. A construction quote picks from the
 * construction items plus the general ones that apply to any job (daywork,
 * netting, design, inspections), so the tab shows exactly that set and nothing
 * from the house-build side.
 */
const LINES = ["CONSTRUCTION", "GENERAL"];
const BANDS: RateBand[] = ["HIGH", "MEDIUM", "COMPETITIVE", "SUPER_COMPETITIVE"];
const BRACKETS: HeightBracket[] = [
  "UP_TO_6M",
  "H6_12M",
  "H12_18M",
  "H18_24M",
  "H24_30M",
  "ANY",
];
const BRACKET_SHORT: Record<HeightBracket, string> = {
  UP_TO_6M: "≤ 6 m",
  H6_12M: "6–12",
  H12_18M: "12–18",
  H18_24M: "18–24",
  H24_30M: "24–30",
  ANY: "Any",
};
const CATEGORY_ORDER = ["Access", "Protection", "Internal", "Extras"];
const UNIT_OPTS = (Object.keys(UNIT_LABEL) as ConstructionUnit[]).map((u) => ({
  value: u,
  label: UNIT_LABEL[u],
}));

const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function ConstructionRatesManager({ elements }: { elements: ConstructionElementVM[] }) {
  const [band, setBand] = useState<RateBand>("COMPETITIVE");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  const visible = useMemo(() => {
    const s = query.trim().toLowerCase();
    return elements
      .filter((e) => LINES.includes(e.line))
      .filter((e) => showInactive || e.isActive)
      .filter(
        (e) =>
          !s ||
          e.name.toLowerCase().includes(s) ||
          (e.sourceTitle ?? "").toLowerCase().includes(s) ||
          e.aliases.some((a) => a.toLowerCase().includes(s)),
      );
  }, [elements, showInactive, query]);

  /** Only show bracket columns this line actually prices. */
  const columns = useMemo(() => {
    const used = new Set<string>();
    for (const e of visible) for (const r of e.rates) used.add(r.bracket);
    const cols = BRACKETS.filter((b) => used.has(b));
    return cols.length ? cols : (["ANY"] as HeightBracket[]);
  }, [visible]);

  const groups = useMemo(() => {
    const map = new Map<string, ConstructionElementVM[]>();
    for (const e of visible) {
      const cat = e.category || "Extras";
      const list = map.get(cat) ?? [];
      list.push(e);
      map.set(cat, list);
    }
    return [...map.entries()].sort(
      (a, b) => (CATEGORY_ORDER.indexOf(a[0]) + 1 || 99) - (CATEGORY_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [visible]);

  const priced = visible.filter((e) => e.rates.some((r) => r.band === band && r.rate > 0)).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Item library</h2>
          <p className="mt-1 text-xs text-ink-muted">
            {priced} of {visible.length} items priced on this band.
          </p>
        </div>
        <Button variant="secondary" className="gap-2" onClick={() => setNewOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={2} /> New item
        </Button>
      </div>

      {/* Band + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">Band</span>
          <div className="flex items-center gap-1 rounded-lg border border-hairline bg-canvas p-1">
            {BANDS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBand(b)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs transition-colors",
                  band === b ? "bg-ink font-semibold text-canvas" : "text-ink-muted hover:text-ink",
                )}
              >
                {BAND_LABEL[b]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#1b1a17]"
            />
            Show retired
          </label>
          <div className="relative w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
              strokeWidth={2}
              aria-hidden
            />
            <label className="sr-only" htmlFor="rate-search">
              Search items
            </label>
            <input
              id="rate-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items"
              className="h-9 w-full rounded-lg border border-hairline-strong bg-canvas pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
            />
          </div>
        </div>
      </div>

      <Panel bodyClassName="px-0 pb-0 pt-0">
        {visible.length === 0 ? (
          <div className="px-5 py-6">
            <EmptyHint title="Nothing here yet">
              Import Airwright&apos;s sheet, or add an item by hand.
            </EmptyHint>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="text-left">
                  <Th className="pl-5">Item</Th>
                  {columns.map((c) => (
                    <Th key={c} className="w-[88px] text-right">
                      {BRACKET_SHORT[c]}
                    </Th>
                  ))}
                  <Th className="w-[74px] text-right">Base wk</Th>
                  <Th className="w-[86px] text-right">E/H £/wk</Th>
                  <Th className="w-[70px] text-right">Charge</Th>
                  <Th className="w-[44px] pr-5" />
                </tr>
              </thead>
              <tbody>
                {groups.map(([category, items]) => (
                  <Fragment key={category}>
                    <tr>
                      <td colSpan={columns.length + 5} className="px-5 pb-1.5 pt-4">
                        <span className="eyebrow">{category}</span>
                      </td>
                    </tr>
                    {items.map((e) => (
                      <ElementRow key={e.id} element={e} band={band} columns={columns} />
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-ink-muted">
        A blank cell has no rate on this band, so a line using it prices at zero. Hire terms are
        per item and band: the rate already includes “Base wk” weeks, and each week past that is
        charged at “E/H £/wk” times “Charge”.
      </p>

      <NewElementModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "px-2 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

function ElementRow({
  element,
  band,
  columns,
}: {
  element: ConstructionElementVM;
  band: RateBand;
  columns: HeightBracket[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const inBand = element.rates.filter((r) => r.band === band);
  const terms = inBand[0];

  const saveRate = (bracket: HeightBracket, rate: number) =>
    start(async () => {
      await saveConstructionRate({ elementId: element.id, band, bracket, rate });
      router.refresh();
    });

  const saveTerms = (patch: {
    baseHireWeeks?: number;
    extraHirePerWeek?: number;
    extraHireChargePct?: number;
  }) =>
    start(async () => {
      await saveConstructionHireTerms({ elementId: element.id, band, ...patch });
      router.refresh();
    });

  return (
    <tr className={cn("group border-t border-hairline", !element.isActive && "opacity-50")}>
      <td className="py-2 pl-5 pr-2">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink">{element.name}</span>
          {element.usesLifts && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
              per lift
            </span>
          )}
          {!element.isActive && (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
              retired
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[11px] text-ink-muted" title={element.sourceTitle ?? ""}>
          {UNIT_LABEL[element.unit as ConstructionUnit] ?? element.unit}
          {element.sourceTitle ? ` · ${element.sourceTitle}` : ""}
        </span>
      </td>

      {columns.map((c) => {
        const r = inBand.find((x) => x.bracket === c);
        const has = element.rates.some((x) => x.bracket === c);
        if (!has) return <td key={c} className="px-2 py-2 text-right text-xs text-ink-subtle">—</td>;
        return (
          <td key={c} className="px-2 py-2">
            <RateCell value={r?.rate ?? 0} disabled={pending} onSave={(v) => saveRate(c, v)} />
          </td>
        );
      })}

      <td className="px-2 py-2">
        <RateCell
          value={terms?.baseHireWeeks ?? 0}
          disabled={pending || !terms}
          onSave={(v) => saveTerms({ baseHireWeeks: v })}
        />
      </td>
      <td className="px-2 py-2">
        <RateCell
          value={terms?.extraHirePerWeek ?? 0}
          disabled={pending || !terms}
          onSave={(v) => saveTerms({ extraHirePerWeek: v })}
        />
      </td>
      <td className="px-2 py-2">
        <RateCell
          value={terms?.extraHireChargePct ?? 0}
          suffix="%"
          disabled={pending || !terms}
          onSave={(v) => saveTerms({ extraHireChargePct: v })}
        />
      </td>
      <td className="py-2 pr-5 text-right">
        <IconButton
          label={element.isActive ? "Retire item" : "Restore item"}
          disabled={pending}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={() =>
            start(async () => {
              if (element.isActive) {
                await updateConstructionElement(element.id, { isActive: false });
              } else {
                await updateConstructionElement(element.id, { isActive: true });
              }
              router.refresh();
            })
          }
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </IconButton>
      </td>
    </tr>
  );
}

/** A rate cell that only writes on blur, so typing never fires a round trip. */
function RateCell({
  value,
  onSave,
  disabled,
  suffix,
}: {
  value: number;
  onSave: (v: number) => void;
  disabled?: boolean;
  suffix?: string;
}) {
  const [v, setV] = useState(String(value));
  const [focused, setFocused] = useState(false);
  const shown = focused ? v : value === 0 ? "" : String(value);
  return (
    <div className="relative">
      <CellInput
        inputMode="decimal"
        aria-label="Rate"
        value={shown}
        disabled={disabled}
        placeholder="—"
        className={cn(suffix && "pr-5")}
        onFocus={() => {
          setV(String(value));
          setFocused(true);
        }}
        onChange={(e) => setV(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          const next = num(e.target.value);
          if (next !== value) onSave(next);
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      {suffix && value !== 0 && !focused && (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[11px] text-ink-subtle">
          {suffix}
        </span>
      )}
    </div>
  );
}

function NewElementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<ConstructionUnit>("LM");
  const [category, setCategory] = useState("Access");
  const [usesLifts, setUsesLifts] = useState(false);
  const [usesBracket, setUsesBracket] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      const res = await createConstructionElement({
        line: "CONSTRUCTION",
        name,
        unit,
        category,
        usesLifts,
        usesHeightBracket: usesBracket,
      });
      if (!res.ok) return setError(res.error ?? "Could not create that item.");
      setName("");
      onClose();
      router.refresh();
    });

  return (
    <Modal open={open} onClose={onClose} label="New item" className="max-w-md">
      <div className="px-6 py-5">
        <h2 className="text-base font-semibold text-ink">New item</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Set its rates in the table after.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <Label htmlFor="ne-name">Name</Label>
            <Input id="ne-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ne-unit">Unit</Label>
              <Select
                id="ne-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as ConstructionUnit)}
              >
                {UNIT_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ne-cat">Category</Label>
              <Select id="ne-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORY_ORDER.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={usesLifts}
              onChange={(e) => setUsesLifts(e.target.checked)}
              className="h-4 w-4 accent-[#1b1a17]"
            />
            Priced per lift
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={usesBracket}
              onChange={(e) => setUsesBracket(e.target.checked)}
              className="h-4 w-4 accent-[#1b1a17]"
            />
            Rate varies by height bracket
          </label>
          {error && <p className="text-xs text-ink">{error}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={pending || !name.trim()} className="gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export { formatGBP };
