/**
 * Background worker (a separate Render process from the web app).
 * Consumes extraction jobs: download the PDF from Storage, send the relevant
 * pages to Claude via extractDrawing(), persist the result, and record
 * token/cost telemetry on the Extraction row.
 *
 * Run locally with: npm run worker:dev
 */
import { config as loadEnv } from "dotenv";
// Load local env for `npm run worker:dev`; a no-op on Render where env is injected.
loadEnv({ path: ".env.local" });
loadEnv();

import type PgBoss from "pg-boss";
import { getBoss } from "@/lib/queue/boss";
import {
  EXTRACT_DRAWING_QUEUE,
  extractDrawingJobSchema,
  type ExtractDrawingJob,
} from "@/lib/queue/jobs";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase/storage";
import {
  slicePages,
  buildRangeString,
  MAX_PAGES_PER_EXTRACTION,
} from "@/lib/pdf";
import { classifyPdf, selectRelevantPages } from "@/lib/extract/classify";
import { extractDrawing } from "@/lib/extract/extractDrawing";
import { persistExtraction } from "@/lib/extract/persist";

async function handleJob(raw: ExtractDrawingJob) {
  const job = extractDrawingJobSchema.parse(raw);
  const { extractionId, pageRange } = job;

  const extraction = await prisma.extraction.findUnique({
    where: { id: extractionId },
    include: {
      document: { include: { pack: { include: { project: true } } } },
    },
  });
  if (!extraction) throw new Error(`Extraction ${extractionId} not found`);

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "PROCESSING" },
  });

  try {
    const doc = extraction.document;
    const fullPdf = await downloadFromStorage(doc.storagePath);
    const totalPages = doc.pageCount ?? 0;

    // Classify pages from the text layer (free) and keep only the relevant
    // sheets — elevations, floor plans, section — before sending to Claude.
    let chosenPages: number[];
    const { pages, hasText } = await classifyPdf(fullPdf).catch(() => ({
      pages: [],
      hasText: false,
    }));
    const relevant = selectRelevantPages(pages);

    if (hasText && relevant.length > 0) {
      chosenPages = relevant.slice(0, MAX_PAGES_PER_EXTRACTION);
    } else {
      // Scanned/raster PDF or nothing matched — fall back to the first pages.
      const n = Math.min(totalPages || 1, MAX_PAGES_PER_EXTRACTION);
      chosenPages = Array.from({ length: n }, (_, i) => i + 1);
    }

    const usedRange = pageRange ?? buildRangeString(chosenPages);
    const pdf = await slicePages(fullPdf, chosenPages);
    console.log(
      `[worker] ${doc.fileName}: sending ${chosenPages.length}/${totalPages} pages (${usedRange}) to Claude`,
    );

    const { data, meta } = await extractDrawing(pdf);

    await prisma.extraction.update({
      where: { id: extractionId },
      data: {
        status: "COMPLETED",
        pageRange: usedRange,
        rawOutput: meta.raw as object,
        model: meta.model,
        promptVersion: meta.promptVersion,
        latencyMs: meta.latencyMs,
        inputTokens: meta.inputTokens,
        outputTokens: meta.outputTokens,
        costUsd: meta.costUsd,
      },
    });

    await persistExtraction(
      extractionId,
      doc.pack.project.id,
      doc.pack.project.clientId,
      data,
    );

    console.log(
      `[worker] extraction ${extractionId} completed in ${meta.latencyMs}ms ($${meta.costUsd.toFixed(4)})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.extraction.update({
      where: { id: extractionId },
      data: { status: "FAILED", errorMessage: message },
    });
    console.error(`[worker] extraction ${extractionId} failed:`, message);
    throw err; // let pg-boss record the failure
  }
}

async function main() {
  const boss = await getBoss();
  // pg-boss v10 hands the work callback an array of jobs.
  await boss.work<ExtractDrawingJob>(
    EXTRACT_DRAWING_QUEUE,
    async (jobs: PgBoss.Job<ExtractDrawingJob>[]) => {
      for (const job of jobs) {
        await handleJob(job.data);
      }
    },
  );
  console.log(`[worker] listening on "${EXTRACT_DRAWING_QUEUE}"`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
