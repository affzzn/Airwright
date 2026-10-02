/**
 * Construction pack ingest — open a PDF once and describe every page: size, text
 * layer (positioned items), image count. SERVER/WORKER ONLY: pdfjs is imported
 * lazily so it never reaches the Next.js client bundle (CLAUDE.md gotcha).
 */

import type { TextItem } from "./sheetGeometry";

export interface ProbedPage {
  page: number;
  widthPt: number;
  heightPt: number;
  hasText: boolean;
  imageCount: number;
  items: TextItem[];
  /** The text joined with " | " (identity checks, AI hints). */
  text: string;
}

export interface ProbedPdf {
  pageCount: number;
  pages: ProbedPage[];
}

/** Long documents (specs) only need their first pages probed in full. */
const FULL_PAGES = 6;

export async function probePdf(bytes: Uint8Array | Buffer): Promise<ProbedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(bytes);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const pages: ProbedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const vp = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: TextItem[] = [];
        for (const it of content.items) {
          if (!("str" in it)) continue;
          const s = it.str;
          if (!s || !s.trim()) continue;
          const [a, b, , , x, y] = it.transform as number[];
          items.push({
            s,
            x: Math.round(x * 10) / 10,
            y: Math.round(y * 10) / 10,
            w: Math.round((it.width ?? 0) * 10) / 10,
            h: Math.round((it.height ?? 0) * 10) / 10,
            vertical: Math.abs(b) > Math.abs(a),
          });
        }
        // Image count tells a raster "Print to PDF" sheet from a blank page.
        let imageCount = 0;
        const big = Math.max(vp.width, vp.height) > 900; // larger than A4
        if (i <= FULL_PAGES || big) {
          const ops = await page.getOperatorList();
          for (const fn of ops.fnArray)
            if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) imageCount++;
        }
        pages.push({
          page: i,
          widthPt: Math.round(vp.width * 10) / 10,
          heightPt: Math.round(vp.height * 10) / 10,
          hasText: items.length > 0,
          imageCount,
          items: i <= FULL_PAGES || big ? items : [],
          text: items.map((t) => t.s.trim()).join(" | ").slice(0, 60_000),
        });
      } finally {
        page.cleanup();
      }
    }
    return { pageCount: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}
