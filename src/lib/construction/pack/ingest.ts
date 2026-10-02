/**
 * Construction pack ingest (docs/22 Step 4, docs/23 §5–§6) — SERVER/WORKER ONLY.
 * Probes every file of an enquiry once (hash, PDF pages + text layer, .pptx
 * slides, scope text), builds the register, and extracts the deterministic sheet
 * geometry for every sheet that will be read. No database, no storage: the worker
 * (`src/worker/constructionIngest.ts`) and the offline runner
 * (`scripts/construction-offline.mts`) both call this, so they cannot disagree.
 */

import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { baseName, boxOf, fileTypeOf, junkReason, mimeTypeFor } from "./files";
import { probePdf, type ProbedPdf } from "./pdfProbe";
import { readPptx, type PptxRead } from "./pptx";
import { buildRegister, type RegisterFileInput, type RegisterResult } from "./register";
import { sheetGeometry, type SheetGeometry } from "./sheetGeometry";
import { extractScopeText } from "../scopeText";

export interface PackSource {
  id: string;
  relativePath: string;
  mimeType: string | null;
  /** The upload box (the attachment's `kind`): Scope / Drawings / Email. */
  box?: string | null;
  sizeBytes: number | null;
  load: () => Promise<Buffer>;
}

export interface ProbedFile {
  id: string;
  relativePath: string;
  mimeType: string;
  box?: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
  pdf?: ProbedPdf;
  pptx?: PptxRead;
  /** Readable text of a scope-type file (email, spreadsheet, text). */
  scopeText?: string;
  error?: string;
}

export interface IngestResult {
  files: ProbedFile[];
  register: RegisterResult;
  /** `${fileId}:${page}` → the sheet's deterministic geometry (read sheets only). */
  geometry: Map<string, SheetGeometry>;
}

export const sha256 = (b: Buffer | Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Run `fn` over `items` with at most `n` in flight. */
export async function mapPool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

/**
 * Every file inside a zip (all types — construction packs carry xlsx, pptx, eml
 * as well as PDFs), keeping their folder paths under the archive's own folder.
 * Nested zips are expanded one level deeper; junk is dropped here already.
 */
export function expandZip(zipBytes: Uint8Array, archivePath: string, depth = 0): { relativePath: string; bytes: Uint8Array }[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    return [];
  }
  const dir = archivePath.includes("/") ? archivePath.slice(0, archivePath.lastIndexOf("/") + 1) : "";
  const out: { relativePath: string; bytes: Uint8Array }[] = [];
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith("/") || bytes.length === 0) continue;
    const rel = `${dir}${path}`;
    if (junkReason(rel)) continue;
    if (/\.zip$/i.test(path) && depth < 2) out.push(...expandZip(bytes, rel, depth + 1));
    else out.push({ relativePath: rel, bytes });
  }
  return out;
}

async function probeOne(src: PackSource): Promise<ProbedFile> {
  const mimeType = src.mimeType || mimeTypeFor(src.relativePath);
  const base: ProbedFile = { id: src.id, relativePath: src.relativePath, mimeType, box: src.box ?? null, sizeBytes: src.sizeBytes, contentHash: null };
  // Junk is never downloaded.
  if (junkReason(src.relativePath)) return base;
  try {
    const bytes = await src.load();
    base.contentHash = sha256(bytes);
    base.sizeBytes = base.sizeBytes ?? bytes.byteLength;
    const type = fileTypeOf(src.relativePath, mimeType);
    const box = boxOf(src.box, src.relativePath, mimeType);
    // A file in the Scope or Email box is read as TEXT, whatever its type (a scope PDF too).
    if ((box === "SCOPE" || box === "EMAIL") && type !== "IMAGE" && type !== "ZIP" && type !== "PPTX" && type !== "OTHER") {
      base.scopeText = await extractScopeText({ name: baseName(src.relativePath), mimeType, bytes }).catch(() => "");
    } else if (type === "PDF") base.pdf = await probePdf(bytes);
    else if (type === "PPTX") base.pptx = await readPptx(bytes);
    else if (type === "EMAIL" || type === "SPREADSHEET" || type === "TEXT") {
      base.scopeText = await extractScopeText({ name: baseName(src.relativePath), mimeType, bytes }).catch(() => "");
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

export function toRegisterInput(f: ProbedFile): RegisterFileInput {
  return {
    id: f.id,
    relativePath: f.relativePath,
    mimeType: f.mimeType,
    box: f.box ?? null,
    sizeBytes: f.sizeBytes,
    contentHash: f.contentHash,
    textLength: f.scopeText != null ? f.scopeText.trim().length : null,
    pages: f.pdf?.pages.map((p) => ({
      page: p.page,
      widthPt: p.widthPt,
      heightPt: p.heightPt,
      hasText: p.hasText,
      imageCount: p.imageCount,
      text: p.text,
    })),
    slideText: f.pptx?.text ?? null,
    slides: f.pptx?.slides.map((sl) => ({ index: sl.index, text: sl.text, widthPt: f.pptx!.widthPt, heightPt: f.pptx!.heightPt })),
  };
}

/** Probe → register → geometry. `concurrency` bounds how many PDFs are parsed at once. */
export async function ingestPack(sources: PackSource[], opts: { concurrency?: number } = {}): Promise<IngestResult> {
  const files = await mapPool(sources, opts.concurrency ?? 3, probeOne);
  const register = buildRegister(files.map(toRegisterInput));

  const geometry = new Map<string, SheetGeometry>();
  const byId = new Map(files.map((f) => [f.id, f]));
  for (const s of register.sheets) {
    // Scenario 1 never reads the drawings: no geometry to extract.
    if (register.mode === "A") break;
    if (s.bucket !== "CORE" && s.bucket !== "CONTEXT") continue;
    const page = byId.get(s.fileId)?.pdf?.pages.find((p) => p.page === s.page);
    if (!page || !page.hasText) continue;
    geometry.set(`${s.fileId}:${s.page}`, sheetGeometry(page.items, { scale: s.identity.scale, kind: s.identity.kind }));
  }
  return { files, register, geometry };
}
