/**
 * The --ai half of `scripts/construction-offline.mts`: read a sorted pack with the
 * sheet readers and print the building models. Every paid read is cached in a
 * local JSON file (`--cache <file>`, default `.construction-read-cache.json` in the
 * OS temp dir) keyed by content hash + reader version, so re-running while
 * iterating on the ENGINE costs nothing; a prompt change re-reads.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markupShapeHints, readPack, type SheetToRead } from "@/lib/construction/pack/readPack";
import type { IngestResult } from "@/lib/construction/pack/ingest";
import { resolveJobParams } from "@/lib/construction/params";
import { BRACKET_LABEL } from "@/lib/construction/types";

export async function readPackOffline(
  ingest: IngestResult,
  opts: { only?: string; load: (fileId: string) => Promise<Buffer>; cacheFile?: string },
): Promise<void> {
  const { files, register, geometry } = ingest;
  const cacheFile = opts.cacheFile ?? join(tmpdir(), ".construction-read-cache.json");
  const cache: Record<string, { read: unknown; raw: unknown }> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};

  const byId = new Map(files.map((f) => [f.id, f]));
  const shapeHints = markupShapeHints(
    files,
    register.files.filter((f) => f.readViaFileId).map((f) => ({ pptxFileId: f.id, pdfFileId: f.readViaFileId! })),
  );
  const sheets: SheetToRead[] = register.sheets
    .filter((s) => s.bucket === "CORE" && !s.superseded)
    .filter((s) => {
      if (!opts.only) return true;
      const hay = `${s.identity.drawingNo ?? ""} ${s.identity.title} ${byId.get(s.fileId)?.relativePath ?? ""}`.toLowerCase();
      return hay.includes(opts.only.toLowerCase());
    })
    .map((s) => {
      const f = byId.get(s.fileId)!;
      const page = f.pdf?.pages.find((p) => p.page === s.page);
      return {
        key: `${s.fileId}:${s.page}`,
        fileId: s.fileId,
        page: s.page,
        kind: s.identity.kind,
        title: `${s.identity.drawingNo ? s.identity.drawingNo + " " : ""}${s.identity.title}`,
        level: s.identity.level,
        buildingKey: s.buildingKey,
        geometry: geometry.get(`${s.fileId}:${s.page}`) ?? null,
        rawText: page?.text ?? f.pptx?.text ?? "",
        contentHash: f.contentHash,
        extraHints: s.identity.kind === "MARKUP" ? (shapeHints.get(`${s.fileId}:${s.page}`) ?? null) : null,
      };
    });

  // Proposed ground levels (relative to FFL) from the job's site plans.
  const groundRel: number[] = [];
  for (const s of register.sheets.filter((x) => x.bucket === "CONTEXT")) {
    const g = geometry.get(`${s.fileId}:${s.page}`);
    for (const sp of g?.spotLevels ?? []) if (sp.relMm != null) groundRel.push(sp.relMm);
  }

  console.log(`\n=== AI read: ${sheets.length} sheets (cache ${cacheFile}) ===`);
  const t0 = Date.now();
  const result = await readPack({
    sheets,
    buildings: register.buildings.map((b) => ({ key: b.key, name: b.name })),
    loadFile: async (id) => {
      const f = byId.get(id)!;
      if (f.pptx?.pdf) return f.pptx.pdf;
      return opts.load(id);
    },
    params: resolveJobParams(null),
    groundRelMm: { "*": groundRel },
    cached: (key, readKey) => (cache[readKey] ? (cache[readKey] as never) : null),
    onSheet: (rec) => {
      const s = sheets.find((x) => x.key === rec.key)!;
      console.log(
        `  ${rec.error ? "FAILED" : rec.reused ? "cached" : "read  "} ${rec.readKind.padEnd(14)} ${s.title.slice(0, 60).padEnd(60)} ` +
          (rec.meta ? `$${rec.meta.costUsd.toFixed(3)} ${Math.round(rec.meta.latencyMs / 1000)}s ${rec.tiles ? `${rec.tiles} tiles` : ""}` : "") +
          (rec.error ? ` — ${rec.error}` : ""),
      );
      if (rec.read && !rec.reused) {
        cache[rec.readKey] = { read: rec.read, raw: rec.raw };
        writeFileSync(cacheFile, JSON.stringify(cache));
      }
    },
    concurrency: 3,
  });
  console.log(`  total new spend $${result.costUsd.toFixed(3)} in ${Math.round((Date.now() - t0) / 1000)} s`);

  for (const b of result.models) {
    console.log(`\n--- ${b.name}: measurement sheet ---`);
    for (const m of b.model.measurements) {
      const extra = [
        m.lifts != null ? `${m.lifts} lifts (suggested)` : null,
        m.heightBracket ? BRACKET_LABEL[m.heightBracket] : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.log(`  [${m.confidence.padEnd(7)}] ${m.label.padEnd(58)} ${String(m.valueNumber).padStart(9)} ${m.unit}${extra ? `  · ${extra}` : ""}`);
      if (m.note) console.log(`             ${m.note}`);
      if (process.argv.includes("--prov")) for (const p of m.provenance.slice(0, 8)) console.log(`               ↳ ${p}`);
    }
    if (b.model.flags.length) {
      console.log("  flags:");
      for (const f of b.model.flags) console.log(`   ⚑ ${f}`);
    }
    if (process.argv.includes("--outline") && b.model.outline)
      console.log(JSON.stringify(b.model.outline.segments.map((s) => ({ id: s.id, dir: s.direction, m: s.lengthM, src: s.source, prov: s.provenance, feat: s.feature })), null, 0));
  }
  if (result.flags.length) for (const f of result.flags) console.log(`⚑ ${f}`);
}
