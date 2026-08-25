import { prisma } from "@/lib/db";
import { priceProject, type ProjectPricing } from "@/lib/pricing/priceProject";
import { getStoreyLiftTemplate } from "@/server/builderProfile";

/**
 * Load a project and price its whole development. Shared by the pricing matrix
 * page, the quote-generation action, and the exports, so every route prices the
 * same way (active house-build rate card + the client's default band).
 */
export interface LoadedPricing {
  project: { id: string; name: string; clientName: string; band: string };
  rateCard: { id: string; name: string } | null;
  pricing: ProjectPricing;
}

export async function loadProjectPricing(
  projectId: string,
): Promise<LoadedPricing | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    relationLoadStrategy: "join",
    include: {
      client: true,
      houseTypes: {
        include: { takeoff: { include: { measurements: true, wallSegments: true } } },
      },
      plots: true,
    },
  });
  if (!project) return null;

  const rateCard = await prisma.rateCard.findFirst({
    where: { mode: "HOUSE_BUILD", isActive: true },
    orderBy: { effectiveFrom: "desc" },
    include: { items: true, stageSplits: true },
  });

  // The lift template is per-builder (the client is the housebuilder).
  const storeyLiftTemplate = await getStoreyLiftTemplate(project.clientId);

  const pricing = priceProject({
    houseTypes: project.houseTypes.map((h) => ({
      id: h.id,
      name: h.name,
      code: h.code,
      buildType: h.buildType,
      takeoffStatus: h.takeoff?.status ?? "DRAFT",
      measurements: (h.takeoff?.measurements ?? []).map((m) => ({
        key: m.key as string,
        valueNumber: m.valueNumber !== null ? Number(m.valueNumber) : null,
      })),
      walls: (h.takeoff?.wallSegments ?? []).map((w) => ({
        position: w.position as string,
        lengthM: Number(w.lengthM),
      })),
      warnings:
        h.takeoff?.warnings && typeof h.takeoff.warnings === "object"
          ? (h.takeoff.warnings as Record<string, unknown>)
          : {},
    })),
    plots: project.plots.map((p) => ({
      id: p.id,
      plotNumber: p.plotNumber,
      houseTypeId: p.houseTypeId,
      configuration: p.configuration,
      isRendered: p.isRendered,
      hasGarage: p.hasGarage,
    })),
    rateItems: (rateCard?.items ?? []).map((i) => ({
      component: i.component,
      action: i.action,
      band: i.band,
      rate: Number(i.rate),
      liftLevel: i.liftLevel,
    })),
    stageSplits: (rateCard?.stageSplits ?? []).map((s) => ({
      scenario: s.scenario,
      name: s.name,
      percent: Number(s.percent),
    })),
    band: project.client.defaultBand,
    storeyLiftTemplate,
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      clientName: project.client.name,
      band: project.client.defaultBand,
    },
    rateCard: rateCard ? { id: rateCard.id, name: rateCard.name } : null,
    pricing,
  };
}
