import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { plotListResultSchema, type PlotListResult } from "./plotSchema";

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

/**
 * Re-match a project's plots to house types from the STORED plot-list refs
 * (`Document.plotListData`). Fixes the ordering gap where the plot list was read
 * before the drawings set their real codes, and lets a user re-link after the
 * backfill. Only re-links plots currently on an UNMATCHED/"Unknown" stub — never
 * overrides a real house type a person assigned by hand. Then deletes emptied
 * "Unknown" stubs. No Claude calls.
 */
export async function rematchProjectPlots(
  projectId: string,
): Promise<{ relinked: number; cleaned: number; hadData: boolean }> {
  const docs = await prisma.document.findMany({
    where: { pack: { projectId }, plotListData: { not: Prisma.DbNull } },
    select: { plotListData: true },
  });
  if (docs.length === 0) return { relinked: 0, cleaned: 0, hadData: false };

  // A plot-list STUB is a house type with no drawing behind it (no extraction, no
  // take-off) — created only to hang a plot on. Real (drawing-backed) house types
  // are the re-link targets; a plot on a stub is re-linkable, a plot a person
  // assigned to a real house type is left alone.
  const houseTypes = await prisma.houseType.findMany({
    where: { projectId },
    select: {
      id: true,
      code: true,
      name: true,
      takeoff: { select: { id: true } },
      _count: { select: { extractions: true } },
    },
  });
  const isStub = (h: (typeof houseTypes)[number]) => !h.takeoff && h._count.extractions === 0;
  const realHouseTypes = houseTypes.filter((h) => !isStub(h)).map((h) => ({ id: h.id, code: h.code, name: h.name }));
  const stubIds = new Set(houseTypes.filter(isStub).map((h) => h.id));

  const plots = await prisma.plot.findMany({
    where: { projectId },
    select: { id: true, plotNumber: true, houseTypeId: true },
  });
  const relinkableByNumber = new Map(
    plots.filter((p) => stubIds.has(p.houseTypeId)).map((p) => [p.plotNumber, p.id]),
  );

  let relinked = 0;
  for (const doc of docs) {
    const parsed = plotListResultSchema.safeParse(doc.plotListData);
    if (!parsed.success) continue;
    for (const ref of parsed.data.plots) {
      if (!ref.plotNumber) continue;
      const plotId = relinkableByNumber.get(ref.plotNumber);
      if (!plotId) continue;
      const match = findHouseType(ref.houseTypeCode, ref.houseTypeName, realHouseTypes);
      if (!match) continue;
      await prisma.plot.update({ where: { id: plotId }, data: { houseTypeId: match.id } });
      relinked++;
    }
  }

  // Drop stubs that now have no plots (and, by definition, no drawing).
  const emptyStubs = await prisma.houseType.findMany({
    where: { id: { in: [...stubIds] }, plots: { none: {} } },
    select: { id: true },
  });
  if (emptyStubs.length > 0) {
    await prisma.houseType.deleteMany({ where: { id: { in: emptyStubs.map((h) => h.id) } } });
  }
  return { relinked, cleaned: emptyStubs.length, hadData: true };
}
