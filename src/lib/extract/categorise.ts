import type { PageClass } from "./classify";

/** Mirrors the Prisma DocumentCategory enum. */
export type DocumentCategory =
  | "HOUSE_TYPE_DRAWINGS"
  | "SITE_LAYOUT"
  | "SPEC"
  | "NOT_RELEVANT"
  | "UNCERTAIN"
  | "UNREADABLE";

/** Which categories are auto-included in a take-off. */
export function isRelevantCategory(c: DocumentCategory): boolean {
  return (
    c === "HOUSE_TYPE_DRAWINGS" || c === "SITE_LAYOUT" || c === "SPEC"
  );
}

// Filenames that clearly signal an irrelevant discipline. Conservative on
// purpose — we never skip anything that mentions site/plot/elevation/floor.
const JUNK_FILENAME: [RegExp, string][] = [
  [/bar\s*schedule|reinforc|rebar/i, "Reinforcement schedule"],
  [/drainage|\bsuds?\b|soakaway|attenuation/i, "Drainage"],
  [/proposed\s*levels|\blevels\b/i, "Levels"],
  [/long\s*section/i, "Long sections (civils)"],
  [/signing\s*and\s*lining/i, "Highways"],
  [/landscap|planting|tree\s*survey|arboricultur|ecolog/i, "Landscape"],
  [/structural\s*(calc|detail)|steel(work|\s*frame)/i, "Structural"],
  [/\bmaterials?\b/i, "Materials"],
  [/issue\s*sheet|and\s*register/i, "Issue register"],
  [/standard\s*details?/i, "Standard details"],
  [/\bs278\b|\bs38\b|\bs104\b|highway|\bkerb\b|gully|manhole/i, "Highways / roads"],
  [/\bschedule\b/i, "Schedule"],
];

// Filename signals that a file IS a drawing / site plan — protects it from the
// junk filter (e.g. "Site Layout Showing … Foundations" must not be skipped).
const POSITIVE_FILENAME =
  /site\s*layout|site\s*plan|\bplot\b|elevation|floor\s*plan|working\s*drawing|\bsection\b/i;

/**
 * Cheap filename-only pre-filter for large packs: returns a skip category for
 * clearly-junk files so we don't open + text-extract them. Null = open it.
 */
export function filenamePrefilter(
  fileName: string,
): { category: DocumentCategory; detail: string } | null {
  if (POSITIVE_FILENAME.test(fileName)) return null;
  for (const [re, detail] of JUNK_FILENAME) {
    if (re.test(fileName)) return { category: "NOT_RELEVANT", detail };
  }
  return null;
}

function detailFromFilename(fileName: string): string | undefined {
  for (const [re, detail] of JUNK_FILENAME) if (re.test(fileName)) return detail;
  return undefined;
}

/**
 * Categorise a document from its classified pages (the source of truth). House
 * drawings win over site layout wins over spec; anything else is not relevant.
 */
export function categoriseDocument(input: {
  fileName: string;
  pages: PageClass[];
  hasText: boolean;
}): { category: DocumentCategory; detail?: string } {
  if (!input.hasText) return { category: "UNREADABLE" };
  const kinds = new Set(input.pages.map((p) => p.kind));
  // A house type must have an elevation or floor plan — a lone "sections" sheet
  // (e.g. civils long-sections) is NOT a house type.
  if (kinds.has("ELEVATION") || kinds.has("FLOOR_PLAN"))
    return { category: "HOUSE_TYPE_DRAWINGS" };
  if (kinds.has("PLOT_LAYOUT")) return { category: "SITE_LAYOUT" };
  if (kinds.has("SPEC") || /specification/i.test(input.fileName))
    return { category: "SPEC" };

  // Nothing recognisable. If the filename clearly says junk, it's not relevant;
  // otherwise we genuinely can't tell (e.g. an image-only drawing with no text
  // title) → flag it for a human rather than silently discarding it.
  const detail = detailFromFilename(input.fileName);
  if (detail) return { category: "NOT_RELEVANT", detail };
  return { category: "UNCERTAIN" };
}
