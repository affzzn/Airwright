"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { readDrawing } from "@/lib/construction/readDrawing";
import {
  assembleDrawingDraft,
  type DrawingDraftLine,
  type DrawingDraftMeasurement,
} from "@/lib/construction/assemble";
import type { DrawingObservations } from "@/lib/construction/drawingSchema";
import { lineAmount, resolveConstructionRate } from "@/lib/construction/price";
import { loadConstructionLibrary } from "@/server/construction";
import type { ConstructionUnit, HeightBracket, RateBand } from "@/lib/construction/types";

/**
 * Construction enquiry reading (docs/20) — the DRAWING side. The estimator ticks
 * which attachments the AI reads, runs the drawing reader (Opus 4.8 vision) over
 * them, reviews the assembled draft, then applies it. NEVER reads an answer file;
 * never prices without the estimator (returns a draft to confirm).
 */

/** An internal answer file (Airwright's own schedule/quote) is never eligible for reading. */
function looksLikeAnswerFile(name: string): boolean {
  return /schedule/i.test(name) || /^\s*quote[-_ ]?\d/i.test(name);
}

// --- 1. Tick which files the AI reads --------------------------------------

export async function setConstructionAttachmentDrafting(
  attachmentId: string,
  quoteId: string,
  use: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const att = await prisma.constructionAttachment.findUnique({ where: { id: attachmentId } });
  if (!att) return { ok: false, error: "Attachment not found." };
  if (use && looksLikeAnswerFile(att.fileName))
    return { ok: false, error: "This looks like a priced answer (schedule/quote), not an enquiry — not read." };
  await prisma.constructionAttachment.update({
    where: { id: attachmentId },
    data: { useForDrafting: use },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

// --- 2. Read the ticked drawings → an assembled draft (AI proposes) --------

export interface DrawingDraftResult {
  ok: boolean;
  error?: string;
  lines?: DrawingDraftLine[];
  measurements?: DrawingDraftMeasurement[];
  flags?: string[];
  suggestedHeightBracket?: HeightBracket | null;
  buildingHeightM?: number | null;
  read?: { fileName: string; ok: boolean; costUsd?: number; error?: string }[];
}

export async function readConstructionDrawings(quoteId: string): Promise<DrawingDraftResult> {
  if (!env.constructionAI) return { ok: false, error: "AI reading is turned off." };
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };

  const atts = await prisma.constructionAttachment.findMany({
    where: { quoteId, useForDrafting: true },
  });
  // Only PDFs go to the drawing reader; skip answer files defensively.
  const drawings = atts.filter(
    (a) => a.mimeType === "application/pdf" && !looksLikeAnswerFile(a.fileName),
  );
  if (drawings.length === 0)
    return { ok: false, error: "Tick at least one drawing (PDF) to read first." };

  const library = await loadConstructionLibrary();
  if (library.length === 0)
    return { ok: false, error: "The picking list is empty — add elements on the Rates → Construction tab." };

  const observations: DrawingObservations[] = [];
  const read: NonNullable<DrawingDraftResult["read"]> = [];

  // Read each drawing (bounded parallelism keeps it responsive for a handful of files).
  const results = await Promise.allSettled(
    drawings.map(async (a) => {
      const bytes = await downloadFromStorage(a.storagePath);
      return { att: a, result: await readDrawing(bytes) };
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const a = drawings[i];
    const r = results[i];
    if (r.status === "fulfilled") {
      observations.push(r.value.result.observations);
      read.push({ fileName: a.fileName, ok: true, costUsd: r.value.result.meta.costUsd });
      await prisma.constructionAttachment.update({
        where: { id: a.id },
        data: {
          readStatus: "READ",
          drawingKind: r.value.result.observations.sheet.kind,
          readRawOutput: r.value.result.meta.raw as Prisma.InputJsonValue,
          readMeta: {
            model: r.value.result.meta.model,
            promptVersion: r.value.result.meta.promptVersion,
            inputTokens: r.value.result.meta.inputTokens,
            outputTokens: r.value.result.meta.outputTokens,
            costUsd: r.value.result.meta.costUsd,
          } as Prisma.InputJsonValue,
        },
      });
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : "read failed";
      read.push({ fileName: a.fileName, ok: false, error: msg });
      await prisma.constructionAttachment.update({
        where: { id: a.id },
        data: { readStatus: "FAILED" },
      });
    }
  }

  if (observations.length === 0)
    return { ok: false, error: "Couldn’t read any drawing.", read };

  // Layer 2: fuse the observations into a draft. Call-offs (scope) would be threaded
  // here once the scope + drawing drafts are merged; for now the drawing is the source.
  const draft = assembleDrawingDraft(
    observations,
    library.map((e) => ({
      id: e.id,
      name: e.name,
      aliases: e.aliases,
      unit: e.unit as ConstructionUnit,
      usesLifts: e.usesLifts,
    })),
  );
  revalidatePath(`/construction/${quoteId}`);
  return {
    ok: true,
    lines: draft.lines,
    measurements: draft.measurements,
    flags: draft.flags,
    suggestedHeightBracket: draft.suggestedHeightBracket,
    buildingHeightM: draft.buildingHeightM,
    read,
  };
}

// --- 3. Apply the confirmed draft (measurements + lines) -------------------

export interface ApplyDrawingLine {
  elementId: string | null;
  description: string;
  unit: ConstructionUnit;
  quantity: number | null;
  lifts: number | null;
  heightBracket: HeightBracket | null;
  note: string | null;
}

const cleanQty = (n: number | null): number => (n != null && Number.isFinite(n) && n >= 0 ? n : 0);
const cleanLifts = (n: number | null): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
};

export async function applyDrawingDraft(
  quoteId: string,
  input: { lines: ApplyDrawingLine[]; measurements: DrawingDraftMeasurement[]; setHeightBracket?: HeightBracket | null },
): Promise<{ ok: boolean; added?: number; error?: string }> {
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to add lines." };
  if (input.lines.length === 0 && input.measurements.length === 0)
    return { ok: false, error: "Nothing selected." };

  const library = await loadConstructionLibrary();
  const byId = new Map(library.map((e) => [e.id, e]));
  const band = quote.band as RateBand;
  // Prefer an explicit bracket set from this draft, else the quote's default.
  const defaultBracket =
    input.setHeightBracket ?? (quote.defaultHeightBracket as HeightBracket | null) ?? null;

  const [maxLine, maxMeas] = await Promise.all([
    prisma.constructionQuoteLine.aggregate({ where: { quoteId }, _max: { sortOrder: true } }),
    prisma.constructionMeasurement.aggregate({ where: { quoteId }, _max: { sortOrder: true } }),
  ]);
  let lineSort = (maxLine._max.sortOrder ?? 0) + 10;
  let measSort = (maxMeas._max.sortOrder ?? 0) + 10;

  const lineData: Prisma.ConstructionQuoteLineCreateManyInput[] = [];
  for (const l of input.lines) {
    const el = l.elementId ? byId.get(l.elementId) : undefined;
    const quantity = cleanQty(l.quantity);
    if (el) {
      const bracket = el.usesHeightBracket ? (l.heightBracket ?? defaultBracket) : null;
      const rate =
        resolveConstructionRate(
          el.rates.map((r) => ({ band: r.band as RateBand, bracket: r.bracket as HeightBracket, rate: r.rate })),
          band,
          bracket,
        ) ?? 0;
      const lifts = el.usesLifts ? cleanLifts(l.lifts) : null;
      const unit = el.unit as ConstructionUnit;
      lineData.push({
        quoteId,
        elementId: el.id,
        description: el.name,
        lifts,
        unit,
        quantity,
        heightBracket: bracket,
        rate,
        amount: lineAmount({ unit, quantity, lifts, rate }),
        isAuto: true,
        note: l.note,
        sortOrder: lineSort,
      });
    } else {
      // Unmatched feature → a one-off custom line for the estimator to finish.
      lineData.push({
        quoteId,
        elementId: null,
        description: l.description.trim() || "Untitled item",
        lifts: cleanLifts(l.lifts),
        unit: l.unit,
        quantity,
        rate: 0,
        amount: 0,
        isAuto: true,
        note: l.note,
        sortOrder: lineSort,
      });
    }
    lineSort += 10;
  }

  const measData: Prisma.ConstructionMeasurementCreateManyInput[] = input.measurements.map((m) => ({
    quoteId,
    label: m.label,
    kind: m.kind,
    valueNumber: m.valueNumber,
    lifts: cleanLifts(m.lifts),
    source: "DRAWING",
    note: m.note,
    sortOrder: (measSort += 10) - 10,
  }));

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (lineData.length) ops.push(prisma.constructionQuoteLine.createMany({ data: lineData }));
  if (measData.length) ops.push(prisma.constructionMeasurement.createMany({ data: measData }));
  // Adopt the drawing's height bracket on the quote if it had none (so bracketed rates resolve).
  if (input.setHeightBracket && !quote.defaultHeightBracket)
    ops.push(
      prisma.constructionQuote.update({
        where: { id: quoteId },
        data: { defaultHeightBracket: input.setHeightBracket },
      }),
    );
  await prisma.$transaction(ops);

  revalidatePath(`/construction/${quoteId}`);
  return { ok: true, added: lineData.length };
}
