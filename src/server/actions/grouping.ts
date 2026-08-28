"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";

/**
 * Confirm a proposed cross-file grouping (docs/17 §10) and start extraction.
 *
 * The worker groups a known-builder pack into house types and creates one
 * PENDING extraction per assembled combined-PDF, but does NOT queue them — a
 * human confirms the grouping first (so a silently-wrong grouping can't waste
 * extraction spend or mis-price). This enqueues every pending extraction.
 */
export async function confirmGrouping(packId: string): Promise<void> {
  const pack = await prisma.tenderPack.findUnique({
    where: { id: packId },
    select: { id: true, projectId: true, groupingStatus: true },
  });
  if (!pack || pack.groupingStatus !== "PROPOSED") return;

  const pending = await prisma.extraction.findMany({
    where: { status: "PENDING", document: { packId } },
    select: { id: true, documentId: true, pageRange: true },
  });

  const boss = await getBoss();
  for (const e of pending) {
    await boss.send(EXTRACT_DRAWING_QUEUE, {
      documentId: e.documentId,
      extractionId: e.id,
      pageRange: e.pageRange,
    });
  }

  await prisma.tenderPack.update({
    where: { id: packId },
    data: { groupingStatus: "CONFIRMED" },
  });
  revalidatePath(`/projects/${pack.projectId}`);
}
