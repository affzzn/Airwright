"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RateBand } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidModelKey } from "@/lib/extract/providers/catalog";

const RATE_BANDS = new Set<RateBand>([
  "SUPER_COMPETITIVE",
  "COMPETITIVE",
  "MEDIUM",
  "HIGH",
  "CUSTOM",
]);

/**
 * Set the commercial rate band for a project's pricing (the Commercial panel on
 * the pricing screen). Null clears the override, falling back to the client's
 * default band. The matrix re-prices at the chosen band on the next render.
 */
export async function setProjectRateBand(
  projectId: string,
  band: string | null,
): Promise<{ ok: boolean; error?: string }> {
  if (band !== null && !RATE_BANDS.has(band as RateBand))
    return { ok: false, error: "Invalid rate band." };
  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { rateBand: band as RateBand | null },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set band." };
  }
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true };
}

/**
 * Set the CUSTOM band's headline external-lift rate (£/LM) from the pricing
 * screen's Commercial panel. Applied FLAT across lift levels (base + 1st) so the
 * Custom band is a single per-metre external rate with no odd 1st-lift inversion.
 * Other Custom components (birdcage, gable, dismantle…) are edited on /rates. The
 * matrix, quote and Excel all read these rate items, so they stay correct.
 */
export async function setCustomMeterRate(
  projectId: string,
  rate: number,
): Promise<{ ok: boolean; error?: string }> {
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "Enter a valid rate." };
  const card = await prisma.rateCard.findFirst({
    where: { mode: "HOUSE_BUILD", isActive: true },
    orderBy: { effectiveFrom: "desc" },
    select: { id: true },
  });
  if (!card) return { ok: false, error: "No active house-build rate card." };
  const r = Math.round(rate * 100) / 100;
  try {
    for (const liftLevel of [0, 1]) {
      await prisma.rateItem.upsert({
        where: {
          rateCardId_component_action_band_liftLevel: {
            rateCardId: card.id,
            component: "LIFT",
            action: "ERECT",
            band: "CUSTOM",
            liftLevel,
          },
        },
        create: {
          rateCardId: card.id,
          component: "LIFT",
          action: "ERECT",
          band: "CUSTOM",
          unit: "LM",
          rate: r,
          liftLevel,
        },
        update: { rate: r },
      });
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to set rate." };
  }
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true };
}

/** Create a client + project in one step (Week-1 simple flow). */
export async function createProject(formData: FormData) {
  const clientName = String(formData.get("clientName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  // Build system for this tender (docs/18) — selects the take-off + pricing logic.
  // Construction estimating mode has been retired from the create form; every new
  // tender is a HOUSE_BUILD, either TRADITIONAL or TIMBER_FRAME.
  const buildType =
    String(formData.get("buildType") ?? "TRADITIONAL") === "TIMBER_FRAME"
      ? "TIMBER_FRAME"
      : "TRADITIONAL";
  // Which LLM reads this project's drawings; unknown/empty → default (Anthropic).
  const rawModel = String(formData.get("extractionModel") ?? "");
  const extractionModel = isValidModelKey(rawModel) ? rawModel : null;

  if (!clientName || !projectName) return;

  // Reuse an existing client of the same name, else create one.
  const client =
    (await prisma.client.findFirst({ where: { name: clientName } })) ??
    (await prisma.client.create({ data: { name: clientName } }));

  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: projectName,
      estimatingMode: "HOUSE_BUILD",
      buildType,
      extractionModel,
      packs: { create: { version: 1 } }, // start with an empty pack to upload into
    },
  });

  revalidatePath("/");
  redirect(`/projects/${project.id}`);
}

/** Archive / unarchive a tender (hidden from the default list, never deleted). */
export async function setProjectArchived(
  id: string,
  archived: boolean,
): Promise<{ ok: boolean }> {
  await prisma.project.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidatePath("/");
  return { ok: true };
}

/**
 * Permanently delete a tender and everything under it. Plots are deleted first
 * so the Plot→HouseType RESTRICT can't block the project cascade; deleting the
 * project then cascades packs, documents, extractions, house types, takeoffs
 * and quotes.
 */
export async function deleteProject(
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$transaction([
      prisma.plot.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } }),
    ]);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
  revalidatePath("/");
  return { ok: true };
}
