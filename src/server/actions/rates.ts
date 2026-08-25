"use server";

import { revalidatePath } from "next/cache";
import type {
  EstimatingMode,
  OperationAction,
  RateBand,
  ScaffoldComponent,
  Unit as PrismaUnit,
} from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Rate-card admin. Rates and bands are edited here by Airwright (no developer).
 * Rate cards are versioned + effective-dated, so a historic quote reprices at the
 * rates it was made with; quotes hold their own immutable snapshot regardless.
 */

type Mode = EstimatingMode;
type Component = ScaffoldComponent;
type Action = OperationAction;
type Band = RateBand;
type Unit = PrismaUnit;

export async function createRateCard(input: {
  name: string;
  mode: string;
  effectiveFrom: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  const mode: Mode = input.mode === "CONSTRUCTION" ? "CONSTRUCTION" : "HOUSE_BUILD";
  await prisma.rateCard.create({
    data: {
      name,
      mode,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
      // Seed the confirmed standard stage split so a new card is usable at once.
      stageSplits: {
        create: [
          { scenario: "STANDARD", name: "Plot Erect", percent: 50, sortOrder: 0 },
          { scenario: "STANDARD", name: "Birdcage Erect", percent: 25, sortOrder: 1 },
          { scenario: "STANDARD", name: "Dismantle", percent: 25, sortOrder: 2 },
        ],
      },
    },
  });
  revalidatePath("/rates");
  return { ok: true };
}

export async function setRateCardActive(
  id: string,
  isActive: boolean,
): Promise<{ ok: boolean }> {
  await prisma.rateCard.update({ where: { id }, data: { isActive } });
  revalidatePath("/rates");
  return { ok: true };
}

export async function deleteRateCard(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Items + stage splits cascade; quotes keep their snapshot (rateCardId → null).
    await prisma.rateCard.delete({ where: { id } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
  revalidatePath("/rates");
  return { ok: true };
}

const COMPONENTS = new Set([
  "LIFT", "GABLE", "GABLE_RAILS", "RENDER_ADAPTION",
  "BIRDCAGE_GF", "BIRDCAGE_FF", "BIRDCAGE_SF", "BIRDCAGE_TF",
  "LOADING_BAY", "HAKI", "LADDER_TOWER", "RUBBISH_CHUTE", "TABLE_LIFT",
  "JOIST_SUPPORT", "FOOT_SCAFFOLD", "LOW_LEVEL", "PARTY_WALL", "CONSTRUCTION_LINE", "OTHER",
]);
const ACTIONS = new Set(["ERECT", "DISMANTLE"]);
const BANDS = new Set(["SUPER_COMPETITIVE", "COMPETITIVE", "MEDIUM", "HIGH", "CUSTOM"]);
const UNITS = new Set(["LM", "M2", "EACH", "LIFT", "WEEK"]);

/**
 * Add or update one rate, keyed by rate card + component + action + band +
 * liftLevel. liftLevel 0 = the base rate (upper lifts + non-lift components);
 * 1..8 = a specific lift level's rate (docs/15 P2).
 */
export async function saveRateItem(input: {
  rateCardId: string;
  component: string;
  action: string;
  band: string;
  unit: string;
  rate: number;
  liftLevel?: number;
}): Promise<{ ok: boolean; error?: string }> {
  if (
    !COMPONENTS.has(input.component) ||
    !ACTIONS.has(input.action) ||
    !BANDS.has(input.band) ||
    !UNITS.has(input.unit)
  )
    return { ok: false, error: "Invalid rate item." };
  if (!Number.isFinite(input.rate) || input.rate < 0)
    return { ok: false, error: "Rate must be a positive number." };
  const liftLevel = Math.trunc(input.liftLevel ?? 0);
  if (liftLevel < 0 || liftLevel > 8)
    return { ok: false, error: "Lift level must be 0–8 (0 = base)." };

  const key = {
    rateCardId: input.rateCardId,
    component: input.component as Component,
    action: input.action as Action,
    band: input.band as Band,
    liftLevel,
  };
  await prisma.rateItem.upsert({
    where: { rateCardId_component_action_band_liftLevel: key },
    create: { ...key, unit: input.unit as Unit, rate: input.rate },
    update: { unit: input.unit as Unit, rate: input.rate },
  });
  revalidatePath("/rates");
  return { ok: true };
}

export async function deleteRateItem(id: string): Promise<{ ok: boolean }> {
  await prisma.rateItem.delete({ where: { id } });
  revalidatePath("/rates");
  return { ok: true };
}

export async function setStageSplitPercent(
  id: string,
  percent: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100)
    return { ok: false, error: "Percent must be 0–100." };
  await prisma.stageSplit.update({ where: { id }, data: { percent } });
  revalidatePath("/rates");
  return { ok: true };
}
