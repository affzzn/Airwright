import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { readFileSync } from "node:fs";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { lowLevelQty, type ExtractionResult } from "../src/lib/extract/schema";
import {
  buildTakeoff,
  type ApexByFace,
  type Configuration,
  type TakeoffInput,
} from "../src/lib/takeoff/engine";
import { computeBirdcageFloor } from "../src/lib/extract/birdcage";

/**
 * Step 1 validation: grade our extraction + engine against Colin's House Take-Offs
 * Bank (his real LM / birdcage / gables / low-levels per house type × config).
 * Rate-independent — this checks the take-off QUANTITIES, the foundation pricing
 * sits on. Bank data: data/pricing-data/bank.json (gitignored PII).
 *
 *   npx tsx scripts/validate-against-bank.mts [nameFilter]
 */

type BankRow = {
  builder: string; name: string; type: string | null; storey: number | null;
  lm: number | null; gables: string | null; low: number | null; bcage: number | null;
};
const bank: BankRow[] = JSON.parse(readFileSync("data/pricing-data/bank.json", "utf8"));

const DIR = "data/816125 Whitford Road, Bromsgrove - Scaffolding Enquiry - WestMids_24 02 2026(2) 2";

// Drawings we have ↔ their bank name + the configs to grade.
const TEST: { path: string; name: string; configs: Configuration[] }[] = [
  { path: `${DIR}/32. L464_Chesterwood_Combined Working Drawings.pdf`, name: "Chesterwood", configs: ["DETACHED"] },
  { path: `${DIR}/29. L363_Hampton_Combined Working Drawings Rev A.pdf`, name: "Hampton", configs: ["DETACHED"] },
  { path: `${DIR}/28. L361_Braxton_Combined Working Drawings Rev A.pdf`, name: "Braxton", configs: ["DETACHED"] },
  { path: `${DIR}/25. L255_Delmont_Combined Working Drawings.pdf`, name: "Delmont", configs: ["SEMI_DETACHED", "MID_TERRACE"] },
];

const filter = process.argv[2]?.toLowerCase();

/** Strip house-type codes (L464, AL30, B12…) and non-letters → the plain name. */
const normName = (s: string) =>
  s.toLowerCase().replace(/\b[a-z]{0,3}\d+[a-z]?\b/g, "").replace(/[^a-z]/g, "");
const normConfig = (t: string | null): Configuration | null => {
  const s = (t ?? "").toLowerCase();
  if (s.includes("mid")) return "MID_TERRACE";
  if (s.includes("end")) return "END_TERRACE";
  if (s.includes("semi")) return "SEMI_DETACHED";
  if (s.includes("det") || s.includes("bungalow") || s.includes("mais")) return "DETACHED";
  return null;
};

function bankLookup(name: string, config: Configuration): BankRow[] {
  const n = normName(name);
  return bank.filter((r) => normName(r.name) === n && normConfig(r.type) === config);
}

/** Raw extraction → engine input (mirrors scripts/offline-extract.mts). */
function toEngineInput(d: ExtractionResult, config: Configuration): TakeoffInput {
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const e of d.elevations) apexByFace[e.face] += e.apexCount ?? 0;
  const dwellingsWide =
    d.dwellingsWide.value !== null && d.dwellingsWide.value >= 1 ? d.dwellingsWide.value : 1;
  const floors = d.floorAreas
    .map((f) => {
      const m2 = computeBirdcageFloor(
        { statedGrossInternalM2: f.statedGrossInternalM2, statedNdssM2: f.statedNdssM2 ?? null, rectangles: f.rectangles, readConfidence: f.confidence },
        dwellingsWide,
      ).m2;
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
    renderSegmentsM: d.elevations.filter((e) => e.rendered === true).map((e) => e.renderLengthM ?? 0).filter((x) => x > 0),
    floors,
    lowLevelCount: lowLevelQty(d.lowLevel) ?? 0,
    chimney: d.chimney.value === true,
    config,
  };
}

const within = (a: number, b: number, pct: number) => (b === 0 ? a === 0 : Math.abs(a - b) / b <= pct);
const gablesBank = (g: string | null): number | null => {
  if (g == null) return null;
  if (/hip/i.test(g)) return 0;
  const n = Number(g);
  return Number.isFinite(n) ? n : null;
};

let pass = 0, total = 0;
const line = (ok: boolean, s: string) => `${ok ? "✓" : "✗"} ${s}`;

async function main() {
  for (const t of TEST) {
    if (filter && !t.name.toLowerCase().includes(filter)) continue;
    console.log(`\n${"=".repeat(76)}\n${t.name}\n${"=".repeat(76)}`);
    const buf = readFileSync(t.path);
    const { data, meta } = await extractDrawing(buf);
    console.log(`  extracted in ${(meta.latencyMs / 1000).toFixed(1)}s  $${meta.costUsd.toFixed(3)}`);
    for (const config of t.configs) {
      const input = toEngineInput(data, config);
      const L = buildTakeoff(input);
      const ourLM = L.perimeter.perLiftM;
      const ourWalls = L.perimeter.wallsM;
      const ourBc = L.birdcage.floors[0]?.m2 ?? null;
      const ourG = L.apex.count;
      const ourLow = L.lowLevel;
      const rows = bankLookup(t.name, config);
      console.log(`\n  [${config}]  ours: LM=${ourLM} (walls ${ourWalls}) · bcage=${ourBc} · gables=${ourG} · low=${ourLow}`);
      if (rows.length === 0) { console.log("    (no bank row)"); continue; }
      for (const b of rows) {
        const bg = gablesBank(b.gables);
        const cLM = b.lm != null && within(ourLM, b.lm, 0.1);
        const cBc = b.bcage != null && ourBc != null && within(ourBc, b.bcage, 0.1);
        const cG = bg != null && ourG === bg;
        const cLow = b.low != null && ourLow === b.low;
        for (const [ok] of [[cLM],[cBc],[cG],[cLow]]) { total++; if (ok) pass++; }
        console.log(`    bank(${b.builder}): LM=${b.lm} bcage=${b.bcage} gables=${b.gables} low=${b.low}`);
        console.log(`      ${line(cLM,`LM ${ourLM} vs ${b.lm}`)}  ${line(cBc,`bcage ${ourBc} vs ${b.bcage}`)}  ${line(cG,`gables ${ourG} vs ${bg}`)}  ${line(cLow,`low ${ourLow} vs ${b.low}`)}`);
      }
    }
  }
  console.log(`\n${"=".repeat(76)}\nOVERALL: ${pass}/${total} field checks passed (${total ? ((100*pass)/total).toFixed(0) : 0}%)`);
}
main().catch(console.error);
