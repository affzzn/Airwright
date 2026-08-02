import { config as loadEnv } from "dotenv";
// Load local env for `npm run worker:dev`; a no-op on Render where env is injected.
loadEnv({ path: ".env.local" });
loadEnv();

import type PgBoss from "pg-boss";
import { getBoss } from "@/lib/queue/boss";
import {
  PROCESS_PACK_QUEUE,
  EXTRACT_DRAWING_QUEUE,
  processPackJobSchema,
  extractDrawingJobSchema,
  type ProcessPackJob,
  type ExtractDrawingJob,
} from "@/lib/queue/jobs";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { slicePages, parseRangeString } from "@/lib/pdf";
import { extractDrawing } from "@/lib/extract/extractDrawing";
import { persistExtraction } from "@/lib/extract/persist";
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

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "PROCESSING" },
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

    const { data, meta } = await extractDrawing(pdf);

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

    await persistExtraction(extractionId, data);

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

async function main() {
  const boss = await getBoss();

  await boss.work<ProcessPackJob>(
    PROCESS_PACK_QUEUE,
    async (jobs: PgBoss.Job<ProcessPackJob>[]) => {
      for (const job of jobs) await handleProcessPack(job.data);
    },
  );

  await boss.work<ExtractDrawingJob>(
    EXTRACT_DRAWING_QUEUE,
    async (jobs: PgBoss.Job<ExtractDrawingJob>[]) => {
      for (const job of jobs) await handleExtract(job.data);
    },
  );

  console.log(
    `[worker] listening on "${PROCESS_PACK_QUEUE}" and "${EXTRACT_DRAWING_QUEUE}"`,
  );
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
