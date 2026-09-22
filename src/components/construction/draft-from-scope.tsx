"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
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

const CONF_DOT: Record<Row["confidence"], string> = {
  high: "bg-ink",
  medium: "bg-ink/50",
  low: "bg-ink/25",
};

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
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [applying, startApply] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const usesLifts = (elementId: string | null): boolean =>
    !!elementId &&
    PER_LIFT_UNITS.has(
      (library.find((e) => e.id === elementId)?.unit ?? "") as ConstructionUnit,
    );

  const reset = () => {
    setStep("input");
    setText("");
    setNotes("");
    setError(null);
    setRows([]);
  };
  const close = () => {
    setOpen(false);
    reset();
  };

  const onPickFile = async (file: File | undefined) => {
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
      else if (res.text) setText(res.text);
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
      setRows(
        res.lines.map((l: DraftLineVM) => ({
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
        })),
      );
      setStep("review");
    });
  };

  const patchRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const includedCount = useMemo(() => rows.filter((r) => r.include).length, [rows]);

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

  const sel =
    "h-8 rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";
  const inp =
    "h-8 w-full rounded-md border border-hairline-strong bg-canvas px-2 text-xs text-ink tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink";

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
        <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Draft from enquiry</h2>
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              Reads the client’s written scope (text only — never drawings) and proposes lines
              you confirm. Nothing is priced or added until you say so.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="rounded-md p-1 text-ink-subtle transition-colors hover:bg-surface hover:text-ink"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === "input" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-ink-subtle">
                  Paste the scope, or upload a file (.xlsx · .csv · .pdf · .txt):
                </span>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf,.txt,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0])}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  disabled={extracting}
                  className="gap-1.5"
                >
                  {extracting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                  ) : (
                    <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  Upload file
                </Button>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                placeholder="Paste the client's scope of works here — e.g. 'Edge protection to LV pits 20 LM x 2 pits; Haki stairs all levels + roof access; Loading bay 3.6 x 2.4 x 15m'…"
                className="w-full rounded-lg border border-hairline-strong bg-canvas p-3 text-sm text-ink placeholder:text-ink-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
              />
              <p className="text-[11px] text-ink-subtle">
                <FileText className="mr-1 inline h-3 w-3" strokeWidth={1.75} />
                An uploaded file is read to text and shown above — trim any noise before drafting.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {notes && (
                <p className="rounded-md border border-hairline bg-surface px-3 py-2 text-[11px] text-ink-muted">
                  {notes}
                </p>
              )}
              <p className="text-[11px] text-ink-subtle">
                {rows.length} line{rows.length === 1 ? "" : "s"} proposed. Check the mapping and
                quantities — quantities are the client’s stated numbers, so verify them against the
                drawing yourself.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-hairline text-left text-ink-subtle">
                      <th className="py-1.5 pr-2 font-medium">Add</th>
                      <th className="py-1.5 pr-2 font-medium">Scope wording</th>
                      <th className="py-1.5 pr-2 font-medium">Item</th>
                      <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
                      <th className="py-1.5 pr-2 font-medium">Lifts</th>
                      <th className="py-1.5 pr-1 font-medium" title="AI confidence">⬤</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const perLift = usesLifts(r.elementId);
                      const needsMap = r.elementId == null;
                      return (
                        <tr key={i} className="border-b border-hairline align-top last:border-0">
                          <td className="py-1.5 pr-2">
                            <input
                              type="checkbox"
                              checked={r.include}
                              onChange={(e) => patchRow(i, { include: e.target.checked })}
                              className="mt-0.5 accent-ink"
                            />
                          </td>
                          <td className="max-w-[16rem] py-1.5 pr-2 text-ink">
                            <span className="block">{r.clientText || "—"}</span>
                            {(r.note || r.reason || r.invented) && (
                              <span className="mt-0.5 block text-[10px] text-ink-subtle">
                                {r.invented && "AI matched an unknown item — map it. "}
                                {r.note ?? r.reason}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <select
                              className={`${sel} min-w-[11rem] ${needsMap ? "border-amber-500" : ""}`}
                              value={r.elementId ?? ""}
                              onChange={(e) => patchRow(i, { elementId: e.target.value || null })}
                            >
                              <option value="">— needs mapping —</option>
                              {library.map((e) => (
                                <option key={e.id} value={e.id}>
                                  {e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              inputMode="decimal"
                              value={r.quantity}
                              onChange={(e) => patchRow(i, { quantity: e.target.value })}
                              placeholder="—"
                              className={`${inp} w-20 text-right`}
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              inputMode="numeric"
                              value={r.lifts}
                              disabled={!perLift}
                              onChange={(e) => patchRow(i, { lifts: e.target.value })}
                              placeholder={perLift ? "—" : "n/a"}
                              className={`${inp} w-14 text-right disabled:opacity-40`}
                            />
                          </td>
                          <td className="py-2 pr-1">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${CONF_DOT[r.confidence]}`}
                              title={`${r.confidence} confidence${r.reason ? ` — ${r.reason}` : ""}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-ink">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-hairline px-5 py-3">
          {step === "review" ? (
            <Button variant="ghost" size="sm" onClick={() => setStep("input")} disabled={applying}>
              ← Back to text
            </Button>
          ) : (
            <span className="text-[11px] text-ink-subtle">One quick AI pass — a few seconds.</span>
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
            <Button onClick={apply} disabled={applying || includedCount === 0} className="gap-1.5">
              {applying ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
              Add {includedCount} line{includedCount === 1 ? "" : "s"} to quote
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
