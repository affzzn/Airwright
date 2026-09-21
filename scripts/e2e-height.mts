import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
const pid = process.argv[2] ?? "cmu0x7p0w0001itep9jz0bqxo";
const hts = await prisma.houseType.findMany({ where: { projectId: pid },
  include: { extractions: { where: { status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 1 } } });
for (const ht of hts.sort((a,b)=>a.name.localeCompare(b.name))) {
  const raw: any = ht.extractions[0]?.rawOutput;
  if (!raw) { console.log(`${ht.name}: no extraction`); continue; }
  const h = raw.heightToSoffitM ?? {};
  const ladder = raw.storeyHeightsM ?? [];
  console.log(`${ht.name.padEnd(12)}${ht.code?`(${ht.code})`:""}`);
  console.log(`   height=${h.value} [${h.confidence}]  dim="${h.sourceDimension ?? "-"}"  page=${h.sourcePage ?? "-"}  ladder=[${ladder.join(", ")}]  storeys=${raw.storeys?.value}`);
}
await prisma.$disconnect();
