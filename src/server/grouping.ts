/**
 * Server-side helpers for the grouping OVERRIDE actions (docs/17 §4.7) — pre-confirm
 * edits to a proposed grouping: rename, exclude, merge. Kept out of the "use server"
 * actions file so these internal helpers aren't exposed as server actions.
 *
 * All edits happen while `groupingStatus = "PROPOSED"` (before any paid extraction).
 */

import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { downloadFromStorage, uploadToStorage } from "@/lib/supabase/storage";
import { buildRangeString } from "@/lib/pdf";
import type { AssembledPageRef } from "@/lib/ingest/assemble";

/** One group as stored in `TenderPack.groupingData.groups` (mirror of the worker's summary). */
export interface StoredGroup {
  name: string;
  houseTypeId: string;
  documentId: string;
  extractionId: string | null;
  confidence: "high" | "medium" | "low";
  relevantPageCount: number;
  totalPageCount: number;
  files: string[];
  flags: string[];
}

interface StoredGroupingData {
  builderId?: string;
  builderLabel?: string;
  groups: StoredGroup[];
  unplacedFiles?: string[];
  answerKey?: unknown;
}

export function readGroupingData(value: Prisma.JsonValue | null): StoredGroupingData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.groups)) return null;
  return v as unknown as StoredGroupingData;
}

/** Read → mutate → write the pack's groupingData (preserving the non-group fields). */
export async function updateGroupingData(
  packId: string,
  mutate: (data: StoredGroupingData) => void,
): Promise<void> {
  const pack = await prisma.tenderPack.findUnique({
    where: { id: packId },
    select: { groupingData: true },
  });
  const data = readGroupingData(pack?.groupingData ?? null);
  if (!data) return;
  mutate(data);
  await prisma.tenderPack.update({
    where: { id: packId },
    data: { groupingData: data as unknown as Prisma.InputJsonValue },
  });
}

const KIND_MAP: Record<string, "ELEVATION" | "FLOOR_PLAN" | "SECTION"> = {
  FLOOR_PLAN: "FLOOR_PLAN",
  SETTING_OUT: "FLOOR_PLAN",
  ROOF: "FLOOR_PLAN",
  SECTION: "SECTION",
};
const pageKindOf = (k: string): "ELEVATION" | "FLOOR_PLAN" | "SECTION" => KIND_MAP[k] ?? "ELEVATION";

/** Delete a house type's assembled artefacts (extraction + assembled doc + pages + the house type). */
export async function deleteHouseTypeArtifacts(
  houseTypeId: string,
  documentId: string,
): Promise<void> {
  // Deleting the assembled Document cascades its Extraction + DocumentPage rows;
  // delete the (plot-free, pre-confirm) house type after.
  await prisma.document.delete({ where: { id: documentId } }).catch(() => {});
  await prisma.houseType.delete({ where: { id: houseTypeId } }).catch(() => {});
}

/**
 * Merge the SOURCE assembled dossier into the TARGET: concatenate both combined
 * PDFs (relevant pages first), rebuild the target's manifest/pages/extraction, then
 * delete the source's artefacts. Operates on the already-assembled PDFs (no source
 * re-download).
 */
export async function mergeAssembledDocs(
  targetDocId: string,
  sourceDocId: string,
  targetHouseTypeId: string,
  targetHouseTypeName: string,
): Promise<{ relevantCount: number; totalCount: number }> {
  const [targetDoc, sourceDoc] = await Promise.all([
    prisma.document.findUnique({ where: { id: targetDocId } }),
    prisma.document.findUnique({ where: { id: sourceDocId } }),
  ]);
  if (!targetDoc || !sourceDoc) throw new Error("Assembled document not found for merge.");

  const tMan = (targetDoc.pageManifest as unknown as AssembledPageRef[]) ?? [];
  const sMan = (sourceDoc.pageManifest as unknown as AssembledPageRef[]) ?? [];

  const [tBytes, sBytes] = await Promise.all([
    downloadFromStorage(targetDoc.storagePath),
    downloadFromStorage(sourceDoc.storagePath),
  ]);
  const tPdf = await PDFDocument.load(tBytes, { ignoreEncryption: true });
  const sPdf = await PDFDocument.load(sBytes, { ignoreEncryption: true });

  // Combine both manifests, relevant pages first (stable sort preserves order).
  const entries = [
    ...tMan.map((m) => ({ m, from: "t" as const })),
    ...sMan.map((m) => ({ m, from: "s" as const })),
  ].sort((a, b) => Number(b.m.relevant) - Number(a.m.relevant));

  const out = await PDFDocument.create();
  const newManifest: AssembledPageRef[] = [];
  for (const e of entries) {
    const src = e.from === "t" ? tPdf : sPdf;
    const idx = e.m.assembledPage - 1;
    if (idx < 0 || idx >= src.getPageCount()) continue;
    const [pg] = await out.copyPages(src, [idx]);
    out.addPage(pg);
    newManifest.push({ ...e.m, assembledPage: newManifest.length + 1 });
  }
  const bytes = Buffer.from(await out.save());
  await uploadToStorage(targetDoc.storagePath, bytes, "application/pdf", { upsert: true });

  const relevantPositions = newManifest.filter((m) => m.relevant).map((m) => m.assembledPage);
  const pageRange = buildRangeString(relevantPositions);

  await prisma.document.update({
    where: { id: targetDoc.id },
    data: {
      pageCount: newManifest.length,
      sizeBytes: bytes.byteLength,
      relevantPages: relevantPositions.length,
      pageManifest: newManifest as unknown as Prisma.InputJsonValue,
    },
  });
  await prisma.documentPage.deleteMany({ where: { documentId: targetDoc.id } });
  await prisma.documentPage.createMany({
    data: newManifest.map((m) => ({
      documentId: targetDoc.id,
      pageNumber: m.assembledPage,
      kind: pageKindOf(m.drawingKind),
      relevant: m.relevant,
      houseTypeName: targetHouseTypeName,
      sheetTitle: `${m.drawingKind} · ${m.relativePath.split("/").pop() ?? ""} p${m.sourcePage}`,
    })),
  });

  // Point the target's extraction at the new relevant range (create/drop as needed).
  const targetExtraction = await prisma.extraction.findFirst({
    where: { documentId: targetDoc.id },
    select: { id: true },
  });
  if (relevantPositions.length > 0) {
    if (targetExtraction) {
      await prisma.extraction.update({ where: { id: targetExtraction.id }, data: { pageRange } });
    } else {
      await prisma.extraction.create({
        data: {
          documentId: targetDoc.id,
          houseTypeId: targetHouseTypeId,
          pageRange,
          model: "pending",
          promptVersion: "pending",
          status: "PENDING",
        },
      });
    }
  } else if (targetExtraction) {
    await prisma.extraction.delete({ where: { id: targetExtraction.id } });
  }

  return { relevantCount: relevantPositions.length, totalCount: newManifest.length };
}
