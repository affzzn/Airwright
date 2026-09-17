"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
  ConstructionUnit,
  HeightBracket,
  RateBand,
  SiteType,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { lineAmount, resolveConstructionRate } from "@/lib/construction/price";
import { createSignedUploadUrl } from "@/lib/supabase/storage";

/**
 * Server actions for the construction estimator (docs/19). Everything is MANUAL —
 * no AI, no drawing parsing. A quote holds hand-entered measurements + priced
 * lines picked off the element library. Line `amount` is recomputed and stored on
 * every edit (unit × qty × lifts × rate), so the quote total is always Σ lines.
 */

const UNITS = new Set<ConstructionUnit>([
  "LM_PER_LIFT", "M2_PER_LIFT", "NR_PER_LIFT", "NR", "LM", "M2", "PER_WEEK", "FIXED",
]);
const BRACKETS = new Set<HeightBracket>(["UP_TO_6M", "H6_12M", "H12_18M", "H18_24M", "ANY"]);
const BANDS = new Set<RateBand>(["SUPER_COMPETITIVE", "COMPETITIVE", "MEDIUM", "HIGH", "CUSTOM"]);
const SITE_TYPES = new Set<SiteType>([
  "SCHOOL", "PUBLIC_STREET", "CONSTRUCTION_SITE", "COMMERCIAL", "OTHER",
]);
const MEASUREMENT_KINDS = new Set([
  "PERIMETER_LM", "BIRDCAGE_M2", "HANDRAIL_LM", "HEIGHT_M", "LIFTS", "AREA_LM",
]);
const MEASUREMENT_SOURCES = new Set(["GOOGLE_EARTH", "DRAWING", "CLIENT_SCOPE", "MANUAL"]);

const asBracket = (v: unknown): HeightBracket | null =>
  typeof v === "string" && BRACKETS.has(v as HeightBracket) ? (v as HeightBracket) : null;
const intOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

// --- Quote CRUD --------------------------------------------------------------

export async function createConstructionQuote(input: {
  reference?: string;
  customerName?: string;
  siteAddress?: string;
  band?: string;
  durationWeeks?: number | null;
  enquiryType?: string;
  siteType?: string;
  notes?: string;
}): Promise<void> {
  const band = BANDS.has(input.band as RateBand) ? (input.band as RateBand) : "COMPETITIVE";
  const siteType = SITE_TYPES.has(input.siteType as SiteType)
    ? (input.siteType as SiteType)
    : null;
  const quote = await prisma.constructionQuote.create({
    data: {
      reference: input.reference?.trim() || null,
      customerName: input.customerName?.trim() || null,
      siteAddress: input.siteAddress?.trim() || null,
      band,
      durationWeeks: intOrNull(input.durationWeeks),
      enquiryType: input.enquiryType?.trim() || null,
      siteType,
      notes: input.notes?.trim() || null,
    },
  });
  revalidatePath("/construction");
  redirect(`/construction/${quote.id}`);
}

/** Patch the quote's header + enquiry-review fields. Re-prices lines when the
 *  band or default bracket changes (so already-added lines pick up the new rate). */
export async function updateConstructionQuote(
  id: string,
  patch: {
    reference?: string | null;
    customerName?: string | null;
    siteAddress?: string | null;
    band?: string;
    durationWeeks?: number | null;
    extraHirePctPerWeek?: number | null;
    enquiryType?: string | null;
    siteType?: string | null;
    buildingHeightM?: number | null;
    defaultHeightBracket?: string | null;
    doorwayCount?: number | null;
    fireExitCount?: number | null;
    pedestrianAccessCount?: number | null;
    notes?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const data: Record<string, unknown> = {};
  if (patch.reference !== undefined) data.reference = patch.reference?.trim() || null;
  if (patch.customerName !== undefined) data.customerName = patch.customerName?.trim() || null;
  if (patch.siteAddress !== undefined) data.siteAddress = patch.siteAddress?.trim() || null;
  if (patch.band !== undefined && BANDS.has(patch.band as RateBand)) data.band = patch.band;
  if (patch.durationWeeks !== undefined) data.durationWeeks = intOrNull(patch.durationWeeks);
  if (patch.extraHirePctPerWeek !== undefined)
    data.extraHirePctPerWeek =
      patch.extraHirePctPerWeek == null ? null : numOrNull(patch.extraHirePctPerWeek);
  if (patch.enquiryType !== undefined) data.enquiryType = patch.enquiryType?.trim() || null;
  if (patch.siteType !== undefined)
    data.siteType = SITE_TYPES.has(patch.siteType as SiteType) ? patch.siteType : null;
  if (patch.buildingHeightM !== undefined) data.buildingHeightM = numOrNull(patch.buildingHeightM);
  if (patch.defaultHeightBracket !== undefined)
    data.defaultHeightBracket = asBracket(patch.defaultHeightBracket);
  if (patch.doorwayCount !== undefined) data.doorwayCount = intOrNull(patch.doorwayCount);
  if (patch.fireExitCount !== undefined) data.fireExitCount = intOrNull(patch.fireExitCount);
  if (patch.pedestrianAccessCount !== undefined)
    data.pedestrianAccessCount = intOrNull(patch.pedestrianAccessCount);
  if (patch.notes !== undefined) data.notes = patch.notes?.trim() || null;

  try {
    await prisma.constructionQuote.update({ where: { id }, data });
    // A band / default-bracket change moves the resolved rate on library-linked lines.
    if (patch.band !== undefined || patch.defaultHeightBracket !== undefined) {
      await repriceQuoteLines(id);
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" };
  }
  revalidatePath(`/construction/${id}`);
  return { ok: true };
}

export async function deleteConstructionQuote(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.constructionQuote.delete({ where: { id } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
  revalidatePath("/construction");
  return { ok: true };
}

export async function setConstructionQuoteStatus(
  id: string,
  status: "DRAFT" | "CONFIRMED" | "QUOTED",
): Promise<{ ok: boolean; error?: string }> {
  if (!["DRAFT", "CONFIRMED", "QUOTED"].includes(status))
    return { ok: false, error: "Invalid status." };
  await prisma.constructionQuote.update({
    where: { id },
    data: { status, confirmedAt: status === "DRAFT" ? null : new Date() },
  });
  revalidatePath(`/construction/${id}`);
  return { ok: true };
}

// --- Measurements ------------------------------------------------------------

export async function addConstructionMeasurement(
  quoteId: string,
  input: {
    label: string;
    kind: string;
    valueNumber: number;
    lifts?: number | null;
    heightBracket?: string | null;
    source?: string | null;
    note?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!input.label.trim()) return { ok: false, error: "Label is required." };
  if (!MEASUREMENT_KINDS.has(input.kind)) return { ok: false, error: "Invalid measurement kind." };
  if (!Number.isFinite(input.valueNumber)) return { ok: false, error: "Enter a value." };
  const max = await prisma.constructionMeasurement.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });
  await prisma.constructionMeasurement.create({
    data: {
      quoteId,
      label: input.label.trim(),
      kind: input.kind,
      valueNumber: input.valueNumber,
      lifts: intOrNull(input.lifts),
      heightBracket: asBracket(input.heightBracket),
      source: input.source && MEASUREMENT_SOURCES.has(input.source) ? input.source : "MANUAL",
      note: input.note?.trim() || null,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

export async function deleteConstructionMeasurement(
  id: string,
  quoteId: string,
): Promise<{ ok: boolean }> {
  await prisma.constructionMeasurement.delete({ where: { id } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

// --- Lines -------------------------------------------------------------------

/** Resolve an element's rate for the quote's band + a bracket, and compute a line. */
async function resolveLineFromElement(
  quoteId: string,
  elementId: string,
  lifts: number | null,
  bracketOverride: HeightBracket | null,
): Promise<{
  description: string;
  unit: ConstructionUnit;
  rate: number;
  heightBracket: HeightBracket | null;
  lifts: number | null;
} | null> {
  const [quote, element] = await Promise.all([
    prisma.constructionQuote.findUnique({ where: { id: quoteId } }),
    prisma.constructionElement.findUnique({ where: { id: elementId }, include: { rates: true } }),
  ]);
  if (!quote || !element) return null;
  const bracket = element.usesHeightBracket
    ? (bracketOverride ?? (quote.defaultHeightBracket as HeightBracket | null))
    : null;
  const rate =
    resolveConstructionRate(
      element.rates.map((r) => ({ band: r.band, bracket: r.bracket, rate: Number(r.rate) })),
      quote.band,
      bracket,
    ) ?? 0;
  return {
    description: element.name,
    unit: element.unit,
    rate,
    heightBracket: bracket,
    lifts: element.usesLifts ? lifts : null,
  };
}

export async function addConstructionLineFromElement(
  quoteId: string,
  input: { elementId: string; quantity?: number; lifts?: number | null; bracket?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const resolved = await resolveLineFromElement(
    quoteId,
    input.elementId,
    intOrNull(input.lifts),
    asBracket(input.bracket),
  );
  if (!resolved) return { ok: false, error: "Element not found." };
  const quantity = numOrNull(input.quantity) ?? 0;
  const max = await prisma.constructionQuoteLine.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });
  const amount = lineAmount({ unit: resolved.unit, quantity, lifts: resolved.lifts, rate: resolved.rate });
  await prisma.constructionQuoteLine.create({
    data: {
      quoteId,
      elementId: input.elementId,
      description: resolved.description,
      lifts: resolved.lifts,
      unit: resolved.unit,
      quantity,
      heightBracket: resolved.heightBracket,
      rate: resolved.rate,
      amount,
      isAuto: false,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

export async function addConstructionCustomLine(
  quoteId: string,
  input: {
    description: string;
    unit: string;
    quantity?: number;
    lifts?: number | null;
    rate?: number;
    note?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  if (!input.description.trim()) return { ok: false, error: "Description is required." };
  if (!UNITS.has(input.unit as ConstructionUnit)) return { ok: false, error: "Invalid unit." };
  const unit = input.unit as ConstructionUnit;
  const quantity = numOrNull(input.quantity) ?? 0;
  const rate = numOrNull(input.rate) ?? 0;
  const lifts = intOrNull(input.lifts);
  const max = await prisma.constructionQuoteLine.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });
  await prisma.constructionQuoteLine.create({
    data: {
      quoteId,
      elementId: null,
      description: input.description.trim(),
      lifts,
      unit,
      quantity,
      rate,
      amount: lineAmount({ unit, quantity, lifts, rate }),
      isAuto: false,
      note: input.note?.trim() || null,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

export async function updateConstructionLine(
  id: string,
  quoteId: string,
  patch: {
    description?: string;
    quantity?: number;
    lifts?: number | null;
    rate?: number;
    heightBracket?: string | null;
    note?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const line = await prisma.constructionQuoteLine.findUnique({ where: { id } });
  if (!line) return { ok: false, error: "Line not found." };

  const description = patch.description !== undefined ? patch.description.trim() : line.description;
  const quantity = patch.quantity !== undefined ? (numOrNull(patch.quantity) ?? 0) : Number(line.quantity);
  const lifts = patch.lifts !== undefined ? intOrNull(patch.lifts) : line.lifts;
  const rate = patch.rate !== undefined ? (numOrNull(patch.rate) ?? 0) : Number(line.rate);
  const heightBracket =
    patch.heightBracket !== undefined ? asBracket(patch.heightBracket) : line.heightBracket;
  const note = patch.note !== undefined ? patch.note?.trim() || null : line.note;

  await prisma.constructionQuoteLine.update({
    where: { id },
    data: {
      description: description || line.description,
      quantity,
      lifts,
      rate,
      heightBracket,
      note,
      amount: lineAmount({ unit: line.unit, quantity, lifts, rate }),
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

export async function duplicateConstructionLine(
  id: string,
  quoteId: string,
): Promise<{ ok: boolean; error?: string }> {
  const line = await prisma.constructionQuoteLine.findUnique({ where: { id } });
  if (!line) return { ok: false, error: "Line not found." };
  const max = await prisma.constructionQuoteLine.aggregate({
    where: { quoteId },
    _max: { sortOrder: true },
  });
  await prisma.constructionQuoteLine.create({
    data: {
      quoteId,
      elementId: line.elementId,
      description: line.description,
      lifts: line.lifts,
      unit: line.unit,
      quantity: line.quantity,
      heightBracket: line.heightBracket,
      rate: line.rate,
      amount: line.amount,
      isAuto: false,
      note: line.note,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

export async function deleteConstructionLine(
  id: string,
  quoteId: string,
): Promise<{ ok: boolean }> {
  await prisma.constructionQuoteLine.delete({ where: { id } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** Re-resolve the rate + amount of every library-linked line (after a band change). */
async function repriceQuoteLines(quoteId: string): Promise<void> {
  const lines = await prisma.constructionQuoteLine.findMany({
    where: { quoteId, elementId: { not: null } },
  });
  for (const l of lines) {
    if (!l.elementId) continue;
    const resolved = await resolveLineFromElement(
      quoteId,
      l.elementId,
      l.lifts,
      l.heightBracket as HeightBracket | null,
    );
    if (!resolved) continue;
    const quantity = Number(l.quantity);
    await prisma.constructionQuoteLine.update({
      where: { id: l.id },
      data: {
        rate: resolved.rate,
        heightBracket: resolved.heightBracket,
        amount: lineAmount({ unit: l.unit, quantity, lifts: l.lifts, rate: resolved.rate }),
      },
    });
  }
}

// --- Attachments (upload + register + delete — files are stored & shown, NEVER parsed) ---

export async function createSignedConstructionUploads(
  quoteId: string,
  files: { name: string; type: string; size: number }[],
): Promise<{ targets: { index: number; path: string; signedUrl: string; name: string; type: string; size: number }[] }> {
  const targets = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const path = `construction/${quoteId}/${randomUUID()}-${f.name}`;
    const { signedUrl } = await createSignedUploadUrl(path);
    targets.push({ index: i, path, signedUrl, name: f.name, type: f.type, size: f.size });
  }
  return { targets };
}

export async function registerConstructionAttachments(
  quoteId: string,
  uploaded: { path: string; name: string; type: string; size: number; kind?: string }[],
): Promise<void> {
  if (uploaded.length === 0) return;
  await prisma.constructionAttachment.createMany({
    data: uploaded.map((u) => ({
      quoteId,
      fileName: u.name,
      storagePath: u.path,
      mimeType: u.type || "application/octet-stream",
      sizeBytes: u.size,
      kind: u.kind ?? null,
    })),
  });
  revalidatePath(`/construction/${quoteId}`);
}

export async function deleteConstructionAttachment(
  id: string,
  quoteId: string,
): Promise<{ ok: boolean }> {
  await prisma.constructionAttachment.delete({ where: { id } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}
