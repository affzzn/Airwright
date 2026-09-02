/**
 * Golden-set model comparison. For each known house type, runs the FULL pipeline
 * (extract → corners / birdcage / perimeter → computed take-off + C12/C13 shape
 * checks) through EVERY configured model, and scores each against the known
 * answer. Read-only; makes real API calls. Usage:
 *   npx tsx scripts/golden-test.mts            # all houses
 *   npx tsx scripts/golden-test.mts hallam     # filter by name
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync, writeFileSync } from "node:fs";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { lowLevelQty, type ExtractionResult } from "../src/lib/extract/schema";
import { EXTRACTION_MODELS } from "../src/lib/extract/providers/catalog";
import {
  buildTakeoff,
  type ApexByFace,
  type Configuration,
  type TakeoffInput,
} from "../src/lib/takeoff/engine";
import {
  computeBirdcageFloor,
  cornerBirdcageWarning,
  pairBirdcageWidthWarning,
} from "../src/lib/extract/birdcage";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Golden houses + the config to price + the known answers to score against. */
interface Golden {
  name: string;
  path: string;
  config: Configuration;
  expect: {
    structure: string;
    dwellingsWide: number;
    corners?: number;
    perHouseWidthM?: number; // one house's birdcage width
    birdcageGfM2?: number; // one house's GF birdcage
  };
}
const HOUSES: Golden[] = [
  { name: "Hallam (detached, stepped front)", path: "data/new-laura/470_HALLAM_ISSUE_4.8.pdf", config: "DETACHED",
    expect: { structure: "DETACHED", dwellingsWide: 1, corners: 5, birdcageGfM2: 51.71 } },
  { name: "Kilburn (semi, plain)", path: "data/new-laura/386_KILBURN_ISSUE_4.12.pdf", config: "SEMI_DETACHED",
    expect: { structure: "PAIR_SEMI", dwellingsWide: 2, corners: 4, perHouseWidthM: 4.8, birdcageGfM2: 40.99 } },
  { name: "Sinclair (semi, plain)", path: "data/new-laura/2B4P_SINCLAIR_ISSUE_4.3.pdf", config: "SEMI_DETACHED",
    expect: { structure: "PAIR_SEMI", dwellingsWide: 2, corners: 4, perHouseWidthM: 4.25, birdcageGfM2: 34.65 } },
  { name: "SM1 (semi, shared core)", path: "/private/tmp/claude-501/-Users-affanimran-Desktop-InnateAI-Airwright-Airwright-production/5e31d50e-a02c-4ca6-b2e7-5f99a5250909/scratchpad/SM1_combined.pdf", config: "SEMI_DETACHED",
    expect: { structure: "PAIR_SEMI", dwellingsWide: 2, perHouseWidthM: 6.873 } },
  { name: "Dekker (semi)", path: "colin-data/NSS.277_DEKKER_ISSUE_8.pdf", config: "SEMI_DETACHED",
    expect: { structure: "PAIR_SEMI", dwellingsWide: 2, birdcageGfM2: 35.6 } },
  { name: "Rosewood (detached bungalow)", path: "colin-data/3068-IDP-ROSEWOOD_DET_AS-DR-A-0000 - Working Drawing RVT - 01-1_Ver1.pdf", config: "DETACHED",
    expect: { structure: "DETACHED", dwellingsWide: 1 } },
];

function toEngineInput(d: ExtractionResult, config: Configuration): TakeoffInput {
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const e of d.elevations) apexByFace[e.face] += e.apexCount ?? 0;
  const renderSegmentsM = d.elevations
    .filter((e) => e.rendered === true)
    .map((e) => e.renderLengthM ?? null)
    .filter((x): x is number => x !== null);
  const dwellingsWide = d.dwellingsWide.value !== null && d.dwellingsWide.value >= 1 ? d.dwellingsWide.value : 1;
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
  };
}

const out: string[] = [];
const log = (s = "") => {
  out.push(s);
  console.log(s);
};

/** Per-house summary rows: [house, model, structure✓, corners✓, width✓, notes]. */
const summary: string[][] = [];

async function runHouse(h: Golden) {
  log("\n" + "#".repeat(90));
  log(`# ${h.name}   [config ${h.config}]   expect: ${JSON.stringify(h.expect)}`);
  log("#".repeat(90));
  const buf = readFileSync(h.path);

  const MODELS = process.env.ONLY_MODEL ? EXTRACTION_MODELS.filter((mm) => mm.key.includes(process.env.ONLY_MODEL)) : EXTRACTION_MODELS;
  for (const m of MODELS) {
    log("\n" + "-".repeat(90));
    log(`${m.label}   [${m.apiModelId}]`);
    log("-".repeat(90));
    try {
      const { data, meta } = await extractDrawing(buf, m.key);
      log(`  ${(meta.latencyMs / 1000).toFixed(1)}s  in=${meta.inputTokens} out=${meta.outputTokens}  ~$${meta.costUsd.toFixed(3)}`);
      // --- Observables ---
      log(`  structure=${data.structure.form}  dwellingsWide=${data.dwellingsWide.value}  storeys=${data.storeys.value}  height=${data.heightToSoffitM.value}m  roof=${data.roof.overallType}  chimney=${data.chimney.value}  lowLevel=${lowLevelQty(data.lowLevel) ?? "-"}`);
      log(`  corners=${data.cornerCount.value}${data.cornerReason ? `  (${data.cornerReason})` : ""}`);
      log(`  apex/face: ${data.elevations.map((e) => `${e.face}=${e.apexCount}`).join(" ")}`);
      log(`  walls: ${data.wallSegments.map((w) => `${w.position}=${w.lengthM}`).join(" ")}`);
      // --- Birdcage per floor (deterministic) ---
      for (const f of data.floorAreas) {
        const r = computeBirdcageFloor({ rectangles: f.rectangles, readConfidence: f.confidence });
        const rects = (f.rectangles ?? []).map((rc) => `${rc.internalWidthM ?? `(${rc.overallWidthM}−w)`}×${rc.internalDepthM ?? `(${rc.overallDepthM}−w)`}`).join(" + ");
        log(`  birdcage ${f.level}: ${r.m2 ?? "-"} m² [${r.confidence}]  tiles: ${rects || "(none)"}`);
      }
      const maxW = data.floorAreas.reduce((mx, f) => (f.rectangles ?? []).reduce((m, r) => Math.max(m, r.internalWidthM ?? r.overallWidthM ?? 0), mx), 0);
      const frontM = round3(data.wallSegments.filter((w) => w.position === "front").reduce((a, w) => a + w.lengthM, 0));
      const maxRects = data.floorAreas.reduce((m, f) => Math.max(m, (f.rectangles ?? []).length), 0);
      // --- Shape checks ---
      log(`  C12 corner↔shape: ${cornerBirdcageWarning(data.cornerCount.value, maxRects) ?? "✓"}`);
      log(`  C13 pair-width:   ${pairBirdcageWidthWarning(data.dwellingsWide.value, frontM, maxW) ?? "✓"}`);
      // --- Computed take-off ---
      const line = buildTakeoff(toEngineInput(data, h.config));
      log(`  TAKE-OFF: ${line.text}`);
      log(`    perimeter/lift=${line.perimeter.perLiftM}m ×${line.lifts.lifts}lifts=${line.perimeter.totalM}m  corners=${line.perimeter.corners}  birdcage/floor=${line.birdcage.totalM2}m² ×${line.birdcage.floorCount}  apex=${line.apex.count}`);
      // --- Scorecard ---
      const gfM2 = (() => { const gf = data.floorAreas.find((f) => f.level === "GF"); return gf ? computeBirdcageFloor({ rectangles: gf.rectangles, readConfidence: gf.confidence }).m2 : null; })();
      const okStruct = data.structure.form === h.expect.structure && data.dwellingsWide.value === h.expect.dwellingsWide;
      const okCorners = h.expect.corners == null ? "—" : data.cornerCount.value === h.expect.corners ? "✓" : `✗(${data.cornerCount.value})`;
      const okWidth = h.expect.perHouseWidthM == null ? "—" : Math.abs(maxW - h.expect.perHouseWidthM) <= 0.06 ? "✓" : `✗(${round2(maxW)})`;
      const okGf = h.expect.birdcageGfM2 == null || gfM2 == null ? "—" : Math.abs(gfM2 - h.expect.birdcageGfM2) / h.expect.birdcageGfM2 <= 0.04 ? "✓" : `✗(${round2(gfM2)})`;
      summary.push([h.name.split(" ")[0], m.label.split("·")[1].trim(), okStruct ? "✓" : "✗", String(okCorners), String(okWidth), String(okGf)]);
    } catch (err) {
      log(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
      summary.push([h.name.split(" ")[0], m.label.split("·")[1].trim(), "ERR", "ERR", "ERR", "ERR"]);
    }
  }
}

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const houses = filter ? HOUSES.filter((h) => h.name.toLowerCase().includes(filter)) : HOUSES;
  for (const h of houses) {
    try { await runHouse(h); } catch (e) { log(`\n!! could not run ${h.name}: ${e instanceof Error ? e.message : e}`); }
  }
  // Final scorecard
  log("\n" + "=".repeat(90));
  log("SCORECARD  (structure / corners / per-house width / GF birdcage)");
  log("=".repeat(90));
  log(["House", "Model", "Struct", "Corners", "Width", "GF m²"].map((c, i) => c.padEnd(i === 0 ? 12 : i === 1 ? 18 : 9)).join(""));
  for (const r of summary) log(r.map((c, i) => c.padEnd(i === 0 ? 12 : i === 1 ? 18 : 9)).join(""));
  writeFileSync("/private/tmp/claude-501/-Users-affanimran-Desktop-InnateAI-Airwright-Airwright-production/5e31d50e-a02c-4ca6-b2e7-5f99a5250909/scratchpad/golden-results.txt", out.join("\n"));
  log("\n(full log written to /private/tmp/claude-501/-Users-affanimran-Desktop-InnateAI-Airwright-Airwright-production/5e31d50e-a02c-4ca6-b2e7-5f99a5250909/scratchpad/golden-results.txt)");
}

main().catch((e) => { console.error(e); process.exit(1); });
