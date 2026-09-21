import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { lowLevelQty, type ExtractionResult } from "../src/lib/extract/schema";
import {
  buildTakeoff,
  type ApexByFace,
  type BuildSystem,
  type Configuration,
  type TakeoffInput,
} from "../src/lib/takeoff/engine";
import { computeBirdcageFloor } from "../src/lib/extract/birdcage";

/**
 * One-off: run a house type's drawings through the extractor + the TIMBER-FRAME
 * take-off engine, and print the numbers to compare against Colin's handwritten
 * answer sheet. Usage:
 *   npx tsx scripts/tf-extract.mts "<folder of PDFs>" DETACHED SEMI_DETACHED
 */

function toEngineInput(
  d: ExtractionResult,
  config: Configuration,
  buildSystem: BuildSystem,
): TakeoffInput {
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const e of d.elevations) apexByFace[e.face] += e.apexCount ?? 0;
  const renderSegmentsM = d.elevations
    .filter((e) => e.rendered === true)
    .map((e) => e.renderLengthM ?? null)
    .filter((x): x is number => x !== null);
  const dwellingsWide =
    d.dwellingsWide.value !== null && d.dwellingsWide.value >= 1 ? d.dwellingsWide.value : 1;
  const floors = d.floorAreas
    .map((f) => {
      const m2 = computeBirdcageFloor({ rectangles: f.rectangles, readConfidence: f.confidence }).m2;
      return m2 === null ? null : { level: f.level, m2 };
    })
    .filter((x): x is { level: (typeof d.floorAreas)[number]["level"]; m2: number } => x !== null);
  return {
    storeys: d.storeys.value,
    roomInRoof: d.roomInRoof.value === true,
    heightToSoffitM: d.heightToSoffitM.value,
    roofType: d.roof.overallType,
    wallSegments: d.wallSegments.map((w) => ({ position: w.position, lengthM: w.lengthM })),
    dwellingsWide,
    isApartmentBlock: d.structure.form === "APARTMENT_BLOCK",
    cornerCount: d.cornerCount.value,
    apexByFace,
    renderSegmentsM,
    floors,
    lowLevelCount: lowLevelQty(d.lowLevel) ?? 0,
    chimney: d.chimney.value === true,
    config,
    buildSystem,
  };
}

/** Merge every PDF in a folder into one buffer (all pages, in filename order). */
async function mergeFolder(folder: string): Promise<Buffer> {
  const files = readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(readFileSync(join(folder, f)), { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
    console.log(`  + ${f} (${src.getPageCount()}p)`);
  }
  return Buffer.from(await out.save());
}

const folder = process.argv[2];
const configs = (process.argv.slice(3) as Configuration[]);
if (!folder || configs.length === 0) {
  console.error('Usage: tsx scripts/tf-extract.mts "<folder>" DETACHED SEMI_DETACHED');
  process.exit(1);
}

console.log(`Merging drawings in: ${folder}`);
const buf = await mergeFolder(folder);
console.log(`Merged ${(buf.length / 1e6).toFixed(2)} MB → extracting (timber frame)…\n`);

const { data, meta } = await extractDrawing(buf);
console.log(
  `model=${meta.model}  ${(meta.latencyMs / 1000).toFixed(1)}s  in=${meta.inputTokens} out=${meta.outputTokens}  $${meta.costUsd.toFixed(3)}`,
);
console.log(`\n--- EXTRACTED (observables) ---`);
console.log(`house: ${data.houseType.name} (${data.houseType.code ?? "-"})  build read: ${data.buildType.value ?? "-"}`);
console.log(`structure: ${data.structure.form}  storeys: ${data.storeys.value} [${data.storeys.confidence}]  roomInRoof: ${data.roomInRoof.value}  height→soffit: ${data.heightToSoffitM.value} m [${data.heightToSoffitM.confidence}]  roof: ${data.roof.overallType}`);
console.log(`corners: ${data.cornerCount.value}  dwellingsWide: ${data.dwellingsWide.value}  lowLevel: ${lowLevelQty(data.lowLevel) ?? "-"}`);
console.log(`elevations:`);
for (const e of data.elevations)
  console.log(`  ${e.face}: roof=${e.faceRoof ?? "-"} apex=${e.apexCount}${e.rendered ? " (rendered)" : ""} [${e.confidence}]`);
console.log(`wall segments:`);
for (const w of data.wallSegments)
  console.log(`  ${w.position}: ${w.lengthM} m (dim ${w.sourceDimension ?? "-"})`);

console.log(`\n--- TIMBER-FRAME TAKE-OFF (engine) ---`);
for (const cfg of configs) {
  const line = buildTakeoff(toEngineInput(data, cfg, "TIMBER_FRAME"));
  console.log(`\n  [${cfg}] ${line.text}`);
  console.log(`     lifts=${line.lifts.lifts} (basis=${line.lifts.basis}, height→${line.lifts.heightLifts}, storey→${line.lifts.storeyLifts})`);
  console.log(`     perimeter/lift=${line.perimeter.perLiftM} m  (walls ${line.perimeter.wallsM} + ${line.perimeter.corners} corners)`);
  console.log(`     apex count=${line.apex.count}  birdcage floors=${line.birdcage.floorCount}`);
  console.log(`     adaptions: inside-board=${line.adaptions?.insideBoardLM} LM  hop-up=${line.adaptions?.hopUpLM} LM  (adaptionLifts=${line.adaptions?.adaptionLifts}, apex units ${line.adaptions?.apexInsideBoardUnits}/${line.adaptions?.apexHopUpUnits})`);
  for (const f of line.flags) console.log(`     ⚠ ${f}`);
}
