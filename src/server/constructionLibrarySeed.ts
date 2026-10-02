import type { PrismaClient } from "@prisma/client";
import { CONSTRUCTION_ELEMENT_SEED } from "@/lib/construction/library";

/**
 * Write the development picking list (`library.ts`) into the database — shared by
 * `prisma/seed.ts` and `scripts/restore-seed-library.mts` so both leave the library
 * in exactly the same state. Idempotent: elements are upserted by their fixed id and
 * each element's rates are replaced by the seed's. Never deletes an element (quote
 * lines point at them); `retireOthers` switches everything else off instead.
 */
export async function writeDevLibrary(
  prisma: PrismaClient,
  opts: { retireOthers: boolean },
): Promise<{ written: number; retired: number }> {
  for (const el of CONSTRUCTION_ELEMENT_SEED) {
    const data = {
      line: el.line,
      name: el.name,
      aliases: el.aliases,
      category: el.category,
      unit: el.unit,
      usesLifts: el.usesLifts,
      usesHeightBracket: el.usesHeightBracket,
      defaultRuleNote: el.defaultRuleNote,
      sortOrder: el.sortOrder,
      sourceTitle: null,
      isActive: true,
    };
    await prisma.constructionElement.upsert({
      where: { id: el.id },
      update: data,
      create: { id: el.id, ...data },
    });
    await prisma.constructionRate.deleteMany({ where: { elementId: el.id } });
    await prisma.constructionRate.createMany({
      data: el.rates.map((r) => ({
        elementId: el.id,
        band: r.band,
        bracket: r.bracket,
        rate: r.rate,
        baseHireWeeks: r.baseHireWeeks,
        extraHirePerWeek: r.extraHirePerWeek,
        extraHireChargePct: r.extraHireChargePct,
      })),
    });
  }

  let retired = 0;
  if (opts.retireOthers) {
    const res = await prisma.constructionElement.updateMany({
      where: { id: { notIn: CONSTRUCTION_ELEMENT_SEED.map((e) => e.id) }, isActive: true },
      data: { isActive: false },
    });
    retired = res.count;
  }
  return { written: CONSTRUCTION_ELEMENT_SEED.length, retired };
}
