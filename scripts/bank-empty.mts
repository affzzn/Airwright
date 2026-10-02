// Empty the house bank (docs/20 v2): delete ONLY the bank's own rows (entries +
// versions) and unlink house types from them. Projects, house types, take-offs,
// measurements, plots and quotes are not touched — confirmed take-offs stay confirmed.
//   npx tsx scripts/bank-empty.mts            (dry run — counts only)
//   npx tsx scripts/bank-empty.mts --yes      (do it)
import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
const entries = await prisma.houseTypeBankEntry.count();
const versions = await prisma.houseTypeBankVersion.count();
const linked = await prisma.houseType.count({ where: { OR: [{ bankEntryId: { not: null } }, { bankMatchState: { not: null } }, { bankVersionId: { not: null } }] } });
const confirmedBefore = await prisma.takeoff.count({ where: { status: "CONFIRMED" } });
console.log(`bank entries ${entries} · versions ${versions} · house types linked ${linked} · confirmed take-offs ${confirmedBefore}`);
if (!process.argv.includes("--yes")) { console.log("dry run — pass --yes to empty the bank"); process.exit(0); }
await prisma.$transaction(async (tx) => {
  await tx.houseType.updateMany({ where: { OR: [{ bankEntryId: { not: null } }, { bankMatchState: { not: null } }, { bankVersionId: { not: null } }] }, data: { bankEntryId: null, bankVersionId: null, bankMatchState: null } });
  await tx.houseTypeBankEntry.updateMany({ data: { currentVersionId: null } });
  await tx.houseTypeBankVersion.deleteMany({});
  await tx.houseTypeBankEntry.deleteMany({});
});
const confirmedAfter = await prisma.takeoff.count({ where: { status: "CONFIRMED" } });
console.log(`emptied. bank entries ${await prisma.houseTypeBankEntry.count()} · versions ${await prisma.houseTypeBankVersion.count()} · confirmed take-offs ${confirmedAfter} (was ${confirmedBefore})`);
await prisma.$disconnect();
