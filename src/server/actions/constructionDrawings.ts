"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { readDrawing } from "@/lib/construction/readDrawing";
import { extractScopeText } from "@/lib/construction/scopeText";
import { draftFromScope } from "@/lib/construction/draftFromScope";
import {
  assembleDrawingDraft,
  callOffsFromScope,
  scopeOnlyLines,
  type AssembleLibEl,
  type DrawingDraftLine,
  type DrawingDraftMeasurement,
  type ScopeItem,
} from "@/lib/construction/assemble";
import type { DrawingObservations } from "@/lib/construction/drawingSchema";
import { lineAmount, resolveConstructionRateRow, type RateRow } from "@/lib/construction/price";
import { isDrawingFile, isScopeTextFile } from "@/lib/construction/fileKinds";
import { loadConstructionLibrary } from "@/server/construction";
import type { ConstructionUnit, HeightBracket, RateBand } from "@/lib/construction/types";

/**
 * Construction enquiry reading (docs/20) — reads the estimator's ticked enquiry
 * files: DRAWINGS (PDF → Opus 4.8 vision) and SCOPE text (email / spreadsheet →
 * the text reader), fuses them (drawing quantities are primary; a scope item with
 * no drawing is added flagged), and returns a draft to confirm. NEVER reads an
 * answer file; never prices without the estimator.
 */

// --- 1. Tick which files the AI reads --------------------------------------

export async function setConstructionAttachmentDrafting(
  attachmentId: string,
  quoteId: string,
  use: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const att = await prisma.constructionAttachment.findUnique({ where: { id: attachmentId } });
  if (!att) return { ok: false, error: "Attachment not found." };
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
  accessPoints?: { doorways: number; fireExits: number };
  read?: { fileName: string; ok: boolean; costUsd?: number; error?: string }[];
}

export async function readConstructionEnquiry(
  quoteId: string,
  extraScopeText?: string,
): Promise<DrawingDraftResult> {
  if (!env.constructionAI) return { ok: false, error: "AI reading is turned off." };
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };

  const pasted = extraScopeText?.trim() || "";
  // Whatever the estimator ticked: PDFs go to the vision reader, emails and
  // spreadsheets (a client's scope of works or scaffolding schedule) to the text
  // reader. Nothing is excluded by name — the tick is the decision.
  const atts = await prisma.constructionAttachment.findMany({ where: { quoteId, useForDrafting: true } });
  const drawings = atts.filter((a) => isDrawingFile(a.mimeType, a.fileName));
  const scopeFiles = atts.filter(
    (a) => !isDrawingFile(a.mimeType, a.fileName) && isScopeTextFile(a.mimeType, a.fileName),
  );
  if (drawings.length === 0 && scopeFiles.length === 0 && !pasted)
    return { ok: false, error: "Turn on at least one file to read." };

  const library = await loadConstructionLibrary();
  if (library.length === 0)
    return { ok: false, error: "The picking list is empty — add elements on the Rates → Construction tab." };
  const libAssemble: AssembleLibEl[] = library.map((e) => ({
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    unit: e.unit as ConstructionUnit,
    usesLifts: e.usesLifts,
  }));

  const read: NonNullable<DrawingDraftResult["read"]> = [];

  // --- Drawings (vision) — bounded parallelism -------------------------------
  const observations: DrawingObservations[] = [];
  const results = await Promise.allSettled(
    drawings.map(async (a) => ({ att: a, result: await readDrawing(await downloadFromStorage(a.storagePath)) })),
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
      read.push({ fileName: a.fileName, ok: false, error: r.reason instanceof Error ? r.reason.message : "read failed" });
      await prisma.constructionAttachment.update({ where: { id: a.id }, data: { readStatus: "FAILED" } });
    }
  }

  // --- Scope text (email / spreadsheet / txt) → the text reader --------------
  const scopeTexts: string[] = [];
  for (const a of scopeFiles) {
    try {
      const text = await extractScopeText({ name: a.fileName, mimeType: a.mimeType, bytes: await downloadFromStorage(a.storagePath) });
      if (text.trim()) scopeTexts.push(text);
      read.push({ fileName: a.fileName, ok: true });
      await prisma.constructionAttachment.update({ where: { id: a.id }, data: { readStatus: "READ" } });
    } catch (e) {
      read.push({ fileName: a.fileName, ok: false, error: e instanceof Error ? e.message : "read failed" });
      await prisma.constructionAttachment.update({ where: { id: a.id }, data: { readStatus: "FAILED" } });
    }
  }
  if (pasted) scopeTexts.push(pasted);

  // Keep what the scope actually said, for the audit trail and the quote's
  // "scope added" state.
  if (scopeTexts.length > 0) {
    await prisma.constructionQuote.update({
      where: { id: quoteId },
      data: { enquiryText: scopeTexts.join("\n\n---\n\n").slice(0, 200_000) },
    });
  }

  let scopeItems: ScopeItem[] = [];
  if (scopeTexts.length > 0) {
    try {
      const scopeDraft = await draftFromScope(
        scopeTexts.join("\n\n---\n\n"),
        library.map((e) => ({ id: e.id, name: e.name, aliases: e.aliases, unit: e.unit, usesLifts: e.usesLifts, category: e.category })),
      );
      scopeItems = scopeDraft.lines.map((l) => ({
        elementId: l.elementId,
        quantity: l.quantity,
        lifts: l.lifts,
        clientText: l.clientText,
        hireWeeks: l.hireWeeks,
        location: l.location,
        quantityBasis: l.quantityBasis,
      }));
    } catch {
      /* scope reader failed — proceed with the drawings alone */
    }
  }

  if (observations.length === 0 && scopeItems.length === 0)
    return { ok: false, error: "Couldn’t read any enquiry file.", read };

  // Layer 2: fuse. Drawing quantities are primary; the scope cross-checks the
  // call-off (docs/20 §7) and adds any item asked-for but not on a drawing.
  const callOffs = callOffsFromScope(scopeItems, libAssemble);
  const draft = assembleDrawingDraft(observations, libAssemble, callOffs);
  const extra = scopeOnlyLines(draft.lines, scopeItems, libAssemble);

  revalidatePath(`/construction/${quoteId}`);
  return {
    ok: true,
    lines: [...draft.lines, ...extra],
    measurements: draft.measurements,
    flags: draft.flags,
    suggestedHeightBracket: draft.suggestedHeightBracket,
    buildingHeightM: draft.buildingHeightM,
    accessPoints: draft.accessPoints,
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
  /** Weeks of hire this line asks for, when the scope stated one. */
  hireWeeks?: number | null;
}

const cleanQty = (n: number | null): number => (n != null && Number.isFinite(n) && n >= 0 ? n : 0);
const cleanLifts = (n: number | null): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
};

export async function applyDrawingDraft(
  quoteId: string,
  input: {
    lines: ApplyDrawingLine[];
    measurements: DrawingDraftMeasurement[];
    setHeightBracket?: HeightBracket | null;
    accessPoints?: { doorways: number; fireExits: number };
  },
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
      const resolved = resolveConstructionRateRow(
        el.rates.map(
          (r): RateRow => ({
            band: r.band as RateBand,
            bracket: r.bracket as HeightBracket,
            rate: r.rate,
            baseHireWeeks: r.baseHireWeeks,
            extraHirePerWeek: r.extraHirePerWeek,
            extraHireChargePct: r.extraHireChargePct,
          }),
        ),
        band,
        bracket,
      );
      const rate = resolved?.rate ?? 0;
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
        durationWeeks: l.hireWeeks ?? null,
        rate,
        baseHireWeeks: resolved?.baseHireWeeks ?? null,
        extraHirePerWeek: resolved?.extraHirePerWeek ?? null,
        extraHireChargePct: resolved?.extraHireChargePct ?? null,
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
        durationWeeks: l.hireWeeks ?? null,
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
  // On the quote itself: adopt the drawing's height bracket if it had none (so bracketed
  // rates resolve), and store the door/exit counts (so the builder can offer a foam chip) —
  // only when not already set, so a manual edit is never clobbered.
  const quoteData: Prisma.ConstructionQuoteUpdateInput = {};
  if (input.setHeightBracket && !quote.defaultHeightBracket)
    quoteData.defaultHeightBracket = input.setHeightBracket;
  if (input.accessPoints && quote.doorwayCount == null && quote.fireExitCount == null) {
    if (input.accessPoints.doorways > 0) quoteData.doorwayCount = input.accessPoints.doorways;
    if (input.accessPoints.fireExits > 0) quoteData.fireExitCount = input.accessPoints.fireExits;
  }
  if (Object.keys(quoteData).length)
    ops.push(prisma.constructionQuote.update({ where: { id: quoteId }, data: quoteData }));
  await prisma.$transaction(ops);

  revalidatePath(`/construction/${quoteId}`);
  return { ok: true, added: lineData.length };
}
