"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  FileText,
  ImageIcon,
  Layers,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { deleteConstructionAttachment } from "@/server/actions/construction";
import {
  applyDrawingDraft,
  readConstructionEnquiry,
  setConstructionAttachmentDrafting,
  type ApplyDrawingLine,
} from "@/server/actions/constructionDrawings";
import { extractConstructionScopeText } from "@/server/actions/constructionDraft";
import type { DrawingDraftLine, DrawingDraftMeasurement } from "@/lib/construction/assemble";
import { isDraftableFile, looksLikeAnswerFile } from "@/lib/construction/fileKinds";
import type { ConstructionAttachmentVM, ConstructionElementLibVM, ConstructionQuoteVM } from "@/server/construction";
import { UNIT_LABEL, type ConstructionUnit, type HeightBracket } from "@/lib/construction/types";
import type { JobStep } from "@/lib/construction/jobState";
import { Button } from "@/components/ui/button";
import { ConfidenceDot } from "@/components/ui/badge";
import {
  CellInput,
  EmptyHint,
  IconButton,
  Panel,
  ToggleButton,
} from "@/components/construction/parts";
import { fileKindLabel, filesFromDataTransfer, uploadConstructionFiles } from "@/components/construction/upload";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Step 1 — the enquiry (docs/20). The files the AI may read are ticked here, the
 * read runs from the panel directly beneath them, and the proposals come back
 * IN THE PAGE (no modal) for the estimator to check before anything is added.
 */

const CONF_VALUE: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.4, unknown: 0 };

const SCOPE_ACCEPT =
  ".xlsx,.xls,.csv,.pdf,.txt,.eml,text/csv,text/plain,application/pdf,message/rfc822,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("Could not read the file."));
    r.readAsDataURL(file);
  });

interface LineRow extends DrawingDraftLine {
  include: boolean;
}
interface MeasRow extends DrawingDraftMeasurement {
  include: boolean;
}

export function EnquiryStep({
  quote,
  library,
  locked,
  aiEnabled,
  compact,
  onShowFile,
  goToStep,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  locked: boolean;
  aiEnabled: boolean;
  /** True when the drawing pane is open, so this column stays narrow. */
  compact: boolean;
  onShowFile: (id: string) => void;
  goToStep: (s: JobStep) => void;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const scopeInput = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeText, setScopeText] = useState("");
  const [extracting, setExtracting] = useState(false);

  const [reading, startRead] = useTransition();
  const [applying, startApply] = useTransition();
  const [review, setReview] = useState<{
    lines: LineRow[];
    measurements: MeasRow[];
    flags: string[];
    bracket: HeightBracket | null;
    heightM: number | null;
    accessPoints: { doorways: number; fireExits: number } | null;
    failures: { fileName: string; error?: string }[];
  } | null>(null);

  const readable = quote.attachments.filter(
    (a) => isDraftableFile(a.mimeType, a.fileName) && !looksLikeAnswerFile(a.fileName),
  );
  const ticked = readable.filter((a) => a.useForDrafting);

  const upload = async (files: File[]) => {
    if (files.length === 0 || locked) return;
    setBusy(true);
    setError(null);
    try {
      await uploadConstructionFiles(quote.id, files);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toggleRead = (a: ConstructionAttachmentVM) =>
    start(async () => {
      const res = await setConstructionAttachmentDrafting(a.id, quote.id, !a.useForDrafting);
      if (!res.ok) setError(res.error ?? "Could not update that file.");
      else {
        setError(null);
        router.refresh();
      }
    });

  const removeFile = (id: string) =>
    start(async () => {
      await deleteConstructionAttachment(id, quote.id);
      router.refresh();
    });

  const extractScopeFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setExtracting(true);
    try {
      const res = await extractConstructionScopeText({
        name: file.name,
        mimeType: file.type,
        dataBase64: await fileToBase64(file),
      });
      if (res.error) setError(res.error);
      else if (res.text) setScopeText(res.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setExtracting(false);
      if (scopeInput.current) scopeInput.current.value = "";
    }
  };

  const runRead = () => {
    setError(null);
    startRead(async () => {
      const res = await readConstructionEnquiry(quote.id, scopeText.trim() || undefined);
      if (!res.ok || !res.lines) {
        setError(res.error ?? "Could not read the enquiry.");
        return;
      }
      setReview({
        lines: res.lines.map((l) => ({ ...l, include: l.elementId != null })),
        measurements: (res.measurements ?? []).map((m) => ({ ...m, include: true })),
        flags: res.flags ?? [],
        bracket: res.suggestedHeightBracket ?? null,
        heightM: res.buildingHeightM ?? null,
        accessPoints: res.accessPoints ?? null,
        failures: (res.read ?? []).filter((r) => !r.ok).map((r) => ({ fileName: r.fileName, error: r.error })),
      });
      router.refresh();
    });
  };

  const applyReview = () => {
    if (!review) return;
    setError(null);
    const lines: ApplyDrawingLine[] = review.lines
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
    const measurements = review.measurements
      .filter((m) => m.include)
      .map(({ include: _include, ...m }) => m);
    if (lines.length === 0 && measurements.length === 0) {
      setError("Tick at least one item or measurement.");
      return;
    }
    startApply(async () => {
      const res = await applyDrawingDraft(quote.id, {
        lines,
        measurements,
        setHeightBracket: review.bracket,
        accessPoints: review.accessPoints ?? undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Could not add those items.");
        return;
      }
      setReview(null);
      router.refresh();
      goToStep("items");
    });
  };

  // --- Review of what the read proposed -------------------------------------
  if (review) {
    const includedLines = review.lines.filter((l) => l.include).length;
    const includedMeas = review.measurements.filter((m) => m.include).length;
    const patchLine = (i: number, patch: Partial<LineRow>) =>
      setReview((r) =>
        r ? { ...r, lines: r.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) } : r,
      );

    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-ink">What the enquiry says</h2>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-ink-muted">
              {review.lines.length} proposed
            </span>
            {review.heightM != null && (
              <span className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-ink-muted">
                {review.heightM} m
              </span>
            )}
            <Button variant="secondary" size="sm" onClick={() => setReview(null)}>
              Back
            </Button>
          </div>
        </div>

        {review.failures.length > 0 && (
          <p className="rounded-lg border border-hairline-strong bg-surface px-4 py-2.5 text-xs text-ink">
            {review.failures.map((f) => `${f.fileName}: ${f.error ?? "could not be read"}`).join(" · ")}
          </p>
        )}

        {review.flags.length > 0 && (
          <Panel title="Worth a look">
            <ul className="flex flex-col gap-2">
              {review.flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
                  <span className="text-[13px] leading-relaxed text-ink">{f}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <Panel title="Items" bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="text-left">
                  <th className="w-10 pb-2 pl-5" />
                  <th className="pb-2 pr-3 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    Item
                  </th>
                  <th className="w-28 pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    Quantity
                  </th>
                  <th className="w-20 pb-2 pr-3 text-right text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    Lifts
                  </th>
                  <th className="pb-2 pr-5 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {review.lines.map((l, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-t border-hairline align-middle transition-opacity",
                      !l.include && "opacity-45",
                    )}
                  >
                    <td className="py-2.5 pl-5">
                      <Check checked={l.include} onChange={(v) => patchLine(i, { include: v })} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="relative">
                        <select
                          aria-label="Picking list item"
                          value={l.elementId ?? ""}
                          onChange={(e) =>
                            patchLine(i, { elementId: e.target.value || null, include: Boolean(e.target.value) })
                          }
                          className={cn(
                            "h-9 w-full min-w-[12rem] cursor-pointer appearance-none rounded-lg border bg-canvas pl-3 pr-8 text-[13px] font-medium text-ink focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15",
                            l.elementId ? "border-hairline-strong" : "border-dashed border-hairline-strong text-ink-muted",
                          )}
                        >
                          <option value="">Choose an item</option>
                          {library.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}
                            </option>
                          ))}
                        </select>
                        <ChevronDown
                          className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle"
                          strokeWidth={2}
                          aria-hidden
                        />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <CellInput
                        inputMode="decimal"
                        aria-label="Quantity"
                        value={l.quantity ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          patchLine(i, {
                            quantity: e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                      />
                    </td>
                    <td className="py-2.5 pr-3">
                      <CellInput
                        inputMode="numeric"
                        aria-label="Lifts"
                        value={l.lifts ?? ""}
                        placeholder="—"
                        onChange={(e) =>
                          patchLine(i, {
                            lifts: e.target.value === "" ? null : Math.trunc(Number(e.target.value)),
                          })
                        }
                      />
                    </td>
                    <td className="py-2.5 pr-5">
                      <span className="flex items-start gap-2">
                        <span className="mt-1">
                          <ConfidenceDot value={CONF_VALUE[l.confidence] ?? 0} />
                        </span>
                        <span className="text-xs leading-relaxed text-ink-muted">{l.note ?? "From the drawing"}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {review.measurements.length > 0 && (
          <Panel title="Measurements">
            <ul className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
              {review.measurements.map((m, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-center gap-3 border-t border-hairline py-2.5 transition-opacity",
                    !m.include && "opacity-45",
                  )}
                >
                  <Check
                    checked={m.include}
                    onChange={(v) =>
                      setReview((r) =>
                        r
                          ? {
                              ...r,
                              measurements: r.measurements.map((x, idx) =>
                                idx === i ? { ...x, include: v } : x,
                              ),
                            }
                          : r,
                      )
                    }
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{m.label}</span>
                    {m.note && <span className="block truncate text-[11px] text-ink-muted">{m.note}</span>}
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                    {m.valueNumber}
                    {m.lifts ? ` × ${m.lifts}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {error && <p className="text-sm text-ink">{error}</p>}

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas/95 px-5 py-3.5 backdrop-blur">
          <p className="text-xs text-ink-muted">Check the quantities against your own measure.</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setReview(null)} disabled={applying}>
              Discard
            </Button>
            <Button onClick={applyReview} disabled={applying} className="gap-2">
              {applying && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
              Add {includedLines} item{includedLines === 1 ? "" : "s"}
              {includedMeas > 0 ? ` and ${includedMeas} measurement${includedMeas === 1 ? "" : "s"}` : ""}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // --- Files + the read action ----------------------------------------------
  return (
    <div
      onDragOver={(e) => {
        if (locked) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        await upload(await filesFromDataTransfer(e.dataTransfer));
      }}
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-xl",
        !compact && "max-w-4xl",
        dragOver && "outline-dashed outline-2 outline-offset-4 outline-ink/40",
      )}
    >
      <Panel
        title="Files"
        action={
          !locked && (
            <Button variant="secondary" size="sm" className="gap-1.5" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />}
              Add files
            </Button>
          )
        }
        bodyClassName="px-0 pb-0"
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => e.target.files && upload(Array.from(e.target.files))}
        />

        {quote.attachments.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyHint
              title="No files yet"
              action={
                !locked && (
                  <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                    Add files
                  </Button>
                )
              }
            >
              Drop the enquiry email, the drawings and any scope of works.
            </EmptyHint>
          </div>
        ) : (
          <ul>
            {quote.attachments.map((a) => {
              const answer = looksLikeAnswerFile(a.fileName);
              const draftable = isDraftableFile(a.mimeType, a.fileName) && !answer;
              const isImg = (a.mimeType || "").startsWith("image/");
              return (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline px-5 py-3"
                >
                  <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface sm:flex">
                    {isImg ? (
                      <ImageIcon className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
                    ) : (
                      <FileText className="h-4 w-4 text-ink-muted" strokeWidth={1.75} />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onShowFile(a.id)}
                    className="min-w-0 flex-1 basis-full text-left sm:basis-auto"
                  >
                    <span className="block truncate text-sm font-medium text-ink">{a.fileName}</span>
                    <span className="block text-[11px] text-ink-muted">
                      {[fileKindLabel(a.mimeType, a.fileName), a.sizeBytes != null ? formatBytes(a.sizeBytes) : null]
                        .filter(Boolean)
                        .join(" · ")}
                      {a.readStatus === "READ" ? " · read" : ""}
                      {a.readStatus === "FAILED" ? " · could not be read" : ""}
                    </span>
                  </button>

                  {answer ? (
                    <span className="shrink-0 rounded-lg border border-dashed border-hairline-strong px-2.5 py-1 text-[11px] font-semibold text-ink-subtle">
                      Never read
                    </span>
                  ) : draftable && aiEnabled ? (
                    <ToggleButton
                      on={a.useForDrafting}
                      disabled={locked || pending}
                      onClick={() => toggleRead(a)}
                      onLabel="Reading"
                      offLabel="Not read"
                      title={a.useForDrafting ? "This file is read" : "Include this file in the read"}
                    />
                  ) : (
                    <span className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-muted">
                      Reference
                    </span>
                  )}

                  {!locked && (
                    <IconButton label="Remove file" onClick={() => removeFile(a.id)} disabled={pending}>
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                  )}
                  <span className="flex-1 sm:hidden" aria-hidden />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {!locked && aiEnabled && (
        <>
          <Panel
            title="Scope of works"
            action={
              <button
                type="button"
                onClick={() => setScopeOpen((v) => !v)}
                className="text-xs font-semibold text-ink-muted hover:text-ink"
              >
                {scopeOpen ? "Hide" : scopeText ? "Edit" : "Paste"}
              </button>
            }
          >
            {scopeOpen ? (
              <div className="flex flex-col gap-2.5">
                <textarea
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  rows={5}
                  aria-label="Scope of works"
                  placeholder="Paste the client's scope of works"
                  className="w-full resize-y rounded-lg border border-hairline-strong bg-canvas p-3 text-sm leading-relaxed text-ink placeholder:text-ink-subtle focus-visible:border-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/15"
                />
                <div className="flex items-center gap-2">
                  <input
                    ref={scopeInput}
                    type="file"
                    accept={SCOPE_ACCEPT}
                    className="hidden"
                    onChange={(e) => extractScopeFile(e.target.files?.[0])}
                  />
                  <Button variant="secondary" size="sm" disabled={extracting} onClick={() => scopeInput.current?.click()} className="gap-1.5">
                    {extracting && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
                    Upload a scope file
                  </Button>
                  {scopeText && (
                    <Button variant="ghost" size="sm" onClick={() => setScopeText("")}>
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-ink-muted">
                {scopeText ? `${scopeText.length.toLocaleString()} characters ready to read` : "Optional"}
              </p>
            )}
          </Panel>

          <div className="flex flex-col items-stretch gap-4 rounded-xl border border-ink bg-canvas px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">Read the enquiry</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                Pulls measurements, counts and mark ups off the ticked files. Nothing is added until you confirm it.
              </p>
            </div>
            <Button
              onClick={runRead}
              disabled={reading || (ticked.length === 0 && !scopeText.trim())}
              className="h-11 w-full gap-2 px-5 text-[15px] sm:w-auto"
            >
              {reading ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : (
                <Layers className="h-4 w-4" strokeWidth={1.75} />
              )}
              {reading
                ? "Reading"
                : ticked.length > 0
                  ? `Read ${ticked.length} file${ticked.length === 1 ? "" : "s"}`
                  : "Read enquiry"}
            </Button>
          </div>
        </>
      )}

      {error && <p className="text-sm text-ink">{error}</p>}
    </div>
  );
}


function Check({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={checked ? "Included" : "Not included"}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors",
        checked ? "border-ink bg-ink text-canvas" : "border-hairline-strong bg-canvas hover:border-ink/50",
      )}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      )}
    </button>
  );
}
