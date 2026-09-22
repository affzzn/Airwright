"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import {
  applyConstructionDraftLines,
  draftConstructionLinesFromScope,
  extractConstructionScopeText,
  type ApplyDraftLine,
  type DraftLineVM,
} from "@/server/actions/constructionDraft";
import type { ConstructionElementLibVM } from "@/server/construction";
import { UNIT_LABEL, PER_LIFT_UNITS, type ConstructionUnit } from "@/lib/construction/types";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge, ConfidenceDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** One editable review row (the AI's proposal + the estimator's corrections). */
interface Row {
  clientText: string;
  suggestedElementId: string | null; // what the AI proposed (for correction detection)
  elementId: string | null; // the estimator's current mapping
  quantity: string;
  lifts: string;
  note: string | null;
  confidence: "high" | "medium" | "low";
  reason: string | null;
  invented: boolean;
  include: boolean;
}

// Map the draft's discrete confidence onto the shared ConfidenceDot's 0–1 scale
// (≥0.85 high · ≥0.6 medium · else low) so we reuse the one sanctioned colour.
const CONF_VALUE: Record<Row["confidence"], number> = { high: 0.9, medium: 0.7, low: 0.4 };

const draftLineToRow = (l: DraftLineVM): Row => ({
  clientText: l.clientText,
  suggestedElementId: l.elementId,
  elementId: l.elementId,
  quantity: l.quantity != null ? String(l.quantity) : "",
  lifts: l.lifts != null ? String(l.lifts) : "",
  note: l.note,
  confidence: l.confidence,
  reason: l.reason,
  invented: l.invented,
  include: true,
});

const ACCEPT =
  ".xlsx,.xls,.csv,.pdf,.txt,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Couldn’t read the file."));
    r.readAsDataURL(file);
  });

export function DraftFromScope({
  quoteId,
  library,
}: {
  quoteId: string;
  library: ConstructionElementLibVM[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"input" | "review">("input");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [applying, startApply] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const elementById = useMemo(
    () => new Map(library.map((e) => [e.id, e])),
    [library],
  );
  const usesLifts = (elementId: string | null): boolean =>
    !!elementId &&
    PER_LIFT_UNITS.has((elementById.get(elementId)?.unit ?? "") as ConstructionUnit);

  const reset = () => {
    setStep("input");
    setText("");
    setFileName(null);
    setNotes("");
    setError(null);
    setRows([]);
    setDragOver(false);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const extractFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setExtracting(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await extractConstructionScopeText({
        name: file.name,
        mimeType: file.type,
        dataBase64,
      });
      if (res.error) setError(res.error);
      else if (res.text) {
        setText(res.text);
        setFileName(file.name);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn’t read that file.");
    } finally {
      setExtracting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const runDraft = () => {
    setError(null);
    startDraft(async () => {
      const res = await draftConstructionLinesFromScope(quoteId, text);
      if (!res.ok || !res.lines) {
        setError(res.error ?? "The draft failed.");
        return;
      }
      setNotes(res.notes ?? "");
      setRows(res.lines.map(draftLineToRow));
      setStep("review");
    });
  };

  const patchRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const stats = useMemo(() => {
    const included = rows.filter((r) => r.include);
    return {
      total: rows.length,
      included: included.length,
      matched: included.filter((r) => r.elementId).length,
      needsMap: included.filter((r) => !r.elementId).length,
    };
  }, [rows]);
  const allIncluded = rows.length > 0 && rows.every((r) => r.include);

  const apply = () => {
    setError(null);
    const accepted: ApplyDraftLine[] = rows
      .filter((r) => r.include)
      .map((r) => ({
        clientText: r.clientText,
        elementId: r.elementId,
        suggestedElementId: r.suggestedElementId,
        quantity: r.quantity === "" ? null : Number(r.quantity),
        lifts: r.lifts === "" ? null : Math.trunc(Number(r.lifts)),
        note: r.note,
      }));
    if (accepted.length === 0) {
      setError("Tick at least one line to add.");
      return;
    }
    startApply(async () => {
      const res = await applyConstructionDraftLines(quoteId, accepted);
      if (!res.ok) {
        setError(res.error ?? "Couldn’t add the lines.");
        return;
      }
      close();
      router.refresh();
    });
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title="Read the client's written scope of works into draft lines"
      >
        <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        Draft from enquiry
      </Button>

      <Modal open={open} onClose={close} label="Draft from enquiry" className="max-w-3xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2">
                <Sparkles className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
              </span>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">
                Draft from enquiry
              </h2>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <StepDots step={step} />
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {drafting ? (
            <DraftingState />
          ) : step === "input" ? (
            <div className="space-y-4 px-6 py-5">
              <Dropzone
                dragOver={dragOver}
                extracting={extracting}
                fileName={fileName}
                onBrowse={() => fileInput.current?.click()}
                onClear={() => {
                  setFileName(null);
                  setText("");
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void extractFile(e.dataTransfer.files?.[0]);
                }}
              />
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => extractFile(e.target.files?.[0])}
              />

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-hairline" />
                <span className="text-[11px] uppercase tracking-wide text-ink-subtle">
                  or paste the scope
                </span>
                <span className="h-px flex-1 bg-hairline" />
              </div>

              <div className="relative">
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    if (fileName) setFileName(null);
                  }}
                  rows={9}
                  placeholder={
                    "Paste the client's scope of works, e.g.\n• Edge protection to LV pits, 20 LM x 2 pits\n• Haki staircase, all levels + roof access\n• Loading bay, 3.6 x 2.4 x 15m"
                  }
                  className="w-full resize-y rounded-lg border border-hairline-strong bg-canvas p-3.5 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
                />
                {text.trim() && (
                  <span className="pointer-events-none absolute bottom-2.5 right-3 text-[10px] tabular-nums text-ink-subtle">
                    {text.trim().length.toLocaleString()} chars
                  </span>
                )}
              </div>

              {error && <ErrorNote message={error} />}
            </div>
          ) : (
            <div className="px-6 py-5">
              {/* Summary bar */}
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Badge variant="muted">{stats.total} proposed</Badge>
                <Badge variant="outline">{stats.matched} matched</Badge>
                {stats.needsMap > 0 && <Badge variant="dashed">{stats.needsMap} need mapping</Badge>}
                <button
                  type="button"
                  onClick={() =>
                    setRows((prev) => prev.map((r) => ({ ...r, include: !allIncluded })))
                  }
                  className="ml-auto text-[11px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  {allIncluded ? "Clear all" : "Select all"}
                </button>
              </div>

              {notes && (
                <p className="mb-4 rounded-lg border border-hairline bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-ink-muted">
                  {notes}
                </p>
              )}

              <p className="mb-2 text-[11px] leading-relaxed text-ink-subtle">
                Check the mapping and quantities before adding.
              </p>

              <div className="overflow-x-auto rounded-lg border border-hairline">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-canvas">
                    <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                      <th className="w-8 py-2 pl-3" />
                      <th className="py-2 pr-3 font-medium">Scope wording</th>
                      <th className="py-2 pr-3 font-medium">Maps to</th>
                      <th className="py-2 pr-3 text-right font-medium">Qty</th>
                      <th className="py-2 pr-3 font-medium">Lifts</th>
                      <th className="w-8 py-2 pr-3 text-center font-medium" title="AI confidence">
                        Conf.
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const perLift = usesLifts(r.elementId);
                      const needsMap = r.elementId == null;
                      return (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-hairline align-top transition-opacity last:border-0",
                            !r.include && "opacity-45",
                          )}
                        >
                          <td className="py-2.5 pl-3">
                            <RowCheck
                              checked={r.include}
                              onChange={(v) => patchRow(i, { include: v })}
                            />
                          </td>
                          <td className="max-w-[15rem] py-2.5 pr-3">
                            <span className="block leading-snug text-ink">{r.clientText || "—"}</span>
                            {(r.note || r.reason) && (
                              <span className="mt-0.5 block text-[10px] leading-snug text-ink-subtle">
                                {r.note ?? r.reason}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="relative">
                              <select
                                className={cn(
                                  "h-8 w-full min-w-[10.5rem] cursor-pointer appearance-none rounded-md border bg-canvas pl-2.5 pr-7 text-xs text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15",
                                  needsMap
                                    ? "border-dashed border-hairline-strong text-ink-muted"
                                    : "border-hairline-strong",
                                )}
                                value={r.elementId ?? ""}
                                onChange={(e) => patchRow(i, { elementId: e.target.value || null })}
                              >
                                <option value="">Needs mapping</option>
                                {library.map((e) => (
                                  <option key={e.id} value={e.id}>
                                    {e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}
                                  </option>
                                ))}
                              </select>
                              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle">
                                ▾
                              </span>
                            </div>
                            {r.invented && (
                              <span className="mt-1 block text-[10px] leading-snug text-ink-subtle">
                                Pick an item.
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <input
                              inputMode="decimal"
                              value={r.quantity}
                              onChange={(e) => patchRow(i, { quantity: e.target.value })}
                              placeholder="—"
                              className="h-8 w-16 rounded-md border border-hairline-strong bg-canvas px-2 text-right text-xs tabular-nums text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
                            />
                          </td>
                          <td className="py-2.5 pr-3">
                            <input
                              inputMode="numeric"
                              value={r.lifts}
                              disabled={!perLift}
                              onChange={(e) => patchRow(i, { lifts: e.target.value })}
                              placeholder={perLift ? "—" : "n/a"}
                              className="h-8 w-12 rounded-md border border-hairline-strong bg-canvas px-2 text-right text-xs tabular-nums text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15 disabled:border-hairline disabled:opacity-40"
                            />
                          </td>
                          <td className="py-3 pr-3 text-center">
                            <span
                              className="inline-flex"
                              title={r.reason ? `${r.confidence}: ${r.reason}` : `${r.confidence} confidence`}
                            >
                              <ConfidenceDot value={CONF_VALUE[r.confidence]} />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {error && <div className="mt-3"><ErrorNote message={error} /></div>}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-hairline bg-canvas px-6 py-3.5">
          {step === "review" ? (
            <Button variant="ghost" size="sm" onClick={() => setStep("input")} disabled={applying}>
              ← Back to text
            </Button>
          ) : (
            <span />
          )}
          {step === "input" ? (
            <Button onClick={runDraft} disabled={drafting || !text.trim()} className="gap-1.5">
              {drafting ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Sparkles className="h-4 w-4" strokeWidth={1.75} />
              )}
              Draft lines
            </Button>
          ) : (
            <Button onClick={apply} disabled={applying || stats.included === 0} className="gap-1.5">
              {applying && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              Add {stats.included} line{stats.included === 1 ? "" : "s"} to quote
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}

// --- Sub-components ----------------------------------------------------------

function StepDots({ step }: { step: "input" | "review" }) {
  return (
    <div className="hidden items-center gap-1.5 sm:flex" aria-hidden>
      <span className={cn("h-1.5 w-1.5 rounded-full", step === "input" ? "bg-ink" : "bg-hairline-strong")} />
      <span className={cn("h-1.5 w-1.5 rounded-full", step === "review" ? "bg-ink" : "bg-hairline-strong")} />
    </div>
  );
}

function Dropzone({
  dragOver,
  extracting,
  fileName,
  onBrowse,
  onClear,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragOver: boolean;
  extracting: boolean;
  fileName: string | null;
  onBrowse: () => void;
  onClear: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  if (fileName && !extracting) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface px-3.5 py-3">
        <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
          <FileText className="h-4 w-4 shrink-0 text-ink-muted" strokeWidth={1.75} />
          <span className="truncate">{fileName}</span>
          <Check className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={2} />
        </span>
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded-md px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink"
        >
          Replace
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onBrowse}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      disabled={extracting}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-6 py-7 text-center transition-colors",
        dragOver
          ? "border-ink bg-surface"
          : "border-hairline-strong bg-canvas hover:border-ink/40 hover:bg-surface/50",
      )}
    >
      {extracting ? (
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" strokeWidth={2} />
      ) : (
        <UploadCloud className="h-5 w-5 text-ink-muted" strokeWidth={1.75} />
      )}
      <span className="text-sm font-medium text-ink">
        {extracting ? "Reading the file…" : "Drop a scope file, or browse"}
      </span>
      <span className="text-[11px] text-ink-subtle">.xlsx · .csv · .pdf · .txt</span>
    </button>
  );
}

function DraftingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-hairline bg-surface">
        <Loader2 className="h-5 w-5 animate-spin text-ink-muted" strokeWidth={2} />
      </span>
      <p className="text-sm font-medium text-ink">Reading the scope…</p>
      <p className="max-w-xs text-xs leading-relaxed text-ink-subtle">
        Matching each line to your picking list. This takes a few seconds.
      </p>
    </div>
  );
}

function RowCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Exclude line" : "Include line"}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-4 w-4 items-center justify-center rounded border transition-colors",
        checked
          ? "border-ink bg-ink text-canvas"
          : "border-hairline-strong bg-canvas hover:border-ink/50",
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={2.5} />}
    </button>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-hairline-strong bg-surface px-3.5 py-2.5 text-xs text-ink">
      {message}
    </p>
  );
}
