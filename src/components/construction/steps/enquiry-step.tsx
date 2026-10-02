"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileText, Layers, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { deleteConstructionAttachment } from "@/server/actions/construction";
import { applyDrawingDraft, setConstructionAttachmentDrafting, type ApplyDrawingLine } from "@/server/actions/constructionDrawings";
import {
  setConstructionSheetIncluded,
  startConstructionIngest,
  startConstructionRead,
} from "@/server/actions/constructionPack";
import type { DrawingDraftLine } from "@/lib/construction/assemble";
import type {
  ConstructionAttachmentVM,
  ConstructionElementLibVM,
  ConstructionQuoteVM,
  ConstructionSheetVM,
  SheetRef,
} from "@/server/construction";
import { UNIT_LABEL, type ConstructionUnit } from "@/lib/construction/types";
import { MeasurementSheet, CONF_VALUE } from "@/components/construction/measurement-sheet";
import { ScopeReviewPanel, STATUS_LABEL } from "@/components/construction/scope-review";
import type { JobStep } from "@/lib/construction/jobState";
import { Button } from "@/components/ui/button";
import { ConfidenceDot } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { CellInput, IconButton, Panel, ToggleButton } from "@/components/construction/parts";
import { fileKindLabel, uploadConstructionPack, type FileWithPath, type UploadProgress } from "@/components/construction/upload";
import { BoxDrop } from "@/components/construction/enquiry-boxes";
import { boxOf, ENQUIRY_BOXES, junkReason, SCENARIO_COPY } from "@/lib/construction/pack/files";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Step 1 — the enquiry (docs/22, docs/23). Files arrive in three boxes (Scope ·
 * Drawings · Email); the boxes set the SCENARIO, shown read-only:
 *   1 — a scope: one button reads the scope (+ email) and drafts the client's
 *       lines with the client's numbers; the drawings are only listed to look at;
 *   2 — drawings, no scope: the drawings are tidied into a register (by building,
 *       then by what each sheet is for) and read for the sure things;
 *   3 — neither: nothing is read; the cards are filled in by hand.
 * Nothing prices until the estimator adds it.
 */

const KIND_LABEL: Record<string, string> = {
  PLAN: "Floor plan",
  ROOF_PLAN: "Roof plan",
  ELEVATION: "Elevation",
  SECTION: "Section",
  MARKUP: "Mark-up",
  SITE_PLAN: "Site plan",
  LOGISTICS_PLAN: "Compound / logistics",
  SURVEY: "Existing site / survey",
  REGISTER: "Drawing register",
  SCOPE: "Scope",
  SCHEDULE: "Schedule",
  DETAIL: "Detail",
  FINISHES: "Finishes",
  FURNITURE: "Furniture",
  SPEC: "Specification",
  OTHER: "Unrecognised",
};

interface LineRow extends DrawingDraftLine {
  include: boolean;
}

export function EnquiryStep({
  quote,
  library,
  locked,
  aiEnabled,
  compact,
  onShowFile,
  onShowSheet,
  goToStep,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  locked: boolean;
  aiEnabled: boolean;
  compact: boolean;
  onShowFile: (id: string) => void;
  onShowSheet: (ref: SheetRef) => void;
  goToStep: (s: JobStep) => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [reviewing, setReviewing] = useState(false);

  const sorting = quote.ingestStatus === "QUEUED" || quote.ingestStatus === "RUNNING";
  const run = quote.latestRun;
  const reading = run?.status === "QUEUED" || run?.status === "RUNNING";
  const unsorted = quote.attachments.length > 0 && (quote.ingestStatus == null || quote.ingestStatus === "NONE");
  const scenario = (quote.mode ?? null) as "A" | "B" | "C" | null;
  const scopeScenario = scenario === "A";
  // Scenario 1 reads the scope (+ email) only; Scenario 2 the drawings only; 3 nothing.
  const toRead = scopeScenario ? [] : quote.sheets.filter((s) => s.bucket === "CORE" && s.included && !s.superseded);
  const scopeFiles = quote.attachments.filter((a) => a.bucket === "SCOPE" && a.useForDrafting);
  const canRead = scenario === "A" ? scopeFiles.length > 0 : scenario === "B" ? toRead.length > 0 : false;

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  const drafted = quote.lines.filter((l) => l.formula != null || l.clientRef != null).length;
  if (reviewing && run?.result?.draftLines.length)
    return (
      <DraftReview
        quote={quote}
        library={library}
        lines={run.result.draftLines}
        flags={run.result.draftFlags}
        scopeScenario={scopeScenario}
        alreadyDrafted={drafted}
        onClose={() => setReviewing(false)}
        onApplied={() => {
          setReviewing(false);
          router.refresh();
          goToStep("items");
        }}
      />
    );

  return (
    <div className={cn("flex min-w-0 flex-col gap-4", !compact && "max-w-5xl")}>
      <UploadPanel quote={quote} locked={locked} />

      {(sorting || unsorted || quote.ingestStatus === "FAILED") && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-surface/60 px-5 py-3.5">
          <p className="flex items-center gap-2 text-[13px] text-ink">
            {sorting && <Loader2 className="h-4 w-4 animate-spin text-ink-muted" strokeWidth={2} />}
            {sorting
              ? "Sorting the pack: unpacking, reading title blocks, grouping by building…"
              : quote.ingestStatus === "FAILED"
                ? `The pack could not be sorted: ${quote.ingestError ?? "unknown error"}`
                : "These files have not been sorted yet."}
          </p>
          {!sorting && !locked && (
            <Button variant="secondary" size="sm" className="gap-1.5" disabled={pending} onClick={() => act(() => startConstructionIngest(quote.id))}>
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Sort the pack
            </Button>
          )}
        </div>
      )}

      {quote.ingestStatus === "DONE" && scenario && <ScenarioBanner quote={quote} />}

      {quote.ingestStatus === "DONE" && aiEnabled && !locked && scenario !== "C" && (
        <div className="flex flex-col gap-3 rounded-xl border border-ink bg-canvas px-5 py-4">
          <div className={cn("flex flex-col items-stretch gap-3", !compact && "sm:flex-row sm:items-center sm:justify-between")}>
            <div className="min-w-0 flex-1">
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">{scopeScenario ? "Read the scope" : "Read the drawings"}</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {scopeScenario
                  ? `${scopeFiles.length} file${scopeFiles.length === 1 ? "" : "s"} read: each line of the scope is matched to the picking list with the client's own numbers. The drawings are not read.`
                  : `${toRead.length} sheet${toRead.length === 1 ? "" : "s"} read in the background for the sure things only. Unchanged sheets already read are not paid for again.`}{" "}
                Nothing is priced until you add it.
              </p>
            </div>
            <Button
              onClick={() => act(() => startConstructionRead(quote.id))}
              disabled={pending || reading || !canRead}
              className={cn("h-11 w-full gap-2 px-5 text-[15px]", !compact && "sm:w-auto")}
            >
              {reading ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Layers className="h-4 w-4" strokeWidth={1.75} />}
              {reading ? "Reading" : run?.status === "DONE" ? "Read again" : scopeScenario ? "Read the scope" : "Read the drawings"}
            </Button>
          </div>
          {run && <RunStatus run={run} scopeScenario={scopeScenario} />}
          {run?.status === "DONE" && run.result && run.result.draftLines.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-3">
              <p className="text-[13px] text-ink">
                {run.result.draftLines.length} line{run.result.draftLines.length === 1 ? "" : "s"} from the {scopeScenario ? "client's scope" : run.result.account ? "scope, measured from the drawings" : "mark-up"}, ready to check
                {drafted ? ` (${drafted} already on the quote)` : ""}.
              </p>
              <Button size="sm" onClick={() => setReviewing(true)}>
                Review the lines
              </Button>
            </div>
          )}
        </div>
      )}

      {run?.status === "DONE" && run.result && (run.result.account || (run.result.emptySections?.length ?? 0) > 0 || (run.result.info?.length ?? 0) > 0) && (
        <ScopeReviewPanel quote={quote} result={run.result} locked={locked} />
      )}

      {!scopeScenario && (quote.measurements.some((m) => m.runId) || (quote.latestRun?.result?.buildings ?? []).some((b) => (b.hints ?? []).length > 0)) && (
        <MeasurementSheet quote={quote} library={library} locked={locked} onShowSheet={onShowSheet} />
      )}

      {quote.ingestStatus === "DONE" && (
        <Register quote={quote} locked={locked} pending={pending} onShowFile={onShowFile} act={act} />
      )}

      {error && <p className="text-sm text-ink">{error}</p>}
    </div>
  );
}

// --- Upload -----------------------------------------------------------------------------

function UploadPanel({ quote, locked }: { quote: ConstructionQuoteVM; locked: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = (box: (typeof ENQUIRY_BOXES)[number]) =>
    quote.attachments.filter((a) => !junkReason(a.relativePath ?? a.fileName) && boxOf(a.kind, a.relativePath ?? a.fileName, a.mimeType) === box).length;

  const upload = async (files: FileWithPath[]) => {
    if (files.length === 0 || locked) return;
    setBusy(true);
    setError(null);
    try {
      const p = await uploadConstructionPack(quote.id, files, setProgress);
      if (p.failed) setError(`${p.failed} file${p.failed === 1 ? "" : "s"} failed to upload — add the same files again to retry just those.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  if (locked && quote.attachments.length === 0) return null;
  return (
    <div>
      {!locked && (
        <>
          <p className="mb-2 text-xs text-ink-muted">
            {quote.attachments.length ? "Add more to a box — the job is re-sorted and its scenario updated." : "Put the enquiry in its boxes. All three are optional."}
          </p>
          {/* Wraps to the width it has (the drawing pane may be open beside it). */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
            {ENQUIRY_BOXES.map((box) => (
              <BoxDrop key={box} box={box} count={count(box)} disabled={busy} compact={quote.attachments.length > 0} onAdd={(f) => void upload(f)} />
            ))}
          </div>
        </>
      )}
      {progress && busy && (
        <div className="mt-3">
          <ProgressBar value={progress.bytesTotal ? (progress.bytesDone / progress.bytesTotal) * 100 : 0} />
          <p className="mt-1.5 truncate text-[11px] text-ink-muted">
            {progress.done} of {progress.total} uploaded{progress.skipped ? ` · ${progress.skipped} already there` : ""}
            {progress.current ? ` · ${progress.current}` : ""}
          </p>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-ink">{error}</p>}
    </div>
  );
}

// --- Scenario + run status ---------------------------------------------------------------------

/** The job's scenario — set by the upload boxes, never switched by hand. */
function ScenarioBanner({ quote }: { quote: ConstructionQuoteVM }) {
  const scenario = (quote.mode ?? "C") as "A" | "B" | "C";
  const copy = SCENARIO_COPY[scenario];
  return (
    <div className="rounded-xl border border-hairline px-5 py-3.5">
      <p className="text-[13px] font-semibold text-ink">{copy.title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
        {copy.body}
        {scenario === "C" ? " Go to Scaffold items to fill them in." : ""}
      </p>
    </div>
  );
}

function RunStatus({ run, scopeScenario }: { run: NonNullable<ConstructionQuoteVM["latestRun"]>; scopeScenario: boolean }) {
  const [open, setOpen] = useState(false);
  const p = run.progress;
  if (run.status === "QUEUED" || run.status === "RUNNING") {
    const pct = p && p.total ? ((p.done + p.failed) / p.total) * 100 : 0;
    return (
      <div>
        <ProgressBar value={pct} />
        <p className="mt-1.5 truncate text-[11px] text-ink-muted">
          {run.status === "QUEUED" ? "Waiting for the reader…" : scopeScenario ? "Reading the scope…" : `${(p?.done ?? 0) + (p?.failed ?? 0)} of ${p?.total ?? "?"} sheets`}
          {p?.current ? ` · ${p.current}` : ""}
          {run.costUsd ? ` · $${run.costUsd.toFixed(2)} so far` : ""}
        </p>
      </div>
    );
  }
  if (run.status === "FAILED") return <p className="text-xs text-ink">The read failed: {run.error ?? "unknown error"}. Read again to retry — sheets already read are reused.</p>;
  const r = run.result;
  if (!r) return null;
  const flags = [...r.flags, ...r.buildings.flatMap((b) => b.flags.map((f) => `${b.name}: ${f}`))];
  return (
    <div className="border-t border-hairline pt-3">
      <p className="text-xs text-ink-muted">
        {scopeScenario ? (
          <>Read the scope · {r.draftLines.length} line{r.draftLines.length === 1 ? "" : "s"} · ${run.costUsd.toFixed(2)}</>
        ) : (
          <>
            Read {r.sheetsRead + r.sheetsReused} sheet{r.sheetsRead + r.sheetsReused === 1 ? "" : "s"}
            {r.sheetsReused ? ` (${r.sheetsReused} unchanged, reused)` : ""}
            {r.sheetsFailed ? ` · ${r.sheetsFailed} could not be read` : ""} · ${run.costUsd.toFixed(2)} ·{" "}
            {r.buildings.reduce((a, b) => a + b.measurements, 0)} measurements
          </>
        )}
      </p>
      {flags.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-xs font-semibold text-ink">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {flags.length} thing{flags.length === 1 ? "" : "s"} to check
          </button>
          {open && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {flags.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-muted" aria-hidden />
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- The register ---------------------------------------------------------------------------------

function Register({
  quote,
  locked,
  pending,
  onShowFile,
  act,
}: {
  quote: ConstructionQuoteVM;
  locked: boolean;
  pending: boolean;
  onShowFile: (id: string) => void;
  act: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  // Scenario 1 never reads the drawings: they are listed to look at, with no Read switch.
  const lookOnly = quote.mode === "A";
  const attById = new Map(quote.attachments.map((a) => [a.id, a]));
  const readSheets = quote.sheets.filter((s) => (s.bucket === "CORE" || s.bucket === "CONTEXT") && !s.superseded);
  const buildings = [...quote.buildings.map((b) => ({ id: b.id as string | null, name: b.name })), { id: null, name: "Whole job" }];
  const skippedSheets = quote.sheets.filter((s) => s.bucket === "NOT_RELEVANT" || s.bucket === "REGISTER" || s.superseded);
  const scope = quote.attachments.filter((a) => a.bucket === "SCOPE");
  const reference = quote.attachments.filter((a) => a.bucket === "REFERENCE");
  const junk = quote.attachments.filter((a) => a.bucket === "JUNK" || a.bucket === "DUPLICATE" || a.bucket === "ARCHIVE");

  const sheetRow = (s: ConstructionSheetVM) => {
    const att = attById.get(s.attachmentId);
    return (
      <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-5 py-2.5", !s.included && "opacity-50")}>
        <button type="button" onClick={() => onShowFile(s.attachmentId)} className="min-w-0 flex-1 basis-full text-left sm:basis-0">
          <span className="block truncate text-[13px] font-medium text-ink">{s.title ?? att?.fileName}</span>
          <span className="block truncate text-[11px] text-ink-muted">
            {[KIND_LABEL[s.kind] ?? s.kind, s.level ?? s.face, s.drawingNo, s.revision ? `rev ${s.revision}` : null, s.paper, s.scale, !s.hasText ? "picture" : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </button>
        {!lookOnly && (
          <span className="shrink-0 text-[11px] font-semibold text-ink-muted">
            {s.readStatus === "READ" ? `read${s.readCostUsd != null ? ` · $${s.readCostUsd.toFixed(2)}` : ""}` : s.readStatus === "FAILED" ? "could not be read" : s.bucket === "CONTEXT" ? "text only" : ""}
          </span>
        )}
        {!locked && !lookOnly && s.bucket === "CORE" && (
          <ToggleButton
            on={s.included}
            disabled={pending}
            onClick={() => act(() => setConstructionSheetIncluded(s.id, quote.id, !s.included))}
            onLabel="Read"
            offLabel="Skip"
            title={s.included ? "This sheet is read" : "Read this sheet"}
          />
        )}
      </li>
    );
  };

  const fileRow = (a: ConstructionAttachmentVM, toggle = false) => (
    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline px-5 py-2.5">
      <FileText className="hidden h-4 w-4 shrink-0 text-ink-subtle sm:block" strokeWidth={1.75} />
      <button type="button" onClick={() => onShowFile(a.id)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-medium text-ink">{a.fileName}</span>
        <span className="block truncate text-[11px] text-ink-muted">
          {[fileKindLabel(a.mimeType, a.fileName), a.sizeBytes != null ? formatBytes(a.sizeBytes) : null, a.bucketReason].filter(Boolean).join(" · ")}
        </span>
      </button>
      {toggle && !locked && (
        <ToggleButton
          on={a.useForDrafting}
          disabled={pending}
          onClick={() => act(() => setConstructionAttachmentDrafting(a.id, quote.id, !a.useForDrafting))}
          onLabel="Read"
          offLabel="Skip"
        />
      )}
      {!locked && (
        <IconButton label="Remove file" disabled={pending} onClick={() => act(async () => { await deleteConstructionAttachment(a.id, quote.id); return startConstructionIngest(quote.id); })}>
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </IconButton>
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      {buildings.map((b) => {
        const sheets = readSheets.filter((s) => s.buildingId === b.id);
        if (sheets.length === 0) return null;
        const core = sheets.filter((s) => s.bucket === "CORE");
        const context = sheets.filter((s) => s.bucket === "CONTEXT");
        return (
          <Panel
            key={b.id ?? "job"}
            title={lookOnly ? `Drawings · ${core.length} to look at (not read)` : `${b.name} · ${core.length} drawing${core.length === 1 ? "" : "s"} to read`}
            bodyClassName="px-0 pb-0"
          >
            <ul>{core.map(sheetRow)}</ul>
            {context.length > 0 && (
              <>
                <p className="eyebrow border-t border-hairline px-5 pb-1 pt-3">Site context</p>
                <ul>{context.map(sheetRow)}</ul>
              </>
            )}
          </Panel>
        );
      })}

      {scope.length > 0 && (
        <Panel title={lookOnly ? "Scope and email · read" : "Scope"} bodyClassName="px-0 pb-0">
          <ul>{scope.map((a) => fileRow(a, true))}</ul>
        </Panel>
      )}
      {reference.length > 0 && (
        <Panel title="Reference only" bodyClassName="px-0 pb-0">
          <ul>{reference.map((a) => fileRow(a))}</ul>
        </Panel>
      )}

      {(skippedSheets.length > 0 || junk.length > 0) && (
        <div className="rounded-xl border border-hairline">
          <button type="button" onClick={() => setShowSkipped((o) => !o)} className="flex w-full items-center gap-2 px-5 py-3 text-left text-[13px] font-semibold text-ink">
            {showSkipped ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Not read: {skippedSheets.length} sheet{skippedSheets.length === 1 ? "" : "s"} not needed for scaffold
            {junk.length ? `, ${junk.length} junk / duplicate file${junk.length === 1 ? "" : "s"}` : ""}
          </button>
          {showSkipped && (
            <ul>
              {skippedSheets.map((s) => (
                <li key={s.id} className="flex items-center gap-3 border-t border-hairline px-5 py-2">
                  <button type="button" onClick={() => onShowFile(s.attachmentId)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[12px] text-ink">{s.title ?? attById.get(s.attachmentId)?.fileName}</span>
                    <span className="block truncate text-[11px] text-ink-muted">{s.reason}</span>
                  </button>
                </li>
              ))}
              {junk.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-t border-hairline px-5 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-ink">{a.relativePath ?? a.fileName}</span>
                    <span className="block truncate text-[11px] text-ink-muted">{a.bucketReason}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// --- Draft line review (a scope job) ---------------------------------------------------------------

function DraftReview({
  quote,
  library,
  lines: initial,
  flags,
  scopeScenario,
  alreadyDrafted,
  onClose,
  onApplied,
}: {
  quote: ConstructionQuoteVM;
  library: ConstructionElementLibVM[];
  lines: DrawingDraftLine[];
  flags: string[];
  /** Scenario 1: the client's numbers as given — no working, status or confidence to show. */
  scopeScenario: boolean;
  alreadyDrafted: number;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [lines, setLines] = useState<LineRow[]>(initial.map((l) => ({ ...l, include: l.elementId != null })));
  const [replace, setReplace] = useState(alreadyDrafted > 0);
  const [error, setError] = useState<string | null>(null);
  const [applying, startApply] = useTransition();
  const patch = (i: number, p: Partial<LineRow>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...p } : l)));
  const included = lines.filter((l) => l.include).length;
  const bName = (id: string | null | undefined) => (id ? (quote.buildings.find((b) => b.id === id)?.name ?? null) : null);

  // Grouped by building, then section — the order the quote will print in.
  const groups = useMemo(() => {
    const out: { key: string; title: string; rows: { l: LineRow; i: number }[] }[] = [];
    lines.forEach((l, i) => {
      const title = [bName(l.buildingId), l.section].filter(Boolean).join(" · ") || "Lines";
      let g = out.find((x) => x.key === title);
      if (!g) out.push((g = { key: title, title, rows: [] }));
      g.rows.push({ l, i });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  const apply = () => {
    const chosen: ApplyDrawingLine[] = lines
      .filter((l) => l.include)
      .map((l) => ({
        elementId: l.elementId,
        description: l.description,
        unit: (library.find((e) => e.id === l.elementId)?.unit as ConstructionUnit | undefined) ?? l.unit,
        quantity: l.quantity,
        lifts: l.lifts,
        heightBracket: l.heightBracket,
        note: l.note,
        hireWeeks: l.hireWeeks ?? null,
        section: l.section ?? null,
        buildingId: l.buildingId ?? null,
        formula: l.formula ?? null,
        provenance: l.provenance ?? [],
        paramsUsed: l.paramsUsed ?? [],
        flags: l.flags ?? [],
        confidence: l.confidence,
        clientRef: l.clientRef ?? null,
        suggestedElementId: l.suggestedElementId ?? null,
      }));
    if (chosen.length === 0) {
      setError("Tick at least one line.");
      return;
    }
    startApply(async () => {
      // The measurements are already on the job (saved by the read); add the lines.
      const res = await applyDrawingDraft(quote.id, { lines: chosen, measurements: [], replaceDrafted: replace });
      if (!res.ok) setError(res.error ?? "Could not add those lines.");
      else onApplied();
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{scopeScenario ? "The client's lines" : "Draft lines to check"}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {scopeScenario
              ? "Each line of the scope, matched to the picking list, with the client's own numbers. A blank is yours to type."
              : "The scope says what; the drawings say how much. Every quantity shows its working."}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Back
        </Button>
      </div>
      {flags.length > 0 && (
        <Panel title="Worth a look">
          <ul className="flex flex-col gap-2">
            {flags.map((f, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-ink">
                {f}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {groups.map((g) => (
        <Panel key={g.key} title={g.title} bodyClassName="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-muted">
                  <th className="w-10 pb-2 pl-5" />
                  <th className="pb-2 pr-3">Client asked · item</th>
                  <th className="w-28 pb-2 pr-3 text-right">Quantity</th>
                  <th className="w-20 pb-2 pr-3 text-right">Lifts</th>
                  <th className="w-20 pb-2 pr-5 text-right">Hire</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map(({ l, i }) => (
                  <tr key={i} className={cn("border-t border-hairline align-top", !l.include && "opacity-45")}>
                    <td className="py-2.5 pl-5 pt-3.5">
                      <input type="checkbox" aria-label="Include" checked={l.include} onChange={(e) => patch(i, { include: e.target.checked })} className="h-4 w-4 accent-black" />
                    </td>
                    <td className="py-2.5 pr-3">
                      {l.clientRef?.text && (
                        <p className="mb-1 text-[12px] text-ink">
                          “{l.clientRef.text}”
                          {!scopeScenario && (l.clientRef.statedQuantity != null || l.clientRef.statedCount != null) ? (
                            <span className="ml-1.5 text-ink-muted">client: {l.clientRef.statedQuantity ?? l.clientRef.statedCount}</span>
                          ) : null}
                        </p>
                      )}
                      <select
                        aria-label="Picking list item"
                        value={l.elementId ?? ""}
                        onChange={(e) => patch(i, { elementId: e.target.value || null, include: Boolean(e.target.value) })}
                        className="h-9 w-full min-w-[12rem] rounded-lg border border-hairline-strong bg-canvas px-2 text-[13px] text-ink"
                      >
                        <option value="">Choose an item</option>
                        {library.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} · {UNIT_LABEL[e.unit as ConstructionUnit]}
                          </option>
                        ))}
                      </select>
                      {scopeScenario ? (
                        l.note && <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">{l.note}</p>
                      ) : (
                        <p className="mt-1 flex items-start gap-2 text-[11px] leading-relaxed text-ink-muted" title={(l.provenance ?? []).join("\n")}>
                          <span className="mt-1">
                            <ConfidenceDot value={CONF_VALUE[l.confidence] ?? 0} />
                          </span>
                          <span>
                            {l.status && <span className="mr-1.5 font-semibold text-ink">{STATUS_LABEL[l.status] ?? l.status}</span>}
                            {l.formula ?? l.note ?? "From the drawing"}
                          </span>
                        </p>
                      )}
                      {(l.flags ?? []).filter((f) => !/is a placeholder/.test(f)).map((f, k) => (
                        <p key={k} className="mt-0.5 text-[11px] text-ink">
                          · {f}
                        </p>
                      ))}
                    </td>
                    <td className="py-2.5 pr-3">
                      <CellInput inputMode="decimal" aria-label="Quantity" value={l.quantity ?? ""} placeholder={scopeScenario ? "type" : "measure"} onChange={(e) => patch(i, { quantity: e.target.value === "" ? null : Number(e.target.value) })} />
                    </td>
                    <td className="py-2.5 pr-3">
                      <CellInput inputMode="numeric" aria-label="Lifts" value={l.lifts ?? ""} placeholder="—" onChange={(e) => patch(i, { lifts: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) })} />
                    </td>
                    <td className="py-2.5 pr-5">
                      <CellInput inputMode="numeric" aria-label="Hire weeks" value={l.hireWeeks ?? ""} placeholder="—" onChange={(e) => patch(i, { hireWeeks: e.target.value === "" ? null : Math.trunc(Number(e.target.value)) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
      {error && <p className="text-sm text-ink">{error}</p>}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-canvas/95 px-5 py-3.5 backdrop-blur">
        <div className="text-xs text-ink-muted">
          <p>{scopeScenario ? "A blank quantity is added at zero for you to type in." : "A blank quantity is a line to measure by hand — it is added at zero and flagged."}</p>
          {alreadyDrafted > 0 && (
            <label className="mt-1 flex items-center gap-2 text-ink">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} className="h-3.5 w-3.5 accent-black" />
              Replace the {alreadyDrafted} line{alreadyDrafted === 1 ? "" : "s"} an earlier draft added
            </label>
          )}
        </div>
        <Button onClick={apply} disabled={applying} className="gap-2">
          {applying && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          Add {included} line{included === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}
