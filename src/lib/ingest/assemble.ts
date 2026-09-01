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

import { PDFDocument, type PDFPage } from "pdf-lib";
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
  relevant: boolean; // scaffold-relevant tag (drives extraction + preview)
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
 * (downloaded from Storage by the caller).
 *
 * Each source's requested pages are copied in a SINGLE `copyPages()` call. pdf-lib
 * dedupes shared resources (fonts / images / a common background) only WITHIN one
 * copyPages call — copying pages one at a time re-embeds a source's shared
 * resources once per page, which bloated a 4.7MB / 24-page combined PDF into a
 * 55MB / 17-page assembly and blew past the model's 32MB request limit (HTTP 413).
 * Batching keeps the assembly roughly source-sized (that same case → 3.3MB).
 */
export async function assembleHouseTypePdf(
  group: HouseTypeGrouping,
  sources: Map<string, AssemblySource>,
): Promise<AssembledPdf> {
  const out = await PDFDocument.create();
  const manifest: AssembledPageRef[] = [];
  const skipped: AssembledPdf["skipped"] = [];
  const key = (docId: string, index0: number) => `${docId}:${index0}`;

  // 1. Gather the unique 0-based page indices needed per source (first-seen order),
  //    recording a missing source as skipped.
  const perSource = new Map<string, number[]>();
  const requested = new Set<string>();
  for (const gp of group.pages) {
    if (!sources.get(gp.documentId)) {
      skipped.push({ relativePath: gp.relativePath, sourcePage: gp.page, reason: "source missing" });
      continue;
    }
    const k = key(gp.documentId, gp.page - 1);
    if (requested.has(k)) continue;
    requested.add(k);
    const list = perSource.get(gp.documentId) ?? perSource.set(gp.documentId, []).get(gp.documentId)!;
    list.push(gp.page - 1);
  }

  // 2. Load each source once and copy ALL its pages in ONE call (resources deduped).
  const copiedByKey = new Map<string, PDFPage>();
  for (const [docId, indices] of perSource) {
    const src = sources.get(docId)!;
    try {
      // ignoreEncryption: some builder PDFs carry a benign owner password.
      const doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true });
      const count = doc.getPageCount();
      const valid = indices.filter((i) => {
        if (i >= 0 && i < count) return true;
        skipped.push({ relativePath: src.relativePath, sourcePage: i + 1, reason: "page out of range" });
        return false;
      });
      if (valid.length === 0) continue;
      const copied = await out.copyPages(doc, valid);
      valid.forEach((idx, k2) => copiedByKey.set(key(docId, idx), copied[k2]));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "load/copy failed";
      for (const i of indices) skipped.push({ relativePath: src.relativePath, sourcePage: i + 1, reason });
    }
  }

  // 3. Add pages in the group's reading order and build the manifest.
  const added = new Set<string>();
  for (const gp of group.pages) {
    const k = key(gp.documentId, gp.page - 1);
    const page = copiedByKey.get(k);
    if (!page || added.has(k)) continue; // missing → already in `skipped`; dupe → skip
    added.add(k);
    out.addPage(page);
    manifest.push({
      assembledPage: manifest.length + 1,
      sourceDocumentId: gp.documentId,
      relativePath: gp.relativePath,
      sourcePage: gp.page,
      drawingKind: gp.drawingKind,
      relevant: gp.relevant,
    });
  }

  const bytes = await out.save();
  return { bytes, pageManifest: manifest, pageCount: manifest.length, skipped };
}
