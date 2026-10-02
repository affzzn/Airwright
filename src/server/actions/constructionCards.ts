"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ADDONS,
  coreLines,
  derivedLifts,
  derivedQty,
  longestHire,
  readBuildingCard,
  type BuildingCard,
  type MeasureRow,
} from "@/lib/construction/cards";
import { elementRole } from "@/lib/construction/bindScope";
import { resolveJobParams } from "@/lib/construction/params";
import { lineAmount, resolveConstructionRateRow, type RateRow } from "@/lib/construction/price";
import { loadConstructionLibrary, type ConstructionElementLibVM } from "@/server/construction";
import type { ConstructionUnit, HeightBracket, RateBand } from "@/lib/construction/types";
import type { Hint } from "@/lib/construction/model/buildingModel";

/**
 * The section cards (2026-10-02): the estimator's values, the add-on ticks, and
 * keeping the card-owned quote lines (`cardKey`) in step. A value the estimator
 * types or measures is saved as their own measurement (runId null), which always
 * beats the automatic one; clearing it goes back to the drawings' value.
 */

const SOURCES = new Set(["MANUAL", "DRAWN", "ROOMS"]);

const toRow = (m: {
  id: string;
  key: string | null;
  label: string;
  valueNumber: unknown;
  unit: string | null;
  lifts: number | null;
  confidence: string | null;
  source: string | null;
  provenance: unknown;
  note: string | null;
  buildingId: string | null;
  runId: string | null;
}): MeasureRow => ({
  id: m.id,
  key: m.key,
  label: m.label,
  valueNumber: Number(m.valueNumber),
  unit: m.unit,
  lifts: m.lifts,
  confidence: m.confidence,
  source: m.source,
  provenance: Array.isArray(m.provenance) ? (m.provenance as string[]) : [],
  note: m.note,
  buildingId: m.buildingId,
  runId: m.runId,
});

const LABEL: Record<string, string> = {
  "ext-perimeter": "External wall perimeter",
  "ext-corners": "External corners",
  "ext-height": "External scaffold height",
  "ext-lifts": "External lifts",
  gables: "Main gables",
  "int-run": "Internal scaffold run",
  "int-clear": "Internal clear height",
  "int-lifts": "Internal lifts",
  "bc-area": "Birdcage area",
  "bc-clear": "Birdcage clear height",
  "bc-lifts": "Birdcage lifts",
  "hire:External": "Hire — external",
  "hire:Internal": "Hire — internal",
  "hire:Internal Birdcage": "Hire — birdcage",
};
const UNIT: Record<string, string> = { "ext-perimeter": "m", "ext-height": "m", "int-run": "m", "int-clear": "m", "bc-area": "m²", "bc-clear": "m" };
const KIND: Record<string, string> = { "ext-perimeter": "PERIMETER_LM", "int-run": "PERIMETER_LM", "bc-area": "BIRDCAGE_M2", "ext-height": "HEIGHT_M", "int-clear": "HEIGHT_M", "bc-clear": "HEIGHT_M" };

/**
 * Set one card value for a building (or clear it with null → back to the drawings).
 * `source` MANUAL = typed, DRAWN = measured on the drawing, ROOMS = printed room areas ticked.
 */
export async function setCardValue(
  quoteId: string,
  buildingId: string | null,
  key: string,
  value: number | null,
  opts: { source?: string; provenance?: string[]; sheetRefs?: unknown; note?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!(key in LABEL)) return { ok: false, error: "Unknown value." };
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (!quote) return { ok: false, error: "Job not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to change it." };
  if (value != null && (!Number.isFinite(value) || value < 0)) return { ok: false, error: "Enter a number of zero or more." };
  const source = opts.source && SOURCES.has(opts.source) ? opts.source : "MANUAL";

  await prisma.constructionMeasurement.deleteMany({ where: { quoteId, buildingId, key, runId: null } });
  if (value != null) {
    const max = await prisma.constructionMeasurement.aggregate({ where: { quoteId }, _max: { sortOrder: true } });
    await prisma.constructionMeasurement.create({
      data: {
        quoteId,
        buildingId,
        key,
        label: LABEL[key],
        kind: KIND[key] ?? "COUNT",
        unit: UNIT[key] ?? (key.startsWith("hire:") ? "weeks" : "nr"),
        valueNumber: value,
        source,
        confidence: "high",
        provenance: (opts.provenance ?? []) as Prisma.InputJsonValue,
        sheetRefs: (opts.sheetRefs ?? undefined) as Prisma.InputJsonValue | undefined,
        note: opts.note ?? (source === "MANUAL" ? "Entered by you." : null),
        sortOrder: (max._max.sortOrder ?? 0) + 10,
      },
    });
  }
  await syncCards(quoteId);
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** The birdcage area = the printed areas of the rooms the estimator ticks. */
export async function setBirdcageRooms(quoteId: string, buildingId: string | null, roomIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const rooms = await prisma.constructionMeasurement.findMany({ where: { quoteId, id: { in: roomIds }, key: { startsWith: "room:" } } });
  if (rooms.length === 0) return setCardValue(quoteId, buildingId, "bc-area", null);
  const total = Math.round(rooms.reduce((a, r) => a + Number(r.valueNumber), 0) * 100) / 100;
  const sheetRefs = rooms.flatMap((r) => (Array.isArray(r.sheetRefs) ? (r.sheetRefs as unknown[]) : []));
  return setCardValue(quoteId, buildingId, "bc-area", total, {
    source: "ROOMS",
    provenance: [...rooms.map((r) => `${r.label}: ${Number(r.valueNumber)} m² (printed)`), ...rooms.map((r) => `room-id:${r.id}`)],
    sheetRefs: sheetRefs.length ? sheetRefs : undefined,
    note: `The printed areas of the ${rooms.length} room${rooms.length === 1 ? "" : "s"} you ticked: ${rooms.map((r) => Number(r.valueNumber)).join(" + ")} = ${total} m².`,
  });
}

/** Tick or untick an add-on: a line the card owns, with its quantity filled where it can be. */
export async function toggleAddon(quoteId: string, buildingId: string | null, addonKey: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const addon = ADDONS.find((a) => a.key === addonKey);
  if (!addon) return { ok: false, error: "Unknown add-on." };
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (!quote) return { ok: false, error: "Job not found." };
  if (quote.status !== "DRAFT") return { ok: false, error: "Reopen the quote to change it." };
  const scopeBuilding = addon.section === "Inspections" ? null : buildingId;
  if (!on) {
    await prisma.constructionQuoteLine.deleteMany({ where: { quoteId, buildingId: scopeBuilding, cardKey: addonKey } });
  } else {
    const exists = await prisma.constructionQuoteLine.count({ where: { quoteId, buildingId: scopeBuilding, cardKey: addonKey } });
    if (!exists) {
      const ctx = await loadCardContext(quoteId);
      const el = elementFor(ctx.library, addon.role);
      const card = ctx.cards.find((c) => c.buildingId === buildingId) ?? ctx.cards[0];
      const qty = card ? (derivedQty(addon, card, ctx.longest) ?? 0) : 0;
      const lifts = card ? derivedLifts(addon, card) : null;
      const max = await prisma.constructionQuoteLine.aggregate({ where: { quoteId }, _max: { sortOrder: true } });
      await prisma.constructionQuoteLine.create({
        data: {
          ...lineData(ctx, el, addon.label, qty, lifts, card?.external.bracket ?? null),
          quoteId,
          buildingId: scopeBuilding,
          section: addon.section,
          cardKey: addonKey,
          // Follows its card (lifts, a derived quantity, hire) until the estimator edits it.
          isAuto: true,
          durationWeeks: hireFor(card, addon.section, ctx.longest),
          formula: addon.help,
          sortOrder: (max._max.sortOrder ?? 0) + 10,
        },
      });
    }
  }
  await syncCards(quoteId);
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

// --- Keeping the card lines in step -------------------------------------------------------

interface CardContext {
  quote: { id: string; band: string; durationWeeks: number | null; mode: string | null; jobParams: unknown };
  library: ConstructionElementLibVM[];
  cards: BuildingCard[];
  longest: number | null;
  buildings: { id: string; name: string }[];
}

async function loadCardContext(quoteId: string): Promise<CardContext> {
  const q = await prisma.constructionQuote.findUniqueOrThrow({
    where: { id: quoteId },
    include: { measurements: true, buildings: { orderBy: { sortOrder: "asc" } }, readRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const params = resolveJobParams(q.jobParams);
  const rows = q.measurements.map(toRow);
  const hintsBy = new Map<string, Hint[]>();
  const res = q.readRuns[0]?.result as { buildings?: { id: string; hints?: Hint[] }[] } | null;
  for (const b of res?.buildings ?? []) hintsBy.set(b.id, b.hints ?? []);
  const ids: (string | null)[] = q.buildings.length ? q.buildings.map((b) => b.id) : [null];
  const cards = ids.map((id) => readBuildingCard(rows, id, params, hintsBy.get(id ?? "") ?? [], q.durationWeeks));
  return {
    quote: q,
    library: await loadConstructionLibrary(),
    cards,
    longest: longestHire(cards, q.durationWeeks),
    buildings: q.buildings,
  };
}

function elementFor(library: ConstructionElementLibVM[], role: string): ConstructionElementLibVM | null {
  return library.find((e) => elementRole(e.name) === role) ?? null;
}

function lineData(ctx: CardContext, el: ConstructionElementLibVM | null, label: string, quantity: number, lifts: number | null, bracket: HeightBracket | null) {
  if (!el) return { elementId: null, description: label, unit: "NR" as ConstructionUnit, quantity, lifts, rate: 0, amount: 0 };
  const b = el.usesHeightBracket ? bracket : null;
  const resolved = resolveConstructionRateRow(
    el.rates.map((r): RateRow => ({ band: r.band as RateBand, bracket: r.bracket as HeightBracket, rate: r.rate, baseHireWeeks: r.baseHireWeeks, extraHirePerWeek: r.extraHirePerWeek, extraHireChargePct: r.extraHireChargePct })),
    ctx.quote.band as RateBand,
    b,
  );
  const unit = el.unit as ConstructionUnit;
  const l = el.usesLifts ? lifts : null;
  const rate = resolved?.rate ?? 0;
  return {
    elementId: el.id,
    description: el.name,
    unit,
    quantity,
    lifts: l,
    heightBracket: b,
    rate,
    baseHireWeeks: resolved?.baseHireWeeks ?? null,
    extraHirePerWeek: resolved?.extraHirePerWeek ?? null,
    extraHireChargePct: resolved?.extraHireChargePct ?? null,
    amount: lineAmount({ unit, quantity, lifts: l, rate }),
  };
}

const hireFor = (card: BuildingCard | undefined, section: string, longest: number | null): number | null => {
  if (section === "Inspections") return null;
  if (!card) return null;
  const v = section === "Internal" ? card.internal.hire.value : section === "Internal Birdcage" ? card.birdcage.hire.value : card.external.hire.value;
  return v ?? longest;
};

/**
 * Bring every card-owned line in line with its card: the main line of each card
 * (the external run, the internal run, the birdcage area) is created, updated or
 * removed with its numbers; a ticked add-on follows its card (lifts, a quantity that
 * comes from the card, hire) until the estimator edits it by hand ("pinned").
 * Scenario 1 (a scope) has no cards: it never makes card lines, and removes any left
 * from before a scope was added — the client's own lines are the quote.
 */
export async function syncCards(quoteId: string): Promise<void> {
  const ctx = await loadCardContext(quoteId);
  const lines = await prisma.constructionQuoteLine.findMany({ where: { quoteId, cardKey: { not: null } } });
  const ops: Prisma.PrismaPromise<unknown>[] = [];
  let sort = ((await prisma.constructionQuoteLine.aggregate({ where: { quoteId }, _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 10;
  const scopeScenario = ctx.quote.mode === "A";

  for (const card of ctx.cards) {
    const desired = scopeScenario ? [] : coreLines(card);
    const mineCore = lines.filter((l) => l.buildingId === card.buildingId && (l.cardKey === "ext:run" || l.cardKey === "int:run" || l.cardKey === "bc:area"));
    for (const d of desired) {
      const el = elementFor(ctx.library, d.role);
      const data = lineData(ctx, el, d.section, d.quantity, d.lifts, card.external.bracket);
      const existing = mineCore.find((l) => l.cardKey === d.cardKey);
      const common = { ...data, durationWeeks: d.hireWeeks ?? ctx.longest, formula: d.formula, confidence: d.confidence, section: d.section };
      if (existing) {
        if (existing.isAuto) ops.push(prisma.constructionQuoteLine.update({ where: { id: existing.id }, data: common }));
      } else
        ops.push(
          prisma.constructionQuoteLine.create({
            data: { ...common, quoteId, buildingId: card.buildingId, cardKey: d.cardKey, isAuto: true, sortOrder: (sort += 10) },
          }),
        );
    }
    for (const l of mineCore) if (l.isAuto && !desired.some((d) => d.cardKey === l.cardKey)) ops.push(prisma.constructionQuoteLine.delete({ where: { id: l.id } }));

    // Add-ons on this building follow their card until pinned.
    for (const l of lines.filter((x) => x.buildingId === card.buildingId && x.cardKey && !["ext:run", "int:run", "bc:area"].includes(x.cardKey))) {
      const addon = ADDONS.find((a) => a.key === l.cardKey);
      if (!addon || addon.section === "Inspections") continue;
      const data: Prisma.ConstructionQuoteLineUpdateInput = { durationWeeks: hireFor(card, addon.section, ctx.longest) };
      if (l.isAuto) {
        const q = derivedQty(addon, card, ctx.longest);
        const lifts = derivedLifts(addon, card);
        const qty = addon.qty.kind === "count" || addon.qty.kind === "metres" ? Number(l.quantity) : (q ?? 0);
        const lf = l.lifts != null || lifts != null ? (lifts ?? l.lifts) : null;
        data.quantity = qty;
        data.lifts = lf;
        data.amount = lineAmount({ unit: l.unit as ConstructionUnit, quantity: qty, lifts: lf, rate: Number(l.rate) });
      }
      ops.push(prisma.constructionQuoteLine.update({ where: { id: l.id }, data }));
    }
  }
  // The job's weekly inspections follow the longest hire.
  for (const l of lines.filter((x) => x.cardKey === "job:inspections" && x.isAuto)) {
    const weeks = ctx.longest ?? 0;
    ops.push(
      prisma.constructionQuoteLine.update({
        where: { id: l.id },
        data: { quantity: weeks, amount: lineAmount({ unit: l.unit as ConstructionUnit, quantity: weeks, lifts: null, rate: Number(l.rate) }) },
      }),
    );
  }
  if (ops.length) await prisma.$transaction(ops);
}

/** Card lines follow the card again (undo a hand edit on one). */
export async function unpinCardLine(quoteId: string, lineId: string): Promise<{ ok: boolean }> {
  await prisma.constructionQuoteLine.updateMany({ where: { id: lineId, quoteId, cardKey: { not: null } }, data: { isAuto: true } });
  await syncCards(quoteId);
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** A blank line on the list measured on the drawing (the measuring tool). */
export async function setLineFromDrawing(
  quoteId: string,
  lineId: string,
  quantity: number,
  provenance: string[],
): Promise<{ ok: boolean; error?: string }> {
  const line = await prisma.constructionQuoteLine.findFirst({ where: { id: lineId, quoteId } });
  if (!line) return { ok: false, error: "Line not found." };
  if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: "Not a valid measurement." };
  await prisma.constructionQuoteLine.update({
    where: { id: lineId },
    data: {
      quantity,
      isAuto: false,
      confidence: "high",
      formula: `${quantity} — measured on the drawing`,
      provenance: provenance as Prisma.InputJsonValue,
      amount: lineAmount({ unit: line.unit as ConstructionUnit, quantity, lifts: line.lifts, rate: Number(line.rate) }),
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}
