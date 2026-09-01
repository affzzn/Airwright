/**
 * Structure-form vocabulary (restructured 2026-09-01). The building type read off
 * the drawing, named by HOW MANY HOMES are joined side-by-side:
 *
 *   DETACHED        — 1 home, free-standing, shares no wall with another property.
 *   PAIR_SEMI       — 2 homes sharing ONE party wall (a semi-detached pair).
 *   THREE_BLOCK     — 3 homes joined by shared side walls (two end + one mid).
 *   TERRACE         — 4 OR MORE homes joined in a row. "Terrace" is reserved for 4+.
 *   APARTMENT_BLOCK — a block of FLATS, scaffolded as ONE whole building.
 *
 * The COUNT lives on `dwellingsWide` (2 / 3 / 4+); the form is the NAME for it.
 * This is the single source of truth — the extraction schema enum, the review
 * dropdown, provenance, the plot defaults and the server validators all import it
 * so the vocabulary can never drift between layers.
 *
 * Superseded the old `SINGLE` / `PAIR_OR_TERRACE` pair (which conflated a 2-home
 * pair, a 3-block and a 4+ terrace, and mis-called a pair a "terrace").
 */

export const STRUCTURE_FORMS = [
  "DETACHED",
  "PAIR_SEMI",
  "THREE_BLOCK",
  "TERRACE",
  "APARTMENT_BLOCK",
] as const;

export type StructureForm = (typeof STRUCTURE_FORMS)[number];

/** Short human labels for dropdowns / provenance. */
export const STRUCTURE_LABEL: Record<StructureForm, string> = {
  DETACHED: "Detached",
  PAIR_SEMI: "Pair / semi",
  THREE_BLOCK: "Three-block",
  TERRACE: "Terrace (4+)",
  APARTMENT_BLOCK: "Apartment block",
};

/** How many homes each form joins. TERRACE is 4+ (min shown), so `null` = variable. */
export const STRUCTURE_DWELLINGS: Record<StructureForm, number | null> = {
  DETACHED: 1,
  PAIR_SEMI: 2,
  THREE_BLOCK: 3,
  TERRACE: null,
  APARTMENT_BLOCK: 1,
};

/** The multi-home HOUSE forms whose frontage is divided per dwelling (not flats). */
export function isMultiHome(form: StructureForm | null | undefined): boolean {
  return form === "PAIR_SEMI" || form === "THREE_BLOCK" || form === "TERRACE";
}

/**
 * Normalise any stored / model / legacy structure value to the current vocabulary.
 * Handles the pre-2026-09-01 values still sitting in `takeoff.warnings` JSON:
 *   SINGLE          → DETACHED
 *   PAIR_OR_TERRACE → by dwellingsWide: 4+ TERRACE, 3 THREE_BLOCK, else PAIR_SEMI
 * Returns null for anything unrecognised (so the field just reads blank).
 */
export function normalizeStructureForm(
  value: unknown,
  dwellingsWide?: number | null,
): StructureForm | null {
  if (typeof value !== "string") return null;
  if ((STRUCTURE_FORMS as readonly string[]).includes(value)) return value as StructureForm;
  switch (value) {
    case "SINGLE":
      return "DETACHED";
    case "PAIR_OR_TERRACE":
      if (dwellingsWide != null) {
        if (dwellingsWide >= 4) return "TERRACE";
        if (dwellingsWide === 3) return "THREE_BLOCK";
      }
      return "PAIR_SEMI";
    default:
      return null;
  }
}
