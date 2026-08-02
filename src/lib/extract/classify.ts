import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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
 * Worker-only (imports pdfjs) — never import into the Next.js app bundle.
 */

// Mirrors the Prisma PageKind enum.
export type PageKind =
  | "ELEVATION"
  | "FLOOR_PLAN"
  | "SECTION"
  | "PLOT_LAYOUT"
  | "SPEC"
  | "OTHER";

export interface PageClass {
  page: number;
  kind: PageKind;
  relevant: boolean; // relevant to a scaffold take-off (elevation/floor plan/section)
  houseTypeCode: string | null;
  houseTypeName: string | null;
  title: string; // human-readable drawing title, for display
}

const TAKEOFF_KINDS: PageKind[] = ["ELEVATION", "FLOOR_PLAN", "SECTION"];

/** Strip everything but A-Z0-9 and uppercase — for robust keyword matching. */
function compact(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The drawing title sits in the title block: after the "drawn" date (dd.mm.yy)
 * and before the portfolio code ("L464 - 4B ..."). We take the LAST such match
 * (the title block near the end), so body text doesn't cause false matches.
 * Returns the raw (spaced) title for display.
 */
function drawingTitleRaw(raw: string): string {
  const up = raw.toUpperCase().replace(/\s+/g, " ");
  const re = /\d{2}\.\d{2}\.\d{2}\s+(.+?)\s+L\d+\s*-\s*\d/g;
  let match: RegExpExecArray | null;
  let last = "";
  while ((match = re.exec(up)) !== null) last = match[1];
  return last.trim();
}

/** Fallback for sheets without the standard title block: letter-spaced label. */
function labelText(raw: string): string {
  const matches = raw.toUpperCase().match(/(?:[A-Z0-9]\s){3,}[A-Z0-9]/g) ?? [];
  return compact(matches.join(" "));
}

/**
 * House-type code + name from the portfolio line, e.g.
 * "L464 - 4B / 8P / 1337 - CHESTERWOOD 2024 NATIONAL PORTFOLIO" → {1337, CHESTERWOOD}.
 */
export function extractHouseTypeRef(raw: string): {
  code: string | null;
  name: string | null;
} {
  const up = raw.toUpperCase().replace(/\s+/g, " ");
  const m = up.match(
    /(\d{3,4})\s*-\s*([A-Z][A-Z'\- ]+?)\s+(?:\d{4}\s+)?NATIONAL PORTFOLIO/,
  );
  if (m) return { code: m[1], name: m[2].trim().replace(/\s+/g, " ") };
  return { code: null, name: null };
}

function classifyTitle(title: string): PageKind {
  // Exclusions first — sheets a take-off does NOT need.
  if (title.includes("CUSTOMEROPTION")) return "OTHER";
  if (title.includes("SWIFTBRICK")) return "OTHER";
  if (title.includes("ELECTRICAL")) return "OTHER";
  if (title.includes("FOUNDATION")) return "OTHER";
  if (title.includes("JOIST")) return "OTHER";
  if (title.includes("LAYOUT") && !title.includes("SITE") && !title.includes("PLOT"))
    return "OTHER"; // WC / bathroom / kitchen layouts
  if (title.includes("SCHEDULE")) return "OTHER";

  // Non-take-off but useful sheets (tagged for later handling).
  if (
    title.includes("SITELAYOUT") ||
    title.includes("SITEPLAN") ||
    title.includes("PLOTLAYOUT") ||
    title.includes("PLANNINGLAYOUT") ||
    title.includes("PLOTSCHEDULE")
  )
    return "PLOT_LAYOUT";
  if (title.includes("SPECIFICATION")) return "SPEC";

  // Take-off sheets.
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

    const titleRaw = drawingTitleRaw(raw);
    const titleKey = compact(titleRaw) || labelText(raw);
    const kind = classifyTitle(titleKey);
    const ref = extractHouseTypeRef(raw);

    pages.push({
      page: i,
      kind,
      relevant: TAKEOFF_KINDS.includes(kind),
      houseTypeCode: ref.code,
      houseTypeName: ref.name,
      title: titleRaw || null2str(kind),
    });
  }

  const hasText = textChars > doc.numPages * 15;
  return { pages, hasText };
}

function null2str(kind: PageKind): string {
  return kind === "OTHER" ? "" : kind;
}

export function selectRelevantPages(pages: PageClass[]): number[] {
  return pages.filter((p) => p.relevant).map((p) => p.page);
}
