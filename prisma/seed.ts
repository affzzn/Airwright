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
        create: [
          { name: "Plot Erect", percent: 50, sortOrder: 0 },
          { name: "Birdcage Erect", percent: 25, sortOrder: 1 },
          { name: "Dismantle", percent: 25, sortOrder: 2 },
        ],
      },
      items: {
        create: [
          { component: "LIFT", action: "ERECT", band: "MEDIUM", unit: "LM", rate: 18.25 },
          { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", unit: "M2", rate: 9.0 },
          { component: "GABLE", action: "ERECT", band: "MEDIUM", unit: "EACH", rate: 120.0 },
        ],
      },
    },
  });

  console.log(`Seeded client ${client.name} and rate card ${rateCard.name}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
