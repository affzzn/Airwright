"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Layers, Loader2, X } from "lucide-react";
import {
  applyDrawingDraft,
  readConstructionEnquiry,
  type ApplyDrawingLine,
} from "@/server/actions/constructionDrawings";
import type { DrawingDraftLine, DrawingDraftMeasurement } from "@/lib/construction/assemble";
import type { ConstructionElementLibVM } from "@/server/construction";
import { UNIT_LABEL, type ConstructionUnit, type HeightBracket } from "@/lib/construction/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge, ConfidenceDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CONF_VALUE: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.4, unknown: 0 };

interface LineRow extends DrawingDraftLine {
  include: boolean;
}
interface MeasRow extends DrawingDraftMeasurement {
  include: boolean;
}

export function ReadDrawings({
  quoteId,
  library,
  readableCount,
}: {
  quoteId: string;
  library: ConstructionElementLibVM[];
  readableCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"confirm" | "review">("confirm");
  const [lines, setLines] = useState<LineRow[]>([]);
  const [measurements, setMeasurements] = useState<MeasRow[]>([]);
  const [flags, setFlags] = useState<string[]>([]);
  const [readSummary, setReadSummary] = useState<{ fileName: string; ok: boolean; error?: string }[]>([]);
  const [bracket, setBracket] = useState<HeightBracket | null>(null);
  const [heightM, setHeightM] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, startRead] = useTransition();
  const [applying, startApply] = useTransition();

  const close = () => {
    setOpen(false);
    setStep("confirm");
    setLines([]);
    setMeasurements([]);
    setFlags([]);
    setReadSummary([]);
    setError(null);
  };

  const run = () => {
    setError(null);
    startRead(async () => {
      const res = await readConstructionEnquiry(quoteId);
      setReadSummary(res.read ?? []);
      if (!res.ok || !res.lines) {
        setError(res.error ?? "Couldn’t read the enquiry.");
        return;
      }
      setLines(res.lines.map((l) => ({ ...l, include: true })));
      setMeasurements((res.measurements ?? []).map((m) => ({ ...m, include: true })));
      setFlags(res.flags ?? []);
      setBracket(res.suggestedHeightBracket ?? null);
      setHeightM(res.buildingHeightM ?? null);
      setStep("review");
    });
  };

  const includedLines = useMemo(() => lines.filter((l) => l.include).length, [lines]);
  const includedMeas = useMemo(() => measurements.filter((m) => m.include).length, [measurements]);

  const apply = () => {
    setError(null);
    const applyLines: ApplyDrawingLine[] = lines
      .filter((l) => l.include)
      .map((l) => ({
        elementId: l.elementId,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        lifts: l.lifts,
        heightBracket: l.heightBracket,
        note: l.note,
      }));
    const applyMeas = measurements.filter((m) => m.include).map(({ include: _i, ...m }) => m);
    if (applyLines.length === 0 && applyMeas.length === 0) {
      setError("Tick at least one line or measurement.");
      return;
    }
    startApply(async () => {
      const res = await applyDrawingDraft(quoteId, {
        lines: applyLines,
        measurements: applyMeas,
        setHeightBracket: bracket,
      });
      if (!res.ok) {
        setError(res.error ?? "Couldn’t add.");
        return;
      }
      close();
      router.refresh();
    });
  };

  const inp =
    "h-8 w-full rounded-md border border-hairline-strong bg-canvas px-2 text-xs tabular-nums text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15";

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title={readableCount > 0 ? "Read the ticked drawings + scope into draft lines" : "Tick a file (the AI badge) in Attachments first"}
      >
        <Layers className="h-4 w-4" strokeWidth={1.75} />
        Read enquiry{readableCount > 0 ? ` (${readableCount})` : ""}
      </Button>

      <Modal open={open} onClose={close} label="Read enquiry" className="max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2">
              <Layers className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
            </span>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Read enquiry</h2>
          </div>
          <button type="button" aria-label="Close" onClick={close} className="rounded-md p-1 text-ink-subtle hover:bg-surface hover:text-ink">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {reading ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-surface">
                <Loader2 className="h-5 w-5 animate-spin text-ink-muted" strokeWidth={2} />
              </span>
              <p className="text-sm font-medium text-ink">Reading the enquiry…</p>
              <p className="max-w-xs text-xs leading-relaxed text-ink-subtle">
                Finding measurements, counts and mark-ups. A few seconds per file.
              </p>
            </div>
          ) : step === "confirm" ? (
            <div className="space-y-3 px-6 py-6 text-sm text-ink-muted">
              {readableCount > 0 ? (
                <p>
                  {readableCount} file{readableCount === 1 ? "" : "s"} ticked for reading. The AI reads your
                  drawings + scope (never the priced answer), pulls measurements and counts, and proposes lines you confirm.
                </p>
              ) : (
                <p>
                  No files ticked yet. In <span className="text-ink">Attachments</span>, click the{" "}
                  <span className="text-ink">AI</span> badge on a drawing or the enquiry email to include it, then come back.
                </p>
              )}
              {error && <ErrorNote message={error} />}
            </div>
          ) : (
            <div className="space-y-4 px-6 py-5">
              {/* summary */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">{lines.length} lines</Badge>
                <Badge variant="outline">{measurements.length} measurements</Badge>
                {heightM != null && <Badge variant="outline">height {heightM} m{bracket ? ` · ${bracket === "UP_TO_6M" ? "≤6 m" : bracket}` : ""}</Badge>}
              </div>

              {readSummary.some((r) => !r.ok) && (
                <p className="rounded-lg border border-hairline-strong bg-surface px-3.5 py-2 text-xs text-ink">
                  {readSummary.filter((r) => !r.ok).map((r) => `${r.fileName}: ${r.error}`).join(" · ")}
                </p>
              )}
              {flags.length > 0 && (
                <ul className="space-y-1 rounded-lg border border-hairline bg-surface px-3.5 py-2.5 text-[11px] text-ink-muted">
                  {flags.map((f, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      {f}
                    </li>
                  ))}
                </ul>
              )}

              {/* Lines */}
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Draft lines</p>
                <div className="overflow-x-auto rounded-lg border border-hairline">
                  <table className="w-full text-sm">
                    <thead className="bg-canvas">
                      <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                        <th className="w-8 py-2 pl-3" />
                        <th className="py-2 pr-3 font-medium">Item</th>
                        <th className="py-2 pr-3 text-right font-medium">Qty</th>
                        <th className="py-2 pr-3 font-medium">Lifts</th>
                        <th className="w-8 py-2 pr-3 text-center font-medium">Conf.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} className={cn("border-b border-hairline align-top last:border-0 transition-opacity", !l.include && "opacity-45")}>
                          <td className="py-2.5 pl-3">
                            <RowCheck checked={l.include} onChange={(v) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, include: v } : x)))} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <select
                              className={cn("h-8 w-full min-w-[11rem] cursor-pointer appearance-none rounded-md border bg-canvas pl-2.5 pr-7 text-xs text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15", l.elementId ? "border-hairline-strong" : "border-dashed border-hairline-strong text-ink-muted")}
                              value={l.elementId ?? ""}
                              onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, elementId: e.target.value || null } : x)))}
                            >
                              <option value="">Needs mapping</option>
                              {library.map((e) => (
                                <option key={e.id} value={e.id}>{e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}</option>
                              ))}
                            </select>
                            {l.note && <span className="mt-0.5 block text-[10px] leading-snug text-ink-subtle">{l.note}</span>}
                          </td>
                          <td className="py-2.5 pr-3">
                            <input inputMode="decimal" value={l.quantity ?? ""} placeholder="—"
                              onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, quantity: e.target.value === "" ? null : Number(e.target.value) } : x)))}
                              className={`${inp} w-20 text-right`} />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input inputMode="numeric" value={l.lifts ?? ""} placeholder="—"
                              onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, lifts: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) } : x)))}
                              className={`${inp} w-14 text-right`} />
                          </td>
                          <td className="py-3 pr-3 text-center">
                            <span className="inline-flex" title={`${l.confidence} confidence`}>
                              <ConfidenceDot value={CONF_VALUE[l.confidence] ?? 0} />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Measurements */}
              {measurements.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Measurements (traceable)</p>
                  <div className="overflow-x-auto rounded-lg border border-hairline">
                    <table className="w-full text-sm">
                      <tbody>
                        {measurements.map((m, i) => (
                          <tr key={i} className={cn("border-b border-hairline last:border-0 transition-opacity", !m.include && "opacity-45")}>
                            <td className="py-2 pl-3 w-8">
                              <RowCheck checked={m.include} onChange={(v) => setMeasurements((p) => p.map((x, idx) => (idx === i ? { ...x, include: v } : x)))} />
                            </td>
                            <td className="py-2 pr-3 text-ink">{m.label}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-ink">{m.valueNumber}{m.lifts ? ` × ${m.lifts}` : ""}</td>
                            <td className="py-2 pr-3 text-[10px] uppercase text-ink-subtle">{m.kind.replace("_", " ")}</td>
                            <td className="py-2.5 pr-3 w-8 text-center"><span className="inline-flex"><ConfidenceDot value={CONF_VALUE[m.confidence] ?? 0} /></span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {error && <ErrorNote message={error} />}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline bg-canvas px-6 py-3.5">
          {step === "review" ? (
            <Button variant="ghost" size="sm" onClick={() => setStep("confirm")} disabled={applying}>← Back</Button>
          ) : (
            <span className="text-[11px] text-ink-subtle">Enquiry files only · never the priced answer.</span>
          )}
          {step === "confirm" ? (
            <Button onClick={run} disabled={reading || readableCount === 0} className="gap-1.5">
              {reading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Layers className="h-4 w-4" strokeWidth={1.75} />}
              Read {readableCount || ""} file{readableCount === 1 ? "" : "s"}
            </Button>
          ) : (
            <Button onClick={apply} disabled={applying || (includedLines === 0 && includedMeas === 0)} className="gap-1.5">
              {applying && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              Add {includedLines} line{includedLines === 1 ? "" : "s"}{includedMeas ? ` + ${includedMeas} meas.` : ""}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

function RowCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)}
      className={cn("flex h-4 w-4 items-center justify-center rounded border transition-colors", checked ? "border-ink bg-ink text-canvas" : "border-hairline-strong bg-canvas hover:border-ink/50")}>
      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg border border-hairline-strong bg-surface px-3.5 py-2.5 text-xs text-ink">{message}</p>;
}
