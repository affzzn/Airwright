"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getBoss } from "@/lib/queue/boss";
import { CONSTRUCTION_INGEST_QUEUE, CONSTRUCTION_READ_QUEUE } from "@/lib/queue/jobs";
import { env } from "@/lib/env";

/**
 * Construction pack actions (docs/22). The heavy work — unpacking, sorting,
 * reading — never runs here: these only record the estimator's decision and
 * queue the worker, so a web request never waits on a pack.
 */

/** Queue a (re-)sort of the job's files. Safe to call repeatedly. */
export async function startConstructionIngest(quoteId: string): Promise<{ ok: boolean; error?: string }> {
  const quote = await prisma.constructionQuote.findUnique({ where: { id: quoteId }, select: { id: true } });
  if (!quote) return { ok: false, error: "Job not found." };
  const count = await prisma.constructionAttachment.count({ where: { quoteId } });
  if (count === 0) return { ok: false, error: "No files to sort yet." };
  await prisma.constructionQuote.update({
    where: { id: quoteId },
    data: { ingestStatus: "QUEUED", ingestError: null },
  });
  const boss = await getBoss();
  // The queue is "stately" keyed by job: a burst of uploads collapses into one
  // queued sort (send returns null for the duplicates — that is fine).
  await boss.send(CONSTRUCTION_INGEST_QUEUE, { quoteId }, { singletonKey: quoteId, retryLimit: 2, retryDelay: 20 });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/** The estimator's switch on one register row (read it or not). */
export async function setConstructionSheetIncluded(
  sheetId: string,
  quoteId: string,
  included: boolean,
): Promise<{ ok: boolean }> {
  await prisma.constructionSheet.updateMany({ where: { id: sheetId, quoteId }, data: { included } });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true };
}

/**
 * Start a background read of the job's sheets (docs/22 Step 7). Never reads in
 * the request: it saves a run and queues the worker. A run already queued or
 * running is returned instead of starting a second.
 */
export async function startConstructionRead(quoteId: string): Promise<{ ok: boolean; runId?: string; error?: string }> {
  if (!env.constructionAI) return { ok: false, error: "AI reading is turned off." };
  const quote = await prisma.constructionQuote.findUnique({
    where: { id: quoteId },
    select: { ingestStatus: true, status: true, mode: true },
  });
  if (!quote) return { ok: false, error: "Job not found." };
  if (quote.ingestStatus !== "DONE") return { ok: false, error: "The files are still being sorted — try again in a moment." };
  if (quote.mode === "C") return { ok: false, error: "Scenario 3: nothing is read — fill in the cards by hand." };
  const active = await prisma.constructionReadRun.findFirst({
    where: { quoteId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
  });
  if (active) return { ok: true, runId: active.id };
  // Scenario 1 reads the scope (and email) only; Scenario 2 reads the drawings only.
  if (quote.mode === "A") {
    const scope = await prisma.constructionAttachment.count({ where: { quoteId, bucket: "SCOPE", useForDrafting: true } });
    if (scope === 0) return { ok: false, error: "Nothing to read — switch on the scope file." };
  } else {
    const sheets = await prisma.constructionSheet.count({ where: { quoteId, bucket: "CORE", included: true, superseded: false } });
    if (sheets === 0) return { ok: false, error: "Nothing to read — switch on at least one drawing." };
  }

  const run = await prisma.constructionReadRun.create({ data: { quoteId, status: "QUEUED" } });
  const boss = await getBoss();
  // A pack read can take several minutes; give the job an hour before pg-boss
  // treats it as lost. One retry: stored sheet reads are reused, so it is cheap.
  await boss.send(CONSTRUCTION_READ_QUEUE, { runId: run.id }, { expireInSeconds: 3600, retryLimit: 1, retryDelay: 30 });
  revalidatePath(`/construction/${quoteId}`);
  return { ok: true, runId: run.id };
}
