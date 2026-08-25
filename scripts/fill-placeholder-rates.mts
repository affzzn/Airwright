/**
 * Fill the ACTIVE house-build rate card with placeholder rates + every stage-split
 * scenario, so the pricing matrix stops pricing at £0 and each scenario uses the
 * right split (docs/15 §5). ⚠️ ALL NUMBERS ARE PLACEHOLDERS — swap for Colin's real
 * rate sheet (Track 3), then reproduce a real priced site to the penny.
 *
 *   npx tsx scripts/fill-placeholder-rates.mts          # fills the active card (band MEDIUM)
 *
 * Idempotent: stage splits are rebuilt; rate items upsert on their unique key.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const BAND = "MEDIUM" as const;

// [component, action, unit, rate, liftLevel]
const RATES: [string, "ERECT" | "DISMANTLE", "LM" | "M2" | "EACH", number, number][] = [
  // External scaffold — 1st lift dearer (liftLevel 1), the rest at the base (0).
  ["LIFT", "ERECT", "LM", 18.25, 0],
  ["LIFT", "ERECT", "LM", 21.0, 1],
  ["LIFT", "DISMANTLE", "LM", 6.0, 0],
  // Table lift + gable rails (combined client column M).
  ["GABLE", "ERECT", "EACH", 120.0, 0],
  // Render adaption.
  ["RENDER_ADAPTION", "ERECT", "LM", 18.25, 0],
  // Birdcage erect + strip, per floor GF→TF.
  ["BIRDCAGE_GF", "ERECT", "M2", 9.0, 0],
  ["BIRDCAGE_GF", "DISMANTLE", "M2", 1.5, 0],
  ["BIRDCAGE_FF", "ERECT", "M2", 9.0, 0],
  ["BIRDCAGE_FF", "DISMANTLE", "M2", 1.5, 0],
  ["BIRDCAGE_SF", "ERECT", "M2", 9.0, 0],
  ["BIRDCAGE_SF", "DISMANTLE", "M2", 1.5, 0],
  ["BIRDCAGE_TF", "ERECT", "M2", 9.0, 0],
  ["BIRDCAGE_TF", "DISMANTLE", "M2", 1.5, 0],
  // Timber-frame.
  ["TF_EXTERNAL", "ERECT", "LM", 12.0, 0],
  ["TF_EXTERNAL", "DISMANTLE", "LM", 4.0, 0],
  ["ADAPTION", "ERECT", "LM", 5.0, 0],
  ["GABLE_RAILS", "ERECT", "EACH", 40.0, 0],
  // Extras still priced as client lines (pending the P6 bundling decision).
  ["LOW_LEVEL", "ERECT", "EACH", 150.0, 0],
  ["PARTY_WALL", "ERECT", "EACH", 80.0, 0],
];

// [scenario, [name, percent, sortOrder]...]
const SPLITS: [string, [string, number, number][]][] = [
  ["STANDARD", [["Plot Erect", 50, 0], ["Birdcage Erect", 25, 1], ["Dismantle", 25, 2]]],
  ["BUNGALOW", [["Plot Erect", 65, 0], ["Birdcage Erect", 10, 1], ["Dismantle", 25, 2]]],
  ["NO_BIRDCAGE", [["Plot Erect", 75, 0], ["Birdcage Erect", 0, 1], ["Dismantle", 25, 2]]],
  ["GARAGE", [["Gar Erect", 65, 0], ["Birdcage Erect", 10, 1], ["Dismantle", 25, 2]]],
  ["GARAGE_NO_BCAGE", [["Gar Erect", 75, 0], ["Birdcage Erect", 0, 1], ["Dismantle", 25, 2]]],
  ["TIMBER_FRAME", [["Plot Erect", 80, 0], ["Dismantle", 20, 1]]],
];

async function main() {
  const card = await prisma.rateCard.findFirst({
    where: { mode: "HOUSE_BUILD", isActive: true },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!card) throw new Error("No active house-build rate card. Create one under /rates first.");
  console.log(`Filling card "${card.name}" (${card.id}), band ${BAND}.`);

  // Rebuild stage splits (no unique key → clear then create).
  await prisma.stageSplit.deleteMany({ where: { rateCardId: card.id } });
  await prisma.stageSplit.createMany({
    data: SPLITS.flatMap(([scenario, rows]) =>
      rows.map(([name, percent, sortOrder]) => ({ rateCardId: card.id, scenario, name, percent, sortOrder })),
    ),
  });

  // Upsert rate items on [rateCardId, component, action, band, liftLevel].
  for (const [component, action, unit, rate, liftLevel] of RATES) {
    await prisma.rateItem.upsert({
      where: {
        rateCardId_component_action_band_liftLevel: {
          rateCardId: card.id,
          component: component as never,
          action,
          band: BAND,
          liftLevel,
        },
      },
      create: { rateCardId: card.id, component: component as never, action, band: BAND, unit, rate, liftLevel },
      update: { unit, rate },
    });
  }

  console.log(`Wrote ${SPLITS.reduce((a, [, r]) => a + r.length, 0)} stage splits and ${RATES.length} rate items.`);
  console.log("⚠️ All placeholders — replace with Colin's real rate sheet, then re-generate quotes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
