import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageDims } from "./dimensions";
import {
  type PageClass,
  type PageKind,
  TAKEOFF_KINDS,
  classifyByText,
  classifyTitle,
  drawingTitle,
  extractHouseTypeRef,
} from "./classify-rules";

/**
 * Cheap, AI-free page classification from the PDF text layer.
 *
 * House-builder tender packs are mostly irrelevant to a scaffold take-off
 * (electrical, wet-area layouts, schedules, foundations). Every sheet has a
 * title block naming the drawing and (for house-type drawings) a portfolio
 * line carrying the house-type code + name — so we read the text layer to:
 *   1. keep only the sheets a take-off needs (elevations / floor plans / section),
 *   2. tag plot-layout and spec sheets for their own downstream handling,
 *   3. attach the house-type code/name so a pack can be segmented by house type.
 *
 * Worker-only (imports pdfjs) — never import into the Next.js app bundle. The
 * PURE title/keyword logic lives in `classify-rules.ts` (no pdfjs) and is
 * re-exported below so existing `from "./classify"` imports keep working.
 */

export {
  type PageClass,
  type PageKind,
  TAKEOFF_KINDS,
  classifyByText,
  classifyTitle,
  drawingTitle,
  extractHouseTypeRef,
  selectRelevantPages,
} from "./classify-rules";

export async function classifyPdf(
  buffer: Buffer,
): Promise<{ pages: PageClass[]; hasText: boolean }> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const pages: PageClass[] = [];
  let textChars = 0;

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const raw = content.items
      .map((it: unknown) =>
        it && typeof it === "object" && "str" in it
          ? String((it as { str: string }).str)
          : "",
      )
      .join(" ");
    textChars += raw.replace(/\s/g, "").length;

    const titleRaw = drawingTitle(raw);
    let kind = classifyTitle(titleRaw);
    let title = titleRaw;
    // If the title block wasn't parseable (unfamiliar builder), fall back to a
    // direct text scan for drawing-type labels — and prefer its clean label over
    // any letter-spaced gibberish the title fallback produced.
    if (kind === "OTHER") {
      const fb = classifyByText(raw);
      if (fb.kind !== "OTHER") {
        kind = fb.kind;
        title = fb.label;
      }
    }
    const ref = extractHouseTypeRef(raw);

    pages.push({
      page: i,
      kind,
      relevant: TAKEOFF_KINDS.includes(kind),
      houseTypeCode: ref.code,
      houseTypeName: ref.name,
      title: title || null2str(kind),
    });
  }

  const hasText = textChars > doc.numPages * 15;
  return { pages, hasText };
}

function null2str(kind: PageKind): string {
  return kind === "OTHER" ? "" : kind;
}

/**
 * Read the distinct 3–5 digit dimension strings from each page's text layer of
 * an (already-sliced) PDF — page 1 = the first page the model is shown. Feeds the
 * candidate hint + the sourceDimension verifier (see dimensions.ts). Worker-only.
 */
export async function extractDimensionsByPage(buffer: Buffer): Promise<PageDims[]> {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  const out: PageDims[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const raw = content.items
      .map((it: unknown) =>
        it && typeof it === "object" && "str" in it
          ? String((it as { str: string }).str)
          : "",
      )
      .join(" ");
    const set = new Set<string>();
    for (const m of raw.match(/\d{3,5}/g) ?? []) set.add(m);
    out.push({ page: i, tokens: [...set].sort((a, b) => Number(a) - Number(b)) });
  }
  return out;
}
