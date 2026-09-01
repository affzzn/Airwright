/**
 * Offline dry-run of the smart-upload grouping (docs/17) against a real folder —
 * no DB, no Storage, no AI. Walks a pack folder, simulates page relevance from
 * each file's name (single-page PDFs → their drawing kind), detects the builder,
 * groups across files, and prints the proposed house types.
 *
 *   npx tsx scripts/ingest-dryrun.mts "data/first-ones-sent/VISTRY SOUTH EAST MIDLANDS TOP WIGHAY"
 *
 * Note: real ingestion classifies every PAGE via the PDF text layer; this dry-run
 * approximates a single-page file's relevance from its name, so multi-page
 * combined PDFs (Bloor/TW) count as one relevant page here. It still exercises
 * detectBuilder + groupPack on real paths.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { parsePath, RELEVANT_KINDS } from "../src/lib/ingest/parsePath";
import { detectBuilder } from "../src/lib/ingest/profiles";
import { groupPack, type IngestFile } from "../src/lib/ingest/group";

const root = process.argv[2];
if (!root) {
  console.error('Usage: tsx scripts/ingest-dryrun.mts "<pack folder>"');
  process.exit(1);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.pdf$/i.test(name)) out.push(full);
  }
  return out;
}

const packName = basename(root);
const pdfs = walk(root);
const files: IngestFile[] = pdfs.map((full, i) => {
  const rp = `${packName}/${relative(root, full)}`;
  const kind = parsePath(rp).drawingKind;
  return {
    documentId: `d${i}`,
    relativePath: rp,
    pages: [{ page: 1, relevant: RELEVANT_KINDS.has(kind) }],
  };
});

const folders = [...new Set(files.flatMap((f) => f.relativePath.split("/").slice(0, -1)))];
const fileNames = files.map((f) => f.relativePath.split("/").pop()!);
const profile = detectBuilder({ folders, fileNames, projectName: packName });

console.log(`\nPack: ${packName}`);
console.log(`Files: ${pdfs.length} PDFs`);
console.log(`Detected builder: ${profile ? profile.label + ` (${profile.id})` : "UNKNOWN → LLM fallback"}\n`);

const result = groupPack(files, profile);
console.log(`House types: ${result.groups.length}`);
for (const g of result.groups) {
  console.log(
    `  • ${g.name}  [${g.confidence}]  ${g.relevantPageCount} relevant / ${g.totalPageCount} total page(s), ${g.files.length} file(s)` +
      (g.flags.length ? `\n      flags: ${g.flags.join("; ")}` : ""),
  );
}
console.log(`\nUnplaced (no house type — pack-level): ${result.unplacedFiles.length} file(s)`);
if (result.unplacedFiles.length)
  for (const u of result.unplacedFiles.slice(0, 15)) console.log(`  ? ${u}`);
