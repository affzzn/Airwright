import type { BusinessLine } from "@prisma/client";
import { prisma } from "@/lib/db";
import { priceConstructionQuote, type LinePriceInput } from "@/lib/construction/price";
import {
  validateConstructionQuote,
  type ValidationFlag,
} from "@/lib/construction/rules";
import { PER_LIFT_UNITS, type ConstructionUnit } from "@/lib/construction/types";
import { factsFromQuote, nextAction, type JobStep } from "@/lib/construction/jobState";
import { resolveJobParams, paramString, type ResolvedParams } from "@/lib/construction/params";
import type { ClientRef, LineStatus } from "@/lib/construction/assemble";
import type { InfoItem, ScopeAccount } from "@/lib/construction/bindScope";
import type { ScopeColumn } from "@/lib/construction/scopeTable";

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
  /** Weeks of hire this line is quoted for (a scope states it per line). */
  durationWeeks: number | null;
  /** Scope mode (docs/23 §11): where it sits and the working behind it. */
  section: string | null;
  buildingId: string | null;
  formula: string | null;
  confidence: string | null;
  provenance: string[];
  paramsUsed: string[];
  flags: string[];
  clientRef: ClientRef | null;
  /** The section card that owns the line, if any ("ext:run", "ext:haki"…). */
  cardKey: string | null;
}
export interface SheetRef {
  sheetId: string;
  attachmentId: string;
  page: number;
  title: string;
  /** A value measured on the drawing keeps the line drawn (PDF points). */
  points?: [number, number][];
  closed?: boolean;
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
  /** Pack reading (docs/23): the building, unit, confidence, sources, placeholders, run. */
  buildingId: string | null;
  unit: string | null;
  confidence: string | null;
  provenance: string[];
  paramsUsed: string[];
  runId: string | null;
  key: string | null;
  sheetRefs: SheetRef[];
}
export interface ConstructionAttachmentVM {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  kind: string | null;
  useForDrafting: boolean;
  readStatus: string | null;
  relativePath: string | null;
  bucket: string | null;
  bucketReason: string | null;
}
export interface ConstructionBuildingVM {
  id: string;
  name: string;
  code: string | null;
}
export interface ConstructionSheetVM {
  id: string;
  attachmentId: string;
  page: number;
  buildingId: string | null;
  drawingNo: string | null;
  title: string | null;
  revision: string | null;
  kind: string;
  level: string | null;
  face: string | null;
  scale: string | null;
  paper: string | null;
  hasText: boolean;
  bucket: string;
  reason: string | null;
  included: boolean;
  superseded: boolean;
  readStatus: string;
  readError: string | null;
  readCostUsd: number | null;
}
export interface ConstructionRunVM {
  id: string;
  status: string;
  progress: { total: number; done: number; failed: number; reused: number; current: string | null } | null;
  costUsd: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  result: {
    buildings: { id: string; name: string; measurements: number; flags: string[]; hints?: import("@/lib/construction/model/buildingModel").Hint[] }[];
    draftLines: import("@/lib/construction/assemble").DrawingDraftLine[];
    draftFlags: string[];
    info?: InfoItem[];
    emptySections?: string[];
    account?: ScopeAccount | null;
    flags: string[];
    costUsd: number;
    sheetsRead: number;
    sheetsReused: number;
    sheetsFailed: number;
  } | null;
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
  /** Pack reading (docs/22–23). */
  mode: string | null;
  ingestStatus: string | null;
  ingestError: string | null;
  buildings: ConstructionBuildingVM[];
  sheets: ConstructionSheetVM[];
  latestRun: ConstructionRunVM | null;
  /** The ⚠ job settings, resolved (placeholders + this job's overrides). */
  params: ResolvedParams;
  /** Empty sections the estimator confirmed "none required". */
  scopeReview: ScopeReview;
  /** SECTIONS (Airwright's lump-sum quote) · SCHEDULE (itemised) · CLIENT (the client's workbook). */
  outputFormat: OutputFormat;
  /** The client's schedule layout, when the scope was a spreadsheet. */
  clientTemplate: ClientTemplate | null;
}

export type OutputFormat = "SECTIONS" | "SCHEDULE" | "CLIENT";
export interface ScopeReview {
  /** Section name → confirmed none required. */
  noneRequired: string[];
}
export interface ClientTemplate {
  tables: {
    attachmentId: string;
    fileName: string;
    sheet: string;
    sheetIndex: number;
    title: string | null;
    headerRows: number[];
    itemCol: number;
    columns: ScopeColumn[];
    sections: { name: string; row: number; itemCount: number }[];
  }[];
}

const asOutputFormat = (v: string | null | undefined, hasTemplate: boolean, packJob: boolean): OutputFormat =>
  v === "SECTIONS" || v === "SCHEDULE" || v === "CLIENT" ? (v === "CLIENT" && !hasTemplate ? "SECTIONS" : v) : packJob ? "SECTIONS" : "SCHEDULE";

export interface ConstructionPricing {
  total: number;
  /** £ a week once the hire runs past what the rates include (terms). */
  extraHirePerWeek: number | null;
  /** What the quoted duration implies in extra hire. Not in `total`. */
  extraHireBeyondBase: number;
  maxWeeksBeyondBase: number;
  /** True when `total` includes the hire beyond the rates' base weeks (P18). */
  hireIncluded: boolean;
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
    durationWeeks: l.durationWeeks,
  }));
  const priced = priceConstructionQuote({
    lines: priceLines,
    durationWeeks: q.durationWeeks,
    hireInPrice: paramString(q.params, "P18_hireInPrice") === "INCLUDED",
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
    hireIncluded: priced.hireIncluded,
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
  mode?: string | null;
  ingestStatus?: string | null;
  ingestError?: string | null;
  jobParams?: unknown;
  scopeReview?: unknown;
  outputFormat?: string | null;
  clientTemplate?: unknown;
  measurements: {
    id: string; label: string; kind: string; valueNumber: unknown; lifts: number | null;
    heightBracket: string | null; source: string | null; note: string | null; sortOrder: number;
    buildingId?: string | null; unit?: string | null; confidence?: string | null;
    provenance?: unknown; paramsUsed?: unknown; runId?: string | null;
    key?: string | null; sheetRefs?: unknown;
  }[];
  lines: {
    id: string; elementId: string | null; description: string; lifts: number | null; unit: string;
    quantity: unknown; heightBracket: string | null; rate: unknown; amount: unknown;
    isAuto: boolean; note: string | null; sortOrder: number;
    baseHireWeeks: number | null; extraHirePerWeek: unknown; extraHireChargePct: unknown;
    durationWeeks?: number | null; section?: string | null; buildingId?: string | null; formula?: string | null;
    confidence?: string | null; provenance?: unknown; paramsUsed?: unknown; flags?: unknown; clientRef?: unknown;
    cardKey?: string | null;
  }[];
  attachments: {
    id: string; fileName: string; mimeType: string; sizeBytes: number | null; kind: string | null;
    useForDrafting: boolean; readStatus: string | null;
    relativePath?: string | null; bucket?: string | null; bucketReason?: string | null;
  }[];
  buildings?: { id: string; name: string; code: string | null }[];
  sheets?: {
    id: string; attachmentId: string; page: number; buildingId: string | null; drawingNo: string | null;
    title: string | null; revision: string | null; kind: string; level: string | null; face: string | null;
    scale: string | null; paper: string | null; hasText: boolean; bucket: string; reason: string | null;
    included: boolean; superseded: boolean; readStatus: string; readError: string | null; readMeta: unknown;
  }[];
  readRuns?: {
    id: string; status: string; progress: unknown; costUsd: unknown; error: string | null;
    createdAt: Date; finishedAt: Date | null; result: unknown;
  }[];
}): ConstructionQuoteVM {
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const run = q.readRuns?.[0];
  const template = q.clientTemplate && typeof q.clientTemplate === "object" ? (q.clientTemplate as ClientTemplate) : null;
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
      buildingId: m.buildingId ?? null,
      unit: m.unit ?? null,
      confidence: m.confidence ?? null,
      provenance: strs(m.provenance),
      paramsUsed: strs(m.paramsUsed),
      runId: m.runId ?? null,
      key: m.key ?? null,
      sheetRefs: Array.isArray(m.sheetRefs) ? (m.sheetRefs as SheetRef[]) : [],
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
      durationWeeks: l.durationWeeks ?? null,
      section: l.section ?? null,
      buildingId: l.buildingId ?? null,
      formula: l.formula ?? null,
      confidence: l.confidence ?? null,
      provenance: strs(l.provenance),
      paramsUsed: strs(l.paramsUsed),
      flags: strs(l.flags),
      clientRef: l.clientRef && typeof l.clientRef === "object" ? (l.clientRef as ClientRef) : null,
      cardKey: l.cardKey ?? null,
    })),
    attachments: q.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
      useForDrafting: a.useForDrafting,
      readStatus: a.readStatus,
      relativePath: a.relativePath ?? null,
      bucket: a.bucket ?? null,
      bucketReason: a.bucketReason ?? null,
    })),
    mode: q.mode ?? null,
    ingestStatus: q.ingestStatus ?? null,
    ingestError: q.ingestError ?? null,
    buildings: (q.buildings ?? []).map((b) => ({ id: b.id, name: b.name, code: b.code })),
    sheets: (q.sheets ?? []).map((s) => ({
      id: s.id,
      attachmentId: s.attachmentId,
      page: s.page,
      buildingId: s.buildingId,
      drawingNo: s.drawingNo,
      title: s.title,
      revision: s.revision,
      kind: s.kind,
      level: s.level,
      face: s.face,
      scale: s.scale,
      paper: s.paper,
      hasText: s.hasText,
      bucket: s.bucket,
      reason: s.reason,
      included: s.included,
      superseded: s.superseded,
      readStatus: s.readStatus,
      readError: s.readError,
      readCostUsd:
        s.readMeta && typeof s.readMeta === "object" && typeof (s.readMeta as { costUsd?: unknown }).costUsd === "number"
          ? ((s.readMeta as { costUsd: number }).costUsd)
          : null,
    })),
    latestRun: run
      ? {
          id: run.id,
          status: run.status,
          progress: (run.progress as ConstructionRunVM["progress"]) ?? null,
          costUsd: Number(run.costUsd),
          error: run.error,
          createdAt: run.createdAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
          result: (run.result as ConstructionRunVM["result"]) ?? null,
        }
      : null,
    params: resolveJobParams(q.jobParams, { scopeJob: q.mode === "A" }),
    scopeReview: {
      noneRequired: strs((q.scopeReview as { noneRequired?: unknown } | null)?.noneRequired),
    },
    outputFormat: asOutputFormat(q.outputFormat, Boolean(template?.tables?.length), (q.sheets?.length ?? 0) > 0),
    clientTemplate: template?.tables?.length ? template : null,
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
      buildings: { orderBy: { sortOrder: "asc" } },
      // The register without the heavy geometry / raw reads (the page never needs them).
      sheets: {
        orderBy: [{ bucket: "asc" }, { drawingNo: "asc" }, { page: "asc" }],
        select: {
          id: true, attachmentId: true, page: true, buildingId: true, drawingNo: true, title: true,
          revision: true, kind: true, level: true, face: true, scale: true, paper: true, hasText: true,
          bucket: true, reason: true, included: true, superseded: true, readStatus: true, readError: true,
          readMeta: true,
        },
      },
      readRuns: { orderBy: { createdAt: "desc" }, take: 1 },
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
