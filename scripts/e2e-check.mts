import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
const projects = await prisma.project.findMany({
  where: { buildType: "TIMBER_FRAME", name: { contains: "Earl Shilton" } },
  include: { houseTypes: { include: { takeoff: { select: { status: true } }, extractions: { select: { status: true } } } }, _count: { select: { plots: true } } },
  orderBy: { createdAt: "desc" },
});
for (const p of projects) {
  console.log(`\nProject ${p.id}  "${p.name}"  buildType=${p.buildType}  created=${p.createdAt.toISOString().slice(0,16)}`);
  console.log(`  house types: ${p.houseTypes.length}`);
  for (const h of p.houseTypes.sort((a,b)=>a.name.localeCompare(b.name)))
    console.log(`    ${h.name}${h.code?` [${h.code}]`:""}  takeoff=${h.takeoff?.status??"-"}  extractions=${h.extractions.map(e=>e.status).join(",")||"-"}`);
}
if (projects.length===0) console.log("No existing Earl Shilton TF project found.");
await prisma.$disconnect();
