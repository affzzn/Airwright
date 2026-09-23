/**
 * Construction DRAWING reader (docs/20 §3/§14) — extract the text layer (labels +
 * dimension strings) from a drawing PDF, so the model reads them as TEXT and only
 * uses the image for spatial reasoning. Server-only; pdfjs is lazy-imported so the
 * non-drawing paths never load it.
 *
 * A "Print to PDF" raster sheet (docs/20 §1.2, eg-02) has no text layer → hasText
 * is false and the reader treats measurements as manual.
 */

/** Per-page text cap — an A1 CAD sheet's text layer can be large (schedules etc.). */
const MAX_PAGE_CHARS = 12_000;

export interface DrawingText {
  hasText: boolean;
  pageCount: number;
  pageTexts: { page: number; text: string }[];
}

/** Read the text layer of every page. Never throws for a raster PDF — returns empty text. */
export async function extractDrawingText(bytes: Buffer): Promise<DrawingText> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(bytes);
  const doc = await getDocument({ data, isEvalSupported: false }).promise;
  try {
    const pageTexts: { page: number; text: string }[] = [];
    let any = false;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        const raw = content.items
          .map((it) => ("str" in it ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        const text = raw.length > MAX_PAGE_CHARS ? raw.slice(0, MAX_PAGE_CHARS) + " …(truncated)" : raw;
        if (text) any = true;
        pageTexts.push({ page: i, text });
      } finally {
        page.cleanup();
      }
    }
    return { hasText: any, pageCount: doc.numPages, pageTexts };
  } finally {
    await doc.destroy();
  }
}
