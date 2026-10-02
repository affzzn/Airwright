/**
 * Construction pack ingest (docs/23 §5.4) — PURE sheet identity: drawing number,
 * title, revision, status, scale, kind, level, face and building code, read from
 * the file name, its folders and the page's text layer (in that order of trust).
 *
 * Deliberately NOT the house-build `parsePath` rules: those treat "stair" and
 * "schedule" as junk, which is wrong for a construction pack (stair cores and the
 * client's scaffold schedule matter here).
 */

export type SheetKind =
  | "PLAN"
  | "ROOF_PLAN"
  | "ELEVATION"
  | "SECTION"
  | "MARKUP"
  | "SITE_PLAN"
  | "LOGISTICS_PLAN"
  | "SURVEY"
  | "REGISTER"
  | "SCOPE"
  | "SCHEDULE"
  | "DETAIL"
  | "FINISHES"
  | "FURNITURE"
  | "SPEC"
  | "OTHER";

export interface SheetIdentity {
  drawingNo: string | null;
  title: string;
  revision: string | null;
  /** Comparable order so the latest revision of a drawing number wins. */
  revisionOrder: number | null;
  status: string | null;
  scale: string | null;
  kind: SheetKind;
  /** Where the kind was decided: the title, a folder name, the text layer, or nothing. */
  kindSource: "title" | "folder" | "text" | "none";
  level: string | null;
  face: string | null;
  /** A building code carried in the drawing number (Bovis `…-CCH01-…`). */
  buildingCode: string | null;
}

// Order matters: the first match wins.
const KIND_RULES: [RegExp, SheetKind][] = [
  [/mark[\s_-]?up|marked[\s_-]?up|scaffold(ing)?[\s_-]+measure/i, "MARKUP"],
  [/issue[\s_-]*sheet|drawing[\s_-]*register|document[\s_-]*register|transmittal/i, "REGISTER"],
  [/scaffold(ing)?[\s_-]+(schedule|scope)|scope[\s_-]+of[\s_-]+works/i, "SCOPE"],
  [/\bnbs\b|specification|\bspec\b|preliminaries/i, "SPEC"],
  [/furniture|funiture|room[\s_-]*data/i, "FURNITURE"],
  [/finishes|ceiling|flooring/i, "FINISHES"],
  // "Section Details" (a Bovis section sheet with heights) is a SECTION, but
  // "Canopy Section Details" / "Detail Section Drawings" are construction details.
  [/^(proposed[\s_-]+)?sections?[\s_-]+details?\b/i, "SECTION"],
  [/\bdetails?\b|railing|junction|vent[\s_-]*brick/i, "DETAIL"],
  [/schedule/i, "SCHEDULE"],
  [/existing[\s_-]+(site|floor|building)|topographic|topo[\s_-]*survey|measured[\s_-]*survey|site[\s_-]*survey/i, "SURVEY"],
  [/compound|logistic|traffic[\s_-]*management|\bcdm\b|site[\s_-]*set[\s_-]*up|phasing/i, "LOGISTICS_PLAN"],
  [/site[\s_-]*plan|location[\s_-]*plan|block[\s_-]*plan|site[\s_-]*layout|way[\s_-]*in[\s_-]*to[\s_-]*site/i, "SITE_PLAN"],
  [/roof(ing)?[\s_-]*(plan|layout)|roofscape|sky[\s_-]*lights?[\s_-]*(locations?|plan|layout)/i, "ROOF_PLAN"],
  [/elevation/i, "ELEVATION"],
  [/\bsections?\b/i, "SECTION"],
  [/floor[\s_-]*plan|ground[\s_-]*floor|first[\s_-]*floor|second[\s_-]*floor|third[\s_-]*floor|basement|mezzanine|general[\s_-]*arrangement|\bga[\s_-]*plan|\bplans?\b|\blayout\b/i, "PLAN"],
];

export function kindFromText(text: string): SheetKind {
  for (const [re, kind] of KIND_RULES) if (re.test(text)) return kind;
  return "OTHER";
}

const LEVEL_RULES: [RegExp, string][] = [
  [/basement|lower[\s_-]*ground/i, "B1"],
  [/ground[\s_-]*floor|\bgf\b/i, "GF"],
  [/first[\s_-]*floor|\b1st[\s_-]*floor|\bff\b/i, "1F"],
  [/second[\s_-]*floor|\b2nd[\s_-]*floor/i, "2F"],
  [/third[\s_-]*floor|\b3rd[\s_-]*floor/i, "3F"],
  [/fourth[\s_-]*floor|\b4th[\s_-]*floor/i, "4F"],
  [/fifth[\s_-]*floor|\b5th[\s_-]*floor/i, "5F"],
];

export function levelFromText(text: string, kind: SheetKind): string | null {
  if (kind === "ROOF_PLAN") return "RF";
  for (const [re, lvl] of LEVEL_RULES) if (re.test(text)) return lvl;
  return null;
}

const FACE_RULES: [RegExp, string][] = [
  [/\bnorth[\s_-]*(east|west)\b/i, "NORTH_$1"],
  [/\bsouth[\s_-]*(east|west)\b/i, "SOUTH_$1"],
  [/\bnorth\b/i, "NORTH"],
  [/\bsouth\b/i, "SOUTH"],
  [/\beast\b/i, "EAST"],
  [/\bwest\b/i, "WEST"],
  [/\bfront\b/i, "FRONT"],
  [/\b(rear|back)\b/i, "REAR"],
  [/\b(left|lh)[\s_-]*(side)?\b/i, "LEFT"],
  [/\b(right|rh)[\s_-]*(side)?\b/i, "RIGHT"],
  [/\bside\b/i, "SIDE"],
  [/\bgable\b/i, "GABLE"],
];

export function faceFromText(text: string): string | null {
  for (const [re, face] of FACE_RULES) {
    const m = re.exec(text);
    if (m) return face.includes("$1") ? face.replace("$1", (m[1] ?? "").toUpperCase()) : face;
  }
  return null;
}

/** The scales drawings are actually printed at (a "1:1990" in a note is a standard's year). */
const REAL_SCALES = new Set([1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 1250, 2000, 2500, 5000]);

/**
 * The sheet's scale: "1 : 50", "1:50 @ A1" → "1:50". Ignores ratios that are not
 * a drawing scale (CBAND's notes cite "BS 5499:PART 1:1990"). Prefers a scale
 * printed with its paper size, then the most frequent. NTS when a sheet says so
 * and prints no ratio.
 */
export function scaleFromText(text: string): string | null {
  const found: { d: number; paper: boolean }[] = [];
  for (const m of text.matchAll(/\b1\s*:\s*(\d{1,4})\b(\s*@\s*A\d)?/g)) {
    const d = Number(m[1]);
    if (REAL_SCALES.has(d)) found.push({ d, paper: Boolean(m[2]) });
  }
  const withPaper = found.find((f) => f.paper);
  if (withPaper) return `1:${withPaper.d}`;
  if (found.length) {
    const freq = new Map<number, number>();
    for (const f of found) freq.set(f.d, (freq.get(f.d) ?? 0) + 1);
    const best = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return `1:${best}`;
  }
  if (/\bN\.?T\.?S\.?\b|not[\s_-]+to[\s_-]+scale/i.test(text)) return "NTS";
  return null;
}

/**
 * Revision → comparable order (higher = newer). Handles `T9`, `P02`, `C1`,
 * a bare two-digit suffix (`_07`), `Rev B`, `ISSUE 7.1`. Construction status
 * letters rank P (preliminary) < T (tender) < C (construction).
 */
export function revisionOrder(rev: string | null): number | null {
  if (!rev) return null;
  const r = rev.trim().toUpperCase();
  let m = /^([PTC])(\d{1,3})$/.exec(r);
  if (m) return ({ P: 1, T: 2, C: 3 }[m[1] as "P" | "T" | "C"]) * 1000 + Number(m[2]);
  m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(r);
  if (m) return Number(m[1]) * 100 + Number(m[2] ?? 0);
  m = /^([A-Z])$/.exec(r);
  if (m) return m[1].charCodeAt(0) - 64;
  m = /^ISSUE\s*(\d+)(?:\.(\d+))?$/.exec(r);
  if (m) return Number(m[1]) * 100 + Number(m[2] ?? 0);
  return null;
}

interface NameParts {
  drawingNo: string | null;
  title: string;
  revision: string | null;
  status: string | null;
}

/** Split a file name into drawing number / title / revision / status. */
export function parseFileName(fileName: string): NameParts {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, "").trim();

  // KE-style: "2591.1100.T9 Proposed Ground Floor Plan"
  let m = /^(\d{3,6}\.\d{3,6})(?:\.([A-Z]{1,2}\d{1,3}))?\s+(.+)$/.exec(stem);
  if (m) return { drawingNo: m[1], revision: m[2] ?? null, title: m[3].trim(), status: null };

  // Bovis / BS 1192 style: "CBAND-BOV-CCH01-GF-D2-A-AS-0201_Ground Floor Plan_For Construction_07"
  m = /^([A-Z0-9]+(?:-[A-Z0-9]+){4,})[_\s]+(.+?)(?:[_\s]+(for[\s_]+[a-z ]+?))?(?:[_\s]+(\d{1,3}|[PTC]\d{1,3}))?$/i.exec(stem);
  if (m)
    return {
      drawingNo: m[1],
      title: m[2].replace(/_/g, " ").trim(),
      status: m[3] ? m[3].replace(/_/g, " ").trim() : null,
      revision: m[4] ?? null,
    };

  // Code-and-revision only, e.g. "XWM.12.233_06"
  m = /^([A-Z]{2,}[A-Z0-9]*(?:[.-][A-Z0-9]+){1,})[_\s-]+(\d{1,3}|[PTC]\d{1,3})$/i.exec(stem);
  if (m) return { drawingNo: m[1], title: m[1], revision: m[2], status: null };

  // Anything else: the whole stem is the title; pick up a trailing revision.
  let title = stem.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  let revision: string | null = null;
  const rev = /[\s-]+(?:rev(?:ision)?\.?\s*([A-Z0-9]{1,3})|([PTC]\d{2}))$/i.exec(title);
  if (rev) {
    revision = (rev[1] ?? rev[2]).toUpperCase();
    title = title.slice(0, rev.index).trim();
  }
  return { drawingNo: null, title, revision, status: null };
}

/** The Bovis/BS1192 drawing number's building field (`CBAND-BOV-CCH01-…` → CCH01). */
export function buildingCodeFromNumber(drawingNo: string | null): string | null {
  if (!drawingNo || !drawingNo.includes("-")) return null;
  const parts = drawingNo.split("-");
  if (parts.length < 6) return null;
  const code = parts[2];
  return /^[A-Z]{2,}\d{1,3}$/i.test(code) ? code.toUpperCase() : null;
}

/** The Bovis/BS1192 level field (`…-GF-…`, `…-RD-…`, `…-XX-…`). */
function levelFromNumber(drawingNo: string | null): string | null {
  if (!drawingNo || !drawingNo.includes("-")) return null;
  const f = drawingNo.split("-")[3]?.toUpperCase();
  if (!f) return null;
  if (f === "GF" || f === "00") return "GF";
  if (f === "01" || f === "FF" || f === "1F") return "1F";
  if (f === "02" || f === "SF" || f === "2F") return "2F";
  if (f === "RF" || f === "RD" || f === "R0") return "RF";
  return null;
}

export function paperFromSize(widthPt: number, heightPt: number): string {
  const longMm = (Math.max(widthPt, heightPt) * 25.4) / 72;
  if (longMm > 1250) return "A0+";
  if (longMm > 900) return "A0";
  if (longMm > 640) return "A1";
  if (longMm > 460) return "A2";
  if (longMm > 330) return "A3";
  if (longMm > 250) return "A4";
  return "A5";
}

/**
 * Identify one page. `folders` are the relative-path folders (outermost first);
 * `pageText` is the page's text layer (title-block words, scale).
 */
export function identifySheet(input: {
  fileName: string;
  folders: string[];
  pageText: string;
}): SheetIdentity {
  const parts = parseFileName(input.fileName);
  const text = input.pageText ?? "";

  let kind = kindFromText(parts.title);
  let kindSource: SheetIdentity["kindSource"] = kind !== "OTHER" ? "title" : "none";
  if (kind === "OTHER") {
    for (const f of [...input.folders].reverse()) {
      const k = kindFromText(f);
      if (k !== "OTHER") {
        kind = k;
        kindSource = "folder";
        break;
      }
    }
  }
  if (kind === "OTHER" && text) {
    // Only the title-block region words matter; the full text of a busy plan
    // contains "section", "plan", "elevation" as notes. Use short text only.
    const k = text.length < 600 ? kindFromText(text) : "OTHER";
    if (k !== "OTHER") {
      kind = k;
      kindSource = "text";
    }
  }

  const level = levelFromText(parts.title, kind) ?? levelFromNumber(parts.drawingNo);
  const face = kind === "ELEVATION" ? faceFromText(parts.title) : null;

  return {
    drawingNo: parts.drawingNo,
    title: parts.title,
    revision: parts.revision,
    revisionOrder: revisionOrder(parts.revision),
    status: parts.status,
    scale: scaleFromText(text),
    kind,
    kindSource,
    level: kind === "PLAN" || kind === "ROOF_PLAN" ? level : null,
    face,
    buildingCode: buildingCodeFromNumber(parts.drawingNo),
  };
}
