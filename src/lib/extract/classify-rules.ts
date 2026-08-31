/**
 * PURE page-classification logic + the keyword rule lists — NO pdfjs.
 *
 * The title/text parsing and the classification keyword lists live here (with no
 * `pdfjs-dist` import), so they are safe to import anywhere: the pdfjs-based page
 * reader in `classify.ts` (worker-only) imports these, and so does the Dev spec
 * page (which must never pull pdfjs into the Next.js app bundle). `classify.ts`
 * re-exports everything here, so existing `from "./classify"` imports still work.
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

/** The page kinds a scaffold take-off actually needs. */
export const TAKEOFF_KINDS: PageKind[] = ["ELEVATION", "FLOOR_PLAN", "SECTION"];

/**
 * Site / plot layouts are NOT used — plots come from confirming a take-off, not
 * from reading a site plan. Named so they fall straight to OTHER (not relevant)
 * rather than being mistaken for a take-off sheet.
 */
export const SITE_LAYOUT_TERMS = [
  "SITELAYOUT",
  "SITEPLAN",
  "PLOTLAYOUT",
  "PLOTSCHEDULE",
  "PLANNINGLAYOUT",
];

/** Title keywords for sheets a take-off does NOT need → OTHER. */
export const EXCLUSION_TERMS = [
  "CUSTOMEROPTION",
  "SWIFTBRICK",
  "ELECTRICAL",
  "JOIST",
  "SCHEDULE", // bar / window / door / lintel
  "FOUNDATION",
  "DRAINAGE",
  "LEVELS",
  "LANDSCAP",
  "PLANTING",
  "TREESURVEY",
  "LONGSECTION", // civils road long-sections
  "SIGNINGANDLINING", // highways
  "LAYOUT", // WC / bathroom / kitchen layouts
];

/**
 * A "Setting Out Plan" is a take-off-relevant floor plan (it carries the gross-
 * internal footprint area). These terms mark a CIVILS setting-out plan (road /
 * drainage / site) that must NOT be treated as a house floor plan.
 */
export const SETTING_OUT_CIVIL_GUARDS = [
  "ROAD",
  "KERB",
  "HIGHWAY",
  "SEWER",
  "SITE",
  "EXTERNALWORKS",
];

/** Strip everything but A-Z0-9 and uppercase — for robust keyword matching. */
function compact(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Title-block *labels* that are not the actual drawing title (they precede the
// value in the title block, so a naive anchor would grab them).
function isLabelNoise(s: string): boolean {
  const c = s.toUpperCase().replace(/[^A-Z]/g, "");
  return (
    c.length < 3 ||
    ["DRAWNBY", "CHECKEDBY", "DRAWN", "CHECKED", "SCALE", "DATE", "REVISION", "REV", "STATUS", "TITLE", "DRAWING", "PROJECT", "CLIENT", "NOTES"].includes(c)
  );
}

/**
 * The drawing title sits in the title block: after the "drawn" date (dd.mm.yy)
 * and before the portfolio code ("L464 - 4B ..."). We take the LAST such match
 * (the title block near the end), so body text doesn't cause false matches.
 * Returns the raw (spaced) title for display.
 */
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

  // Site / plot layouts are NOT used (see SITE_LAYOUT_TERMS) → OTHER.
  if (SITE_LAYOUT_TERMS.some((t) => title.includes(t))) return "OTHER";

  // Exclusions — sheets a take-off does NOT need.
  for (const t of EXCLUSION_TERMS) if (title.includes(t)) return "OTHER";

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
    !SETTING_OUT_CIVIL_GUARDS.some((g) => title.includes(g))
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

export function selectRelevantPages(pages: PageClass[]): number[] {
  return pages.filter((p) => p.relevant).map((p) => p.page);
}
