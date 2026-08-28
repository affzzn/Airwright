/**
 * Combined-PDF assembly (`docs/17-smart-upload-and-grouping.md` §9).
 *
 * A house type's scaffold pages can be spread across many source files (loose
 * single-page elevations, a floor plan, a section…). To keep the extractor and
 * review screen unchanged, we MERGE a group's chosen pages into ONE synthetic
 * PDF — in reading order — and record a page manifest mapping every assembled
 * page back to its source file + page, so provenance stays traceable.
 *
 * Uses pdf-lib (already a dependency). Runs in the worker.
 */

import { PDFDocument } from "pdf-lib";
import type { HouseTypeGrouping } from "./group";

export interface AssemblySource {
  documentId: string;
  relativePath: string;
  bytes: Uint8Array | ArrayBuffer;
}

/** One assembled page's trace back to where it came from. */
export interface AssembledPageRef {
  assembledPage: number; // 1-based in the combined PDF
  sourceDocumentId: string;
  relativePath: string;
  sourcePage: number; // 1-based in the source file
  drawingKind: string;
}

export interface AssembledPdf {
  bytes: Uint8Array;
  pageManifest: AssembledPageRef[];
  pageCount: number;
  /** Source pages that couldn't be copied (missing/corrupt), for flagging. */
  skipped: { relativePath: string; sourcePage: number; reason: string }[];
}

/**
 * Merge a group's pages into one PDF. `sources` maps documentId → its raw bytes
 * (downloaded from Storage by the caller). Source docs are parsed once and reused.
 */
export async function assembleHouseTypePdf(
  group: HouseTypeGrouping,
  sources: Map<string, AssemblySource>,
): Promise<AssembledPdf> {
  const out = await PDFDocument.create();
  const parsed = new Map<string, PDFDocument>();
  const manifest: AssembledPageRef[] = [];
  const skipped: AssembledPdf["skipped"] = [];

  for (const gp of group.pages) {
    const src = sources.get(gp.documentId);
    if (!src) {
      skipped.push({ relativePath: gp.relativePath, sourcePage: gp.page, reason: "source missing" });
      continue;
    }
    try {
      let doc = parsed.get(gp.documentId);
      if (!doc) {
        // ignoreEncryption: some builder PDFs carry a benign owner password.
        doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
        parsed.set(gp.documentId, doc);
      }
      const index = gp.page - 1; // manifest pages are 1-based; pdf-lib is 0-based
      if (index < 0 || index >= doc.getPageCount()) {
        skipped.push({ relativePath: gp.relativePath, sourcePage: gp.page, reason: "page out of range" });
        continue;
      }
      const [copied] = await out.copyPages(doc, [index]);
      out.addPage(copied);
      manifest.push({
        assembledPage: manifest.length + 1,
        sourceDocumentId: gp.documentId,
        relativePath: gp.relativePath,
        sourcePage: gp.page,
        drawingKind: gp.drawingKind,
      });
    } catch (err) {
      skipped.push({
        relativePath: gp.relativePath,
        sourcePage: gp.page,
        reason: err instanceof Error ? err.message : "copy failed",
      });
    }
  }

  const bytes = await out.save();
  return { bytes, pageManifest: manifest, pageCount: manifest.length, skipped };
}
