// Re-read ONE extraction with THIS checkout's code — the worker's extract-drawing handler
// (src/worker/index.ts) run in-process, NOT via the queue: the deployed Render worker shares
// the database + pg-boss queue, so a queued job may be taken by the OLD deployed code.
//   npx tsx scripts/extract-local.mts <extractionId>
import { config } from "dotenv"; config({ path: ".env.local" });
import { prisma } from "../src/lib/db";
import { downloadFromStorage } from "../src/lib/supabase/storage";
import { slicePages, parseRangeString } from "../src/lib/pdf";
import { extractDrawing } from "../src/lib/extract/extractDrawing";
import { persistExtraction } from "../src/lib/extract/persist";
const extractionId = process.argv[2];
const ex = await prisma.extraction.findUniqueOrThrow({ where: { id: extractionId }, include: { document: { include: { pack: { select: { project: { select: { extractionModel: true } } } } } } } });
await prisma.extraction.update({ where: { id: extractionId }, data: { status: "PROCESSING", errorMessage: null, processingStartedAt: new Date() } });
const fullPdf = await downloadFromStorage(ex.document.storagePath);
const pages = parseRangeString(ex.pageRange!);
const pdf = await slicePages(fullPdf, pages);
console.log(`reading ${pages.length} pages (${ex.pageRange})`);
const { data, meta, dimensions } = await extractDrawing(pdf, ex.document.pack.project?.extractionModel ?? null, fullPdf);
await prisma.extraction.update({ where: { id: extractionId }, data: { status: "COMPLETED", rawOutput: meta.raw as object, model: meta.model, promptVersion: meta.promptVersion, latencyMs: meta.latencyMs, inputTokens: meta.inputTokens, outputTokens: meta.outputTokens, costUsd: meta.costUsd } });
await persistExtraction(extractionId, data, dimensions);
console.log(`done: prompt ${meta.promptVersion}, ${meta.latencyMs} ms, $${meta.costUsd.toFixed(3)}`);
console.log(`frontageReason: ${data.frontageReason}`);
for (const w of data.wallSegments) console.log(`  ${w.position} ${w.lengthM} party=${w.isPartyWall} (${w.sourceDimension})`);
await prisma.$disconnect();
