import { config as loadEnv } from "dotenv";
// Load local env for `npm run worker:dev`; a no-op on Render where env is injected.
loadEnv({ path: ".env.local" });
loadEnv();

import type PgBoss from "pg-boss";
import { getBoss } from "@/lib/queue/boss";
import {
  PROCESS_PACK_QUEUE,
  EXTRACT_DRAWING_QUEUE,
  EXTRACT_PLOT_LIST_QUEUE,
  processPackJobSchema,
  extractDrawingJobSchema,
  extractPlotListJobSchema,
  type ProcessPackJob,
  type ExtractDrawingJob,
  type ExtractPlotListJob,
} from "@/lib/queue/jobs";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { slicePages, parseRangeString } from "@/lib/pdf";
import { extractDrawing } from "@/lib/extract/extractDrawing";
import { extractionResultSchema } from "@/lib/extract/schema";
import { extractPlotList } from "@/lib/extract/extractPlotList";
import { persistExtraction } from "@/lib/extract/persist";
import { persistPlots } from "@/lib/extract/persistPlots";
import { processPack } from "./processPack";

// --- process-pack: ingest + classify + segment + fan out ---------------------

async function handleProcessPack(raw: ProcessPackJob) {
  const { packId } = processPackJobSchema.parse(raw);
  console.log(`[worker] processing pack ${packId}`);
  await processPack(packId);
}

// --- extract-drawing: send one house type's pages to Claude ------------------

async function handleExtract(raw: ExtractDrawingJob) {
  const { extractionId, pageRange } = extractDrawingJobSchema.parse(raw);

  const extraction = await prisma.extraction.findUnique({
    where: { id: extractionId },
    include: { document: true },
  });
  if (!extraction) throw new Error(`Extraction ${extractionId} not found`);

  // If a previous attempt already got a valid result out of Claude but died
  // persisting it (or is being retried), reuse the stored rawOutput instead of
  // paying for a second model call. Old-schema outputs fail the parse and fall
  // through to a fresh extraction.
  if (extraction.rawOutput) {
    const reuse = extractionResultSchema.safeParse(extraction.rawOutput);
    if (reuse.success) {
      await prisma.extraction.update({
        where: { id: extractionId },
        data: { status: "PROCESSING", errorMessage: null, processingStartedAt: new Date() },
      });
      try {
        await persistExtraction(extractionId, reuse.data);
        await prisma.extraction.update({
          where: { id: extractionId },
          data: { status: "COMPLETED" },
        });
        console.log(
          `[worker] extraction ${extractionId}: reused stored output (no model call)`,
        );
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await prisma.extraction.update({
          where: { id: extractionId },
          data: { status: "FAILED", errorMessage: message },
        });
        throw err;
      }
    }
  }

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "PROCESSING", errorMessage: null, processingStartedAt: new Date() },
  });

  try {
    const doc = extraction.document;
    const fullPdf = await downloadFromStorage(doc.storagePath);

    // Pages were chosen up front by segmentation (may be non-contiguous).
    const pageNumbers =
      pageRange && pageRange.length > 0
        ? parseRangeString(pageRange)
        : Array.from({ length: doc.pageCount ?? 1 }, (_, i) => i + 1);
    const pdf = await slicePages(fullPdf, pageNumbers);

    console.log(
      `[worker] extraction ${extractionId}: ${pageNumbers.length} pages (${pageRange ?? "all"})`,
    );

    const { data, meta, dimensions } = await extractDrawing(pdf);

    await prisma.extraction.update({
      where: { id: extractionId },
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

    await persistExtraction(extractionId, data, dimensions);

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
    throw err;
  }
}

// --- extract-plot-list: read the plot → house-type → config map --------------

async function handlePlotList(raw: ExtractPlotListJob) {
  const { documentId, pageRange } = extractPlotListJobSchema.parse(raw);

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { pack: { include: { project: true } } },
  });
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const fullPdf = await downloadFromStorage(doc.storagePath);
  const pageNumbers =
    pageRange && pageRange.length > 0
      ? parseRangeString(pageRange)
      : Array.from({ length: doc.pageCount ?? 1 }, (_, i) => i + 1);
  const pdf = await slicePages(fullPdf, pageNumbers);

  const { data, meta } = await extractPlotList(pdf);
  const { created } = await persistPlots(
    doc.pack.project.id,
    doc.pack.project.clientId,
    data,
  );
  console.log(
    `[worker] plot list ${documentId}: ${created} plots in ${meta.latencyMs}ms ($${meta.costUsd.toFixed(4)})`,
  );
}

async function main() {
  const boss = await getBoss();

  // batchSize: 1 → process one job at a time per queue, so we never fan out
  // dozens of concurrent Claude calls + DB transactions and exhaust the pool.
  const one = { batchSize: 1 } as const;

  await boss.work<ProcessPackJob>(
    PROCESS_PACK_QUEUE,
    one,
    async (jobs: PgBoss.Job<ProcessPackJob>[]) => {
      for (const job of jobs) await handleProcessPack(job.data);
    },
  );

  await boss.work<ExtractDrawingJob>(
    EXTRACT_DRAWING_QUEUE,
    one,
    async (jobs: PgBoss.Job<ExtractDrawingJob>[]) => {
      for (const job of jobs) await handleExtract(job.data);
    },
  );

  await boss.work<ExtractPlotListJob>(
    EXTRACT_PLOT_LIST_QUEUE,
    one,
    async (jobs: PgBoss.Job<ExtractPlotListJob>[]) => {
      for (const job of jobs) await handlePlotList(job.data);
    },
  );

  console.log(
    `[worker] listening on "${PROCESS_PACK_QUEUE}", "${EXTRACT_DRAWING_QUEUE}", "${EXTRACT_PLOT_LIST_QUEUE}"`,
  );
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
