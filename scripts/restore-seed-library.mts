/**
 * Put the construction picking list on the DEVELOPMENT list
 * (`src/lib/construction/library.ts`, docs/22 §4.0) — the placeholder list the
 * pack reader maps a scope to until Airwright's final list is confirmed.
 *
 *   npx tsx scripts/restore-seed-library.mts [--dry-run]
 *
 * Reversible in both directions and never destructive:
 *   - the dev items are re-upserted exactly as `library.ts` defines them, with
 *     their placeholder rates + hire terms, and switched on;
 *   - everything else in the library is RETIRED (`isActive = false`), not
 *     deleted, because quote lines point at it. Re-running
 *     `scripts/import-rate-sheet.mts` brings Airwright's real sheet back.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { prisma } from "@/lib/db";
import { CONSTRUCTION_ELEMENT_SEED } from "@/lib/construction/library";
import { writeDevLibrary } from "@/server/constructionLibrarySeed";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const seedIds = CONSTRUCTION_ELEMENT_SEED.map((e) => e.id);

  const before = await prisma.constructionElement.count({ where: { isActive: true } });
  const toRetire = await prisma.constructionElement.count({
    where: { isActive: true, id: { notIn: seedIds } },
  });
  console.log(`Active now: ${before}. Writing ${seedIds.length} dev items, retiring ${toRetire}.`);
  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  const { written, retired } = await writeDevLibrary(prisma, { retireOthers: true });
  const active = await prisma.constructionElement.count({ where: { isActive: true } });
  console.log(`Wrote ${written} dev items, retired ${retired}. Active now: ${active}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
