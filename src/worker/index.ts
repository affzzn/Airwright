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
import { slicePdf, parsePageRange } from "@/lib/pdf";
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
    let pdf = await downloadFromStorage(doc.storagePath);

    if (pageRange) {
      const { start, end } = parsePageRange(pageRange);
      pdf = await slicePdf(pdf, start, end);
    }

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
