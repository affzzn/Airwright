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
import { downloadFromStorage, uploadToStorage, createSignedUrl } from "@/lib/supabase/storage";
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

const SIGNED_TTL = 60 * 60 * 4; // 4h — matches the review page

/**
 * Return a signed URL to a document's FULL drawing (docs/17 §5 — lazy dossier).
 *
 * For an ASSEMBLED doc, the eager PDF holds only the relevant pages; the COMPLETE
 * dossier (every page of every file grouped into this house type, incl. the trade
 * sheets) is built here ON DEMAND and cached to storage — so the heavy merge only
 * happens when someone actually clicks "Open full drawing". For any other document
 * it just signs the file itself.
 */
export async function ensureFullDossier(documentId: string): Promise<string> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  if (doc.kind !== "ASSEMBLED") return createSignedUrl(doc.storagePath, SIGNED_TTL);

  const fullPath = doc.storagePath.replace(/\.pdf$/i, "") + "-full.pdf";
  try {
    return await createSignedUrl(fullPath, SIGNED_TTL); // already built + cached
  } catch {
    /* not built yet — build below */
  }

  const pack = await prisma.tenderPack.findUnique({
    where: { id: doc.packId },
    select: { groupingData: true },
  });
  const group = readGroupingData(pack?.groupingData ?? null)?.groups.find(
    (g) => g.documentId === documentId,
  );
  const relPaths = group?.files ?? [];
  if (relPaths.length === 0) return createSignedUrl(doc.storagePath, SIGNED_TTL); // no group info

  const sourceDocs = await prisma.document.findMany({
    where: { packId: doc.packId, relativePath: { in: relPaths } },
    include: { pages: { select: { pageNumber: true, relevant: true } } },
  });

  // Load every source PDF (bounded concurrency) and enumerate its pages + relevance.
  const loaded = new Map<string, PDFDocument>();
  const entries: { docId: string; index: number; relevant: boolean }[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(8, sourceDocs.length) }, async () => {
    while (cursor < sourceDocs.length) {
      const sd = sourceDocs[cursor++];
      try {
        const bytes = await downloadFromStorage(sd.storagePath);
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        loaded.set(sd.id, pdf);
      } catch {
        /* skip a corrupt/missing source */
      }
    }
  });
  await Promise.all(workers);

  for (const sd of sourceDocs) {
    const pdf = loaded.get(sd.id);
    if (!pdf) continue;
    const relByPage = new Map(sd.pages.map((p) => [p.pageNumber, p.relevant]));
    for (let i = 0; i < pdf.getPageCount(); i++)
      entries.push({ docId: sd.id, index: i, relevant: relByPage.get(i + 1) ?? false });
  }
  // Relevant pages first (stable), then the rest of the dossier.
  entries.sort((a, b) => Number(b.relevant) - Number(a.relevant));

  const out = await PDFDocument.create();
  for (const e of entries) {
    const pdf = loaded.get(e.docId);
    if (!pdf || e.index < 0 || e.index >= pdf.getPageCount()) continue;
    const [pg] = await out.copyPages(pdf, [e.index]);
    out.addPage(pg);
  }
  const bytes = Buffer.from(await out.save());
  await uploadToStorage(fullPath, bytes, "application/pdf", { upsert: true });
  return createSignedUrl(fullPath, SIGNED_TTL);
}
