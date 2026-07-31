import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Cheap, AI-free page classification from the PDF text layer.
 *
 * House-builder tender packs are mostly irrelevant to a scaffold take-off
 * (electrical, wet-area layouts, schedules, foundations). Every sheet has a
 * title block naming the drawing, so we read the text layer and keep only the
 * elevations, floor plans and section — then send ONLY those pages to Claude.
 * This typically cuts pages sent to the model by ~70%+.
 *
 * Worker-only (imports pdfjs) — never import into the Next.js app bundle.
 */

export type PageKind = "ELEVATION" | "FLOOR_PLAN" | "SECTION" | "OTHER";

export interface PageClass {
  page: number;
  kind: PageKind;
  relevant: boolean;
}

const RELEVANT_KINDS: PageKind[] = ["ELEVATION", "FLOOR_PLAN", "SECTION"];

/** Strip everything but A-Z0-9 and uppercase — for robust keyword matching. */
function compact(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The drawing title sits in the title block: after the "drawn" date
 * (dd.mm.yy) and before the portfolio code ("L464 - 4B ..."). We take the
 * LAST such match, which is the title block near the end of the page. This is
 * far more reliable than scanning the whole page (body text like "FOUNDATIONS
 * ARE INDICATIVE" on a section sheet would otherwise cause false matches).
 */
function drawingTitle(raw: string): string {
  const up = raw.toUpperCase().replace(/\s+/g, " ");
  const re = /\d{2}\.\d{2}\.\d{2}\s+(.+?)\s+L\d+\s*-\s*\d/g;
  let match: RegExpExecArray | null;
  let last = "";
  while ((match = re.exec(up)) !== null) last = match[1];
  return compact(last);
}

/** Fallback for sheets without the standard title block: letter-spaced label. */
function labelText(raw: string): string {
  const matches = raw.toUpperCase().match(/(?:[A-Z0-9]\s){3,}[A-Z0-9]/g) ?? [];
  return compact(matches.join(" "));
}

function classify(raw: string): PageKind {
  const title = drawingTitle(raw) || labelText(raw);

  // Exclusions first — the sheets a scaffold take-off does NOT need.
  if (title.includes("CUSTOMEROPTION")) return "OTHER";
  if (title.includes("SWIFTBRICK")) return "OTHER";
  if (title.includes("ELECTRICAL")) return "OTHER";
  if (title.includes("FOUNDATION")) return "OTHER";
  if (title.includes("JOIST")) return "OTHER";
  if (title.includes("LAYOUT")) return "OTHER"; // WC / bathroom / kitchen etc.
  if (title.includes("SCHEDULE")) return "OTHER"; // window / door / lintel

  // Inclusions — the sheets it does need.
  if (title.includes("ELEVATION")) return "ELEVATION";
  if (title.includes("SECTION")) return "SECTION";
  if (title.includes("FLOORPLAN")) return "FLOOR_PLAN";

  return "OTHER";
}

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
    const kind = classify(raw);
    pages.push({ page: i, kind, relevant: RELEVANT_KINDS.includes(kind) });
  }

  // If there's almost no text, this is a scanned/raster PDF — classification
  // isn't reliable and the caller should fall back.
  const hasText = textChars > doc.numPages * 15;
  return { pages, hasText };
}

export function selectRelevantPages(pages: PageClass[]): number[] {
  return pages.filter((p) => p.relevant).map((p) => p.page);
}
