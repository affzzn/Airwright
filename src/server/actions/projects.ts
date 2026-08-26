"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RateBand } from "@prisma/client";
import { prisma } from "@/lib/db";

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

/** Create a client + project in one step (Week-1 simple flow). */
export async function createProject(formData: FormData) {
  const clientName = String(formData.get("clientName") ?? "").trim();
  const projectName = String(formData.get("projectName") ?? "").trim();
  const mode =
    String(formData.get("mode") ?? "HOUSE_BUILD") === "CONSTRUCTION"
      ? "CONSTRUCTION"
      : "HOUSE_BUILD";

  if (!clientName || !projectName) return;

  // Reuse an existing client of the same name, else create one.
  const client =
    (await prisma.client.findFirst({ where: { name: clientName } })) ??
    (await prisma.client.create({ data: { name: clientName } }));

  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: projectName,
      estimatingMode: mode,
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
