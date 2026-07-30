import { PDFDocument } from "pdf-lib";

/** Anthropic's per-request PDF ceiling is ~100 pages / ~32MB. Stay well under. */
export const MAX_PAGES_PER_EXTRACTION = 20;
export const OVERSIZED_PAGE_THRESHOLD = 30;

/** Read the page count of a PDF buffer. */
export async function getPdfPageCount(buffer: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false });
  return doc.getPageCount();
}

/**
 * Extract a sub-range of pages (1-indexed, inclusive) into a new PDF buffer.
 * Used to send only the relevant pages of an oversized pack to Claude.
 */
export async function slicePdf(
  buffer: Buffer,
  startPage: number,
  endPage: number,
): Promise<Buffer> {
  const src = await PDFDocument.load(buffer, { updateMetadata: false });
  const out = await PDFDocument.create();
  const total = src.getPageCount();
  const from = Math.max(1, startPage);
  const to = Math.min(total, endPage);
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  const bytes = await out.save();
  return Buffer.from(bytes);
}

/**
 * Plan how to split a document into extraction jobs.
 * Week 1: naive fixed-size windows. Week 2 replaces this with real elevation
 * sheet-classification so only the relevant pages are sent.
 */
export function planPageRanges(pageCount: number): string[] {
  if (pageCount <= OVERSIZED_PAGE_THRESHOLD) return [`1-${pageCount}`];
  const ranges: string[] = [];
  for (let start = 1; start <= pageCount; start += MAX_PAGES_PER_EXTRACTION) {
    const end = Math.min(start + MAX_PAGES_PER_EXTRACTION - 1, pageCount);
    ranges.push(`${start}-${end}`);
  }
  return ranges;
}

/** Parse a "3-7" range string into { start, end }. */
export function parsePageRange(range: string): { start: number; end: number } {
  const [a, b] = range.split("-").map((n) => parseInt(n, 10));
  return { start: a, end: b ?? a };
}
