import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { lowLevelQty, type ExtractionResult } from "../src/lib/extract/schema";
import { buildTakeoff, type ApexByFace, type Configuration, type TakeoffInput } from "../src/lib/takeoff/engine";
import { computeBirdcageFloor } from "../src/lib/extract/birdcage";
import { normalizeWallRoles, readPartyGables, resolveConfiguration } from "../src/lib/structure";
import { resolveFrontage } from "../src/lib/takeoff/engine";

/**
 * Attached-house validation (docs/21 §B6): read semis / terraces with the LIVE model,
 * run the engine the way production does (persist's role + frontage resolution), and
 * grade the semi / mid perimeter, apex and birdcage against Colin's House Take-Offs
 * Bank (data/pricing-data/bank.json — gitignored PII).
 *
 *   npx tsx scripts/validate-attached.mts <cacheDir> [nameFilter] [--reread]
 *
 * Each raw model read is cached in <cacheDir> (keep it OUTSIDE the repo — it is
 * client data), so re-grading after an engine change costs nothing; --reread forces a
 * fresh (billed) read. ~$0.5 a drawing.
 */

type BankRow = { builder: string; name: string; type: string | null; lm: number | string | null; gables: string | null; bcage: number | null };
const bank: BankRow[] = JSON.parse(readFileSync("data/pricing-data/bank.json", "utf8"));

const WR = "data/816125 Whitford Road, Bromsgrove - Scaffolding Enquiry - WestMids_24 02 2026(2) 2";
const TW = "data/first-ones-sent/TAYLOR WIMPEY NORTH MIDS PERRYFIELDS 2B/House_Type/Masonry";
const BL = "data/new-laura";

// Drawing ↔ bank name. Covers both drawing conventions: ONE HOUSE per sheet (TW END/MID,
// Miller) and the WHOLE PAIR on one sheet (Bloor/NSS).
const TEST: { name: string; bank: string; path: string; drawn: "one house" | "whole pair" }[] = [
  { name: "Millfield", bank: "Millfield", path: `${WR}/20. B12 Millfield Bungalow_Combined Working Drawings.pdf`, drawn: "one house" },
  { name: "Delmont", bank: "Delmont", path: `${WR}/25. L255_Delmont_Combined Working Drawings.pdf`, drawn: "one house" },
  { name: "Denton", bank: "Denton", path: `${WR}/11. 250814 Denton (L356).pdf`, drawn: "one house" },
  { name: "Avonsford END", bank: "Avonsford", path: `${TW}/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford END - 2021.pdf`, drawn: "one house" },
  { name: "Avonsford MID", bank: "Avonsford", path: `${TW}/EMA21_Avonsford/00_House_Type_PDF/EMA21-Avonsford MID - 2021.pdf`, drawn: "one house" },
  { name: "Brambleford END", bank: "Brambleford", path: `${TW}/EMA32_Brambleford/00_House_Type_PDF/EMA32-Brambleford END - 2021.pdf`, drawn: "one house" },
  { name: "Harrton", bank: "Harrton", path: `${TW}/EMB31_Harrton/00_House_Type_PDF/EMB31-Harrton - 2021.pdf`, drawn: "one house" },
  { name: "Eynsford", bank: "Eynsford", path: `${TW}/EMA33_Eynsford/00_House_Type_PDF/EMA33-Eynsford - 2021.pdf`, drawn: "one house" },
  { name: "Dekker", bank: "Dekker", path: "colin-data/NSS.277_DEKKER_ISSUE_8.pdf", drawn: "whole pair" },
  { name: "Sinclair", bank: "Sinclair", path: `${BL}/2B4P_SINCLAIR_ISSUE_4.3.pdf`, drawn: "whole pair" },
  { name: "Sorley", bank: "Sorley", path: `${BL}/3B5P_SORLEY_ISSUE_4.3.pdf`, drawn: "whole pair" },
  { name: "Byron", bank: "Byron", path: `${BL}/372_BYRON_ISSUE_4.13.pdf`, drawn: "whole pair" },
];

// Colin's handwritten Dekker sheet (colin-data) — not in the bank.
const EXTRA: Record<string, { semi: number; mid: number; bc: number; apex: string }> = {
  Dekker: { semi: 20.5, mid: 10.6, bc: 35.6, apex: "1" },
};

const [, , cacheDir, filterArg, flag] = process.argv;
if (!cacheDir) {
  console.error("usage: validate-attached.mts <cacheDir> [nameFilter] [--reread]");
  process.exit(1);
}
mkdirSync(cacheDir, { recursive: true });
const filter = filterArg && filterArg !== "--reread" ? filterArg.toLowerCase() : null;
const reread = flag === "--reread" || filterArg === "--reread";

const norm = (s: string) => s.toLowerCase().replace(/\b[a-z]{0,3}\d+[a-z]?\b/g, "").replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
const cfgOf = (t: string | null) => {
  const s = (t ?? "").toLowerCase();
  return s.includes("mid") ? "mid" : s.includes("end") || s.includes("semi") ? "semi" : null;
};
function truth(name: string) {
  if (EXTRA[name]) return EXTRA[name];
  const rows = bank.filter((r) => norm(r.name) === norm(name));
  const semi = rows.find((r) => cfgOf(r.type) === "semi");
  const mid = rows.find((r) => cfgOf(r.type) === "mid");
  return {
    semi: semi ? Number(semi.lm) : NaN,
    mid: mid ? Number(mid.lm) : NaN,
    bc: Number(rows.find((r) => r.bcage)?.bcage ?? NaN),
    apex: semi?.gables ?? "-",
  };
}

/** The engine input exactly as production builds it (persist → fromStored). */
function toInput(d: ExtractionResult, config: Configuration): TakeoffInput {
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const e of d.elevations) apexByFace[e.face] += e.apexCount ?? 0;
  const floors = d.floorAreas
    .map((f) => ({ level: f.level, r: computeBirdcageFloor({ rectangles: f.rectangles, readConfidence: f.confidence }) }))
    .filter((x) => x.r.m2 !== null);
  const gf = floors.find((f) => f.level === "GF")?.r;
  const widths = gf ? gf.rectangles.map((x) => x.widthM ?? 0) : [];
  const roles = normalizeWallRoles(d.wallSegments);
  const frontage = resolveFrontage({
    wallSegments: roles.walls,
    dwellingsWide: d.dwellingsWide.value ?? 1,
    isApartmentBlock: d.structure.form === "APARTMENT_BLOCK",
  });
  return {
    storeys: d.storeys.value,
    roomInRoof: d.roomInRoof.value === true,
    heightToSoffitM: d.heightToSoffitM.value,
    roofType: d.roof.overallType,
    wallSegments: roles.walls.map((w) => ({ position: w.position, lengthM: w.lengthM, isPartyWall: w.isPartyWall ?? null })),
    dwellingsWide: frontage.divisor,
    isApartmentBlock: d.structure.form === "APARTMENT_BLOCK",
    cornerCount: d.cornerCount.value,
    apexByFace,
    renderSegmentsM: [],
    floors: floors.map((f) => ({ level: f.level as "GF", m2: f.r.m2 as number })),
    lowLevelCount: lowLevelQty(d.lowLevel) ?? 0,
    chimney: false,
    config,
    houseInternalWidthM: widths.length ? Math.max(...widths) : null,
    houseInternalWidthSingleRect: widths.length === 1,
    houseWallThicknessM: (() => {
      const r = gf?.rectangles[0];
      if (!r || r.wallSource === "legend") return null;
      const mm = r.wallWidthAMm ?? r.wallDepthAMm;
      return mm ? mm / 1000 : null;
    })(),
  };
}

const pct = (a: number, b: number) => (Number.isFinite(b) && b > 0 ? `${a >= b ? "+" : ""}${(((a - b) / b) * 100).toFixed(1)}%` : "  n/a");
let spent = 0;
const summary: string[] = [];
for (const t of TEST) {
  if (filter && !t.name.toLowerCase().includes(filter)) continue;
  if (!existsSync(t.path)) {
    console.log(`\n!! missing ${t.path}`);
    continue;
  }
  const cache = `${cacheDir}/${t.name.replace(/\W+/g, "_")}.json`;
  let d: ExtractionResult;
  if (existsSync(cache) && !reread) {
    d = JSON.parse(readFileSync(cache, "utf8")).data;
  } else {
    const r = await extractDrawing(readFileSync(t.path));
    spent += r.meta.costUsd;
    writeFileSync(cache, JSON.stringify({ meta: r.meta, data: r.data }, null, 1));
    d = r.data;
  }
  const tr = truth(t.bank);
  const semi = buildTakeoff(toInput(d, "SEMI_DETACHED"));
  const mid = buildTakeoff(toInput(d, "MID_TERRACE"));
  const roles = normalizeWallRoles(d.wallSegments);
  const fr = semi.perimeter.frontage;
  const cfg = resolveConfiguration(d.structure.form, d.structure.confidence, readPartyGables(roles.walls), fr.blockDrawn);
  const bc = semi.birdcage.floors[0]?.m2 ?? NaN;
  console.log(`\n=== ${t.name}  (sheet draws: ${t.drawn}) ===`);
  console.log(`structure ${d.structure.form} [${d.structure.confidence}]  dwellingsWide ${d.dwellingsWide.value} → divisor ${fr.divisor} (${fr.basis})  config ${cfg.config}${cfg.certain ? "" : " (uncertain)"} via ${cfg.basis}`);
  console.log(`frontageReason: ${d.frontageReason ?? "-"}`);
  console.log(`walls: ${roles.walls.map((w) => `${w.position}=${w.lengthM}${w.isPartyWall === true ? "[P]" : w.isPartyWall === false ? "" : "[?]"}`).join("  ")}${roles.swapped ? "   ← roles renamed" : ""}`);
  console.log(`apex per face: ${d.elevations.map((e) => `${e.face}=${e.apexCount}`).join(" ")}`);
  console.log(`SEMI ${semi.perimeter.perLiftM} vs ${tr.semi} (${pct(semi.perimeter.perLiftM, tr.semi)})  apex ${semi.apex.count} vs ${tr.apex}`);
  console.log(`MID  ${mid.perimeter.perLiftM} vs ${tr.mid} (${pct(mid.perimeter.perLiftM, tr.mid)})  apex ${mid.apex.count}`);
  console.log(`birdcage/floor ${bc} vs ${tr.bc} (${pct(bc, tr.bc)})`);
  for (const f of semi.flags) console.log(`  ⚑ ${f}`);
  summary.push(
    `${t.name.padEnd(16)} ${t.drawn.padEnd(10)} dw ${String(d.dwellingsWide.value).padEnd(2)}→${fr.divisor}  semi ${String(semi.perimeter.perLiftM).padStart(6)} / ${String(tr.semi).padEnd(4)} ${pct(semi.perimeter.perLiftM, tr.semi).padStart(6)}   mid ${String(mid.perimeter.perLiftM).padStart(6)} / ${String(tr.mid).padEnd(4)} ${pct(mid.perimeter.perLiftM, tr.mid).padStart(6)}   bc ${String(bc).padStart(6)} / ${String(tr.bc).padEnd(5)} ${pct(bc, tr.bc).padStart(6)}   apex ${semi.apex.count}/${tr.apex}`,
  );
}
console.log(`\n${"=".repeat(120)}\nSUMMARY (semi / mid LM per lift, birdcage m²/floor, apex — engine vs Colin)\n${summary.join("\n")}`);
if (spent) console.log(`\nmodel spend this run: $${spent.toFixed(2)}`);
