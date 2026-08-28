import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { collectZipPdfEntries } from "@/lib/zip";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { downloadFromStorage, uploadToStorage } from "@/lib/supabase/storage";
import { getPdfPageCount } from "@/lib/pdf";
import { classifyPdf, type PageClass } from "@/lib/extract/classify";
import {
  categoriseDocument,
  filenamePrefilter,
  isRelevantCategory,
} from "@/lib/extract/categorise";
import { segmentByHouseType } from "@/lib/extract/segment";
import { detectBuilder, profileById } from "@/lib/ingest/profiles";
import { groupPack, type IngestFile } from "@/lib/ingest/group";
import { assembleHouseTypePdf, type AssemblySource } from "@/lib/ingest/assemble";
import type { DrawingKind } from "@/lib/ingest/parsePath";
import { getBoss } from "@/lib/queue/boss";
import { EXTRACT_DRAWING_QUEUE } from "@/lib/queue/jobs";

/**
 * Process a whole tender pack (docs/17 — smart upload & grouping):
 *   1. expand any uploaded ZIPs into Document rows, KEEPING each file's relative
 *      path (the strongest grouping signal) and a content hash (zip-vs-unzipped dedupe),
 *   2. classify every document's pages (free, text-layer) and persist them,
 *   3. detect the builder and GROUP the relevant pages into house types ACROSS
 *      all files; assemble one combined PDF per type; create a PENDING extraction
 *      each and wait for a human to confirm the grouping (groupingStatus=PROPOSED).
 *   UNKNOWN builder → legacy per-file segmentation, auto-queued (groupingStatus=FALLBACK).
 */
export async function processPack(packId: string): Promise<void> {
  await ingestUploads(packId);
  await classifyDocuments(packId);
  await groupAndPrepare(packId);
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
          // The zip entry name IS the relative path inside the pack (docs/17).
          const relativePath = joinRelative(upload.relativePath, entry.name);
          // Deterministic path (upload id + entry index) so a retried job
          // OVERWRITES rather than duplicating documents.
          const path = `${packId}/${upload.id}/${i}-${sanitizeKey(base)}`;
          if (await documentExists(packId, path, buffer)) continue;
          await uploadToStorage(path, buffer, "application/pdf", { upsert: true });
          await createDocument(packId, base, relativePath, path, buffer);
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
        // A PDF already sitting in storage — register it as a Document (skip if a
        // retry, or a duplicate zip-vs-unzipped copy, already registered it).
        const buffer = await downloadFromStorage(upload.storagePath);
        if (!(await documentExists(packId, upload.storagePath, buffer))) {
          const relativePath = upload.relativePath ?? upload.fileName;
          await createDocument(packId, upload.fileName, relativePath, upload.storagePath, buffer);
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

/** Join an upload's own relative prefix (if any) with a zip entry's path. */
function joinRelative(prefix: string | null, entryName: string): string {
  if (!prefix) return entryName;
  const dir = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
  return dir ? `${dir}/${entryName}` : entryName;
}

/** Already ingested? Either the same storage path, or the same content (dedupe). */
async function documentExists(
  packId: string,
  storagePath: string,
  buffer: Buffer,
): Promise<boolean> {
  const hash = sha256(buffer);
  const existing = await prisma.document.findFirst({
    where: { packId, OR: [{ storagePath }, { contentHash: hash }] },
    select: { id: true },
  });
  return existing !== null;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Make a zip entry name safe as a Storage object key. */
function sanitizeKey(name: string): string {
  return name.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 180);
}

async function createDocument(
  packId: string,
  fileName: string,
  relativePath: string,
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
      relativePath,
      contentHash: sha256(buffer),
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

// --- 2. Classify every document's pages (no segmentation / no queueing here) ---

async function classifyDocuments(packId: string): Promise<void> {
  const documents = await prisma.document.findMany({
    where: { packId, classifiedAt: null, kind: { not: "ASSEMBLED" } },
  });

  for (const doc of documents) {
    if (!doc.isReadable) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { classifiedAt: new Date(), needsReview: true, category: "UNREADABLE", included: false },
      });
      continue;
    }

    // Filename pre-filter: skip opening clearly-junk files entirely (large packs).
    const skip = filenamePrefilter(doc.fileName);
    if (skip) {
      await prisma.document.update({
        where: { id: doc.id },
        data: { classifiedAt: new Date(), category: skip.category, categoryDetail: skip.detail, included: false },
      });
      continue;
    }

    const pdf = await downloadFromStorage(doc.storagePath);
    let pages: PageClass[] = [];
    let hasText = false;
    try {
      ({ pages, hasText } = await classifyPdf(pdf));
    } catch (err) {
      console.error(`[process-pack] classify ${doc.fileName} failed:`, err);
    }

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

    const { category, detail } = categoriseDocument({ fileName: doc.fileName, pages, hasText });
    await prisma.document.update({
      where: { id: doc.id },
      data: {
        kind: documentKind(pages),
        category,
        categoryDetail: detail,
        included: isRelevantCategory(category),
        relevantPages: pages.filter((p) => p.relevant).length,
        isRasterOnly: !hasText,
        needsReview: !hasText || category === "UNCERTAIN",
        classifiedAt: new Date(),
      },
    });
  }
}

// --- 3. Detect the builder, group across files, assemble, prepare extractions --

async function groupAndPrepare(packId: string): Promise<void> {
  const pack = await prisma.tenderPack.findUnique({
    where: { id: packId },
    include: { project: true },
  });
  if (!pack) return;
  // Idempotent: don't re-group a pack that's reached a terminal grouping state.
  if (pack.groupingStatus && pack.groupingStatus !== "GROUPING") return;

  // Mark in-progress so the UI shows "grouping…" (assembly can take a while), and
  // clear any half-built artefacts from a crashed prior run (retry safety).
  await prisma.extraction.deleteMany({
    where: { status: "PENDING", document: { packId, kind: "ASSEMBLED" } },
  });
  await prisma.document.deleteMany({ where: { packId, kind: "ASSEMBLED" } });
  await prisma.tenderPack.update({ where: { id: packId }, data: { groupingStatus: "GROUPING" } });

  const docs = await prisma.document.findMany({
    where: { packId, kind: { not: "ASSEMBLED" }, included: true, isReadable: true },
    include: { pages: true },
  });

  // Detect the builder from every signal we have.
  const relPaths = docs.map((d) => d.relativePath ?? d.fileName);
  const folders = [...new Set(relPaths.flatMap((p) => p.split("/").slice(0, -1)))];
  const fileNames = docs.map((d) => d.fileName);
  const titles = docs.flatMap((d) => d.pages.map((p) => p.sheetTitle ?? p.houseTypeName ?? ""));
  const profile = detectBuilder({ folders, fileNames, projectName: pack.project.name, titles });

  const boss = await getBoss();

  // ── UNKNOWN builder → legacy per-file segmentation, auto-queued (unchanged behaviour).
  if (!profile) {
    for (const doc of docs) {
      if (doc.isRasterOnly) continue;
      const pages: PageClass[] = doc.pages.map((p) => ({
        page: p.pageNumber,
        kind: p.kind as PageClass["kind"],
        relevant: p.relevant,
        houseTypeCode: p.houseTypeCode,
        houseTypeName: p.houseTypeName,
        title: p.sheetTitle ?? "",
      }));
      const groups = segmentByHouseType(pages);
      for (const group of groups) {
        const houseType = await ensureHouseType(
          pack.project.id,
          pack.project.clientId,
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
    }
    await prisma.tenderPack.update({
      where: { id: packId },
      data: { groupingStatus: "FALLBACK", builderProfileId: null },
    });
    console.log(`[process-pack] no builder profile → legacy per-file extraction (auto-queued)`);
    return;
  }

  // ── KNOWN builder → cross-file grouping + combined-PDF assembly, gated on confirm.
  const files: IngestFile[] = docs.map((d) => ({
    documentId: d.id,
    relativePath: d.relativePath ?? d.fileName,
    pages: d.pages.map((p) => ({
      page: p.pageNumber,
      relevant: p.relevant,
      houseTypeName: p.houseTypeName,
    })),
  }));

  const result = groupPack(files, profile);
  const summaryGroups: GroupingSummaryGroup[] = [];

  for (const group of result.groups) {
    if (group.pages.length === 0) continue;

    // Download the distinct source docs this group needs.
    const neededIds = [...new Set(group.pages.map((p) => p.documentId))];
    const sources = new Map<string, AssemblySource>();
    for (const id of neededIds) {
      const src = docs.find((d) => d.id === id);
      if (!src) continue;
      const bytes = await downloadFromStorage(src.storagePath);
      sources.set(id, { documentId: id, relativePath: src.relativePath ?? src.fileName, bytes });
    }

    const assembled = await assembleHouseTypePdf(group, sources);
    if (assembled.pageCount === 0) continue;

    // Store the combined PDF as its own ASSEMBLED Document.
    const path = `${packId}/assembled/${sanitizeKey(group.name)}.pdf`;
    const buf = Buffer.from(assembled.bytes);
    await uploadToStorage(path, buf, "application/pdf", { upsert: true });
    const assembledDoc = await prisma.document.create({
      data: {
        packId,
        kind: "ASSEMBLED",
        fileName: `${group.name} (assembled).pdf`,
        relativePath: group.name,
        storageBucket: env.storageBucket,
        storagePath: path,
        mimeType: "application/pdf",
        pageCount: assembled.pageCount,
        sizeBytes: buf.byteLength,
        included: true,
        category: "HOUSE_TYPE_DRAWINGS",
        relevantPages: assembled.pageCount,
        classifiedAt: new Date(),
        pageManifest: assembled.pageManifest as unknown as Prisma.InputJsonValue,
      },
    });

    // Page rows for the assembled PDF (drive the review thumbnail strip + the
    // wall-read-off-elevation cross-check in persist.ts).
    await prisma.documentPage.createMany({
      data: assembled.pageManifest.map((m) => ({
        documentId: assembledDoc.id,
        pageNumber: m.assembledPage,
        kind: pageKindOf(m.drawingKind as DrawingKind),
        relevant: true,
        houseTypeName: group.name,
        sheetTitle: `${m.drawingKind} · ${m.relativePath.split("/").pop() ?? ""} p${m.sourcePage}`,
      })),
    });

    const houseType = await ensureHouseType(pack.project.id, pack.project.clientId, null, group.name);
    const pageRange = `1-${assembled.pageCount}`;
    const extraction = await prisma.extraction.create({
      data: {
        documentId: assembledDoc.id,
        houseTypeId: houseType.id,
        pageRange,
        model: env.extractionModel,
        promptVersion: "pending",
        status: "PENDING",
      },
    });

    const flags = [...group.flags];
    if (assembled.skipped.length)
      flags.push(`${assembled.skipped.length} source page(s) could not be copied.`);

    summaryGroups.push({
      name: group.name,
      houseTypeId: houseType.id,
      extractionId: extraction.id,
      confidence: group.confidence,
      pageCount: assembled.pageCount,
      files: group.files,
      flags,
    });
  }

  await prisma.tenderPack.update({
    where: { id: packId },
    data: {
      groupingStatus: "PROPOSED",
      builderProfileId: profile.id,
      groupingData: {
        builderId: profile.id,
        builderLabel: profile.label,
        groups: summaryGroups,
        ignoredCount: result.ignoredFiles.length,
        unplacedFiles: result.unplacedFiles,
      } as unknown as Prisma.InputJsonValue,
    },
  });
  console.log(
    `[process-pack] builder=${profile.id}: ${summaryGroups.length} house type(s) grouped, ${result.ignoredFiles.length} files ignored, ${result.unplacedFiles.length} unplaced — awaiting confirm`,
  );
}

interface GroupingSummaryGroup {
  name: string;
  houseTypeId: string;
  extractionId: string;
  confidence: "high" | "medium" | "low";
  pageCount: number;
  files: string[];
  flags: string[];
}

/** Map an ingest DrawingKind to the coarse PageKind used across the app. */
function pageKindOf(kind: DrawingKind): Prisma.DocumentPageCreateManyInput["kind"] {
  switch (kind) {
    case "FLOOR_PLAN":
    case "SETTING_OUT":
    case "ROOF":
      return "FLOOR_PLAN";
    case "SECTION":
      return "SECTION";
    default:
      return "ELEVATION";
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
  return prisma.houseType.create({ data: { projectId, clientId, name, code } });
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
