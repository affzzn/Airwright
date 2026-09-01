/**
 * Filename / path analyzer (pure, no I/O) — the generic signal layer under the
 * per-builder grouping profiles (`profiles.ts`).
 *
 * House-builders package tender packs as trees of PDFs whose FILE NAME and
 * FOLDER PATH carry most of the identity we need to group pages into house
 * types: the drawing kind (elevation / floor plan / section…), the revision
 * (so the latest wins), the plots the sheet serves, and config/material
 * variants (END/MID, Brick/Stone/Render). This module reads those signals off a
 * relative path *deterministically*. Builder-specific bits — which folder is the
 * house type, which filename regex names it — live in `profiles.ts`; the house
 * type NAME is resolved there, not here.
 *
 * Nothing here guesses a measurement. It only reads what the path literally says.
 * See `docs/17-smart-upload-and-grouping.md` §6-8.
 */

/** The kind of drawing a file/page is, as read from its name. */
export type DrawingKind =
  | "FRONT_ELEVATION"
  | "REAR_ELEVATION"
  | "SIDE_ELEVATION"
  | "GABLE_ELEVATION"
  | "GA_ELEVATION" // apartment "General Arrangement" elevation
  | "ELEVATION" // an elevation whose face we couldn't name
  | "FLOOR_PLAN"
  | "SECTION"
  | "SETTING_OUT" // carries the gross-internal footprint (Colin's birdcage number)
  | "ROOF" // roof plan / truss layout
  | "COMBINED" // a multi-drawing "working drawings" / house-type PDF
  | "JUNK" // a non-scaffold trade sheet (kitchen, SAP, wardrobe, M+E…)
  | "UNKNOWN";

/** Drawing kinds a scaffold take-off actually reads. */
export const RELEVANT_KINDS: ReadonlySet<DrawingKind> = new Set<DrawingKind>([
  "FRONT_ELEVATION",
  "REAR_ELEVATION",
  "SIDE_ELEVATION",
  "GABLE_ELEVATION",
  "GA_ELEVATION",
  "ELEVATION",
  "FLOOR_PLAN",
  "SECTION",
  "SETTING_OUT",
  "ROOF",
  "COMBINED",
]);

export interface Revision {
  raw: string; // as printed, e.g. "ISSUE 7.1", "Ver3", "P02"
  /** A monotonic order so the latest revision wins (higher = newer). */
  order: number;
}

export interface ParsedPath {
  drawingKind: DrawingKind;
  relevant: boolean;
  revision: Revision | null;
  plots: number[];
  configHint: string | null; // END / MID / DETACHED / SEMI / AFFORDABLE…
  materialVariant: string | null; // BRICK / STONE / RENDER / BOARDED
  baseName: string; // filename without extension
  segments: string[]; // folder path segments (excluding the filename)
}

// ── Junk (non-scaffold trades). Checked FIRST so a "…Floor…" in a kitchen
//    services sheet can't masquerade as a floor plan.
const JUNK_PATTERNS: RegExp[] = [
  /\bkitchen\b/i,
  /\butility\b/i,
  /\bwardrobe/i,
  /\bfitted[ _]furniture/i,
  /\bunder[ _]stair/i,
  /\bventilation\b/i,
  /\bheating\b/i,
  /\bplumbing\b/i,
  /\bm\+e\b/i,
  /\bservices\b/i,
  /\bsap\b/i,
  /\bpart[ _]o\b/i,
  /\blintel/i,
  /\bwindpost/i,
  /\bjoist/i, // intermediate-floor joist layouts — structural, not scaffold
  /\bmetsa/i,
  /\bstair(case|craft)?\b/i,
  /\bstructural[ _]appraisal/i,
  /\bstructural[ _]calc/i,
  /\bschedule/i,
  /\bcompliance\b/i,
  /\bm4\(2\)/i,
  /\bfire[ _]strategy/i,
  /\bcustomer[ _]plan/i,
  /\bpc[ _]plank/i,
  /\bindicative\b/i,
  /\bsuppliers?[ _]information/i,
  /\brisk[ _]assessment/i,
  /\b_?ra_?\b/i,
  /\bbathroom\b/i,
  /\ben[ _-]?suite\b/i,
  /\bcloak/i,
  /\bboundaries\b/i,
  /\btake[ _]?offs?\b/i, // the builder's OWN take-off answer sheet — not an input
  /\bmaterials?[ _](layout|schedule|plan)/i,
  /\bsigning[ _]and[ _]lining/i,
  /\bdrainage\b/i,
  /\blandscap/i,
  /\bhighway/i,
];

// ── Relevant kinds, in priority order (first match wins).
const KIND_PATTERNS: [RegExp, DrawingKind][] = [
  [/\bsetting[ _-]?out\b/i, "SETTING_OUT"],
  [/\bsection\b/i, "SECTION"],
  [/\b(roof[ _]?(plan|truss|layout)|truss[ _]layout|roofscape)\b/i, "ROOF"],
  [/\bga[ _]elevation/i, "GA_ELEVATION"],
  [/\bfront[ _]elevation\b/i, "FRONT_ELEVATION"],
  [/\brear[ _]elevation\b/i, "REAR_ELEVATION"],
  [/\bgable[ _]elevation\b/i, "GABLE_ELEVATION"],
  [/\b(side|l\.?h\.?|r\.?h\.?)[ _.]*elevation\b/i, "SIDE_ELEVATION"],
  [/\bga[ _](ground|first|second|third)?[ _]?floor[ _]plan/i, "FLOOR_PLAN"],
  [/\b(ground|first|second|third)[ _]floor[ _]plan\b/i, "FLOOR_PLAN"],
  [/\bfloor[ _]plan\b/i, "FLOOR_PLAN"],
  [/\bsub[ _-]?structure[ _]plan\b/i, "SETTING_OUT"], // substructure GA = footprint
  [/\belevation\b/i, "ELEVATION"],
  [/\b(combined[ _]working[ _]drawings|working[ _]drawing|house[ _]type[ _]pdf)\b/i, "COMBINED"],
];

/** Read the drawing kind off a name (filename or title). Junk is checked first. */
export function drawingKindFromName(name: string): DrawingKind {
  if (JUNK_PATTERNS.some((re) => re.test(name))) return "JUNK";
  for (const [re, kind] of KIND_PATTERNS) if (re.test(name)) return kind;
  return "UNKNOWN";
}

/**
 * Parse a revision into a comparable order so the latest wins. Handles the three
 * conventions seen in real packs: Bloor `ISSUE_7.2` / `ISSUE 4.13`, Tilia
 * `_Ver3`, and consultant `_Preliminary_P02` / `-C1` suffixes.
 */
export function parseRevision(name: string): Revision | null {
  // NB: no leading \b — the keyword is usually preceded by "_" (a word char),
  // so \b would not fire (e.g. "470_HALLAM_ISSUE_7.1").
  let m = name.match(/(?:^|[\s_-])issue[_ ]?(\d+)(?:\.(\d+))?/i);
  if (m) {
    const major = parseInt(m[1], 10);
    const minor = m[2] ? parseInt(m[2], 10) : 0;
    return { raw: `ISSUE ${m[1]}${m[2] ? "." + m[2] : ""}`, order: major * 1000 + minor };
  }
  m = name.match(/[_ -]ver(\d+)\b/i);
  if (m) return { raw: `Ver${m[1]}`, order: parseInt(m[1], 10) };
  m = name.match(/[_ -]p(\d{2})\b/i);
  if (m) return { raw: `P${m[1]}`, order: parseInt(m[1], 10) };
  m = name.match(/[_ -]c(\d+)\b/i);
  if (m) return { raw: `C${m[1]}`, order: parseInt(m[1], 10) };
  return null;
}

/**
 * A stable key for a drawing with its revision token removed, so two revisions
 * of the same sheet collapse to one (latest wins) while genuinely different
 * sheets stay apart. e.g. `470_HALLAM_ISSUE_4.8` and `470_HALLAM_ISSUE_7.1`
 * both → `470 HALLAM`; a front vs a side elevation stay distinct.
 */
export function revisionStrippedKey(baseName: string): string {
  return baseName
    .replace(/[_\s-]+/g, " ") // normalise separators FIRST so \b fires on keywords
    .replace(/\bissue ?\d+(?:\.\d+)?/gi, "")
    .replace(/\bver\d+\b/gi, "")
    .replace(/\bp\d{2}\b/gi, "")
    .replace(/\bc\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * A key that also collapses CONFIG/handing variants of the same drawing (on top of
 * the revision strip): `EMA21-Avonsford END`, `… MID`, `… END AFFORDABLE` all →
 * `EMA21 AVONSFORD`. Used to pick ONE variant per house type for extraction (the
 * others stay in the full dossier). Material variants (Brick/Stone/Render) are kept
 * distinct — they carry render info the take-off needs.
 */
export function variantStrippedKey(baseName: string): string {
  return revisionStrippedKey(baseName)
    .replace(/\b(END|MID|DET|DETACHED|SEMI|AFFORDABLE|LH|RH|LEFT|RIGHT|HANDED|HANDING)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plot numbers a sheet serves, e.g. "Plots 4, 21, 39" → [4,21,39]. */
export function parsePlots(name: string): number[] {
  const m = name.match(/\bplots?\s+([\d,\s&and]+)/i);
  if (!m) return [];
  return [...m[1].matchAll(/\d+/g)]
    .map((x) => parseInt(x[0], 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 10000);
}

/** A config/handing hint carried in the name (END/MID/DET/SEMI/AFFORDABLE…). */
export function parseConfigHint(name: string): string | null {
  const u = name.toUpperCase();
  if (/\bMID\b/.test(u)) return "MID";
  if (/\bEND\b/.test(u)) return "END";
  if (/\bDET(ACHED)?\b/.test(u)) return "DETACHED";
  if (/\bSEMI\b/.test(u)) return "SEMI";
  if (/\bAFFORDABLE\b/.test(u)) return "AFFORDABLE";
  return null;
}

/** A material/finish variant of an elevation (Brick/Stone/Render/Boarded). */
export function parseMaterialVariant(name: string): string | null {
  const u = name.toUpperCase();
  if (/\bRENDER\b|\bGR\b|GABLE[ _]RENDER/.test(u)) return "RENDER";
  if (/\bSTONE\b/.test(u)) return "STONE";
  if (/\bBOARD(ED)?\b/.test(u)) return "BOARDED";
  if (/\bBRICK\b/.test(u)) return "BRICK";
  return null;
}

// ── Canonical take-off "role" of a single page, from its title-block text.
// A combined working-drawings PDF repeats the same drawing across material and
// handing options, so its relevant page count balloons far past what a take-off
// needs. The bloat, on real packs, is the repeated PLANS (a house-type PDF can
// carry 10+ floor-plan pages); collapsing those to one-per-level is safe. See
// docs/17 §5.
//
// ELEVATIONS ARE DELIBERATELY NEVER COLLAPSED. Real title blocks (e.g. Taylor
// Wimpey) label every elevation page identically ("FRONT ELEVATION" / bare
// "ELEVATION") in the text layer, so two pages that read the same may actually be
// different faces or a render variant. Each face carries its own apex / render /
// height reads, and dropping one is a silent hole in the take-off — the exact
// failure recall-over-precision guards against (docs/17 §6). An extra elevation
// page only wastes a few tokens; a missing one mis-prices the quote. So we keep
// them all and let the MAX_EXTRACTION_PAGES cap be the only ceiling.

/** Floor level of a floor plan from its title (GF/FF/SF/TF). */
function floorLevel(u: string): "GF" | "FF" | "SF" | "TF" | null {
  if (/\b(GROUND|GF)\b/.test(u)) return "GF";
  if (/\b(FIRST|FF|1ST)\b/.test(u)) return "FF";
  if (/\b(SECOND|SF|2ND)\b/.test(u)) return "SF";
  if (/\b(THIRD|TF|3RD)\b/.test(u)) return "TF";
  return null;
}

/**
 * The canonical take-off slot a page fills, for de-duplicating the repetitive
 * GEOMETRY pages inside a combined PDF: `PLAN_GF`, `PLAN_FF`, `PLAN_SF`,
 * `PLAN_ROOF`, `PLAN_SETTING_OUT`, `SECTION`, `SECTION_A-A`. Two pages sharing a
 * role are duplicates for a take-off; ONE is read, the rest stay in the dossier.
 *
 * Returns `null` for elevations (never collapsed — see the note above), for a
 * floor plan whose level isn't legible (don't risk merging GF with FF), and for
 * any non-take-off page. A null role means "leave this page's relevance as it is".
 */
export function canonicalPageRole(title: string): string | null {
  if (!title.trim()) return null;
  const u = title.toUpperCase();

  switch (drawingKindFromName(title)) {
    case "FLOOR_PLAN": {
      const floor = floorLevel(u);
      return floor ? `PLAN_${floor}` : null; // unknown level → keep (don't merge GF/FF)
    }
    case "SETTING_OUT":
      return "PLAN_SETTING_OUT";
    case "ROOF":
      return "PLAN_ROOF";
    case "SECTION": {
      const m = u.match(/\bSECTION\s+([A-Z]{1,2})\s*[-–]\s*([A-Z]{1,2})\b/);
      return m ? `SECTION_${m[1]}-${m[2]}` : "SECTION";
    }
    default:
      return null; // elevations / combined / junk / unknown → never collapse
  }
}

/** Split a relative path into folder segments (excluding the filename). */
export function pathSegments(relativePath: string): string[] {
  return relativePath.split("/").slice(0, -1).filter(Boolean);
}

/** Filename without directory or extension. */
export function baseNameOf(relativePath: string): string {
  const file = relativePath.split("/").pop() ?? relativePath;
  return file.replace(/\.[^.]+$/, "");
}

/** Read every generic signal off a relative path. Builder-agnostic. */
export function parsePath(relativePath: string): ParsedPath {
  const baseName = baseNameOf(relativePath);
  const segments = pathSegments(relativePath);
  // Consider the filename AND its immediate folder (apartment packs name the
  // sheet "51_GA ELEVATIONS.pdf" but the kind is unambiguous; TW's combined
  // lives in "00_House_Type_PDF").
  const hay = `${segments.join(" ")} ${baseName}`;
  const drawingKind = drawingKindFromName(hay);
  return {
    drawingKind,
    relevant: RELEVANT_KINDS.has(drawingKind),
    revision: parseRevision(baseName),
    plots: parsePlots(baseName),
    configHint: parseConfigHint(baseName),
    materialVariant: parseMaterialVariant(baseName),
    baseName,
    segments,
  };
}
