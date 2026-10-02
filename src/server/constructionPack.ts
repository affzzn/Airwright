/**
 * Construction pack ingest — the DATABASE side (docs/22 Step 4). Runs in the
 * worker (`construction-ingest` job) or in-process from a script; never inside a
 * web request. Idempotent: re-running after more files arrive re-sorts the whole
 * pack but keeps what the estimator decided (a sheet switched off stays off, a
 * file's read tick stays as they left it) and what was already read (a sheet whose
 * file did not change keeps its read).
 */

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { downloadFromStorage, uploadToStorage } from "@/lib/supabase/storage";
import { env } from "@/lib/env";
import { baseName, fileTypeOf, mimeTypeFor } from "@/lib/construction/pack/files";
import { expandZip, ingestPack, type PackSource } from "@/lib/construction/pack/ingest";

const sanitizeKey = (name: string): string => name.replace(/[^A-Za-z0-9._ ()-]/g, "_").slice(0, 180);

/** Unpack every not-yet-expanded zip into its own attachments (folder paths kept). */
async function expandArchives(quoteId: string): Promise<number> {
  const atts = await prisma.constructionAttachment.findMany({ where: { quoteId } });
  const expanded = new Set(atts.map((a) => a.sourceArchiveId).filter(Boolean));
  let created = 0;
  for (const zip of atts) {
    if (fileTypeOf(zip.fileName, zip.mimeType) !== "ZIP" || expanded.has(zip.id) || zip.bucket === "ARCHIVE") continue;
    const bytes = await downloadFromStorage(zip.storagePath);
    const entries = expandZip(new Uint8Array(bytes), zip.relativePath ?? zip.fileName);
    const existing = new Set(atts.map((a) => a.relativePath ?? a.fileName));
    for (const e of entries) {
      if (existing.has(e.relativePath)) continue;
      const name = baseName(e.relativePath);
      const mimeType = mimeTypeFor(name);
      const path = `construction/${quoteId}/${randomUUID()}-${sanitizeKey(name)}`;
      await uploadToStorage(path, Buffer.from(e.bytes), mimeType, { upsert: true });
      await prisma.constructionAttachment.create({
        data: {
          quoteId,
          fileName: name,
          relativePath: e.relativePath,
          storageBucket: env.storageBucket,
          storagePath: path,
          mimeType,
          sizeBytes: e.bytes.byteLength,
          sourceArchiveId: zip.id,
          // A zip's contents belong to the box the zip went into.
          kind: zip.kind,
        },
      });
      existing.add(e.relativePath);
      created++;
    }
    await prisma.constructionAttachment.update({
      where: { id: zip.id },
      data: { bucket: "ARCHIVE", bucketReason: `Archive — ${entries.length} file${entries.length === 1 ? "" : "s"} unpacked`, useForDrafting: false },
    });
  }
  return created;
}

export interface IngestSummary {
  files: number;
  sheets: number;
  buildings: string[];
  mode: string;
  counts: Record<string, number>;
}

/** Sort a job's files into the register and save it. */
export async function ingestConstructionQuote(quoteId: string): Promise<IngestSummary> {
  await prisma.constructionQuote.update({
    where: { id: quoteId },
    data: { ingestStatus: "RUNNING", ingestError: null },
  });
  try {
    await expandArchives(quoteId);

    const atts = await prisma.constructionAttachment.findMany({
      where: { quoteId },
      orderBy: { createdAt: "asc" },
    });
    const sources: PackSource[] = atts
      .filter((a) => a.bucket !== "ARCHIVE")
      .map((a) => ({
        id: a.id,
        relativePath: a.relativePath ?? a.fileName,
        mimeType: a.mimeType,
        box: a.kind,
        sizeBytes: a.sizeBytes,
        load: () => downloadFromStorage(a.storagePath),
      }));

    const { files, register, geometry } = await ingestPack(sources, { concurrency: 3 });

    // --- Buildings: keep ids stable by code (or name) so measurements keep their link.
    const existingBuildings = await prisma.constructionBuilding.findMany({ where: { quoteId } });
    const buildingId = new Map<string, string>();
    for (const [i, b] of register.buildings.entries()) {
      const match = existingBuildings.find((e) => (b.code ? e.code === b.code : e.code == null && e.name === b.name));
      if (match) {
        await prisma.constructionBuilding.update({ where: { id: match.id }, data: { name: b.name, sortOrder: i } });
        buildingId.set(b.key, match.id);
      } else {
        const created = await prisma.constructionBuilding.create({
          data: { quoteId, name: b.name, code: b.code, sortOrder: i },
        });
        buildingId.set(b.key, created.id);
      }
    }
    const keep = new Set(buildingId.values());
    const stale = existingBuildings.filter((e) => !keep.has(e.id)).map((e) => e.id);
    if (stale.length) await prisma.constructionBuilding.deleteMany({ where: { id: { in: stale } } });

    // --- Files: bucket, hash, page count; the read tick only on first sort.
    const probed = new Map(files.map((f) => [f.id, f]));
    for (const rf of register.files) {
      const att = atts.find((a) => a.id === rf.id);
      if (!att) continue;
      const p = probed.get(rf.id);
      // The read tick is set when the file's bucket is first decided or changes
      // (an email becomes readable once a scope arrives); otherwise it is the estimator's.
      const firstSort = att.bucket !== rf.bucket;
      const readable = rf.bucket === "CORE" || rf.bucket === "CONTEXT" || rf.bucket === "SCOPE";
      await prisma.constructionAttachment.update({
        where: { id: rf.id },
        data: {
          bucket: rf.bucket,
          bucketReason: rf.reason,
          contentHash: p?.contentHash ?? att.contentHash,
          pageCount: p?.pdf?.pageCount ?? att.pageCount,
          mimeType: att.mimeType === "application/octet-stream" ? mimeTypeFor(att.fileName) : att.mimeType,
          ...(firstSort ? { useForDrafting: readable } : {}),
        },
      });
    }

    // --- Sheets: upsert by (file, page); keep the estimator's switch and any valid read.
    const existingSheets = await prisma.constructionSheet.findMany({ where: { quoteId } });
    const seen = new Set<string>();
    for (const s of register.sheets) {
      const key = `${s.fileId}:${s.page}`;
      seen.add(key);
      const prev = existingSheets.find((e) => e.attachmentId === s.fileId && e.page === s.page);
      const hash = probed.get(s.fileId)?.contentHash ?? "";
      const readStillValid = prev?.readKey != null && prev.readKey.startsWith(`${hash}|`);
      const g = geometry.get(key);
      const data = {
        buildingId: s.buildingKey ? (buildingId.get(s.buildingKey) ?? null) : null,
        drawingNo: s.identity.drawingNo,
        title: s.identity.title,
        revision: s.identity.revision,
        kind: s.identity.kind,
        level: s.identity.level,
        face: s.identity.face,
        scale: s.identity.scale,
        paper: s.paper,
        widthPt: s.widthPt,
        heightPt: s.heightPt,
        hasText: s.hasText && !s.raster,
        bucket: s.bucket,
        reason: s.reason,
        superseded: s.superseded,
        geometry: g ? (g as unknown as Prisma.InputJsonValue) : undefined,
      };
      if (prev) {
        await prisma.constructionSheet.update({
          where: { id: prev.id },
          data: {
            ...data,
            ...(readStillValid
              ? {}
              : { readStatus: "NONE", readRawOutput: undefined, readKey: null, readError: null, readMeta: undefined }),
          },
        });
      } else {
        await prisma.constructionSheet.create({
          data: { quoteId, attachmentId: s.fileId, page: s.page, ...data },
        });
      }
    }
    const gone = existingSheets.filter((e) => !seen.has(`${e.attachmentId}:${e.page}`)).map((e) => e.id);
    if (gone.length) await prisma.constructionSheet.deleteMany({ where: { id: { in: gone } } });

    // --- The job: the scenario (always from the boxes), status.
    await prisma.constructionQuote.update({
      where: { id: quoteId },
      data: {
        mode: register.mode,
        ingestStatus: "DONE",
        ingestedAt: new Date(),
        ingestError: null,
      },
    });

    return {
      files: register.files.length,
      sheets: register.sheets.length,
      buildings: register.buildings.map((b) => b.name),
      mode: register.mode,
      counts: register.counts,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.constructionQuote.update({
      where: { id: quoteId },
      data: { ingestStatus: "FAILED", ingestError: message.slice(0, 500) },
    });
    throw e;
  }
}
