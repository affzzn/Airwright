import type { BusinessLine } from "@prisma/client";
import { prisma } from "@/lib/db";
import { priceConstructionQuote, type LinePriceInput } from "@/lib/construction/price";
import {
  validateConstructionQuote,
  type ValidationFlag,
} from "@/lib/construction/rules";
import { PER_LIFT_UNITS, type ConstructionUnit } from "@/lib/construction/types";
import { factsFromQuote, nextAction, type JobStep } from "@/lib/construction/jobState";

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
  /** Hire terms snapshotted from the rate (docs/19 §7). */
  baseHireWeeks: number | null;
  extraHirePerWeek: number | null;
  extraHireChargePct: number | null;
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
  siteType: string | null;
  buildingHeightM: number | null;
  defaultHeightBracket: string | null;
  doorwayCount: number | null;
  fireExitCount: number | null;
  pedestrianAccessCount: number | null;
  status: string;
  notes: string | null;
  assumptions: string[] | null;
  /** True when a scope of works has been pasted or extracted for this quote. */
  hasEnquiryText: boolean;
  createdAt: string;
  measurements: ConstructionMeasurementVM[];
  lines: ConstructionLineVM[];
  attachments: ConstructionAttachmentVM[];
}

export interface ConstructionPricing {
  total: number;
  /** £ a week once the hire runs past what the rates include (terms). */
  extraHirePerWeek: number | null;
  /** What the quoted duration implies in extra hire. Not in `total`. */
  extraHireBeyondBase: number;
  maxWeeksBeyondBase: number;
  flags: ValidationFlag[];
}

/** Recompute the pricing + validation flags from a loaded quote's stored lines. */
export function priceLoadedQuote(q: ConstructionQuoteVM): ConstructionPricing {
  const priceLines: LinePriceInput[] = q.lines.map((l) => ({
    unit: l.unit as ConstructionUnit,
    quantity: l.quantity,
    lifts: l.lifts,
    rate: l.rate,
    baseHireWeeks: l.baseHireWeeks,
    extraHirePerWeek: l.extraHirePerWeek,
    extraHireChargePct: l.extraHireChargePct,
  }));
  const priced = priceConstructionQuote({
    lines: priceLines,
    durationWeeks: q.durationWeeks,
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
  return {
    total: priced.total,
    extraHirePerWeek: priced.extraHirePerWeek,
    extraHireBeyondBase: priced.extraHireBeyondBase,
    maxWeeksBeyondBase: priced.maxWeeksBeyondBase,
    flags,
  };
}

function toQuoteVM(q: {
  id: string;
  reference: string | null;
  customerName: string | null;
  siteAddress: string | null;
  enquiryType: string | null;
  band: string;
  durationWeeks: number | null;
  siteType: string | null;
  buildingHeightM: unknown;
  defaultHeightBracket: string | null;
  doorwayCount: number | null;
  fireExitCount: number | null;
  pedestrianAccessCount: number | null;
  status: string;
  notes: string | null;
  assumptions: unknown;
  enquiryText: string | null;
  createdAt: Date;
  measurements: {
    id: string; label: string; kind: string; valueNumber: unknown; lifts: number | null;
    heightBracket: string | null; source: string | null; note: string | null; sortOrder: number;
  }[];
  lines: {
    id: string; elementId: string | null; description: string; lifts: number | null; unit: string;
    quantity: unknown; heightBracket: string | null; rate: unknown; amount: unknown;
    isAuto: boolean; note: string | null; sortOrder: number;
    baseHireWeeks: number | null; extraHirePerWeek: unknown; extraHireChargePct: unknown;
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
    siteType: q.siteType,
    buildingHeightM: q.buildingHeightM != null ? Number(q.buildingHeightM) : null,
    defaultHeightBracket: q.defaultHeightBracket,
    doorwayCount: q.doorwayCount,
    fireExitCount: q.fireExitCount,
    pedestrianAccessCount: q.pedestrianAccessCount,
    status: q.status,
    notes: q.notes,
    assumptions: Array.isArray(q.assumptions) ? (q.assumptions as string[]) : null,
    hasEnquiryText: Boolean(q.enquiryText && q.enquiryText.trim()),
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
      baseHireWeeks: l.baseHireWeeks,
      extraHirePerWeek: l.extraHirePerWeek != null ? Number(l.extraHirePerWeek) : null,
      extraHireChargePct: l.extraHireChargePct != null ? Number(l.extraHireChargePct) : null,
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
  line: string;
  name: string;
  aliases: string[];
  category: string | null;
  unit: string;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote: string | null;
  sourceTitle: string | null;
  rates: {
    band: string;
    bracket: string;
    rate: number;
    baseHireWeeks: number;
    extraHirePerWeek: number;
    extraHireChargePct: number;
  }[];
}

/**
 * The active picking list. Airwright keep one master list for the whole business,
 * so a construction quote picks from the CONSTRUCTION items plus the GENERAL ones
 * (daywork, netting, design) that apply to any job.
 */
export async function loadConstructionLibrary(
  lines: BusinessLine[] = ["CONSTRUCTION", "GENERAL"],
): Promise<ConstructionElementLibVM[]> {
  const els = await prisma.constructionElement.findMany({
    where: { isActive: true, line: { in: lines } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    relationLoadStrategy: "join",
    include: { rates: true },
  });
  return els.map((e) => ({
    id: e.id,
    line: e.line,
    name: e.name,
    aliases: e.aliases,
    category: e.category,
    unit: e.unit,
    usesLifts: e.usesLifts,
    usesHeightBracket: e.usesHeightBracket,
    defaultRuleNote: e.defaultRuleNote,
    sourceTitle: e.sourceTitle,
    rates: e.rates.map((r) => ({
      band: r.band,
      bracket: r.bracket,
      rate: Number(r.rate),
      baseHireWeeks: r.baseHireWeeks,
      extraHirePerWeek: Number(r.extraHirePerWeek),
      extraHireChargePct: Number(r.extraHireChargePct),
    })),
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
  updatedAt: string;
  /** The single action the list offers for this job, and where it goes. */
  next: { step: JobStep; label: string };
}

/**
 * The workspace list (newest first). Each row carries its own "next step", so
 * the list tells the estimator what the job is waiting on without opening it.
 */
export async function loadConstructionQuotes(): Promise<ConstructionQuoteListItem[]> {
  const quotes = await prisma.constructionQuote.findMany({
    orderBy: { updatedAt: "desc" },
    relationLoadStrategy: "join",
    include: {
      lines: {
        select: { amount: true, rate: true, quantity: true, lifts: true, unit: true, description: true },
      },
      measurements: { select: { id: true } },
      attachments: { select: { fileName: true, mimeType: true, readStatus: true } },
    },
  });
  return quotes.map((q) => {
    const lines = q.lines.map((l) => ({
      unit: l.unit as string,
      quantity: Number(l.quantity),
      lifts: l.lifts,
      rate: Number(l.rate),
      amount: Number(l.amount),
      description: l.description,
    }));
    const facts = factsFromQuote({
      status: q.status,
      siteType: q.siteType,
      buildingHeightM: q.buildingHeightM != null ? Number(q.buildingHeightM) : null,
      defaultHeightBracket: q.defaultHeightBracket,
      durationWeeks: q.durationWeeks,
      doorwayCount: q.doorwayCount,
      fireExitCount: q.fireExitCount,
      pedestrianAccessCount: q.pedestrianAccessCount,
      hasEnquiryText: Boolean(q.enquiryText && q.enquiryText.trim()),
      lines,
      measurements: q.measurements,
      attachments: q.attachments,
    });
    return {
      id: q.id,
      reference: q.reference,
      customerName: q.customerName,
      siteAddress: q.siteAddress,
      status: q.status,
      band: q.band,
      total: facts.total,
      lineCount: lines.length,
      createdAt: q.createdAt.toISOString(),
      updatedAt: q.updatedAt.toISOString(),
      next: nextAction(facts),
    };
  });
}
