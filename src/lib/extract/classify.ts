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
// Title-block *labels* that are not the actual drawing title (they precede the
// value in the title block, so a naive anchor would grab them).
function isLabelNoise(s: string): boolean {
  const c = s.toUpperCase().replace(/[^A-Z]/g, "");
  return (
    c.length < 3 ||
    ["DRAWNBY", "CHECKEDBY", "DRAWN", "CHECKED", "SCALE", "DATE", "REVISION", "REV", "STATUS", "TITLE", "DRAWING", "PROJECT", "CLIENT", "NOTES"].includes(c)
  );
}

export function drawingTitle(raw: string): string {
  const up = raw.toUpperCase().replace(/\s+/g, " ");

  // 1. Miller portfolio line: <date> <title> L464 - 4B … (very specific and
  //    reliable). Take the last match (the title block near the end).
  const reMiller = /\d{2}\.\d{2}\.\d{2}\s+(.+?)\s+L\d+\s*-\s*\d/g;
  let match: RegExpExecArray | null;
  let last = "";
  while ((match = reMiller.exec(up)) !== null) last = match[1];
  if (last && !isLabelNoise(last)) return last.trim();

  // 2. "TITLE <...> <terminator>" anchor for consultant title blocks (Travis
  //    Baker etc.). NB: "DRAWN" is NOT a terminator — Miller title blocks put
  //    "TITLE … DRAWN BY" and that grabbed the wrong text.
  const anchor = up.match(
    /\bTITLE\b[:\s-]*([A-Z0-9][A-Z0-9 ,'&/().-]{2,70}?)\s+(?:STATUS|SCALE|CHECKED|DRAWING\s*N|DRG\s*N|DWG\s*N|REVISION|DATE\b|PROJECT\b|CLIENT\b|COPYRIGHT\b)/,
  );
  if (anchor && anchor[1] && !isLabelNoise(anchor[1])) return anchor[1].trim();

  // 3. Letter-spaced big label fallback (G R O U N D  F L O O R  P L A N).
  const labels = up.match(/(?:[A-Z0-9]\s){3,}[A-Z0-9]/g) ?? [];
  const label = labels.length
    ? labels.join(" ").replace(/\s+/g, " ").trim()
    : "";
  return isLabelNoise(label) ? "" : label;
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

/** Classify a sheet from its drawing title. Compacts internally — pass raw or key. */
export function classifyTitle(titleRaw: string): PageKind {
  const title = compact(titleRaw);

  // Site plans win FIRST — a site layout often also says "foundations", which
  // would otherwise be excluded below and lose us the plot list.
  if (
    title.includes("SITELAYOUT") ||
    title.includes("SITEPLAN") ||
    title.includes("PLOTLAYOUT") ||
    title.includes("PLOTSCHEDULE") ||
    title.includes("PLANNINGLAYOUT")
  )
    return "PLOT_LAYOUT";

  // Exclusions — sheets a take-off does NOT need.
  if (title.includes("CUSTOMEROPTION")) return "OTHER";
  if (title.includes("SWIFTBRICK")) return "OTHER";
  if (title.includes("ELECTRICAL")) return "OTHER";
  if (title.includes("JOIST")) return "OTHER";
  if (title.includes("SCHEDULE")) return "OTHER"; // bar / window / door / lintel
  if (title.includes("FOUNDATION")) return "OTHER";
  if (title.includes("DRAINAGE")) return "OTHER";
  if (title.includes("LEVELS")) return "OTHER";
  if (title.includes("LANDSCAP")) return "OTHER";
  if (title.includes("PLANTING")) return "OTHER";
  if (title.includes("TREESURVEY")) return "OTHER";
  if (title.includes("LONGSECTION")) return "OTHER"; // civils road long-sections
  if (title.includes("SIGNINGANDLINING")) return "OTHER"; // highways
  if (title.includes("LAYOUT")) return "OTHER"; // WC / bathroom / kitchen layouts

  // Inclusions — the sheets it does need.
  if (title.includes("ELEVATION")) return "ELEVATION";
  if (title.includes("SECTION")) return "SECTION";
  if (title.includes("FLOORPLAN")) return "FLOOR_PLAN";
  if (title.includes("SPECIFICATION")) return "SPEC";

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

    const titleRaw = drawingTitle(raw);
    const kind = classifyTitle(titleRaw);
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
