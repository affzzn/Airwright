/**
 * Put the construction picking list back to the original 13-item seed
 * (`src/lib/construction/library.ts`), the list that existed before Airwright's
 * own rate sheet was imported.
 *
 *   npx tsx scripts/restore-seed-library.mts [--dry-run]
 *
 * Reversible in both directions and never destructive:
 *   - the 13 seed items are re-upserted exactly as `library.ts` defines them,
 *     with their placeholder rates, and switched back on;
 *   - everything else in the library is RETIRED (`isActive = false`), not
 *     deleted, because quote lines point at it. Re-running
 *     `scripts/import-rate-sheet.mts` brings the real sheet back.
 */

import { prisma } from "@/lib/db";
import { CONSTRUCTION_ELEMENT_SEED } from "@/lib/construction/library";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const seedIds = CONSTRUCTION_ELEMENT_SEED.map((e) => e.id);

  const before = await prisma.constructionElement.count({ where: { isActive: true } });
  const toRetire = await prisma.constructionElement.count({
    where: { isActive: true, id: { notIn: seedIds } },
  });
  console.log(`Active now: ${before}. Restoring ${seedIds.length} seed items, retiring ${toRetire}.`);

  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  for (const el of CONSTRUCTION_ELEMENT_SEED) {
    const data = {
      line: "CONSTRUCTION" as const,
      name: el.name,
      aliases: el.aliases,
      category: el.category,
      unit: el.unit,
      usesLifts: el.usesLifts,
      usesHeightBracket: el.usesHeightBracket,
      defaultRuleNote: el.defaultRuleNote ?? null,
      sortOrder: el.sortOrder,
      sourceTitle: null,
      isActive: true,
    };
    await prisma.constructionElement.upsert({
      where: { id: el.id },
      update: data,
      create: { id: el.id, ...data },
    });
    // The seed's placeholder rates, exactly as `library.ts` lists them.
    await prisma.constructionRate.deleteMany({ where: { elementId: el.id } });
    await prisma.constructionRate.createMany({
      data: el.rates.map((r) => ({
        elementId: el.id,
        band: r.band,
        bracket: r.bracket,
        rate: r.rate,
      })),
    });
  }

  const retired = await prisma.constructionElement.updateMany({
    where: { id: { notIn: seedIds }, isActive: true },
    data: { isActive: false },
  });

  const active = await prisma.constructionElement.count({ where: { isActive: true } });
  console.log(`Restored ${seedIds.length} seed items, retired ${retired.count}. Active now: ${active}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
