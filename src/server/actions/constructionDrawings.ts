"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ClientRef, DrawingDraftMeasurement } from "@/lib/construction/assemble";
import { aliasToLearn } from "@/lib/construction/scopeDraft";
import { lineAmount, resolveConstructionRateRow, type RateRow } from "@/lib/construction/price";
import { loadConstructionLibrary } from "@/server/construction";
import { startConstructionRead } from "@/server/actions/constructionPack";
import type { ConstructionUnit, HeightBracket, RateBand } from "@/lib/construction/types";

/**
 * Construction enquiry reading (docs/20, docs/22): the file switch, the (now
 * background) read, and applying the draft the estimator confirmed. The reading
 * itself runs in the worker — `src/server/constructionRead.ts`.
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

// --- 2. Read the enquiry (queues a background run) --------------------------

/**
 * Read the enquiry — now a BACKGROUND run (docs/22 Step 7): this only queues it
 * and returns; the worker reads every switched-on sheet and scope file, saves the
 * measurements and the draft, and the page follows along. Kept under this name
 * for existing callers; new code calls `startConstructionRead` directly.
 */
export async function readConstructionEnquiry(quoteId: string): Promise<{ ok: boolean; runId?: string; error?: string }> {
  return startConstructionRead(quoteId);
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
  // The traceable working (docs/23 §11) — carried onto the saved line.
  section?: string | null;
  buildingId?: string | null;
  formula?: string | null;
  provenance?: string[];
  paramsUsed?: string[];
  flags?: string[];
  confidence?: string | null;
  clientRef?: ClientRef | null;
  /** The item the reader proposed: a different final choice is a correction → learn the client's wording. */
  suggestedElementId?: string | null;
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
    /** Replace the lines a previous draft added (drafted = carries a formula or a client row). */
    replaceDrafted?: boolean;
  },
): Promise<{ ok: boolean; added?: number; learned?: number; error?: string }> {
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to add lines." };
  if (input.lines.length === 0 && input.measurements.length === 0)
    return { ok: false, error: "Nothing selected." };

  const library = await loadConstructionLibrary();
  const byId = new Map(library.map((e) => [e.id, e]));
  const buildingIds = new Set((await prisma.constructionBuilding.findMany({ where: { quoteId }, select: { id: true } })).map((b) => b.id));
  const band = quote.band as RateBand;
  const aliasAdds = new Map<string, string[]>();
  const trace = (l: ApplyDrawingLine) => ({
    section: l.section?.trim() || null,
    buildingId: l.buildingId && buildingIds.has(l.buildingId) ? l.buildingId : null,
    formula: l.formula ?? null,
    confidence: l.confidence ?? null,
    provenance: (l.provenance?.length ? l.provenance : undefined) as Prisma.InputJsonValue | undefined,
    paramsUsed: (l.paramsUsed?.length ? l.paramsUsed : undefined) as Prisma.InputJsonValue | undefined,
    flags: (l.flags?.length ? l.flags : undefined) as Prisma.InputJsonValue | undefined,
    clientRef: (l.clientRef ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
  });
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
        ...trace(l),
      });
      // Learn the client's wording as an alias — ONLY on a genuine correction (docs/19 §15).
      const clientText = l.clientRef?.text?.trim();
      if (clientText && l.suggestedElementId !== undefined && l.suggestedElementId !== el.id) {
        const alias = aliasToLearn(clientText, { name: el.name, aliases: el.aliases });
        if (alias) {
          const list = aliasAdds.get(el.id) ?? [];
          if (!list.some((x) => x.toLowerCase() === alias.toLowerCase())) list.push(alias);
          aliasAdds.set(el.id, list);
        }
      }
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
        ...trace(l),
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
  if (input.replaceDrafted)
    ops.push(
      prisma.constructionQuoteLine.deleteMany({
        where: { quoteId, isAuto: true, OR: [{ formula: { not: null } }, { clientRef: { not: Prisma.AnyNull } }] },
      }),
    );
  if (lineData.length) ops.push(prisma.constructionQuoteLine.createMany({ data: lineData }));
  for (const [elementId, aliases] of aliasAdds)
    ops.push(prisma.constructionElement.update({ where: { id: elementId }, data: { aliases: { push: aliases } } }));
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
  return { ok: true, added: lineData.length, learned: [...aliasAdds.values()].reduce((a, x) => a + x.length, 0) };
}
