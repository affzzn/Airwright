"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";

/**
 * Re-queue a failed extraction. If the previous attempt stored a valid raw
 * output the worker reuses it (no new model spend); otherwise it re-reads the
 * drawing. Resets status so the review UI shows live progress again.
 */
export async function retryExtraction(extractionId: string): Promise<void> {
  const extraction = await prisma.extraction.findUnique({
    where: { id: extractionId },
    include: { document: { include: { pack: true } } },
  });
  if (!extraction) return;

  await prisma.extraction.update({
    where: { id: extractionId },
    data: { status: "PENDING", errorMessage: null },
  });

  const boss = await getBoss();
  await boss.send(EXTRACT_DRAWING_QUEUE, {
    documentId: extraction.documentId,
    extractionId: extraction.id,
    pageRange: extraction.pageRange,
  });

  revalidatePath(`/projects/${extraction.document.pack.projectId}`);
}
