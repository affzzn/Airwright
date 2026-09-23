"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { extractScopeText } from "@/lib/construction/scopeText";
import { draftFromScope } from "@/lib/construction/draftFromScope";
import { aliasToLearn, type ReconciledDraftLine } from "@/lib/construction/scopeDraft";
import { lineAmount, resolveConstructionRateRow, type RateRow } from "@/lib/construction/price";
import { loadConstructionLibrary } from "@/server/construction";
import type { ConstructionUnit, HeightBracket, RateBand } from "@/lib/construction/types";

/**
 * Server actions for construction "Draft from enquiry" (docs/19) — the ONE place
 * AI reads in construction, and it reads TEXT (the client's written scope), never
 * drawings. Three steps, all human-gated: extract the scope text, draft lines
 * against the picking list (AI proposes), then apply the estimator's confirmed
 * lines into the quote (isAuto) and learn a client's wording as an alias on a
 * genuine correction. Nothing is priced or finalised without the estimator.
 */

/** Max upload we'll accept for text extraction (base64-decoded bytes). */
const MAX_SCOPE_BYTES = 20 * 1024 * 1024;

// --- 1. Extract the scope text from an uploaded file (paste needs no server) ---

export async function extractConstructionScopeText(file: {
  name: string;
  mimeType: string;
  dataBase64: string;
}): Promise<{ text?: string; error?: string }> {
  try {
    const bytes = Buffer.from(file.dataBase64, "base64");
    if (bytes.length === 0) return { error: "The file was empty." };
    if (bytes.length > MAX_SCOPE_BYTES) return { error: "File is too large (max 20 MB)." };
    const text = await extractScopeText({ name: file.name, mimeType: file.mimeType, bytes });
    if (!text.trim())
      return {
        error:
          "No text found — the file may be a scanned image or a drawing. Paste the scope text instead.",
      };
    return { text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn’t read that file." };
  }
}

// --- 2. Draft quote lines from the scope text (AI proposes) ------------------

export interface DraftLineVM {
  clientText: string;
  elementId: string | null;
  quantity: number | null;
  lifts: number | null;
  note: string | null;
  confidence: "high" | "medium" | "low";
  reason: string | null;
  invented: boolean;
}

export async function draftConstructionLinesFromScope(
  quoteId: string,
  scopeText: string,
): Promise<{ ok: boolean; lines?: DraftLineVM[]; notes?: string; error?: string }> {
  if (!env.constructionAI) return { ok: false, error: "AI drafting is turned off." };
  const text = scopeText.trim();
  if (!text) return { ok: false, error: "Paste or upload a scope of works first." };

  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };

  const library = await loadConstructionLibrary();
  if (library.length === 0)
    return { ok: false, error: "The picking list is empty — add elements on the Rates → Construction tab first." };

  // Persist the scope text up-front (useful reference even if the model errors).
  await prisma.constructionQuote.update({ where: { id: quoteId }, data: { enquiryText: text } });

  try {
    const result = await draftFromScope(
      text,
      library.map((e) => ({
        id: e.id,
        name: e.name,
        aliases: e.aliases,
        unit: e.unit,
        usesLifts: e.usesLifts,
        category: e.category,
      })),
    );
    await prisma.constructionQuote.update({
      where: { id: quoteId },
      data: { draftRawOutput: result.meta.raw as Prisma.InputJsonValue },
    });
    return {
      ok: true,
      notes: result.notes,
      lines: result.lines.map((l: ReconciledDraftLine) => ({
        clientText: l.clientText,
        elementId: l.elementId,
        quantity: l.quantity,
        lifts: l.lifts,
        note: l.note,
        confidence: l.confidence,
        reason: l.reason,
        invented: l.invented,
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The draft failed.";
    return { ok: false, error: `Couldn’t draft from the scope: ${message}` };
  }
}

// --- 3. Apply the estimator's confirmed draft lines into the quote -----------

export interface ApplyDraftLine {
  clientText: string;
  /** The final mapping the estimator confirmed (may differ from the AI's guess). */
  elementId: string | null;
  /** What the AI originally proposed — a difference marks a correction (→ learn alias). */
  suggestedElementId: string | null;
  quantity: number | null;
  lifts: number | null;
  note: string | null;
}

const buildLineNote = (clientText: string, aiNote: string | null): string | null => {
  const parts: string[] = [];
  const ct = clientText.trim();
  if (ct) parts.push(`“${ct}”`);
  if (aiNote?.trim()) parts.push(aiNote.trim());
  return parts.length ? parts.join(" · ") : null;
};

const cleanQty = (n: number | null | undefined): number =>
  n != null && Number.isFinite(n) && n >= 0 ? n : 0;
const cleanLifts = (n: number | null | undefined): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const t = Math.trunc(n);
  return t > 0 ? t : null;
};

export async function applyConstructionDraftLines(
  quoteId: string,
  accepted: ApplyDraftLine[],
): Promise<{ ok: boolean; added?: number; error?: string }> {
  if (accepted.length === 0) return { ok: false, error: "No lines selected." };

  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId } });
  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to add lines." };

  const library = await loadConstructionLibrary();
  const byId = new Map(library.map((e) => [e.id, e]));
  const band = quote.band as RateBand;
  const defaultBracket = (quote.defaultHeightBracket as HeightBracket | null) ?? null;

  const max = await prisma.constructionQuoteLine.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });
  let sortOrder = (max._max.sortOrder ?? 0) + 10;

  const lineData: Prisma.ConstructionQuoteLineCreateManyInput[] = [];
  // Aliases to learn, deduped per element (corrections only).
  const aliasAdds = new Map<string, string[]>();

  for (const a of accepted) {
    const el = a.elementId ? byId.get(a.elementId) : undefined;

    if (el) {
      // A matched library line — resolve the rate from the quote's band + bracket.
      const bracket = el.usesHeightBracket ? defaultBracket : null;
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
      const lifts = el.usesLifts ? cleanLifts(a.lifts) : null;
      const quantity = cleanQty(a.quantity);
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
        baseHireWeeks: resolved?.baseHireWeeks ?? null,
        extraHirePerWeek: resolved?.extraHirePerWeek ?? null,
        extraHireChargePct: resolved?.extraHireChargePct ?? null,
        amount: lineAmount({ unit, quantity, lifts, rate }),
        isAuto: true,
        note: buildLineNote(a.clientText, a.note),
        sortOrder,
      });
      sortOrder += 10;

      // Learn the client's wording as an alias — ONLY on a genuine correction.
      if (a.elementId !== a.suggestedElementId) {
        const alias = aliasToLearn(a.clientText, { name: el.name, aliases: el.aliases });
        if (alias) {
          const list = aliasAdds.get(el.id) ?? [];
          if (!list.some((x) => x.toLowerCase() === alias.toLowerCase())) {
            list.push(alias);
            aliasAdds.set(el.id, list);
          }
        }
      }
    } else {
      // Unmatched but kept — a one-off custom line the estimator will finish
      // (unit / rate). We never invent a library item; this is a hand line.
      const quantity = cleanQty(a.quantity);
      lineData.push({
        quoteId,
        elementId: null,
        description: a.clientText.trim() || "Untitled item",
        lifts: null,
        unit: "NR" as ConstructionUnit,
        quantity,
        rate: 0,
        amount: 0,
        isAuto: true,
        note: buildLineNote("", a.note),
        sortOrder,
      });
      sortOrder += 10;
    }
  }

  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.constructionQuoteLine.createMany({ data: lineData }),
  ];
  for (const [elementId, aliases] of aliasAdds) {
    ops.push(
      prisma.constructionElement.update({
        where: { id: elementId },
        data: { aliases: { push: aliases } },
      }),
    );
  }
  await prisma.$transaction(ops);

  revalidatePath(`/construction/${quoteId}`);
  return { ok: true, added: lineData.length };
}
