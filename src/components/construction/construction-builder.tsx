"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Lock, PanelRight, Plus, Trash2, Unlock } from "lucide-react";
import {
  addConstructionCustomLine,
  addConstructionLineFromElement,
  addConstructionMeasurement,
  deleteConstructionLine,
  deleteConstructionMeasurement,
  duplicateConstructionLine,
  setConstructionQuoteStatus,
  updateConstructionLine,
  updateConstructionQuote,
} from "@/server/actions/construction";
import type {
  ConstructionElementLibVM,
  ConstructionLineVM,
  ConstructionQuoteVM,
} from "@/server/construction";
import { lineAmount, priceConstructionQuote } from "@/lib/construction/price";
import {
  HAKI_LIFTS,
  foamCount,
  heightBracketFor,
  inspectionWeeks,
  needsScaffoldMat,
  suggestedLiftsFor,
  validateConstructionQuote,
} from "@/lib/construction/rules";
import {
  BAND_LABEL,
  BRACKET_LABEL,
  PER_LIFT_UNITS,
  SITE_TYPE_LABEL,
  UNIT_LABEL,
  type ConstructionUnit,
  type HeightBracket,
  type RateBand,
  type SiteType,
} from "@/lib/construction/types";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ConstructionAttachments } from "@/components/construction/construction-attachments";
import {
  ReferencePane,
  isPreviewable,
} from "@/components/construction/construction-reference-viewer";
import { DraftFromScope } from "@/components/construction/draft-from-scope";
import { cn, formatGBP } from "@/lib/utils";

const BAND_OPTS = (Object.keys(BAND_LABEL) as RateBand[]).map((b) => ({ value: b, label: BAND_LABEL[b] }));
const SITE_OPTS = (Object.keys(SITE_TYPE_LABEL) as SiteType[]).map((s) => ({ value: s, label: SITE_TYPE_LABEL[s] }));
const BRACKET_OPTS = (Object.keys(BRACKET_LABEL) as HeightBracket[]).map((b) => ({ value: b, label: BRACKET_LABEL[b] }));
const MEAS_KINDS = [
  { value: "PERIMETER_LM", label: "Perimeter (LM)" },
  { value: "HANDRAIL_LM", label: "Handrail perimeter (LM)" },
  { value: "BIRDCAGE_M2", label: "Birdcage (m²)" },
  { value: "AREA_LM", label: "Area / elevation (LM)" },
  { value: "HEIGHT_M", label: "Height (m)" },
  { value: "LIFTS", label: "Lifts (nr)" },
];
const MEAS_SOURCES = [
  { value: "MANUAL", label: "Manual" },
  { value: "GOOGLE_EARTH", label: "Google Earth" },
  { value: "DRAWING", label: "Drawing" },
  { value: "CLIENT_SCOPE", label: "Client scope" },
];

// A per-lift unit line needs a lift count.
const isPerLift = (u: string) => PER_LIFT_UNITS.has(u as ConstructionUnit);
const num = (v: string): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function ConstructionBuilder({
  quote,
  library,
  aiEnabled = false,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  aiEnabled?: boolean;
}) {
  const router = useRouter();
  const locked = quote.status !== "DRAFT";

  // Local, live copy of the priced lines. Re-synced when the SET of lines changes
  // (add/remove/duplicate → router.refresh), not on inline field edits.
  const [lines, setLines] = useState<ConstructionLineVM[]>(quote.lines);
  const lineSig = quote.lines.map((l) => l.id).join(",");
  useEffect(() => {
    setLines(quote.lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineSig]);

  const priced = useMemo(
    () =>
      priceConstructionQuote({
        lines: lines.map((l) => ({ unit: l.unit as ConstructionUnit, quantity: l.quantity, lifts: l.lifts, rate: l.rate })),
        extraHirePctPerWeek: quote.extraHirePctPerWeek,
      }),
    [lines, quote.extraHirePctPerWeek],
  );

  const flags = useMemo(
    () =>
      validateConstructionQuote({
        durationWeeks: quote.durationWeeks,
        buildingHeightM: quote.buildingHeightM,
        defaultHeightBracket: quote.defaultHeightBracket as HeightBracket | null,
        siteType: quote.siteType as SiteType | null,
        lineCount: lines.length,
        measurementCount: quote.measurements.length,
        unpricedLineCount: lines.filter((l) => l.rate <= 0 && l.quantity > 0).length,
        perLiftLinesMissingLifts: lines.filter((l) => isPerLift(l.unit) && (l.lifts == null || l.lifts <= 0)).length,
        hasInferredValues: quote.measurements.some((m) => m.source === "GOOGLE_EARTH" || m.source === "DRAWING"),
      }),
    [lines, quote],
  );

  const [statusPending, startStatus] = useTransition();
  const toggleLock = () =>
    startStatus(async () => {
      await setConstructionQuoteStatus(quote.id, locked ? "DRAFT" : "CONFIRMED");
      router.refresh();
    });

  // Reference viewer (drawings/photos beside the form).
  const previewable = quote.attachments.filter(isPreviewable);
  const [refOpen, setRefOpen] = useState(false);
  const [refFile, setRefFile] = useState<string | null>(previewable[0]?.id ?? null);
  const openRef = (id: string) => {
    setRefFile(id);
    setRefOpen(true);
  };

  // The reference pane shows inline beside the form on large screens only.
  const showPane = refOpen && previewable.length > 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Breadcrumbs
          items={[
            { label: "Construction", href: "/construction" },
            { label: quote.reference || quote.customerName || "Quote" },
          ]}
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-ink">
                {quote.reference || quote.customerName || "Untitled quote"}
              </h1>
              <Badge variant={locked ? "solid" : "muted"}>
                {locked ? (quote.status === "QUOTED" ? "Quoted" : "Confirmed") : "Draft"}
              </Badge>
            </div>
            {quote.siteAddress && <p className="mt-1 text-sm text-ink-subtle">{quote.siteAddress}</p>}
          </div>
          <div className="flex items-center gap-2">
            {previewable.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => setRefOpen((v) => !v)}
                className="hidden gap-1.5 lg:inline-flex"
                title="Show the drawings beside the form"
              >
                <PanelRight className="h-4 w-4" strokeWidth={1.75} />
                {refOpen ? "Hide reference" : "Reference"}
              </Button>
            )}
            <Link href={`/construction/${quote.id}/quote`}>
              <Button variant="secondary">Open quote</Button>
            </Link>
            <Button variant={locked ? "secondary" : "primary"} onClick={toggleLock} disabled={statusPending} className="gap-1.5">
              {statusPending ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : locked ? (
                <Unlock className="h-4 w-4" strokeWidth={1.75} />
              ) : (
                <Lock className="h-4 w-4" strokeWidth={1.75} />
              )}
              {locked ? "Reopen" : "Confirm"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-6">
        {/* The builder. When the reference pane is open it collapses to a single
            column (so it stays readable in the remaining width) — NOT a squished
            3-column grid. */}
        <div className="min-w-0 flex-1">
          <div className={cn("grid gap-6", showPane ? "grid-cols-1" : "lg:grid-cols-3")}>
            {/* Working area */}
            <div className={cn("space-y-6", showPane ? "" : "lg:col-span-2")}>
              <EnquiryReview quote={quote} locked={locked} />
              <MeasurementsPanel quote={quote} locked={locked} />
              <LineBuilder
                quote={quote}
                library={library}
                lines={lines}
                setLines={setLines}
                locked={locked}
                aiEnabled={aiEnabled}
              />
            </div>

            {/* Summary, attachments, checks */}
            <div className="space-y-6">
              <div className={cn("space-y-6", showPane ? "" : "lg:sticky lg:top-20")}>
            <QuoteSummary quote={quote} total={priced.total} extraHire={priced.extraHirePerWeek} locked={locked} />
            <Card>
              <CardHeader className="py-3"><h2 className="text-sm font-semibold text-ink">Attachments</h2></CardHeader>
              <CardBody className="py-3">
                <p className="mb-2 text-[11px] text-ink-subtle">
                  Reference only — drawings and the enquiry email are shown, never read by AI.
                </p>
                <ConstructionAttachments
                  quoteId={quote.id}
                  attachments={quote.attachments}
                  locked={locked}
                  onView={openRef}
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader className="py-3"><h2 className="text-sm font-semibold text-ink">Assumptions &amp; checks</h2></CardHeader>
              <CardBody className="py-3">
                {flags.length === 0 ? (
                  <p className="text-xs text-ink-subtle">All set — nothing outstanding.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {flags.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className={f.level === "warn" ? "mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" : "mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-subtle"} />
                        <span className={f.level === "warn" ? "text-ink" : "text-ink-muted"}>{f.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
              </div>
            </div>
          </div>
        </div>

        {/* Reference pane — inline flex child on large screens (a real column, not
            a fixed overlay), so nothing squishes. Hidden below lg (no room to
            split); there, "View" opens the file in a new tab instead. */}
        {showPane && (
          <aside className="hidden w-[42vw] max-w-[820px] shrink-0 lg:block">
            <div className="sticky top-20 h-[calc(100vh-6.5rem)]">
              <ReferencePane
                onClose={() => setRefOpen(false)}
                quoteId={quote.id}
                attachments={previewable}
                selectedId={refFile}
                onSelect={setRefFile}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// --- Quote summary (header money) -------------------------------------------

function QuoteSummary({
  quote,
  total,
  extraHire,
  locked,
}: {
  quote: ConstructionQuoteVM;
  total: number;
  extraHire: number | null;
  locked: boolean;
}) {
  return (
    <Card>
      <CardBody className="space-y-3">
        <div>
          <p className="eyebrow mb-1">Quote total</p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{formatGBP(total)}</p>
          <p className="mt-0.5 text-[11px] text-ink-subtle">Inclusive of the hire period. ⚠ Placeholder rates.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-sm">
          <HeaderField
            label="Band"
            control={
              <SmallSelect
                value={quote.band}
                disabled={locked}
                onChange={(v) => updateConstructionQuote(quote.id, { band: v })}
                refreshOnChange
                opts={BAND_OPTS}
              />
            }
          />
          <HeaderField
            label="Duration (weeks)"
            control={<SmallNumber value={quote.durationWeeks} disabled={locked} onSave={(v) => updateConstructionQuote(quote.id, { durationWeeks: v })} />}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <HeaderField
            label="Extra hire %/wk"
            control={<SmallNumber value={quote.extraHirePctPerWeek} step="0.01" disabled={locked} onSave={(v) => updateConstructionQuote(quote.id, { extraHirePctPerWeek: v })} />}
          />
          <div>
            <p className="mb-1 text-[11px] text-ink-subtle">Extra hire / week</p>
            <p className="tabular-nums text-ink">{extraHire != null ? formatGBP(extraHire) : "—"}</p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function HeaderField({ label, control }: { label: string; control: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] text-ink-subtle">{label}</p>
      {control}
    </div>
  );
}

// --- Enquiry review panel ----------------------------------------------------

function EnquiryReview({ quote, locked }: { quote: ConstructionQuoteVM; locked: boolean }) {
  const router = useRouter();
  const [height, setHeight] = useState(quote.buildingHeightM != null ? String(quote.buildingHeightM) : "");
  const suggestedBracket = heightBracketFor(height ? num(height) : null);
  const suggestedLifts = suggestedLiftsFor(height ? num(height) : null);

  const saveHeight = () => {
    const v = height === "" ? null : num(height);
    // Auto-fill the default bracket from the height if not set yet.
    const patch: Parameters<typeof updateConstructionQuote>[1] = { buildingHeightM: v };
    if (v != null && !quote.defaultHeightBracket) patch.defaultHeightBracket = heightBracketFor(v);
    updateConstructionQuote(quote.id, patch).then(() => router.refresh());
  };

  return (
    <Card>
      <CardHeader className="py-3">
        <h2 className="text-sm font-semibold text-ink">Enquiry review</h2>
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          The site facts you enter by hand — they drive the mat / foam / bracket suggestions.
        </p>
      </CardHeader>
      <CardBody className="space-y-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="er-site">Site type</Label>
            <Select id="er-site" value={quote.siteType ?? ""} disabled={locked}
              onChange={(e) => updateConstructionQuote(quote.id, { siteType: e.target.value || null }).then(() => router.refresh())}>
              <option value="">—</option>
              {SITE_OPTS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="er-height">Building height (m)</Label>
            <Input id="er-height" inputMode="decimal" value={height} disabled={locked}
              onChange={(e) => setHeight(e.target.value)} onBlur={saveHeight}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} placeholder="e.g. 4" />
            {suggestedBracket && (
              <p className="mt-1 text-[11px] text-ink-subtle">
                → {BRACKET_LABEL[suggestedBracket]}{suggestedLifts ? `, ~${suggestedLifts} lifts` : ""}
              </p>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="er-bracket">Default height bracket</Label>
            <Select id="er-bracket" value={quote.defaultHeightBracket ?? ""} disabled={locked}
              onChange={(e) => updateConstructionQuote(quote.id, { defaultHeightBracket: e.target.value || null }).then(() => router.refresh())}>
              <option value="">—</option>
              {BRACKET_OPTS.filter((b) => b.value !== "ANY").map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </Select>
          </div>
          <div>
            <Label htmlFor="er-enq">Enquiry type</Label>
            <Select id="er-enq" value={quote.enquiryType ?? "DETAILED"} disabled={locked}
              onChange={(e) => updateConstructionQuote(quote.id, { enquiryType: e.target.value })}>
              <option value="VAGUE">Vague</option>
              <option value="SCOPE_OF_WORKS">Scope of works</option>
              <option value="DETAILED">Detailed</option>
            </Select>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-ink">Access points needing foam</p>
          <div className="grid grid-cols-3 gap-3">
            <CountField label="Doorways" value={quote.doorwayCount} disabled={locked}
              onSave={(v) => updateConstructionQuote(quote.id, { doorwayCount: v })} />
            <CountField label="Fire exits" value={quote.fireExitCount} disabled={locked}
              onSave={(v) => updateConstructionQuote(quote.id, { fireExitCount: v })} />
            <CountField label="Walk-unders" value={quote.pedestrianAccessCount} disabled={locked}
              onSave={(v) => updateConstructionQuote(quote.id, { pedestrianAccessCount: v })} />
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function CountField({
  label, value, onSave, disabled,
}: {
  label: string; value: number | null; onSave: (v: number | null) => void; disabled: boolean;
}) {
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => setV(value != null ? String(value) : ""), [value]);
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-subtle">{label}</label>
      <Input inputMode="numeric" value={v} disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => onSave(v === "" ? null : Math.trunc(num(v)))}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className="h-9" />
    </div>
  );
}

// --- Measurements panel ------------------------------------------------------

function MeasurementsPanel({ quote, locked }: { quote: ConstructionQuoteVM; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const remove = (id: string) => start(async () => { await deleteConstructionMeasurement(id, quote.id); router.refresh(); });

  return (
    <Card>
      <CardHeader className="py-3">
        <h2 className="text-sm font-semibold text-ink">Measurements</h2>
        <p className="mt-0.5 text-[11px] text-ink-subtle">
          What you measured (Google Earth / drawing / by hand). Kept separate from the priced lines.
        </p>
      </CardHeader>
      <CardBody className="py-3">
        {quote.measurements.length > 0 && (
          <table className="mb-3 w-full text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                <th className="py-1.5 pr-3 font-medium">Label</th>
                <th className="py-1.5 pr-3 font-medium">Kind</th>
                <th className="py-1.5 pr-3 text-right font-medium">Value</th>
                <th className="py-1.5 pr-3 font-medium">Lifts</th>
                <th className="py-1.5 pr-3 font-medium">Source</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {quote.measurements.map((m) => (
                <tr key={m.id} className="border-b border-hairline last:border-0">
                  <td className="py-1.5 pr-3 text-ink">{m.label}</td>
                  <td className="py-1.5 pr-3 text-ink-muted">{MEAS_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-ink">{m.valueNumber}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink-muted">{m.lifts ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-ink-subtle">{MEAS_SOURCES.find((s) => s.value === m.source)?.label ?? m.source ?? "—"}</td>
                  <td className="py-1.5">
                    {!locked && (
                      <button type="button" aria-label="Remove measurement" onClick={() => remove(m.id)} disabled={pending}
                        className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!locked && <AddMeasurementRow quoteId={quote.id} />}
      </CardBody>
    </Card>
  );
}

function AddMeasurementRow({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("PERIMETER_LM");
  const [value, setValue] = useState("");
  const [lifts, setLifts] = useState("");
  const [source, setSource] = useState("MANUAL");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const add = () => {
    if (!label.trim()) return setErr("Label?");
    if (value === "") return setErr("Value?");
    setErr(null);
    start(async () => {
      const res = await addConstructionMeasurement(quoteId, {
        label, kind, valueNumber: num(value),
        lifts: lifts === "" ? null : Math.trunc(num(lifts)), source,
      });
      if (res.ok) { setLabel(""); setValue(""); setLifts(""); router.refresh(); }
      else setErr(res.error ?? "Couldn’t add.");
    });
  };
  const sel = "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
  const inp = "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
      <input className={`${inp} w-40`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Blue perimeter" />
      <select className={sel} value={kind} onChange={(e) => setKind(e.target.value)}>
        {MEAS_KINDS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <input className={`${inp} w-20 text-right tabular-nums`} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
      <input className={`${inp} w-16 text-right tabular-nums`} inputMode="numeric" value={lifts} onChange={(e) => setLifts(e.target.value)} placeholder="lifts" />
      <select className={sel} value={source} onChange={(e) => setSource(e.target.value)}>
        {MEAS_SOURCES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <Button size="sm" variant="secondary" onClick={add} disabled={pending} className="gap-1.5">
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />} Add
      </Button>
      {err && <span className="text-xs text-ink">{err}</span>}
    </div>
  );
}

// --- Line builder (the picking list) ----------------------------------------

function LineBuilder({
  quote, library, lines, setLines, locked, aiEnabled,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: ConstructionLineVM[];
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
  locked: boolean;
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const total = useMemo(() => lines.reduce((a, l) => a + lineAmount({ unit: l.unit as ConstructionUnit, quantity: l.quantity, lifts: l.lifts, rate: l.rate }), 0), [lines]);

  // Rule-driven suggestion chips (docs/19 §6). Each finds a library element + adds it.
  const findEl = (pred: (e: ConstructionElementLibVM) => boolean) => library.find(pred);
  const matEl = findEl((e) => /scaffold mat|dummy lift/i.test(e.name));
  const inspEl = findEl((e) => e.unit === "PER_WEEK" || /inspection/i.test(e.name));
  const foamEl = findEl((e) => /foam/i.test(e.name));
  const foam = foamCount(quote.doorwayCount, quote.fireExitCount, quote.pedestrianAccessCount);
  const insp = inspectionWeeks(quote.durationWeeks);

  const [busy, startBusy] = useTransition();
  const addFromElement = (elementId: string, quantity: number, lifts: number | null) =>
    startBusy(async () => {
      await addConstructionLineFromElement(quote.id, { elementId, quantity, lifts, bracket: quote.defaultHeightBracket });
      router.refresh();
    });

  const suggestions: { key: string; label: string; onAdd: () => void }[] = [];
  if (!locked && needsScaffoldMat(quote.siteType as SiteType | null) && matEl)
    suggestions.push({ key: "mat", label: "Scaffold mat (school / public)", onAdd: () => addFromElement(matEl.id, 1, null) });
  if (!locked && insp > 0 && inspEl)
    suggestions.push({ key: "insp", label: `${insp} weekly inspections`, onAdd: () => addFromElement(inspEl.id, insp, null) });
  if (!locked && foam > 0 && foamEl)
    suggestions.push({ key: "foam", label: `Foam × ${foam} (doorways / exits)`, onAdd: () => addFromElement(foamEl.id, foam, null) });

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Scaffold items</h2>
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              Pick from the library, set quantity + lifts. Everything is per lift where it applies.
            </p>
          </div>
          {!locked && aiEnabled && library.length > 0 && (
            <DraftFromScope quoteId={quote.id} library={library} />
          )}
        </div>
      </CardHeader>
      <CardBody className="py-3">
        {suggestions.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-ink-subtle">Suggested:</span>
            {suggestions.map((s) => (
              <button key={s.key} type="button" onClick={s.onAdd} disabled={busy}
                className="rounded-full border border-dashed border-hairline-strong px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40">
                + {s.label}
              </button>
            ))}
          </div>
        )}

        {lines.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-subtle">
                  <th className="py-2 pr-3 font-medium">Item</th>
                  <th className="py-2 pr-3 font-medium">Lifts</th>
                  <th className="py-2 pr-3 text-right font-medium">Qty</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 text-right font-medium">Rate (£)</th>
                  <th className="py-2 pr-3 text-right font-medium">Amount</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <LineRow key={l.id} quoteId={quote.id} line={l} setLines={setLines} locked={locked} />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-hairline-strong">
                  <td colSpan={5} className="py-2 pr-3 text-right text-xs font-medium text-ink-subtle">Total</td>
                  <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{formatGBP(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {lines.length === 0 && (
          <p className="py-2 text-xs text-ink-subtle">No items yet — add one below.</p>
        )}

        {!locked && <AddLineControls quote={quote} library={library} />}
      </CardBody>
    </Card>
  );
}

function LineRow({
  quoteId, line, setLines, locked,
}: {
  quoteId: string;
  line: ConstructionLineVM;
  setLines: React.Dispatch<React.SetStateAction<ConstructionLineVM[]>>;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const perLift = isPerLift(line.unit);
  const amount = lineAmount({ unit: line.unit as ConstructionUnit, quantity: line.quantity, lifts: line.lifts, rate: line.rate });

  const patchLocal = (patch: Partial<ConstructionLineVM>) =>
    setLines((prev) => prev.map((x) => (x.id === line.id ? { ...x, ...patch } : x)));

  const saveField = (patch: { quantity?: number; lifts?: number | null; rate?: number; description?: string }) =>
    updateConstructionLine(line.id, quoteId, patch);

  const remove = () => start(async () => { await deleteConstructionLine(line.id, quoteId); router.refresh(); });
  const duplicate = () => start(async () => { await duplicateConstructionLine(line.id, quoteId); router.refresh(); });

  const cell = "w-16 rounded-md border border-hairline bg-canvas px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-hairline-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-60";

  return (
    <tr className="border-b border-hairline last:border-0">
      <td className="py-1.5 pr-3">
        <input
          value={line.description}
          disabled={locked}
          onChange={(e) => patchLocal({ description: e.target.value })}
          onBlur={(e) => saveField({ description: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="w-full min-w-[10rem] rounded-md border border-transparent bg-transparent px-1 py-1 text-sm text-ink hover:border-hairline focus:border-hairline-strong focus:outline-none disabled:opacity-80"
        />
        {line.note && <span className="ml-1 block px-1 text-[11px] text-ink-subtle">{line.note}</span>}
      </td>
      <td className="py-1.5 pr-3">
        {perLift ? (
          <input inputMode="numeric" value={line.lifts ?? ""} disabled={locked}
            onChange={(e) => patchLocal({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
            onBlur={(e) => saveField({ lifts: e.target.value === "" ? null : Math.trunc(num(e.target.value)) })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={cell} placeholder="—" />
        ) : (
          <span className="text-ink-subtle">—</span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right">
        <input inputMode="decimal" value={line.quantity} disabled={locked}
          onChange={(e) => patchLocal({ quantity: num(e.target.value) })}
          onBlur={(e) => saveField({ quantity: num(e.target.value) })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={cell} />
      </td>
      <td className="py-1.5 pr-3 text-xs text-ink-muted">{UNIT_LABEL[line.unit as ConstructionUnit]}</td>
      <td className="py-1.5 pr-3 text-right">
        <input inputMode="decimal" value={line.rate} disabled={locked}
          onChange={(e) => patchLocal({ rate: num(e.target.value) })}
          onBlur={(e) => saveField({ rate: num(e.target.value) })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={cell} />
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-ink" title={`${perLift ? `${line.quantity} × ${line.lifts ?? 1} lift(s) × ` : `${line.quantity} × `}£${line.rate}`}>
        {formatGBP(amount)}
      </td>
      <td className="py-1.5">
        {!locked && (
          <span className="flex items-center gap-0.5">
            <button type="button" aria-label="Duplicate line" onClick={duplicate} disabled={pending}
              className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40">
              <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <button type="button" aria-label="Remove line" onClick={remove} disabled={pending}
              className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </span>
        )}
      </td>
    </tr>
  );
}

function AddLineControls({ quote, library }: { quote: ConstructionQuoteVM; library: ConstructionElementLibVM[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"library" | "custom">("library");
  const [elementId, setElementId] = useState(library[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [lifts, setLifts] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const el = library.find((e) => e.id === elementId);
  // Pre-fill lifts when the element changes: Haki = 3, else the height suggestion.
  useEffect(() => {
    if (!el || !el.usesLifts) { setLifts(""); return; }
    if (/haki/i.test(el.name)) setLifts(String(HAKI_LIFTS));
    else {
      const s = suggestedLiftsFor(quote.buildingHeightM);
      setLifts(s != null ? String(s) : "");
    }
  }, [elementId, el, quote.buildingHeightM]);

  const addLib = () => {
    if (!el) return setErr("Pick an item.");
    if (quantity === "") return setErr("Quantity?");
    setErr(null);
    start(async () => {
      const res = await addConstructionLineFromElement(quote.id, {
        elementId: el.id, quantity: num(quantity),
        lifts: el.usesLifts ? (lifts === "" ? null : Math.trunc(num(lifts))) : null,
        bracket: quote.defaultHeightBracket,
      });
      if (res.ok) { setQuantity(""); router.refresh(); } else setErr(res.error ?? "Couldn’t add.");
    });
  };

  // Custom item
  const [cDesc, setCDesc] = useState("");
  const [cUnit, setCUnit] = useState<ConstructionUnit>("NR");
  const [cQty, setCQty] = useState("");
  const [cLifts, setCLifts] = useState("");
  const [cRate, setCRate] = useState("");
  const addCustom = () => {
    if (!cDesc.trim()) return setErr("Description?");
    setErr(null);
    start(async () => {
      const res = await addConstructionCustomLine(quote.id, {
        description: cDesc, unit: cUnit, quantity: cQty === "" ? 0 : num(cQty),
        lifts: cLifts === "" ? null : Math.trunc(num(cLifts)), rate: cRate === "" ? 0 : num(cRate),
      });
      if (res.ok) { setCDesc(""); setCQty(""); setCLifts(""); setCRate(""); router.refresh(); }
      else setErr(res.error ?? "Couldn’t add.");
    });
  };

  const sel = "h-9 rounded-md border border-hairline-strong bg-canvas px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
  const inp = "h-9 rounded-md border border-hairline-strong bg-canvas px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="mb-3 flex gap-1">
        {(["library", "custom"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={mode === m ? "rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-ink" : "rounded-md px-2.5 py-1 text-xs text-ink-muted hover:text-ink"}>
            {m === "library" ? "From library" : "Custom item"}
          </button>
        ))}
      </div>

      {mode === "library" ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Element</label>
            <select className={`${sel} min-w-[14rem]`} value={elementId} onChange={(e) => setElementId(e.target.value)}>
              {library.map((e) => (
                <option key={e.id} value={e.id}>{e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Quantity</label>
            <input className={`${inp} w-24 text-right tabular-nums`} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Lifts</label>
            <input className={`${inp} w-20 text-right tabular-nums disabled:opacity-50`} inputMode="numeric" value={lifts}
              disabled={!el?.usesLifts} onChange={(e) => setLifts(e.target.value)} placeholder={el?.usesLifts ? "—" : "n/a"} />
          </div>
          <Button variant="secondary" onClick={addLib} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={1.75} />} Add item
          </Button>
          {el?.defaultRuleNote && <span className="w-full text-[11px] text-ink-subtle">{el.defaultRuleNote}</span>}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Description</label>
            <input className={`${inp} w-56`} value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="e.g. Up-and-over stair set" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Unit</label>
            <select className={sel} value={cUnit} onChange={(e) => setCUnit(e.target.value as ConstructionUnit)}>
              {(Object.keys(UNIT_LABEL) as ConstructionUnit[]).map((u) => (
                <option key={u} value={u}>{UNIT_LABEL[u]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Qty</label>
            <input className={`${inp} w-20 text-right tabular-nums`} inputMode="decimal" value={cQty} onChange={(e) => setCQty(e.target.value)} placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Lifts</label>
            <input className={`${inp} w-16 text-right tabular-nums`} inputMode="numeric" value={cLifts} onChange={(e) => setCLifts(e.target.value)} placeholder="—" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-subtle">Rate £</label>
            <input className={`${inp} w-20 text-right tabular-nums`} inputMode="decimal" value={cRate} onChange={(e) => setCRate(e.target.value)} placeholder="0.00" />
          </div>
          <Button variant="secondary" onClick={addCustom} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Plus className="h-4 w-4" strokeWidth={1.75} />} Add custom
          </Button>
        </div>
      )}
      {err && <p className="mt-2 text-xs text-ink">{err}</p>}
    </div>
  );
}

// --- Small controls ----------------------------------------------------------

function SmallSelect({
  value, opts, onChange, disabled, refreshOnChange,
}: {
  value: string;
  opts: { value: string; label: string }[];
  onChange: (v: string) => Promise<unknown>;
  disabled?: boolean;
  refreshOnChange?: boolean;
}) {
  const router = useRouter();
  return (
    <Select value={value} disabled={disabled} className="h-9"
      onChange={(e) => { onChange(e.target.value).then(() => refreshOnChange && router.refresh()); }}>
      {opts.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </Select>
  );
}

function SmallNumber({
  value, onSave, disabled, step,
}: {
  value: number | null;
  onSave: (v: number | null) => Promise<unknown>;
  disabled?: boolean;
  step?: string;
}) {
  const [v, setV] = useState(value != null ? String(value) : "");
  useEffect(() => setV(value != null ? String(value) : ""), [value]);
  return (
    <Input inputMode="decimal" step={step} value={v} disabled={disabled} className="h-9"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onSave(v === "" ? null : Number(v))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
  );
}
