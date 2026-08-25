"use server";

import { revalidatePath } from "next/cache";
import type { Configuration } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rematchProjectPlots } from "@/lib/extract/persistPlots";

/**
 * Plot-schedule editing — the human-in-the-loop correction step for the plot
 * list. Extraction reads plot NUMBERS reliably but often can't read the
 * house-type or configuration per plot (they aren't always on the site drawing),
 * so a person assigns them here. Pricing runs off these corrected values, so a
 * plot pointing at the right CONFIRMED house type + the right config is what
 * unblocks the quote. See docs/11 §3.15 (configuration comes from the schedule).
 */

const CONFIGS = new Set(["DETACHED", "SEMI_DETACHED", "END_TERRACE", "MID_TERRACE"]);

/**
 * Re-link plot-list stubs to real house types from the stored site-plan refs
 * (no Claude calls). Useful after the drawings finish extracting / after a code
 * backfill. Leaves hand-assigned plots alone; clears emptied stubs.
 */
export async function rematchPlots(
  projectId: string,
): Promise<{ ok: boolean; relinked?: number; cleaned?: number; hadData?: boolean; error?: string }> {
  try {
    const r = await rematchProjectPlots(projectId);
    revalidatePath(`/projects/${projectId}`);
    return { ok: true, ...r };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Re-match failed" };
  }
}

/** The project a plot belongs to (for validation + revalidation). */
async function projectOfPlot(plotId: string): Promise<string | null> {
  const p = await prisma.plot.findUnique({
    where: { id: plotId },
    select: { projectId: true },
  });
  return p?.projectId ?? null;
}

/**
 * Edit one plot's house type / configuration / render / garage. Only fields
 * present in `patch` are changed. A house type must belong to the same project.
 */
export async function updatePlot(
  plotId: string,
  patch: {
    houseTypeId?: string;
    configuration?: string;
    isRendered?: boolean;
    hasGarage?: boolean;
  },
): Promise<{ ok: boolean; error?: string }> {
  const projectId = await projectOfPlot(plotId);
  if (!projectId) return { ok: false, error: "Plot not found." };

  const data: {
    houseTypeId?: string;
    configuration?: Configuration;
    isRendered?: boolean;
    hasGarage?: boolean;
  } = {};

  if (patch.houseTypeId !== undefined) {
    const ht = await prisma.houseType.findFirst({
      where: { id: patch.houseTypeId, projectId },
      select: { id: true },
    });
    if (!ht) return { ok: false, error: "House type is not in this project." };
    data.houseTypeId = ht.id;
  }
  if (patch.configuration !== undefined) {
    if (!CONFIGS.has(patch.configuration))
      return { ok: false, error: "Invalid configuration." };
    data.configuration = patch.configuration as Configuration;
  }
  if (patch.isRendered !== undefined) data.isRendered = patch.isRendered;
  if (patch.hasGarage !== undefined) data.hasGarage = patch.hasGarage;

  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.plot.update({ where: { id: plotId }, data });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true };
}

/**
 * Apply the same house type / configuration / render to many plots at once —
 * the workhorse for a real pack (e.g. point 20 "Unknown" plots at the right
 * type in one go). Only the provided fields are changed.
 */
export async function bulkUpdatePlots(
  plotIds: string[],
  patch: { houseTypeId?: string; configuration?: string; isRendered?: boolean },
): Promise<{ ok: boolean; error?: string; updated?: number }> {
  if (plotIds.length === 0) return { ok: false, error: "No plots selected." };

  // All selected plots must share one project (they always do in the UI).
  const plots = await prisma.plot.findMany({
    where: { id: { in: plotIds } },
    select: { id: true, projectId: true },
  });
  const projectIds = new Set(plots.map((p) => p.projectId));
  if (projectIds.size !== 1) return { ok: false, error: "Plots span projects." };
  const projectId = [...projectIds][0];

  const data: {
    houseTypeId?: string;
    configuration?: Configuration;
    isRendered?: boolean;
  } = {};
  if (patch.houseTypeId !== undefined) {
    const ht = await prisma.houseType.findFirst({
      where: { id: patch.houseTypeId, projectId },
      select: { id: true },
    });
    if (!ht) return { ok: false, error: "House type is not in this project." };
    data.houseTypeId = ht.id;
  }
  if (patch.configuration !== undefined) {
    if (!CONFIGS.has(patch.configuration))
      return { ok: false, error: "Invalid configuration." };
    data.configuration = patch.configuration as Configuration;
  }
  if (patch.isRendered !== undefined) data.isRendered = patch.isRendered;
  if (Object.keys(data).length === 0) return { ok: true, updated: 0 };

  const res = await prisma.plot.updateMany({
    where: { id: { in: plots.map((p) => p.id) } },
    data,
  });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true, updated: res.count };
}

/**
 * Add a plot by hand — for pricing a house type when the pack had no site
 * layout / plot list (so no plots were auto-created), or to add a plot the plot
 * list missed. If no plot number is given, the next free integer is used.
 */
export async function addPlot(
  projectId: string,
  input: {
    houseTypeId: string;
    plotNumber?: string;
    configuration?: string;
    isRendered?: boolean;
    count?: number; // add several at once (auto-numbered)
  },
): Promise<{ ok: boolean; error?: string; created?: number }> {
  const ht = await prisma.houseType.findFirst({
    where: { id: input.houseTypeId, projectId },
    select: { id: true },
  });
  if (!ht) return { ok: false, error: "Pick a house type in this project." };

  const configuration: Configuration =
    input.configuration && CONFIGS.has(input.configuration)
      ? (input.configuration as Configuration)
      : "DETACHED";
  const isRendered = input.isRendered ?? false;

  const existing = await prisma.plot.findMany({
    where: { projectId },
    select: { plotNumber: true },
  });
  const taken = new Set(existing.map((p) => p.plotNumber));
  const nextFree = (): string => {
    const maxNum = existing.reduce((m, p) => {
      const n = parseInt(p.plotNumber, 10);
      return !Number.isNaN(n) && n > m ? n : m;
    }, 0);
    let n = maxNum + 1;
    while (taken.has(String(n))) n++;
    return String(n);
  };

  const rows: {
    projectId: string;
    houseTypeId: string;
    plotNumber: string;
    configuration: Configuration;
    isRendered: boolean;
  }[] = [];

  if (input.plotNumber && input.plotNumber.trim()) {
    const num = input.plotNumber.trim();
    if (taken.has(num)) return { ok: false, error: `Plot ${num} already exists.` };
    rows.push({ projectId, houseTypeId: ht.id, plotNumber: num, configuration, isRendered });
    taken.add(num);
  } else {
    const count = Math.max(1, Math.min(input.count ?? 1, 100));
    for (let i = 0; i < count; i++) {
      const num = nextFree();
      taken.add(num);
      existing.push({ plotNumber: num });
      rows.push({ projectId, houseTypeId: ht.id, plotNumber: num, configuration, isRendered });
    }
  }

  await prisma.plot.createMany({ data: rows });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true, created: rows.length };
}

/** Remove a plot (e.g. a mis-read plot number). */
export async function deletePlot(plotId: string): Promise<{ ok: boolean; error?: string }> {
  const projectId = await projectOfPlot(plotId);
  if (!projectId) return { ok: false, error: "Plot not found." };
  await prisma.plot.delete({ where: { id: plotId } });
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/pricing`);
  return { ok: true };
}

/**
 * Delete a house type (to clear junk types created from filenames, or the
 * "Unknown" stub). Its take-off/measurements cascade; extractions are detached.
 * Blocked while plots still reference it (FK Restrict) — reassign those first;
 * we surface a clear message instead of a raw FK error.
 */
export async function deleteHouseType(
  houseTypeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ht = await prisma.houseType.findUnique({
    where: { id: houseTypeId },
    select: { projectId: true, _count: { select: { plots: true } } },
  });
  if (!ht) return { ok: false, error: "House type not found." };
  if (ht._count.plots > 0)
    return {
      ok: false,
      error: `${ht._count.plots} plot(s) still use this house type — reassign them first.`,
    };
  try {
    await prisma.houseType.delete({ where: { id: houseTypeId } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delete failed" };
  }
  revalidatePath(`/projects/${ht.projectId}`);
  revalidatePath(`/projects/${ht.projectId}/pricing`);
  return { ok: true };
}
