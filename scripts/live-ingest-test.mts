/**
 * LIVE test of the AI ingest features (docs/17) against real folders — makes REAL
 * Anthropic API calls (loads .env.local). No DB / no Storage / no browser.
 *
 *   npx tsx scripts/live-ingest-test.mts
 *
 * Tests: F2 recipe inference (+ compile + group) on each builder; F3 answer-key
 * reading + cross-check (Bloor take-off sheet); F4 relevance triage on a batch.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { parsePath, RELEVANT_KINDS } from "../src/lib/ingest/parsePath";
import { buildManifest } from "../src/lib/ingest/manifest";
import { inferRecipe } from "../src/lib/ingest/inferRecipe";
import { compileRecipe } from "../src/lib/ingest/recipe";
import { groupPack, type IngestFile } from "../src/lib/ingest/group";
import { extractHouseTypeList, crossCheckHouseTypes } from "../src/lib/ingest/answerKey";
import { triageRelevance, type TriageItem } from "../src/lib/ingest/relevanceTriage";

const ROOT = "data/first-ones-sent";

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

async function testBuilder(folder: string) {
  const root = join(ROOT, folder);
  const packName = basename(root);
  const pdfs = walk(root);
  const files: IngestFile[] = pdfs.map((full, i) => {
    const rp = `${packName}/${relative(root, full)}`;
    return {
      documentId: `d${i}`,
      relativePath: rp,
      pages: [{ page: 1, relevant: RELEVANT_KINDS.has(parsePath(rp).drawingKind) }],
    };
  });

  console.log(`\n${"═".repeat(70)}\n${packName}  (${pdfs.length} PDFs)\n${"═".repeat(70)}`);
  const manifest = buildManifest(files.map((f) => ({ relativePath: f.relativePath })));

  const t0 = Date.now();
  const { recipe, costUsd } = await inferRecipe(manifest);
  console.log(
    `F2 recipe (${Date.now() - t0}ms, $${costUsd.toFixed(4)}): strategy=${recipe.strategy}` +
      ` conf=${recipe.confidence}` +
      (recipe.folderMarker ? ` folderMarker="${recipe.folderMarker}"` : "") +
      (recipe.combinedPdfFolder ? ` combinedPdfFolder="${recipe.combinedPdfFolder}"` : ""),
  );
  console.log(`   reasoning: ${recipe.reasoning}`);
  console.log(`   junkFolders: [${recipe.junkFolderKeywords.slice(0, 8).join(", ")}]`);
  console.log(`   AI saw ${recipe.houseTypeNames.length} house types: ${recipe.houseTypeNames.slice(0, 20).join(", ")}`);

  const result = groupPack(files, compileRecipe(recipe));
  console.log(`   → grouped ${result.groups.length} house types: ${result.groups.map((g) => g.name).slice(0, 20).join(", ")}`);
  console.log(`   → ${result.unplacedFiles.length} pack-level file(s) unplaced`);
  return result.groups.map((g) => g.name);
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("No ANTHROPIC_API_KEY in .env.local");
    process.exit(1);
  }
  console.log(`Model: ${process.env.ANTHROPIC_GROUPING_MODEL ?? process.env.ANTHROPIC_EXTRACTION_MODEL ?? "claude-opus-4-8"}`);

  const bloorGrouped = await testBuilder("BLOOR OADBY PH2A");
  await testBuilder("VISTRY SOUTH EAST MIDLANDS TOP WIGHAY");
  await testBuilder("TILIA HAWKESBURY");
  await testBuilder("TAYLOR WIMPEY NORTH MIDS PERRYFIELDS 2B");

  // F3 — answer-key: read Bloor's take-off sheet + cross-check.
  console.log(`\n${"═".repeat(70)}\nF3 · Answer-key cross-check (Bloor take-off sheet)\n${"═".repeat(70)}`);
  try {
    const akPath = join(ROOT, "BLOOR OADBY PH2A", "BLOOR OADBY PH2A TAKE OFFS.pdf");
    const names = await extractHouseTypeList(readFileSync(akPath));
    console.log(`Sheet lists ${names.length} house types: ${names.join(", ")}`);
    const cc = crossCheckHouseTypes(bloorGrouped, names);
    console.log(`Cross-check: ${cc.matched.length}/${cc.expected.length} matched · missing=[${cc.missing.join(", ")}] · extra=[${cc.extra.join(", ")}]`);
  } catch (e) {
    console.error("F3 failed:", e instanceof Error ? e.message : e);
  }

  // F4 — relevance triage on a batch of mixed pages.
  console.log(`\n${"═".repeat(70)}\nF4 · Relevance triage (batch)\n${"═".repeat(70)}`);
  const items: TriageItem[] = [
    { key: "1", title: "Front Elevation", fileName: "CROMFORD-201-03 Front Elevation.pdf", folder: "Housetypes 1" },
    { key: "2", title: "Ground Floor M+E Services Layout", fileName: "CROMFORD-203-01 M+E.pdf", folder: "Housetypes 1" },
    { key: "3", title: "External Wall Elevation", fileName: "TYPE-A external wall.pdf", folder: "Drawings" },
    { key: "4", title: "Kitchen Layout", fileName: "91_KITCHEN LAYOUT.pdf", folder: "Apartment A" },
    { key: "5", title: "Setting-out Plan", fileName: "CROMFORD-202-01 Setting-out.pdf", folder: "Housetypes 1" },
    { key: "6", title: "SAP Calculation", fileName: "EMA21 End SAP.pdf", folder: "08_SAP" },
  ];
  try {
    const verdicts = await triageRelevance(items);
    for (const it of items) {
      const v = verdicts.get(it.key);
      console.log(`  "${it.title}" → ${v ? (v.relevant ? "RELEVANT" : "not relevant") : "(no verdict)"}${v ? ` (${v.drawingType})` : ""}`);
    }
  } catch (e) {
    console.error("F4 failed:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
