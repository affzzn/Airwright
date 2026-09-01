import type { Configuration } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeStructureForm, type StructureForm } from "@/lib/structure";

/**
 * Plot defaults derived from a confirmed take-off's own observables. The plot is
 * the billing unit (Colin's matrix is one row per plot), but for the common
 * no-site-layout case the estimator shouldn't hand-build it — so confirming a
 * take-off auto-creates a single plot with config + render read straight off the
 * drawing. This module holds the pure default + the idempotent create.
 */

// Default per-plot POSITION (config) for a house type of each structure form. A
// pair/three-block/terrace defaults to an end/semi position; the estimator sets
// mid-terrace per plot. Apartment blocks scaffold whole-building (the engine keys
// off warnings.structure, not the config), so DETACHED is the safe placeholder.
const STRUCTURE_CONFIG: Record<StructureForm, Configuration> = {
  DETACHED: "DETACHED",
  PAIR_SEMI: "SEMI_DETACHED",
  THREE_BLOCK: "END_TERRACE",
  TERRACE: "END_TERRACE",
  APARTMENT_BLOCK: "DETACHED",
};

/** Config + render defaults read off the take-off's stored `warnings`. */
export function defaultPlotFromWarnings(warnings: unknown): {
  configuration: Configuration;
  isRendered: boolean;
} {
  const w = (warnings && typeof warnings === "object" ? warnings : {}) as Record<
    string,
    unknown
  >;
  const dwellingsWide = typeof w.dwellingsWide === "number" ? w.dwellingsWide : null;
  const structure = normalizeStructureForm(w.structure, dwellingsWide);
  return {
    configuration: structure ? STRUCTURE_CONFIG[structure] : "DETACHED",
    isRendered: w.rendered === true,
  };
}

/**
 * Ensure a house type has at least one plot to price. No-op if it already has
 * any plot (a real site layout read them, or the user added one by hand) — so a
 * multi-plot development is never disturbed. Called when a take-off is confirmed.
 */
export async function ensureDefaultPlot(houseTypeId: string): Promise<void> {
  const ht = await prisma.houseType.findUnique({
    where: { id: houseTypeId },
    select: {
      id: true,
      projectId: true,
      _count: { select: { plots: true } },
      takeoff: { select: { warnings: true } },
    },
  });
  if (!ht || ht._count.plots > 0) return;

  const { configuration, isRendered } = defaultPlotFromWarnings(ht.takeoff?.warnings);

  // Next free integer plot number in the project.
  const existing = await prisma.plot.findMany({
    where: { projectId: ht.projectId },
    select: { plotNumber: true },
  });
  const taken = new Set(existing.map((p) => p.plotNumber));
  const maxNum = existing.reduce((m, p) => {
    const n = parseInt(p.plotNumber, 10);
    return !Number.isNaN(n) && n > m ? n : m;
  }, 0);
  let n = maxNum + 1;
  while (taken.has(String(n))) n++;

  await prisma.plot.create({
    data: {
      projectId: ht.projectId,
      houseTypeId: ht.id,
      plotNumber: String(n),
      configuration,
      isRendered,
    },
  });
}
