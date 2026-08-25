/**
 * Merge duplicate house types (docs/16 · P follow-up). A pack often has several
 * files for the SAME real house type (e.g. "26. L356_Denton_Combined", "NB -
 * Denton (L356)", "11. 250814 Denton") — each became its own HouseType. This
 * collapses them, per project, grouping by the (backfilled) real NAME:
 *
 *   - canonical = the best duplicate to keep (a CONFIRMED take-off wins, then any
 *     take-off, then a drawing extraction, then a clean code; oldest breaks ties);
 *   - all plots + extractions from the others are repointed to the canonical;
 *   - the canonical adopts the best clean code in the group;
 *   - the redundant house types are deleted (their DRAFT take-offs cascade — the
 *     extractions/rawOutput are preserved on the canonical).
 *
 *   npx tsx scripts/merge-duplicate-house-types.mts          # DRY RUN (default)
 *   npx tsx scripts/merge-duplicate-house-types.mts --apply  # writes the merges
 *
 * Safety: a group with two DIFFERENT clean codes is NOT merged (could be two
 * genuinely different types) — it's flagged for a human instead.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";
import { cleanHouseTypeCode } from "../src/lib/extract/houseTypeIdentity";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

async function main() {
  const houseTypes = await prisma.houseType.findMany({
    include: {
      project: { select: { name: true } },
      takeoff: { select: { status: true } },
      _count: { select: { extractions: true, plots: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Group by project + normalised name.
  const groups = new Map<string, typeof houseTypes>();
  for (const ht of houseTypes) {
    const key = `${ht.projectId}::${ht.name.trim().toLowerCase()}`;
    const g = groups.get(key) ?? [];
    g.push(ht);
    groups.set(key, g);
  }

  const score = (h: (typeof houseTypes)[number]) =>
    (h.takeoff?.status === "CONFIRMED" ? 1000 : 0) +
    (h.takeoff ? 100 : 0) +
    (h._count.extractions > 0 ? 10 : 0) +
    (cleanHouseTypeCode(h.code) ? 1 : 0);

  let mergeGroups = 0;
  let toDelete = 0;
  let plotsMoved = 0;
  let extractionsMoved = 0;
  const skipped: string[] = [];

  const plans: {
    canonicalId: string;
    canonicalName: string;
    projectId: string;
    project: string;
    bestCode: string | null;
    losers: typeof houseTypes;
  }[] = [];

  for (const g of groups.values()) {
    if (g.length < 2) continue;

    const distinctCodes = [...new Set(g.map((h) => cleanHouseTypeCode(h.code)).filter(Boolean))];
    if (distinctCodes.length > 1) {
      skipped.push(
        `${g[0].project.name} · "${g[0].name}" — ${distinctCodes.length} distinct codes (${distinctCodes.join(", ")}); left for manual review.`,
      );
      continue;
    }

    const canonical = [...g].sort((a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime())[0];
    const bestCode = distinctCodes[0] ?? null;
    const losers = g.filter((h) => h.id !== canonical.id);

    mergeGroups++;
    toDelete += losers.length;
    plotsMoved += losers.reduce((a, h) => a + h._count.plots, 0);
    extractionsMoved += losers.reduce((a, h) => a + h._count.extractions, 0);
    plans.push({
      canonicalId: canonical.id,
      canonicalName: canonical.name,
      projectId: canonical.projectId,
      project: g[0].project.name,
      bestCode,
      losers,
    });
  }

  // --- Report ---
  const fmt = (h: (typeof houseTypes)[number]) =>
    `"${h.name}"${h.code ? ` [${h.code}]` : ""} · to=${h.takeoff?.status ?? "NONE"} · ext=${h._count.extractions} · plots=${h._count.plots}`;
  let lastProject = "";
  for (const p of plans) {
    if (p.project !== lastProject) {
      console.log(`\n=== ${p.project} ===`);
      lastProject = p.project;
    }
    console.log(`  KEEP  "${p.canonicalName}"${p.bestCode ? ` [${p.bestCode}]` : ""}`);
    for (const l of p.losers) console.log(`  merge ${fmt(l)}`);
  }
  if (skipped.length) {
    console.log(`\n--- SKIPPED (needs manual review) ---`);
    for (const s of skipped) console.log(`  ${s}`);
  }

  console.log(
    `\n${APPLY ? "APPLYING" : "DRY RUN"} — ${mergeGroups} group(s), ${toDelete} house type(s) to remove, ${plotsMoved} plot(s) + ${extractionsMoved} extraction(s) repointed, ${skipped.length} skipped.`,
  );
  if (!APPLY) {
    console.log("Re-run with --apply to perform the merges.");
    return;
  }

  for (const p of plans) {
    const loserIds = p.losers.map((l) => l.id);
    await prisma.$transaction(async (tx) => {
      // Repoint plots, avoiding a (projectId, plotNumber) clash on the canonical.
      const canonPlots = await tx.plot.findMany({
        where: { houseTypeId: p.canonicalId },
        select: { plotNumber: true },
      });
      const taken = new Set(canonPlots.map((x) => x.plotNumber));
      const loserPlots = await tx.plot.findMany({
        where: { houseTypeId: { in: loserIds } },
        select: { id: true, plotNumber: true },
      });
      for (const lp of loserPlots) {
        if (taken.has(lp.plotNumber)) {
          await tx.plot.delete({ where: { id: lp.id } }); // duplicate plot number — drop it
        } else {
          taken.add(lp.plotNumber);
          await tx.plot.update({ where: { id: lp.id }, data: { houseTypeId: p.canonicalId } });
        }
      }
      // Preserve extractions on the canonical.
      await tx.extraction.updateMany({
        where: { houseTypeId: { in: loserIds } },
        data: { houseTypeId: p.canonicalId },
      });
      // Canonical adopts the best clean code (guard the unique constraint).
      if (p.bestCode) {
        const clash = await tx.houseType.findFirst({
          where: { projectId: p.projectId, code: p.bestCode, id: { notIn: [p.canonicalId, ...loserIds] } },
          select: { id: true },
        });
        if (!clash) {
          await tx.houseType.update({ where: { id: p.canonicalId }, data: { code: p.bestCode } });
        }
      }
      // Delete the losers (their take-offs cascade; extractions already moved).
      await tx.houseType.deleteMany({ where: { id: { in: loserIds } } });
    });
  }
  console.log(`Merged ${mergeGroups} group(s); removed ${toDelete} house type(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
