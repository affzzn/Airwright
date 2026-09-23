import { prisma } from "@/lib/db";
import { priceConstructionQuote, type LinePriceInput } from "@/lib/construction/price";
import {
  validateConstructionQuote,
  type ValidationFlag,
} from "@/lib/construction/rules";
import { PER_LIFT_UNITS, type ConstructionUnit } from "@/lib/construction/types";

/**
 * Server-side loaders for the construction estimator (docs/19). Load a quote with
 * its measurements, lines and attachments, price it (Σ lines + extra-hire terms),
 * and run the validation/assumptions pass. Shared by the builder page, the output
 * page and the Excel export so they can never disagree.
 */

export interface ConstructionLineVM {
  id: string;
  elementId: string | null;
  description: string;
  lifts: number | null;
  unit: string;
  quantity: number;
  heightBracket: string | null;
  rate: number;
  amount: number;
  isAuto: boolean;
  note: string | null;
  sortOrder: number;
}
export interface ConstructionMeasurementVM {
  id: string;
  label: string;
  kind: string;
  valueNumber: number;
  lifts: number | null;
  heightBracket: string | null;
  source: string | null;
  note: string | null;
  sortOrder: number;
}
export interface ConstructionAttachmentVM {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  kind: string | null;
  useForDrafting: boolean;
  readStatus: string | null;
}
export interface ConstructionQuoteVM {
  id: string;
  reference: string | null;
  customerName: string | null;
  siteAddress: string | null;
  enquiryType: string | null;
  band: string;
  durationWeeks: number | null;
  extraHirePctPerWeek: number | null;
  siteType: string | null;
  buildingHeightM: number | null;
  defaultHeightBracket: string | null;
  doorwayCount: number | null;
  fireExitCount: number | null;
  pedestrianAccessCount: number | null;
  status: string;
  notes: string | null;
  assumptions: string[] | null;
  createdAt: string;
  measurements: ConstructionMeasurementVM[];
  lines: ConstructionLineVM[];
  attachments: ConstructionAttachmentVM[];
}

export interface ConstructionPricing {
  total: number;
  extraHirePerWeek: number | null;
  flags: ValidationFlag[];
}

/** Recompute the pricing + validation flags from a loaded quote's stored lines. */
export function priceLoadedQuote(q: ConstructionQuoteVM): ConstructionPricing {
  const priceLines: LinePriceInput[] = q.lines.map((l) => ({
    unit: l.unit as ConstructionUnit,
    quantity: l.quantity,
    lifts: l.lifts,
    rate: l.rate,
  }));
  const priced = priceConstructionQuote({
    lines: priceLines,
    extraHirePctPerWeek: q.extraHirePctPerWeek,
  });
  const perLiftMissingLifts = q.lines.filter(
    (l) => PER_LIFT_UNITS.has(l.unit as ConstructionUnit) && (l.lifts == null || l.lifts <= 0),
  ).length;
  const unpriced = q.lines.filter((l) => l.rate <= 0 && l.quantity > 0).length;
  const flags = validateConstructionQuote({
    durationWeeks: q.durationWeeks,
    buildingHeightM: q.buildingHeightM,
    defaultHeightBracket: q.defaultHeightBracket as never,
    siteType: q.siteType as never,
    lineCount: q.lines.length,
    measurementCount: q.measurements.length,
    unpricedLineCount: unpriced,
    perLiftLinesMissingLifts: perLiftMissingLifts,
    hasInferredValues: q.measurements.some(
      (m) => m.source === "GOOGLE_EARTH" || m.source === "DRAWING",
    ),
  });
  return { total: priced.total, extraHirePerWeek: priced.extraHirePerWeek, flags };
}

function toQuoteVM(q: {
  id: string;
  reference: string | null;
  customerName: string | null;
  siteAddress: string | null;
  enquiryType: string | null;
  band: string;
  durationWeeks: number | null;
  extraHirePctPerWeek: unknown;
  siteType: string | null;
  buildingHeightM: unknown;
  defaultHeightBracket: string | null;
  doorwayCount: number | null;
  fireExitCount: number | null;
  pedestrianAccessCount: number | null;
  status: string;
  notes: string | null;
  assumptions: unknown;
  createdAt: Date;
  measurements: {
    id: string; label: string; kind: string; valueNumber: unknown; lifts: number | null;
    heightBracket: string | null; source: string | null; note: string | null; sortOrder: number;
  }[];
  lines: {
    id: string; elementId: string | null; description: string; lifts: number | null; unit: string;
    quantity: unknown; heightBracket: string | null; rate: unknown; amount: unknown;
    isAuto: boolean; note: string | null; sortOrder: number;
  }[];
  attachments: {
    id: string; fileName: string; mimeType: string; sizeBytes: number | null; kind: string | null;
    useForDrafting: boolean; readStatus: string | null;
  }[];
}): ConstructionQuoteVM {
  return {
    id: q.id,
    reference: q.reference,
    customerName: q.customerName,
    siteAddress: q.siteAddress,
    enquiryType: q.enquiryType,
    band: q.band,
    durationWeeks: q.durationWeeks,
    extraHirePctPerWeek: q.extraHirePctPerWeek != null ? Number(q.extraHirePctPerWeek) : null,
    siteType: q.siteType,
    buildingHeightM: q.buildingHeightM != null ? Number(q.buildingHeightM) : null,
    defaultHeightBracket: q.defaultHeightBracket,
    doorwayCount: q.doorwayCount,
    fireExitCount: q.fireExitCount,
    pedestrianAccessCount: q.pedestrianAccessCount,
    status: q.status,
    notes: q.notes,
    assumptions: Array.isArray(q.assumptions) ? (q.assumptions as string[]) : null,
    createdAt: q.createdAt.toISOString(),
    measurements: q.measurements.map((m) => ({
      id: m.id,
      label: m.label,
      kind: m.kind,
      valueNumber: Number(m.valueNumber),
      lifts: m.lifts,
      heightBracket: m.heightBracket,
      source: m.source,
      note: m.note,
      sortOrder: m.sortOrder,
    })),
    lines: q.lines.map((l) => ({
      id: l.id,
      elementId: l.elementId,
      description: l.description,
      lifts: l.lifts,
      unit: l.unit,
      quantity: Number(l.quantity),
      heightBracket: l.heightBracket,
      rate: Number(l.rate),
      amount: Number(l.amount),
      isAuto: l.isAuto,
      note: l.note,
      sortOrder: l.sortOrder,
    })),
    attachments: q.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
      useForDrafting: a.useForDrafting,
      readStatus: a.readStatus,
    })),
  };
}

/** Load one construction quote (full), or null if it doesn't exist. */
export async function loadConstructionQuote(id: string): Promise<ConstructionQuoteVM | null> {
  const q = await prisma.constructionQuote.findUnique({
    where: { id },
    relationLoadStrategy: "join",
    include: {
      measurements: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      attachments: { orderBy: { createdAt: "asc" } },
    },
  });
  return q ? toQuoteVM(q) : null;
}

export interface ConstructionElementLibVM {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  unit: string;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote: string | null;
  rates: { band: string; bracket: string; rate: number }[];
}

/** The active picking-list library the quote builder chooses from. */
export async function loadConstructionLibrary(): Promise<ConstructionElementLibVM[]> {
  const els = await prisma.constructionElement.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    relationLoadStrategy: "join",
    include: { rates: true },
  });
  return els.map((e) => ({
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    category: e.category,
    unit: e.unit,
    usesLifts: e.usesLifts,
    usesHeightBracket: e.usesHeightBracket,
    defaultRuleNote: e.defaultRuleNote,
    rates: e.rates.map((r) => ({ band: r.band, bracket: r.bracket, rate: Number(r.rate) })),
  }));
}

export interface ConstructionQuoteListItem {
  id: string;
  reference: string | null;
  customerName: string | null;
  siteAddress: string | null;
  status: string;
  band: string;
  total: number;
  lineCount: number;
  createdAt: string;
}

/** The workspace list (newest first). */
export async function loadConstructionQuotes(): Promise<ConstructionQuoteListItem[]> {
  const quotes = await prisma.constructionQuote.findMany({
    orderBy: { createdAt: "desc" },
    relationLoadStrategy: "join",
    include: { lines: { select: { amount: true } } },
  });
  return quotes.map((q) => ({
    id: q.id,
    reference: q.reference,
    customerName: q.customerName,
    siteAddress: q.siteAddress,
    status: q.status,
    band: q.band,
    total: q.lines.reduce((a, l) => a + Number(l.amount), 0),
    lineCount: q.lines.length,
    createdAt: q.createdAt.toISOString(),
  }));
}
