"use server";

import { revalidatePath } from "next/cache";
import type { BusinessLine, ConstructionUnit, HeightBracket, RateBand } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Admin for the CONSTRUCTION scaffold-element library (docs/19 §9) — the "picking
 * list" a construction quote is built from. Edited here by Airwright, on the
 * Rates → Construction tab. Rates are per (band, height bracket). Separate from the
 * house-build rate cards (a different, standalone model).
 */

const UNITS = new Set<ConstructionUnit>([
  "LM_PER_LIFT", "M2_PER_LIFT", "NR_PER_LIFT", "NR", "LM", "M2", "PER_WEEK", "FIXED",
]);
const BRACKETS = new Set<HeightBracket>([
  "UP_TO_6M", "H6_12M", "H12_18M", "H18_24M", "H24_30M", "ANY",
]);
const LINES = new Set<BusinessLine>(["CONSTRUCTION", "TRADITIONAL", "TIMBER_FRAME", "GENERAL"]);
const BANDS = new Set<RateBand>(["SUPER_COMPETITIVE", "COMPETITIVE", "MEDIUM", "HIGH", "CUSTOM"]);

export async function createConstructionElement(input: {
  line?: string;
  name: string;
  category?: string;
  unit: string;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  aliases?: string[];
  defaultRuleNote?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!UNITS.has(input.unit as ConstructionUnit)) return { ok: false, error: "Invalid unit." };
  const max = await prisma.constructionElement.aggregate({ _max: { sortOrder: true } });
  await prisma.constructionElement.create({
    data: {
      line: LINES.has(input.line as BusinessLine) ? (input.line as BusinessLine) : "CONSTRUCTION",
      name,
      category: input.category?.trim() || null,
      unit: input.unit as ConstructionUnit,
      usesLifts: input.usesLifts,
      usesHeightBracket: input.usesHeightBracket,
      aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
      defaultRuleNote: input.defaultRuleNote?.trim() || null,
      sortOrder: (max._max.sortOrder ?? 0) + 10,
    },
  });
  revalidatePath("/rates");
  return { ok: true };
}

export async function updateConstructionElement(
  id: string,
  input: {
    name?: string;
    category?: string | null;
    unit?: string;
    usesLifts?: boolean;
    usesHeightBracket?: boolean;
    aliases?: string[];
    defaultRuleNote?: string | null;
    isActive?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Name is required." };
    data.name = n;
  }
  if (input.category !== undefined) data.category = input.category?.trim() || null;
  if (input.unit !== undefined) {
    if (!UNITS.has(input.unit as ConstructionUnit)) return { ok: false, error: "Invalid unit." };
    data.unit = input.unit as ConstructionUnit;
  }
  if (input.usesLifts !== undefined) data.usesLifts = input.usesLifts;
  if (input.usesHeightBracket !== undefined) data.usesHeightBracket = input.usesHeightBracket;
  if (input.aliases !== undefined) data.aliases = input.aliases.map((a) => a.trim()).filter(Boolean);
  if (input.defaultRuleNote !== undefined) data.defaultRuleNote = input.defaultRuleNote?.trim() || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  try {
    await prisma.constructionElement.update({ where: { id }, data });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Update failed" };
  }
  revalidatePath("/rates");
  return { ok: true };
}

export async function deleteConstructionElement(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Rates cascade; any quote line that referenced it keeps its frozen figures
    // (elementId → null via onDelete: SetNull).
    await prisma.constructionElement.delete({ where: { id } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
  revalidatePath("/rates");
  return { ok: true };
}

/** Add or update one element's rate for a (band, bracket). */
export async function saveConstructionRate(input: {
  elementId: string;
  band: string;
  bracket: string;
  rate: number;
  baseHireWeeks?: number;
  extraHirePerWeek?: number;
  extraHireChargePct?: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (!BANDS.has(input.band as RateBand)) return { ok: false, error: "Invalid band." };
  if (!BRACKETS.has(input.bracket as HeightBracket)) return { ok: false, error: "Invalid bracket." };
  if (!Number.isFinite(input.rate) || input.rate < 0)
    return { ok: false, error: "Rate must be a positive number." };
  const key = {
    elementId: input.elementId,
    band: input.band as RateBand,
    bracket: input.bracket as HeightBracket,
  };
  const terms = {
    ...(input.baseHireWeeks != null && Number.isFinite(input.baseHireWeeks)
      ? { baseHireWeeks: Math.max(0, Math.trunc(input.baseHireWeeks)) }
      : {}),
    ...(input.extraHirePerWeek != null && Number.isFinite(input.extraHirePerWeek)
      ? { extraHirePerWeek: Math.max(0, input.extraHirePerWeek) }
      : {}),
    ...(input.extraHireChargePct != null && Number.isFinite(input.extraHireChargePct)
      ? { extraHireChargePct: Math.min(100, Math.max(0, input.extraHireChargePct)) }
      : {}),
  };
  await prisma.constructionRate.upsert({
    where: { elementId_band_bracket: key },
    create: { ...key, rate: input.rate, ...terms },
    update: { rate: input.rate, ...terms },
  });
  revalidatePath("/rates");
  return { ok: true };
}

/**
 * The hire terms are a property of the item and the band, not of one height
 * bracket, so this writes them across every bracket in that band at once
 * (Airwright's sheet carries the same E/H value on every bracket of an item).
 */
export async function saveConstructionHireTerms(input: {
  elementId: string;
  band: string;
  baseHireWeeks?: number | null;
  extraHirePerWeek?: number | null;
  extraHireChargePct?: number | null;
}): Promise<{ ok: boolean; error?: string }> {
  if (!BANDS.has(input.band as RateBand)) return { ok: false, error: "Invalid band." };
  const data: Record<string, number> = {};
  if (input.baseHireWeeks != null && Number.isFinite(input.baseHireWeeks))
    data.baseHireWeeks = Math.max(0, Math.trunc(input.baseHireWeeks));
  if (input.extraHirePerWeek != null && Number.isFinite(input.extraHirePerWeek))
    data.extraHirePerWeek = Math.max(0, input.extraHirePerWeek);
  if (input.extraHireChargePct != null && Number.isFinite(input.extraHireChargePct))
    data.extraHireChargePct = Math.min(100, Math.max(0, input.extraHireChargePct));
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.constructionRate.updateMany({
    where: { elementId: input.elementId, band: input.band as RateBand },
    data,
  });
  revalidatePath("/rates");
  return { ok: true };
}

export async function deleteConstructionRate(id: string): Promise<{ ok: boolean }> {
  await prisma.constructionRate.delete({ where: { id } });
  revalidatePath("/rates");
  return { ok: true };
}
