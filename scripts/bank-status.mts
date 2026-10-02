import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
const entries = await prisma.houseTypeBankEntry.findMany({ include: { client: { select: { name: true } }, _count: { select: { versions: true, houseTypes: true } } }, orderBy: { createdAt: "asc" } });
console.log("Bank entries:", entries.length, " versions:", await prisma.houseTypeBankVersion.count());
for (const e of entries) console.log(` - ${e.client.name} · ${e.canonicalName}${e.canonicalCode ? ` (${e.canonicalCode})` : ""} · ${e.buildType} · v=${e._count.versions} linked=${e._count.houseTypes} aliases=${e.aliases.join("|")}`);
console.log("House types linked to bank:", await prisma.houseType.count({ where: { bankEntryId: { not: null } } }));
console.log("House types with a bank state:", await prisma.houseType.count({ where: { bankMatchState: { not: null } } }));
const projects = await prisma.project.findMany({ where: { estimatingMode: "HOUSE_BUILD" }, select: { id: true, name: true, createdAt: true, buildType: true, client: { select: { name: true } }, _count: { select: { houseTypes: true } } }, orderBy: { createdAt: "asc" } });
console.log("House-build projects:", projects.length);
for (const p of projects) {
  const conf = await prisma.takeoff.count({ where: { status: "CONFIRMED", houseType: { projectId: p.id } } });
  console.log(` - ${p.createdAt.toISOString().slice(0,10)} ${p.id} ${p.client.name} · ${p.name} · ${p.buildType} · types=${p._count.houseTypes} confirmed=${conf}`);
}
console.log("Clients:", (await prisma.client.findMany({ select: { name: true } })).map(c => JSON.stringify(c.name)).join(", "));
await prisma.$disconnect();
