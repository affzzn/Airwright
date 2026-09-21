import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
import { compileRecipe } from "../src/lib/ingest/recipe";
import { groupPack, type IngestFile } from "../src/lib/ingest/group";
const packId = "cmu0vax2e0003ityikqe3ihyz";
const docs = await prisma.document.findMany({ where: { packId, kind: { not: "ASSEMBLED" }, isReadable: true }, include: { pages: true } });
const files: IngestFile[] = docs.map((d) => ({ documentId: d.id, relativePath: d.relativePath ?? d.fileName,
  pages: d.pages.map((p) => ({ page: p.pageNumber, relevant: p.relevant, houseTypeName: p.houseTypeName, sheetTitle: p.sheetTitle })) }));
// Which docs carry relevant pages, and what does their relativePath look like?
const relDocs = docs.filter(d => d.pages.some(p => p.relevant));
console.log(`readable docs=${docs.length}, docs with >=1 relevant page=${relDocs.length}`);
console.log("Sample relevant-doc relativePaths:");
for (const d of relDocs.slice(0,10)) console.log(`  ${(d.relativePath ?? d.fileName).slice(0,90)}`);
const recipe = { strategy: "filename-name-token", confidence: "medium",
  houseTypeNames: ["B1","B3","B5","Curlew","Dahlia","Jackdaw","Kingfisher","Plover","Garage","Double Garage Split"],
  junkFolderKeywords: ["Documents","Groundworks"], junkFileKeywords: [], reasoning: "", folderMarker: null, folderMarkers: [], combinedPdfFolder: null };
const profile = compileRecipe(recipe as any);
// Test identity resolution on the relevant docs directly:
console.log("\nIdentity of relevant docs (profile.houseTypeFromPath):");
const idCount: Record<string,number> = {};
for (const d of relDocs) { const id = profile.grouping.houseTypeFromPath(d.relativePath ?? d.fileName) ?? "(unplaced)"; idCount[id]=(idCount[id]||0)+1; }
for (const [k,v] of Object.entries(idCount).sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v} relevant docs`);
const result = groupPack(files, profile);
console.log(`\ngroupPack -> ${result.groups.length} groups; with relevant pages:`);
for (const g of result.groups.filter(g=>g.pages.some(p=>p.relevant))) console.log(`  ${g.name}: ${g.pages.filter(p=>p.relevant).length} relevant pages, ${g.files.length} files`);
await prisma.$disconnect();
