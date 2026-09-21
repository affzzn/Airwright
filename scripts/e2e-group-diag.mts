import { config } from "dotenv"; config({ path: ".env.local" });
import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { parsePath, RELEVANT_KINDS } from "../src/lib/ingest/parsePath";
import { compileRecipe } from "../src/lib/ingest/recipe";
import { groupPack, type IngestFile } from "../src/lib/ingest/group";
const ROOT = "data/timber-frames/Leicester Road, Earl Shilton TF #";
function walk(dir: string): string[] { const out: string[] = [];
  for (const n of readdirSync(dir)) { if (n.startsWith(".")) continue; const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f)); else if (/\.pdf$/i.test(n)) out.push(f); } return out; }
const rootName = basename(ROOT);
const files: IngestFile[] = walk(ROOT).map((full, i) => {
  const rp = `${rootName}/${relative(ROOT, full)}`;
  return { documentId: `d${i}`, relativePath: rp, pages: [{ page: 1, relevant: RELEVANT_KINDS.has(parsePath(rp).drawingKind) }] };
});
// The recipe the AI ACTUALLY produced on this pack (from the earlier run) — test the fix deterministically.
const recipe = { strategy: "filename-name-token" as const, confidence: "medium" as const,
  houseTypeNames: ["B1","B3","B5","Curlew","Dahlia","Jackdaw","Kingfisher","Plover","Garage","Double Garage Split"],
  junkFolderKeywords: ["Documents","Groundworks"], junkFileKeywords: [], reasoning: "", folderMarker: null, folderMarkers: [], combinedPdfFolder: null };
const result = groupPack(files, compileRecipe(recipe as any));
const houseLike = result.groups.filter(g => g.pages.some(p => p.relevant));
console.log(`groupPack -> ${result.groups.length} groups (${houseLike.length} with relevant pages), ${result.unplacedFiles.length} unplaced`);
for (const g of result.groups.sort((a,b)=>b.pages.filter(p=>p.relevant).length-a.pages.filter(p=>p.relevant).length))
  console.log(`  ${g.name}: ${g.files.length} files, ${g.pages.filter(p=>p.relevant).length} relevant pages`);
