/**
 * One-off, idempotent data fix for the ACTIVE placeholder rate card (2026-09-01).
 *
 * The active card pre-dates the apex split + party-wall spec item, so it holds
 * stale rates: PARTY_WALL at an old £80 placeholder and NO TABLE_LIFT (so apex
 * table lifts were unpriced). This reconciles that ONE card, non-destructively:
 *
 *   1. TABLE_LIFT = GABLE − GABLE_RAILS per band → keeps EVERY existing apex
 *      total identical (pure itemization of the old combined GABLE line).
 *   2. PARTY_WALL → £165, Colin's stated provisional unit cost (flat across bands).
 *
 * Both remain provisional and editable on /rates. Safe to re-run (upserts by the
 * card + component + action + band + liftLevel unique key). Run:
 *   node --env-file-if-exists=.env.local node_modules/.bin/tsx prisma/scripts/fix-active-card-party-wall-rates.ts
 */
import { PrismaClient } from "@prisma/client";

const PARTY_WALL_RATE = 165;

async function main() {
  const prisma = new PrismaClient();
  try {
    const card = await prisma.rateCard.findFirst({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    if (!card) {
      console.log("No active rate card — nothing to do.");
      return;
    }

    const gable = await prisma.rateItem.findMany({
      where: { rateCardId: card.id, component: "GABLE", action: "ERECT" },
      select: { band: true, rate: true, unit: true, liftLevel: true },
    });
    const rails = await prisma.rateItem.findMany({
      where: { rateCardId: card.id, component: "GABLE_RAILS", action: "ERECT" },
      select: { band: true, rate: true },
    });
    const railByBand = new Map(rails.map((r) => [r.band, Number(r.rate)]));

    const before = await prisma.rateItem.findMany({
      where: { rateCardId: card.id, component: { in: ["PARTY_WALL", "TABLE_LIFT"] } },
      select: { component: true, band: true, rate: true },
    });
    console.log(
      `Active card: ${card.name}\nBEFORE: ` +
        (before.map((i) => `${i.component}/${i.band}=${i.rate}`).join(", ") || "(none)"),
    );

    // 1) TABLE_LIFT per band = GABLE − GABLE_RAILS (total-preserving). Upsert so a
    //    re-run corrects the value without creating duplicates.
    let tableLiftWrites = 0;
    for (const g of gable) {
      const rate = Number(g.rate) - (railByBand.get(g.band) ?? 0);
      const liftLevel = g.liftLevel ?? 0;
      const existing = await prisma.rateItem.findFirst({
        where: {
          rateCardId: card.id,
          component: "TABLE_LIFT",
          action: "ERECT",
          band: g.band,
          liftLevel,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.rateItem.update({ where: { id: existing.id }, data: { rate } });
      } else {
        await prisma.rateItem.create({
          data: {
            rateCardId: card.id,
            component: "TABLE_LIFT",
            action: "ERECT",
            band: g.band,
            rate,
            unit: g.unit ?? "EACH",
            liftLevel,
          },
        });
      }
      tableLiftWrites += 1;
    }

    // 2) PARTY_WALL → £165 across the bands it already defines.
    const pw = await prisma.rateItem.updateMany({
      where: { rateCardId: card.id, component: "PARTY_WALL", action: "ERECT" },
      data: { rate: PARTY_WALL_RATE },
    });

    const after = await prisma.rateItem.findMany({
      where: { rateCardId: card.id, component: { in: ["PARTY_WALL", "TABLE_LIFT"] } },
      select: { component: true, band: true, rate: true },
      orderBy: [{ component: "asc" }, { band: "asc" }],
    });
    console.log(
      `TABLE_LIFT rows written: ${tableLiftWrites} | PARTY_WALL rows set to £${PARTY_WALL_RATE}: ${pw.count}`,
    );
    console.log(
      "AFTER: " + after.map((i) => `${i.component}/${i.band}=${i.rate}`).join(", "),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
