import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  downloadFromStorage,
  uploadToStorage,
} from "@/lib/supabase/storage";
import { getPdfPageCount } from "@/lib/pdf";
import { classifyPdf, type PageClass } from "@/lib/extract/classify";
import { segmentByHouseType } from "@/lib/extract/segment";
import { buildRangeString } from "@/lib/pdf";
import { getBoss } from "@/lib/queue/boss";
import {
  EXTRACT_DRAWING_QUEUE,
  EXTRACT_PLOT_LIST_QUEUE,
} from "@/lib/queue/jobs";

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
        const entries = unzipSync(new Uint8Array(zip));
        for (const [name, bytes] of Object.entries(entries)) {
          if (!name.toLowerCase().endsWith(".pdf")) continue;
          if (name.startsWith("__MACOSX") || name.split("/").pop()!.startsWith("."))
            continue;
          if (bytes.length === 0) continue;
          const base = name.split("/").pop() ?? name;
          const buffer = Buffer.from(bytes);
          const path = `${packId}/${randomUUID()}-${base}`;
          await uploadToStorage(path, buffer, "application/pdf");
          await createDocument(packId, base, path, buffer);
        }
      } else {
        // A PDF already sitting in storage — just register it as a Document.
        const buffer = await downloadFromStorage(upload.storagePath);
        await createDocument(packId, upload.fileName, upload.storagePath, buffer);
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
        data: { classifiedAt: new Date(), needsReview: true },
      });
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

    await prisma.document.update({
      where: { id: doc.id },
      data: {
        kind: documentKind(pages),
        isRasterOnly: !hasText,
        needsReview: !hasText,
        classifiedAt: new Date(),
      },
    });

    // No readable text → flag for a human, don't extract.
    if (!hasText) {
      console.log(`[process-pack] ${doc.fileName}: no text layer → flagged for review`);
      continue;
    }

    // Plot-layout pages → queue a plot-list extraction (plot → type + config).
    const plotPages = pages.filter((p) => p.kind === "PLOT_LAYOUT").map((p) => p.page);
    if (plotPages.length > 0) {
      await boss.send(EXTRACT_PLOT_LIST_QUEUE, {
        documentId: doc.id,
        pageRange: buildRangeString(plotPages),
      });
      console.log(`[process-pack] ${doc.fileName}: plot layout → queued plot-list extraction`);
    }

    // Segment into house types and queue one extraction each.
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
