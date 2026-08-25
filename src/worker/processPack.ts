import type { Prisma } from "@prisma/client";
import { collectZipPdfEntries } from "@/lib/zip";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  downloadFromStorage,
  uploadToStorage,
} from "@/lib/supabase/storage";
import { getPdfPageCount } from "@/lib/pdf";
import { classifyPdf, type PageClass } from "@/lib/extract/classify";
import {
  categoriseDocument,
  filenamePrefilter,
  isRelevantCategory,
} from "@/lib/extract/categorise";
import { segmentByHouseType } from "@/lib/extract/segment";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";

/**
 * Process a whole tender pack:
 *   1. expand any uploaded ZIPs into individual Document rows,
 *   2. classify every document's pages (free, text-layer) and persist them,
 *   3. segment each document into house types by code,
 *   4. create one HouseType + one Extraction per house type and queue extraction.
 */
export async function processPack(packId: string): Promise<void> {
  await ingestUploads(packId);
  await classifyAndSegment(packId);
}

// --- 1. Turn raw uploads (PDFs + ZIPs) into Document rows ---------------------

async function ingestUploads(packId: string): Promise<void> {
  const uploads = await prisma.packUpload.findMany({
    where: { packId, status: "PENDING" },
  });

  for (const upload of uploads) {
    try {
      if (upload.isArchive) {
        const zip = await downloadFromStorage(upload.storagePath);
        // Recursive: real packs arrive as zips-of-zips (e.g. a OneDrive export
        // zip inside the pack zip) — nested PDFs must not vanish silently.
        const { pdfs, skipped } = collectZipPdfEntries(new Uint8Array(zip));
        for (let i = 0; i < pdfs.length; i++) {
          const entry = pdfs[i];
          const base = entry.name.split("/").pop() ?? entry.name;
          const buffer = Buffer.from(entry.bytes);
          // Deterministic path (upload id + entry index) so a retried job
          // OVERWRITES rather than duplicating documents.
          const path = `${packId}/${upload.id}/${i}-${sanitizeKey(base)}`;
          const exists = await prisma.document.findFirst({
            where: { packId, storagePath: path },
            select: { id: true },
          });
          if (exists) continue; // retry after a mid-zip crash — already ingested
          await uploadToStorage(path, buffer, "application/pdf", { upsert: true });
          await createDocument(packId, base, path, buffer);
        }
        if (skipped.length) {
          console.warn(
            `[process-pack] ${upload.fileName}: ${skipped.length} non-PDF entr${skipped.length === 1 ? "y" : "ies"} set aside: ${skipped.slice(0, 10).join(", ")}${skipped.length > 10 ? ", …" : ""}`,
          );
        }
        if (pdfs.length === 0) {
          throw new Error(
            `No PDFs found in the archive${skipped.length ? ` (contains: ${skipped.slice(0, 5).join(", ")})` : ""}`,
          );
        }
      } else {
        // A PDF already sitting in storage — just register it as a Document
        // (skip if a retry already registered it).
        const exists = await prisma.document.findFirst({
          where: { packId, storagePath: upload.storagePath },
          select: { id: true },
        });
        if (!exists) {
          const buffer = await downloadFromStorage(upload.storagePath);
          await createDocument(packId, upload.fileName, upload.storagePath, buffer);
        }
      }
      await prisma.packUpload.update({
        where: { id: upload.id },
        data: { status: "PROCESSED" },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.packUpload.update({
        where: { id: upload.id },
        data: { status: "FAILED", error: message },
      });
      console.error(`[process-pack] upload ${upload.fileName} failed:`, message);
    }
  }
}

/** Make a zip entry name safe as a Storage object key. */
function sanitizeKey(name: string): string {
  return name.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 180);
}

async function createDocument(
  packId: string,
  fileName: string,
  storagePath: string,
  buffer: Buffer,
): Promise<void> {
  let pageCount: number | null = null;
  try {
    pageCount = await getPdfPageCount(buffer);
  } catch {
    pageCount = null;
  }
  await prisma.document.create({
    data: {
      packId,
      fileName,
      storageBucket: env.storageBucket,
      storagePath,
      mimeType: "application/pdf",
      pageCount,
      sizeBytes: buffer.byteLength,
      isReadable: pageCount !== null,
      needsReview: pageCount === null,
    },
  });
}

// --- 2/3/4. Classify pages, segment by house type, queue extractions ---------

async function classifyAndSegment(packId: string): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { packId, classifiedAt: null },
    include: { pack: { include: { project: true } } },
  });

  const boss = await getBoss();

  for (const doc of documents) {
    if (!doc.isReadable) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          classifiedAt: new Date(),
          needsReview: true,
          category: "UNREADABLE",
          included: false,
        },
      });
      continue;
    }

    // Filename pre-filter: skip opening clearly-junk files entirely (large packs).
    const skip = filenamePrefilter(doc.fileName);
    if (skip) {
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          classifiedAt: new Date(),
          category: skip.category,
          categoryDetail: skip.detail,
          included: false,
        },
      });
      console.log(`[process-pack] ${doc.fileName}: skipped by filename (${skip.detail})`);
      continue;
    }

    const project = doc.pack.project;
    const pdf = await downloadFromStorage(doc.storagePath);

    let pages: PageClass[] = [];
    let hasText = false;
    try {
      ({ pages, hasText } = await classifyPdf(pdf));
    } catch (err) {
      console.error(`[process-pack] classify ${doc.fileName} failed:`, err);
    }

    // Persist per-page classification.
    if (pages.length) {
      await prisma.documentPage.deleteMany({ where: { documentId: doc.id } });
      await prisma.documentPage.createMany({
        data: pages.map((p) => ({
          documentId: doc.id,
          pageNumber: p.page,
          kind: p.kind as Prisma.DocumentPageCreateManyInput["kind"],
          relevant: p.relevant,
          houseTypeCode: p.houseTypeCode,
          houseTypeName: p.houseTypeName,
          sheetTitle: p.title || null,
        })),
      });
    }

    const { category, detail } = categoriseDocument({
      fileName: doc.fileName,
      pages,
      hasText,
    });
    const included = isRelevantCategory(category);
    const relevantPages = pages.filter((p) => p.relevant).length;

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        kind: documentKind(pages),
        category,
        categoryDetail: detail,
        included,
        relevantPages,
        isRasterOnly: !hasText,
        // Flag for a human: unreadable, or a drawing we couldn't identify from text.
        needsReview: !hasText || category === "UNCERTAIN",
        classifiedAt: new Date(),
      },
    });

    // No readable text → flag for a human, don't extract.
    if (!hasText) {
      console.log(`[process-pack] ${doc.fileName}: no text layer → flagged for review`);
      continue;
    }

    // Not a relevant file (schedule, levels, drainage…) → set aside, don't extract.
    if (!included) {
      console.log(`[process-pack] ${doc.fileName}: not relevant (${category}) → set aside`);
      continue;
    }

    // Segment into house types and queue one extraction each. (Plots are NOT read
    // from a site plan — they're created when a take-off is confirmed; extras are
    // added by hand. So plot-layout sheets are simply not extracted.)
    const groups = segmentByHouseType(pages);
    for (const group of groups) {
      const houseType = await ensureHouseType(
        project.id,
        project.clientId,
        group.code,
        group.name ?? baseName(doc.fileName),
      );
      const extraction = await prisma.extraction.create({
        data: {
          documentId: doc.id,
          houseTypeId: houseType.id,
          pageRange: group.pageRange,
          model: env.extractionModel,
          promptVersion: "pending",
          status: "PENDING",
        },
      });
      await boss.send(EXTRACT_DRAWING_QUEUE, {
        documentId: doc.id,
        extractionId: extraction.id,
        pageRange: group.pageRange,
      });
    }
    console.log(
      `[process-pack] ${doc.fileName}: ${groups.length} house type(s), ${pages.length} pages classified`,
    );
  }
}

async function ensureHouseType(
  projectId: string,
  clientId: string,
  code: string | null,
  name: string,
) {
  const existing = await prisma.houseType.findFirst({
    where: code ? { projectId, code } : { projectId, name },
  });
  if (existing) return existing;
  return prisma.houseType.create({
    data: { projectId, clientId, name, code },
  });
}

function documentKind(pages: PageClass[]): Prisma.DocumentCreateManyInput["kind"] {
  if (pages.some((p) => p.relevant)) return "ELEVATION";
  if (pages.some((p) => p.kind === "PLOT_LAYOUT")) return "PLOT_LAYOUT";
  if (pages.some((p) => p.kind === "SPEC")) return "SPEC";
  return "OTHER";
}

function baseName(fileName: string): string {
  return fileName.replace(/\.pdf$/i, "");
}
