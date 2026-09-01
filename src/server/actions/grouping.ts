"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";
import {
  updateGroupingData,
  deleteHouseTypeArtifacts,
  mergeAssembledDocs,
} from "@/server/grouping";

/** Load a pack that must still be awaiting confirmation (override window). */
async function proposedPack(packId: string) {
  const pack = await prisma.tenderPack.findUnique({
    where: { id: packId },
    select: { id: true, projectId: true, groupingStatus: true },
  });
  return pack && pack.groupingStatus === "PROPOSED" ? pack : null;
}

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

// ── Override actions (docs/17 §4.7) — fix the grouping BEFORE extraction ───────

/** Rename a house type (fix a mis-read name). No re-assembly needed. */
export async function renameGroup(
  packId: string,
  houseTypeId: string,
  newName: string,
): Promise<void> {
  const pack = await proposedPack(packId);
  const name = newName.trim();
  if (!pack || !name) return;

  await prisma.houseType.update({ where: { id: houseTypeId }, data: { name } });
  await updateGroupingData(packId, (data) => {
    const g = data.groups.find((x) => x.houseTypeId === houseTypeId);
    if (g) g.name = name;
  });
  revalidatePath(`/projects/${pack.projectId}`);
}

/** Exclude a group — it isn't a real house type. Drops the dossier + house type. */
export async function excludeGroup(
  packId: string,
  houseTypeId: string,
  documentId: string,
): Promise<void> {
  const pack = await proposedPack(packId);
  if (!pack) return;

  await deleteHouseTypeArtifacts(houseTypeId, documentId);
  await updateGroupingData(packId, (data) => {
    data.groups = data.groups.filter((x) => x.houseTypeId !== houseTypeId);
  });
  revalidatePath(`/projects/${pack.projectId}`);
}

/** Merge the SOURCE group into the TARGET (fix an over-split / handed pair). */
export async function mergeGroups(
  packId: string,
  sourceHouseTypeId: string,
  sourceDocumentId: string,
  targetHouseTypeId: string,
  targetDocumentId: string,
): Promise<void> {
  const pack = await proposedPack(packId);
  if (!pack || sourceHouseTypeId === targetHouseTypeId) return;

  const target = await prisma.houseType.findUnique({
    where: { id: targetHouseTypeId },
    select: { name: true },
  });
  if (!target) return;

  const { relevantCount, totalCount } = await mergeAssembledDocs(
    targetDocumentId,
    sourceDocumentId,
    targetHouseTypeId,
    target.name,
  );
  await deleteHouseTypeArtifacts(sourceHouseTypeId, sourceDocumentId);

  await updateGroupingData(packId, (data) => {
    const src = data.groups.find((x) => x.houseTypeId === sourceHouseTypeId);
    const tgt = data.groups.find((x) => x.houseTypeId === targetHouseTypeId);
    if (tgt) {
      tgt.files = [...new Set([...tgt.files, ...(src?.files ?? [])])];
      tgt.relevantPageCount = relevantCount;
      tgt.totalPageCount = totalCount;
      tgt.confidence = relevantCount > 0 ? tgt.confidence : "low";
    }
    data.groups = data.groups.filter((x) => x.houseTypeId !== sourceHouseTypeId);
  });
  revalidatePath(`/projects/${pack.projectId}`);
}
