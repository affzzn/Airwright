import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Minimal seed so the app isn't empty and the pricing engine (Week 4) has a
 * rate card to read. The percentage splits and rates below are PLACEHOLDERS —
 * confirm the real numbers with Colin before pricing anything for real.
 */
async function main() {
  const client = await prisma.client.upsert({
    where: { id: "seed-client-miller" },
    update: {},
    create: {
      id: "seed-client-miller",
      name: "Miller Homes",
      defaultBand: "MEDIUM",
    },
  });

  const rateCard = await prisma.rateCard.upsert({
    where: { id: "seed-ratecard-2026q3" },
    update: {},
    create: {
      id: "seed-ratecard-2026q3",
      name: "2026 Q3 (placeholder)",
      mode: "HOUSE_BUILD",
      effectiveFrom: new Date("2026-07-01"),
      isActive: true,
      stageSplits: {
        // All ✅ CONFIRMED from Colin's matrix column headers (docs/15 §5).
        create: [
          { scenario: "STANDARD", name: "Plot Erect", percent: 50, sortOrder: 0 },
          { scenario: "STANDARD", name: "Birdcage Erect", percent: 25, sortOrder: 1 },
          { scenario: "STANDARD", name: "Dismantle", percent: 25, sortOrder: 2 },
          { scenario: "BUNGALOW", name: "Plot Erect", percent: 65, sortOrder: 0 },
          { scenario: "BUNGALOW", name: "Birdcage Erect", percent: 10, sortOrder: 1 },
          { scenario: "BUNGALOW", name: "Dismantle", percent: 25, sortOrder: 2 },
          { scenario: "NO_BIRDCAGE", name: "Plot Erect", percent: 75, sortOrder: 0 },
          { scenario: "NO_BIRDCAGE", name: "Birdcage Erect", percent: 0, sortOrder: 1 },
          { scenario: "NO_BIRDCAGE", name: "Dismantle", percent: 25, sortOrder: 2 },
          { scenario: "GARAGE", name: "Gar Erect", percent: 65, sortOrder: 0 },
          { scenario: "GARAGE", name: "Birdcage Erect", percent: 10, sortOrder: 1 },
          { scenario: "GARAGE", name: "Dismantle", percent: 25, sortOrder: 2 },
          { scenario: "GARAGE_NO_BCAGE", name: "Gar Erect", percent: 75, sortOrder: 0 },
          { scenario: "GARAGE_NO_BCAGE", name: "Birdcage Erect", percent: 0, sortOrder: 1 },
          { scenario: "GARAGE_NO_BCAGE", name: "Dismantle", percent: 25, sortOrder: 2 },
          { scenario: "TIMBER_FRAME", name: "Plot Erect", percent: 80, sortOrder: 0 },
          { scenario: "TIMBER_FRAME", name: "Dismantle", percent: 20, sortOrder: 1 },
        ],
      },
      items: {
        // liftLevel 0 = base rate (upper lifts); 1 = the (dearer) 1st lift (docs/15 P2).
        create: [
          { component: "LIFT", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 18.25, liftLevel: 0 },
          { component: "LIFT", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 21.0, liftLevel: 1 },
          { component: "LIFT", action: "DISMANTLE", band: "MEDIUM", unit: "LM", rate: 6.0, liftLevel: 0 },
          { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", unit: "M2", rate: 9.0 },
          { component: "BIRDCAGE_FF", action: "ERECT", band: "MEDIUM", unit: "M2", rate: 9.0 },
          // Apex split into two lines (2026-09-01): table lifts + apex guard rails.
          // GABLE kept for the garage block's combined "Gable Lift & Rails" column.
          { component: "TABLE_LIFT", action: "ERECT", band: "MEDIUM", unit: "EACH", rate: 120.0 },
          { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", unit: "EACH", rate: 40.0 },
          { component: "GABLE", action: "ERECT", band: "MEDIUM", unit: "EACH", rate: 120.0 },
          // Party-wall spec item — inside apex, no rails; one per non-detached house.
          // ⚠ £165 PROVISIONAL (Colin, 2026-09-01 call) — confirm on the rate sheet.
          { component: "PARTY_WALL", action: "ERECT", band: "MEDIUM", unit: "EACH", rate: 165.0 },
          // Timber-frame placeholders (⚠ real TF rates owed by Colin — docs/18 §7).
          { component: "TF_EXTERNAL", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 12.0 },
          { component: "TF_EXTERNAL", action: "DISMANTLE", band: "MEDIUM", unit: "LM", rate: 4.0 },
          // The two LM adaptions (docs/18). TABLE_LIFT + GABLE_RAILS above cover the
          // TF apex scaffold + rails; render/dismantle share the traditional lines.
          { component: "ADAPTION_INSIDE_BOARD", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 5.0 },
          { component: "ADAPTION_HOP_UP", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 4.0 },
        ],
      },
    },
  });

  // Placeholder builder spec profile — the per-housebuilder "extras" rules.
  // All values here are PLACEHOLDERS until the real design-standard spec arrives.
  await prisma.builderProfile.upsert({
    where: { id: "seed-profile-miller" },
    update: {},
    create: {
      id: "seed-profile-miller",
      clientId: client.id,
      name: "Miller Homes standard (placeholder)",
      accessType: "HAKI_STAIR",
      ladderAllowedConfined: true,
      beamOverLowLevel: false,
      chimneyScaffoldAlways: false,
      joistSupportVariant: "single",
      extraHirePolicy: "charge",
      // Standard storey→lifts template (docs/08). ⚠ Confirm per builder with Colin.
      storeyLiftTemplate: { "1": 2, "2": 4, "2.5": 5, "3": 6, "4": 8 },
      notes: "PLACEHOLDER — confirm against Miller's design standard specification.",
    },
  });

  // A second housebuilder to demonstrate the per-builder lift template — Barratt's
  // 2-storey is 3 lifts, not 4 (docs/08). ⚠ Template values still to confirm with Colin.
  const barratt = await prisma.client.upsert({
    where: { id: "seed-client-barratt" },
    update: {},
    create: { id: "seed-client-barratt", name: "Barratt Homes", defaultBand: "MEDIUM" },
  });
  await prisma.builderProfile.upsert({
    where: { id: "seed-profile-barratt" },
    update: {},
    create: {
      id: "seed-profile-barratt",
      clientId: barratt.id,
      name: "Barratt standard (placeholder)",
      storeyLiftTemplate: { "1": 2, "2": 3, "2.5": 5, "3": 6, "4": 8 },
      notes: "PLACEHOLDER — Barratt 2-storey = 3 lifts (docs/08); confirm the full template.",
    },
  });

  console.log(
    `Seeded client ${client.name}, rate card ${rateCard.name}, and a placeholder builder profile.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
