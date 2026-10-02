import { config as loadEnv } from "dotenv";
// Load local env for `npm run worker:dev`; a no-op on Render where env is injected.
loadEnv({ path: ".env.local" });
loadEnv();

import type PgBoss from "pg-boss";
import { getBoss } from "@/lib/queue/boss";
import {
  PROCESS_PACK_QUEUE,
  EXTRACT_DRAWING_QUEUE,
  CONSTRUCTION_INGEST_QUEUE,
  CONSTRUCTION_READ_QUEUE,
  processPackJobSchema,
  extractDrawingJobSchema,
  constructionIngestJobSchema,
  constructionReadJobSchema,
  type ProcessPackJob,
  type ExtractDrawingJob,
  type ConstructionIngestJob,
  type ConstructionReadJob,
} from "@/lib/queue/jobs";
import { prisma } from "@/lib/db";
import { downloadFromStorage } from "@/lib/supabase/storage";
import { slicePages, parseRangeString } from "@/lib/pdf";
import { extractDrawing } from "@/lib/extract/extractDrawing";
import { extractionResultSchema } from "@/lib/extract/schema";
import { persistExtraction } from "@/lib/extract/persist";
import { processPack } from "./processPack";
import { ingestConstructionQuote } from "@/server/constructionPack";
import { runConstructionRead } from "@/server/constructionRead";

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
    include: {
      document: {
        include: {
          pack: {
            select: {
              projectId: true,
              project: { select: { extractionModel: true } },
            },
          },
        },
      },
    },
  });
  if (!extraction) throw new Error(`Extraction ${extractionId} not found`);

  // Which LLM reads this project's drawings (null → default: Anthropic Opus 4.8).
  const modelKey = extraction.document.pack.project?.extractionModel ?? null;

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

    const { data, meta, dimensions } = await extractDrawing(pdf, modelKey, fullPdf);

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

// --- construction (docs/22): sort a pack, then read it ------------------------------

async function handleConstructionIngest(raw: ConstructionIngestJob) {
  const { quoteId } = constructionIngestJobSchema.parse(raw);
  console.log(`[worker] construction ingest ${quoteId}`);
  const s = await ingestConstructionQuote(quoteId);
  console.log(`[worker] construction ingest ${quoteId}: ${s.files} files, ${s.sheets} sheets, mode ${s.mode}`);
}

async function handleConstructionRead(raw: ConstructionReadJob) {
  const { runId } = constructionReadJobSchema.parse(raw);
  console.log(`[worker] construction read ${runId}`);
  const r = await runConstructionRead(runId);
  console.log(
    `[worker] construction read ${runId}: ${r.sheetsRead} read, ${r.sheetsReused} reused, ${r.sheetsFailed} failed ($${r.costUsd.toFixed(3)})`,
  );
}

/**
 * Which queues this worker takes. WORKER_QUEUES=construction runs ONLY the
 * construction queues — the safe way to test locally, because the house-build
 * queues are shared with the live deployed worker (a local worker would otherwise
 * grab production jobs with uncommitted code).
 */
function wanted(queue: string): boolean {
  const only = (process.env.WORKER_QUEUES ?? "").trim();
  if (!only) return true;
  return only.split(",").some((q) => q.trim() && (queue === q.trim() || queue.startsWith(`${q.trim()}-`)));
}

async function main() {
  const boss = await getBoss();

  // batchSize: 1 → process one job at a time per queue, so we never fan out
  // dozens of concurrent Claude calls + DB transactions and exhaust the pool.
  const one = { batchSize: 1 } as const;
  const listening: string[] = [];

  if (wanted(PROCESS_PACK_QUEUE)) {
    await boss.work<ProcessPackJob>(PROCESS_PACK_QUEUE, one, async (jobs: PgBoss.Job<ProcessPackJob>[]) => {
      for (const job of jobs) await handleProcessPack(job.data);
    });
    listening.push(PROCESS_PACK_QUEUE);
  }

  if (wanted(EXTRACT_DRAWING_QUEUE)) {
    await boss.work<ExtractDrawingJob>(EXTRACT_DRAWING_QUEUE, one, async (jobs: PgBoss.Job<ExtractDrawingJob>[]) => {
      for (const job of jobs) await handleExtract(job.data);
    });
    listening.push(EXTRACT_DRAWING_QUEUE);
  }

  if (wanted(CONSTRUCTION_INGEST_QUEUE)) {
    await boss.work<ConstructionIngestJob>(CONSTRUCTION_INGEST_QUEUE, one, async (jobs: PgBoss.Job<ConstructionIngestJob>[]) => {
      for (const job of jobs) await handleConstructionIngest(job.data);
    });
    listening.push(CONSTRUCTION_INGEST_QUEUE);
  }

  if (wanted(CONSTRUCTION_READ_QUEUE)) {
    await boss.work<ConstructionReadJob>(CONSTRUCTION_READ_QUEUE, one, async (jobs: PgBoss.Job<ConstructionReadJob>[]) => {
      for (const job of jobs) await handleConstructionRead(job.data);
    });
    listening.push(CONSTRUCTION_READ_QUEUE);
  }

  console.log(`[worker] listening on ${listening.map((q) => `"${q}"`).join(", ")}`);
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
