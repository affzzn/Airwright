/**
 * Offline runner for the construction pack pipeline (docs/22 Step 6). Reads a
 * local enquiry folder (or zip) straight off disk — no database, no storage, no
 * queue, so it can never race the deployed worker — and prints what the system
 * makes of it:
 *
 *   npx tsx scripts/construction-offline.mts "<folder>"            register + geometry (free)
 *   npx tsx scripts/construction-offline.mts "<folder>" --ai       + the AI sheet reads + building model (costs tokens)
 *   npx tsx scripts/construction-offline.mts "<folder>" --json out.json
 *
 * Flags: --sheets (print every register row), --geometry (full geometry per sheet),
 *        --only <text> (AI: read only sheets whose title contains <text>).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { ingestPack, type PackSource } from "@/lib/construction/pack/ingest";
import { kindLabel } from "@/lib/construction/pack/register";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
if (!root) {
  console.error('usage: npx tsx scripts/construction-offline.mts "<folder>" [--ai] [--sheets] [--geometry] [--json out.json]');
  process.exit(1);
}
const flag = (f: string) => args.includes(f);
const valueOf = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

async function main() {
  const top = basename(root!);
  const paths = statSync(root!).isDirectory() ? walk(root!) : [root!];
  const sources: PackSource[] = paths.map((p, i) => ({
    id: `f${i}`,
    // Keep the pack's own folder name on the path, as a browser folder upload does.
    relativePath: statSync(root!).isDirectory() ? `${top}/${relative(root!, p)}` : basename(p),
    mimeType: null,
    sizeBytes: statSync(p).size,
    load: async () => readFileSync(p),
  }));

  const t0 = Date.now();
  const { files, register, geometry } = await ingestPack(sources);
  const ms = Date.now() - t0;

  console.log(`\n=== ${top} — ${files.length} files, ingested in ${(ms / 1000).toFixed(1)} s ===`);
  console.log(`MODE ${register.mode}: ${register.modeReason}`);
  console.log(
    "FILES: " +
      Object.entries(register.counts)
        .filter(([, n]) => n > 0)
        .map(([b, n]) => `${b} ${n}`)
        .join(" · "),
  );
  console.log(`BUILDINGS: ${register.buildings.map((b) => `${b.name}${b.code ? ` [${b.code}]` : ""}`).join(" · ") || "(none)"}`);

  const sheetsBy = (bucket: string) => register.sheets.filter((s) => s.bucket === bucket && !s.superseded);
  console.log(
    `SHEETS: CORE ${sheetsBy("CORE").length} · CONTEXT ${sheetsBy("CONTEXT").length} · REGISTER ${sheetsBy("REGISTER").length} · SCOPE ${sheetsBy("SCOPE").length} · NOT_RELEVANT ${sheetsBy("NOT_RELEVANT").length} · superseded ${register.sheets.filter((s) => s.superseded).length}`,
  );

  const pathOf = new Map(files.map((f) => [f.id, f.relativePath]));
  if (flag("--sheets")) {
    console.log("\n--- files ---");
    for (const f of register.files) console.log(`${f.bucket.padEnd(12)} ${f.relativePath}  — ${f.reason}`);
  }
  console.log("\n--- sheets read (CORE / CONTEXT) ---");
  for (const s of register.sheets.filter((x) => (x.bucket === "CORE" || x.bucket === "CONTEXT") && !x.superseded)) {
    const id = s.identity;
    const g = geometry.get(`${s.fileId}:${s.page}`);
    const bits = [
      s.bucket.padEnd(7),
      kindLabel(id.kind).padEnd(26),
      (id.level ?? id.face ?? "").padEnd(6),
      (id.drawingNo ?? "—").padEnd(32),
      (id.revision ?? "").padEnd(4),
      (id.scale ?? "no scale").padEnd(8),
      s.paper.padEnd(3),
      s.raster ? "RASTER" : s.hasText ? "vector" : "empty ",
      register.buildings.find((b) => b.key === s.buildingKey)?.name ?? "(job)",
    ];
    console.log(bits.join(" "));
    if (g) {
      const parts: string[] = [];
      if (g.levels.length) parts.push(`levels ${g.levels.map((l) => `${l.name} ${l.valueM >= 0 ? "+" : ""}${l.valueM}`).join(", ")}`);
      if (g.heights.length) parts.push(`heights ${[...new Set(g.heights.map((h) => `${h.mm} ${h.from}→${h.to}`))].join(", ")}`);
      if (g.pitchesDeg.length) parts.push(`pitch ${g.pitchesDeg.join("/")}°`);
      if (g.wallplates.length) parts.push(`wallplates ${g.wallplates.map((w) => w.raw).join(", ")}`);
      if (g.grid.vertical.length || g.grid.horizontal.length) {
        const sumV = g.grid.spacings.slice(0, Math.max(0, g.grid.vertical.length - 1));
        const measured = sumV.reduce((a, x) => a + x.measuredMm, 0);
        const printed = sumV.every((x) => x.printedMm != null) ? sumV.reduce((a, x) => a + (x.printedMm ?? 0), 0) : null;
        parts.push(
          `grid ${g.grid.vertical.map((l) => l.label).join("")} × ${g.grid.horizontal.map((l) => l.label).join("")}; ` +
            `${g.grid.vertical[0]?.label}→${g.grid.vertical.at(-1)?.label} measured ${measured} mm` +
            (printed != null ? `, printed ${printed} mm` : ` (printed: ${sumV.map((x) => x.printedMm ?? "?").join("+")})`),
        );
      }
      if (g.rooms.length) parts.push(`${g.rooms.length} room areas`);
      if (g.labels.length) parts.push(g.labels.map((l) => `${l.label}×${l.count}`).join(" "));
      if (g.spotLevels.length) {
        const rel = g.spotLevels.filter((s) => s.relMm != null).map((s) => s.relMm!);
        const aod = g.spotLevels.map((s) => s.aodM);
        parts.push(
          `${g.spotLevels.length} spot levels` +
            (rel.length ? ` (rel ${Math.min(...rel)}..+${Math.max(...rel)} mm)` : ` (AOD ${Math.min(...aod)}–${Math.max(...aod)})`),
        );
      }
      if (g.wallLegendMm.length) parts.push(`legend wall ${g.wallLegendMm.join("/")} mm`);
      if (g.doNotScale) parts.push("'do not scale'");
      parts.push(`${g.dimensions.length} dims / ${g.chains.length} chains`);
      console.log("         " + parts.join(" · "));
      if (flag("--geometry")) console.log(JSON.stringify(g, null, 1).slice(0, 4000));
    }
  }
  const scope = files.filter((f) => f.scopeText);
  for (const f of scope) console.log(`\nSCOPE ${basename(f.relativePath)}: ${f.scopeText!.length} chars — ${JSON.stringify(f.scopeText!.slice(0, 160))}…`);
  const errors = files.filter((f) => f.error);
  if (errors.length) console.log(`\nERRORS: ${errors.map((f) => `${f.relativePath}: ${f.error}`).join("; ")}`);

  if (flag("--ai")) {
    const { readPackOffline } = await import("./construction-offline-ai.mts");
    const loaders = new Map(sources.map((s) => [s.id, s.load]));
    await readPackOffline(
      { files, register, geometry },
      { only: valueOf("--only"), load: (id) => loaders.get(id)!(), cacheFile: valueOf("--cache") },
    );
  }

  const out = valueOf("--json");
  if (out) {
    writeFileSync(
      out,
      JSON.stringify(
        { register, geometry: Object.fromEntries(geometry), files: files.map((f) => ({ ...f, pdf: undefined, pptx: f.pptx ? { ...f.pptx, pdf: undefined } : undefined, path: pathOf.get(f.id) })) },
        null,
        1,
      ),
    );
    console.log(`\nwrote ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
