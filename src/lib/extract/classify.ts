import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PageDims } from "./dimensions";

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

  // Site / plot layouts are NOT used — plots come from confirming a take-off, not
  // from reading a site plan. Named here so they fall straight to OTHER (not
  // relevant) rather than being mistaken for a take-off sheet.
  if (
    title.includes("SITELAYOUT") ||
    title.includes("SITEPLAN") ||
    title.includes("PLOTLAYOUT") ||
    title.includes("PLOTSCHEDULE") ||
    title.includes("PLANNINGLAYOUT")
  )
    return "OTHER";

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
  // Building "Setting Out Plan" (Beam & Block / Suspended Slab) carries the
  // gross-internal footprint area + exterior-wall run — the source of Colin's
  // birdcage number (docs/13 §3.10). Civils setting-out (drainage/foundation/
  // levels) is already excluded above; guard the remaining civils/site terms.
  if (
    title.includes("SETTINGOUTPLAN") &&
    !title.includes("ROAD") &&
    !title.includes("KERB") &&
    !title.includes("HIGHWAY") &&
    !title.includes("SEWER") &&
    !title.includes("SITE") &&
    !title.includes("EXTERNALWORKS")
  )
    return "FLOOR_PLAN";
  if (title.includes("SPECIFICATION")) return "SPEC";

  return "OTHER";
}

/**
 * Fallback classifier for builders whose title block we don't parse (e.g. Bloor
 * / NSS sheets have no Miller portfolio line or "TITLE … SCALE" anchor). Scans
 * the page text for strong, standalone drawing-type labels — "FRONT ELEVATION",
 * "GROUND FLOOR PLAN", "SITE LAYOUT" — with the internal-elevation and civils
 * exclusions Colin's rules require. Only used when the title-based classifier
 * returns OTHER, so it can only ADD recall, never change a confident result.
 */
export function classifyByText(raw: string): { kind: PageKind; label: string } {
  const up = raw.toUpperCase().replace(/\s+/g, " ");
  const none = { kind: "OTHER" as PageKind, label: "" };

  if (/\bLONG\s*SECTIONS?\b/.test(up)) return none; // civils, not a house section

  // Drawing types win over a plot reference: these dense combined sheets mention
  // "plot"/"site plan" incidentally, so an ELEVATION or FLOOR PLAN page must not
  // be stolen by PLOT_LAYOUT (which is not take-off-relevant). We favour recall —
  // an extra page costs nothing, a missed elevation loses the take-off.
  const internalOnly =
    /\bELEVATIONS?\b/.test(up) &&
    !/\b(FRONT|REAR|SIDE|GABLE|PROPOSED|EXTERNAL)\b[A-Z0-9 ,'&/().-]{0,24}\bELEVATIONS?\b/.test(up) &&
    /\b(KITCHEN|CLOAK|BATHROOM|EN[\s-]?SUITE|UTILITY|W\.?C\.?|WARDROBE|INTERNAL)\b[A-Z0-9 ,'&/().-]{0,24}\bELEVATIONS?\b/.test(
      up,
    );
  const elev = up.match(
    /\b((?:FRONT|REAR|SIDE|GABLE|PROPOSED|EXTERNAL)[A-Z0-9 ,'&/().-]{0,24}?)?\bELEVATIONS?\b/,
  );
  if (!internalOnly && elev)
    return { kind: "ELEVATION", label: (elev[0] || "ELEVATION").trim().slice(0, 40) };

  const floor = up.match(
    /\b((?:GROUND|FIRST|SECOND|THIRD|ROOF|GF|FF|SF)[A-Z0-9 ,'&/().-]{0,12}?)?\bFLOOR\s*PLANS?\b/,
  );
  if (floor) return { kind: "FLOOR_PLAN", label: (floor[0] || "FLOOR PLAN").trim().slice(0, 40) };

  // House sections (not civils long-sections, excluded above) are take-off-relevant.
  if (/\bSECTION\s+[A-Z]{1,2}\s*[-–]\s*[A-Z]{1,2}\b|\bCROSS[\s-]?SECTION\b/.test(up))
    return { kind: "SECTION", label: "SECTION" };

  // Building setting-out plan (footprint + gross-internal area — docs/13 §3.10).
  // Take-off-relevant. Exclude civils setting-out (road / drainage / foundation /
  // site / sewer), which name what they're setting out.
  if (
    /\bSETTING\s*OUT\s*PLAN\b/.test(up) &&
    !/\b(ROAD|KERB|HIGHWAY|SEWER|ADOPTAB|EXTERNAL\s*WORKS)\b/.test(up) &&
    !/\b(SITE|DRAINAGE|FOUNDATION|LEVELS?)\s+SETTING\s*OUT\b/.test(up)
  )
    return { kind: "FLOOR_PLAN", label: "SETTING OUT PLAN" };

  return none;
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

export function selectRelevantPages(pages: PageClass[]): number[] {
  return pages.filter((p) => p.relevant).map((p) => p.page);
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
