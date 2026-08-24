import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync } from "node:fs";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import type { ExtractionResult } from "../src/lib/extract/schema";
import {
  buildTakeoff,
  type ApexByFace,
  type Configuration,
  type TakeoffInput,
} from "../src/lib/takeoff/engine";
import { computeBirdcageFloor } from "../src/lib/extract/birdcage";
import { makeDimensionVerifier } from "../src/lib/extract/dimensions";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Shared birdcage resolve for the offline runner (same engine as production). */
function birdcageM2(
  f: ExtractionResult["floorAreas"][number],
  dwellingsWide: number,
) {
  return computeBirdcageFloor(
    {
      statedGrossInternalM2: f.statedGrossInternalM2,
      statedNdssM2: f.statedNdssM2 ?? null,
      rectangles: f.rectangles,
      readConfidence: f.confidence,
    },
    dwellingsWide,
  );
}

function toEngineInput(d: ExtractionResult, config: Configuration): TakeoffInput {
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const e of d.elevations) {
    const face = e.face; // front | rear | left | right | other
    apexByFace[face] += e.apexCount ?? 0;
  }
  const renderSegmentsM = d.elevations
    .filter((e) => e.rendered === true)
    .map((e) => e.renderLengthM ?? null)
    .filter((x): x is number => x !== null);
  const dwellingsWide =
    d.dwellingsWide.value !== null && d.dwellingsWide.value >= 1 ? d.dwellingsWide.value : 1;
  const floors = d.floorAreas
    .map((f) => {
      const m2 = birdcageM2(f, dwellingsWide).m2;
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
    lowLevelCount: (d.lowLevel.porchCount ?? 0) + (d.lowLevel.bayCount ?? 0),
    chimney: d.chimney.value === true,
    config,
  };
}

async function run(path: string, configs: Configuration[]) {
  const buf = readFileSync(path);
  console.log(`\n${"=".repeat(78)}\n${path}  (${(buf.length / 1e6).toFixed(1)} MB)\n${"=".repeat(78)}`);
  const { data, meta, dimensions } = await extractDrawing(buf);
  console.log(
    `model=${meta.model}  ${(meta.latencyMs / 1000).toFixed(1)}s  in=${meta.inputTokens} out=${meta.outputTokens}  $${meta.costUsd.toFixed(3)}`,
  );
  const tokenCount = dimensions.reduce((a, p) => a + p.tokens.length, 0);
  console.log(
    `text-layer: ${dimensions.filter((p) => p.tokens.length).length}/${dimensions.length} pages carry dims, ${tokenCount} candidate numbers fed to the model`,
  );
  console.log("\n--- EXTRACTED (observables) ---");
  console.log(
    `house: ${data.houseType.name} (${data.houseType.code ?? "-"})  build: ${data.buildType.value ?? "-"}`,
  );
  console.log(
    `structure: ${data.structure.form}  storeys: ${data.storeys.value} [${data.storeys.confidence}]  roomInRoof: ${data.roomInRoof.value}  height: ${data.heightToSoffitM.value} m [${data.heightToSoffitM.confidence}]  roof: ${data.roof.overallType}`,
  );
  console.log(
    `corners: ${data.cornerCount.value}  dwellingsWide: ${data.dwellingsWide.value}  chimney: ${data.chimney.value}  lowLevel: porch=${data.lowLevel.porchCount} bay=${data.lowLevel.bayCount}  smartRoofPeak: ${data.smartRoofPeakHeightM.value}`,
  );
  console.log("elevations:");
  for (const e of data.elevations)
    console.log(`  ${e.face}: apex=${e.apexCount} rendered=${e.rendered} renderLM=${e.renderLengthM ?? "-"} [${e.confidence}]`);
  console.log("wall segments (building line):");
  for (const w of data.wallSegments)
    console.log(`  ${w.position}: ${w.lengthM} m (dim ${w.sourceDimension ?? "-"}) [${w.confidence}]`);
  console.log("floor areas (internal → birdcage):");
  {
    const dw =
      data.dwellingsWide.value !== null && data.dwellingsWide.value >= 1
        ? data.dwellingsWide.value
        : 1;
    for (const f of data.floorAreas) {
      const r = birdcageM2(f, dw);
      console.log(`  ${f.level}: ${r.m2 ?? "-"} m² [${r.confidence}] (${r.source}) — ${r.note}`);
    }
  }
  // Point 3: verify each cited sourceDimension against the text layer.
  const verify = makeDimensionVerifier(dimensions);
  const bad: string[] = [];
  if (data.heightToSoffitM.sourceDimension && !verify(data.heightToSoffitM.sourceDimension, data.heightToSoffitM.sourcePage))
    bad.push(`height "${data.heightToSoffitM.sourceDimension}"`);
  for (const w of data.wallSegments)
    if (w.sourceDimension && !verify(w.sourceDimension, w.sourcePage))
      bad.push(`${w.position} "${w.sourceDimension}"`);
  for (const f of data.floorAreas)
    for (const r of f.rectangles ?? [])
      if (r.sourceDimension && !verify(r.sourceDimension, r.sourcePage))
        bad.push(`birdcage ${f.level} "${r.sourceDimension}"`);
  console.log(
    bad.length
      ? `dimension check: ⚠ ${bad.length} cited value(s) NOT in the text layer → ${bad.join(", ")}`
      : `dimension check: ✓ all cited dimensions verified against the text layer`,
  );

  if (data.notes) console.log(`notes: ${data.notes}`);

  console.log("\n--- COMPUTED TAKE-OFF (engine) ---");
  const effectiveConfigs =
    data.structure.form === "APARTMENT_BLOCK" ? (["DETACHED"] as Configuration[]) : configs;
  for (const cfg of effectiveConfigs) {
    const line = buildTakeoff(toEngineInput(data, cfg));
    const label = data.structure.form === "APARTMENT_BLOCK" ? "WHOLE BLOCK" : cfg;
    console.log(`  [${label}] ${line.text}`);
    console.log(`     lifts basis=${line.lifts.basis} height=${line.lifts.heightLifts} storey=${line.lifts.storeyLifts}  perimeter total=${line.perimeter.totalM}`);
    for (const f of line.flags) console.log(`     ⚠ ${f}`);
  }
}

const targets: Record<string, Configuration[]> = {
  "colin-data/NSS.277_DEKKER_ISSUE_8.pdf": ["SEMI_DETACHED", "MID_TERRACE"],
  "colin-data/3068-IDP-ROSEWOOD_DET_AS-DR-A-0000 - Working Drawing RVT - 01-1_Ver1.pdf": ["DETACHED"],
  "colin-data/NSS.922_AUGUSTA_ISSUE_7.pdf": ["DETACHED"],
  "colin-data/VM0303.NSS.M2BB3P_TYARD_ISSUE_7.3.pdf": ["SEMI_DETACHED", "MID_TERRACE"],
};

const only = process.argv[2];
const entries = only
  ? Object.entries(targets).filter(([p]) => p.includes(only))
  : Object.entries(targets);

for (const [path, configs] of entries) {
  try {
    await run(path, configs);
  } catch (e) {
    console.error(`FAILED ${path}:`, e instanceof Error ? e.message : e);
  }
}
