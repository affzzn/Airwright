import { prisma } from "@/lib/db";
import type { PlotListResult } from "./plotSchema";

interface HouseTypeLite {
  id: string;
  code: string | null;
  name: string;
}

/**
 * Match a plot's house-type reference to an existing house type: by code first
 * (most reliable), then by case-insensitive name. Pure — unit tested.
 */
export function findHouseType(
  code: string | null,
  name: string | null,
  houseTypes: HouseTypeLite[],
): HouseTypeLite | null {
  if (code) {
    const byCode = houseTypes.find((h) => h.code && h.code === code);
    if (byCode) return byCode;
  }
  if (name) {
    const n = name.trim().toLowerCase();
    const byName = houseTypes.find((h) => h.name.trim().toLowerCase() === n);
    if (byName) return byName;
  }
  return null;
}

/**
 * Create/update Plot rows from an extracted plot list, linking each to its
 * house type (matched by code/name, or created as a stub if the drawing for
 * that type wasn't in the pack).
 */
export async function persistPlots(
  projectId: string,
  clientId: string,
  result: PlotListResult,
): Promise<{ created: number }> {
  const houseTypes = await prisma.houseType.findMany({
    where: { projectId },
    select: { id: true, code: true, name: true },
  });
  const cache = new Map<string, string>(); // key → houseTypeId

  let created = 0;
  for (const p of result.plots) {
    if (!p.plotNumber) continue;

    const key = p.houseTypeCode ?? p.houseTypeName ?? "__unknown__";
    let houseTypeId = cache.get(key);

    if (!houseTypeId) {
      const match = findHouseType(p.houseTypeCode, p.houseTypeName, houseTypes);
      if (match) {
        houseTypeId = match.id;
      } else {
        // No drawing for this type in the pack — create a stub so the plot links.
        const stub = await prisma.houseType.create({
          data: {
            projectId,
            clientId,
            name: p.houseTypeName ?? p.houseTypeCode ?? "Unknown",
            code: p.houseTypeCode,
          },
        });
        houseTypeId = stub.id;
        houseTypes.push({ id: stub.id, code: stub.code, name: stub.name });
      }
      cache.set(key, houseTypeId);
    }

    await prisma.plot.upsert({
      where: { projectId_plotNumber: { projectId, plotNumber: p.plotNumber } },
      create: {
        projectId,
        houseTypeId,
        plotNumber: p.plotNumber,
        configuration: p.configuration ?? "DETACHED",
        isRendered: p.isRendered ?? false,
      },
      update: {
        houseTypeId,
        ...(p.configuration ? { configuration: p.configuration } : {}),
        ...(p.isRendered != null ? { isRendered: p.isRendered } : {}),
      },
    });
    created++;
  }
  return { created };
}
