/**
 * FULL end-to-end live test on the real Tilia Hawkesbury pack (docs/17):
 * upload → classify → AI grouping → assemble → CONFIRM → EXTRACT (real Opus) →
 * persist take-off + engine. Runs every substantive stage against the real
 * Supabase DB + Storage and leaves a CONFIRMED project for the UI (NOT deleted).
 *
 * pg-boss transport is the only thing not exercised here — extraction is run
 * inline exactly as the worker's handleExtract does (same functions), so it can
 * be monitored in one process. Run in the background:
 *   npx tsx scripts/e2e-tilia.mts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { env } from "../src/lib/env";
import { downloadFromStorage, uploadToStorage } from "../src/lib/supabase/storage";
import { processPack } from "../src/worker/processPack";
import { slicePages, parseRangeString } from "../src/lib/pdf";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { extractionResultSchema } from "../src/lib/extract/schema";
import { persistExtraction } from "../src/lib/extract/persist";

const SRC = "data/first-ones-sent/TILIA HAWKESBURY";
const PACK_NAME = basename(SRC);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n.startsWith(".")) continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) out.push(...walk(f));
    else if (/\.pdf$/i.test(n)) out.push(f);
  }
  return out;
}

const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const client = await prisma.client.findFirst({ orderBy: { createdAt: "asc" } });
  if (!client) throw new Error("no client in DB");

  const project = await prisma.project.create({
    data: {
      clientId: client.id,
      name: `E2E Tilia Hawkesbury ${new Date().toISOString().slice(0, 16)}`,
      estimatingMode: "HOUSE_BUILD",
    },
  });
  const pack = await prisma.tenderPack.create({ data: { projectId: project.id } });
  log(`project=${project.id} pack=${pack.id}`);
  log(`OPEN IN UI: /projects/${project.id}`);

  // ── 1. Upload every PDF to Storage + register a PackUpload row (as the app does).
  const pdfs = walk(SRC);
  log(`uploading ${pdfs.length} PDFs…`);
  let done = 0;
  let cursor = 0;
  const uploadWorker = async () => {
    while (cursor < pdfs.length) {
      const full = pdfs[cursor++];
      const rel = `${PACK_NAME}/${relative(SRC, full)}`;
      const base = basename(full);
      const path = `${pack.id}/raw/${randomUUID()}-${base.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 120)}`;
      const buf = readFileSync(full);
      await uploadToStorage(path, buf, "application/pdf", { upsert: true });
      await prisma.packUpload.create({
        data: {
          packId: pack.id,
          fileName: base,
          relativePath: rel,
          storagePath: path,
          mimeType: "application/pdf",
          sizeBytes: buf.byteLength,
          isArchive: false,
        },
      });
      if (++done % 50 === 0) log(`  uploaded ${done}/${pdfs.length}`);
    }
  };
  const tUp = Date.now();
  await Promise.all(Array.from({ length: 12 }, uploadWorker));
  log(`uploaded ${done} files in ${((Date.now() - tUp) / 1000).toFixed(0)}s`);

  // ── 2. process-pack: ingest → classify → AI grouping → assemble (→ PROPOSED).
  log(`running processPack (classify + group + assemble)…`);
  const tPP = Date.now();
  await processPack(pack.id);
  log(`processPack finished in ${((Date.now() - tPP) / 1000).toFixed(0)}s`);

  const grouped = await prisma.tenderPack.findUnique({ where: { id: pack.id } });
  const gd = (grouped?.groupingData ?? {}) as {
    builderLabel?: string;
    groups?: { name: string; confidence: string; relevantPageCount: number; totalPageCount: number; files?: string[]; flags?: string[] }[];
    unplacedFiles?: string[];
    answerKey?: { matched?: string[]; expected?: string[]; missing?: string[]; extra?: string[]; source?: string };
  };
  log(`grouping status=${grouped?.groupingStatus} builder="${gd.builderLabel}" houseTypes=${gd.groups?.length ?? 0}`);
  for (const g of gd.groups ?? [])
    log(`  • ${g.name} [${g.confidence}] ${g.relevantPageCount}/${g.totalPageCount} pp, ${g.files?.length ?? 0} files${g.flags?.length ? ` — flags: ${g.flags.join("; ")}` : ""}`);
  if (gd.answerKey)
    log(`  answerKey(${gd.answerKey.source}): ${gd.answerKey.matched?.length}/${gd.answerKey.expected?.length} matched; missing=[${gd.answerKey.missing?.join(", ")}]; extra=[${gd.answerKey.extra?.join(", ")}]`);
  log(`  unplaced pack-level files: ${gd.unplacedFiles?.length ?? 0}`);

  // ── 3. CONFIRM + EXTRACT: run each PENDING extraction inline (as handleExtract).
  const pending = await prisma.extraction.findMany({
    where: { status: "PENDING", document: { packId: pack.id, kind: "ASSEMBLED" } },
    include: { document: true, houseType: true },
    orderBy: { document: { relativePath: "asc" } },
  });
  log(`\nextracting ${pending.length} house types (real Opus calls)…`);

  let ok = 0;
  let failed = 0;
  let totalCost = 0;
  for (const ex of pending) {
    const name = ex.houseType?.name ?? ex.document.fileName;
    const t = Date.now();
    try {
      await prisma.extraction.update({
        where: { id: ex.id },
        data: { status: "PROCESSING", errorMessage: null, processingStartedAt: new Date() },
      });
      const fullPdf = await downloadFromStorage(ex.document.storagePath);
      const pageNumbers =
        ex.pageRange && ex.pageRange.length > 0
          ? parseRangeString(ex.pageRange)
          : Array.from({ length: ex.document.pageCount ?? 1 }, (_, i) => i + 1);
      const pdf = await slicePages(fullPdf, pageNumbers);
      const { data, meta, dimensions } = await extractDrawing(pdf);
      await prisma.extraction.update({
        where: { id: ex.id },
        data: {
          status: "COMPLETED",
          rawOutput: meta.raw as object,
          model: meta.model,
          promptVersion: meta.promptVersion,
          latencyMs: meta.latencyMs,
          inputTokens: meta.inputTokens,
          outputTokens: meta.outputTokens,
          costUsd: meta.costUsd,
        },
      });
      // Guard: rawOutput must satisfy the schema (mirrors the worker's reuse path).
      extractionResultSchema.parse(meta.raw);
      await persistExtraction(ex.id, data, dimensions);
      ok++;
      totalCost += meta.costUsd;
      log(`  ✓ ${name} (${pageNumbers.length}pp) ${((Date.now() - t) / 1000).toFixed(0)}s $${meta.costUsd.toFixed(3)}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await prisma.extraction.update({ where: { id: ex.id }, data: { status: "FAILED", errorMessage: message } });
      log(`  ✗ ${name} FAILED: ${message}`);
    }
  }

  await prisma.tenderPack.update({ where: { id: pack.id }, data: { groupingStatus: "CONFIRMED" } });

  // ── 4. Summary of what the UI will show.
  const takeoffs = await prisma.takeoff.findMany({
    where: { houseType: { projectId: project.id } },
    include: { houseType: true, _count: { select: { measurements: true, wallSegments: true } } },
  });
  log(`\n=== RESULT ===`);
  log(`model: ${env.extractionModel}`);
  log(`extractions: ${ok} completed, ${failed} failed`);
  log(`extraction cost: $${totalCost.toFixed(2)}`);
  log(`take-offs created: ${takeoffs.length}`);
  for (const t of takeoffs)
    log(`  • ${t.houseType.name}: ${t._count.measurements} measurements, ${t._count.wallSegments} walls, status=${t.status}`);
  log(`\nDONE. OPEN IN UI: /projects/${project.id}  (project kept — not deleted)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
