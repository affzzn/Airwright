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

/** A plot's POSITION in its block — mirrors the Prisma `Configuration` enum. */
export type PlotConfiguration = "DETACHED" | "SEMI_DETACHED" | "END_TERRACE" | "MID_TERRACE";

/** The configuration derived from a drawing's structure form, with whether that
 *  derivation actually DETERMINES the position and a plain-language reason. */
export interface DerivedConfiguration {
  config: PlotConfiguration;
  /** True only when the structure form fixes the position outright. False means
   *  "this is the safe default, a human must confirm it" — never a silent guess. */
  certain: boolean;
  /** Why — shown in the review provenance and stored on `warnings`. */
  reason: string;
}

/**
 * Structure form (what the DRAWING shows) → the default plot CONFIGURATION (this
 * plot's position in the block). The single source of this mapping — the extractor
 * (`persist.ts`) and the plot default (`server/plots.ts`) both call it, so the two
 * can never drift.
 *
 * Only DETACHED and PAIR_SEMI determine the position: a pair's two homes are BOTH
 * semis. A three-block or terrace contains end AND mid positions, so the end is a
 * default, not an answer — `certain: false` makes the review screen say so. An
 * unreadable form also returns `certain: false` rather than silently defaulting
 * (docs/11 §1: "unreadable → flag, never guess").
 */
const CONFIG_BY_STRUCTURE: Record<StructureForm, DerivedConfiguration> = {
  DETACHED: {
    config: "DETACHED",
    certain: true,
    reason: "Detached — one free-standing home, so all four sides are scaffolded.",
  },
  PAIR_SEMI: {
    config: "SEMI_DETACHED",
    certain: true,
    reason:
      "A semi-detached pair — BOTH homes in it are semis, so the position is determined by the drawing.",
  },
  THREE_BLOCK: {
    config: "END_TERRACE",
    certain: false,
    reason:
      "A three-block holds two END positions and one MID. End terrace is assumed (the larger scaffold) — the middle plot must be set to mid-terrace.",
  },
  TERRACE: {
    config: "END_TERRACE",
    certain: false,
    reason:
      "A terrace (4+) holds two END positions and the rest MID. End terrace is assumed (the larger scaffold) — the inner plots must be set to mid-terrace.",
  },
  APARTMENT_BLOCK: {
    config: "DETACHED",
    certain: true,
    reason:
      "An apartment block is scaffolded as one whole building — the position does not apply and this value is not used by the engine.",
  },
};

export function configFromStructure(
  form: StructureForm | null | undefined,
  confidence?: string | null,
): DerivedConfiguration {
  if (!form)
    return {
      config: "DETACHED",
      certain: false,
      reason:
        "The drawing's building type could not be read, so this falls back to detached — the largest scaffold (four sides, every apex). Confirm it against the drawing.",
    };
  const base = CONFIG_BY_STRUCTURE[form];
  // A determinate form read with poor confidence is still not an answer.
  if (confidence === "low" || confidence === "unknown")
    return {
      ...base,
      certain: false,
      reason: `${base.reason} The building type itself was read with ${
        confidence === "unknown" ? "no" : "low"
      } confidence — check it against the drawing.`,
    };
  return base;
}

/** The party-wall status of a house's two gable ends, as read off the drawing. */
export interface PartyGableRead {
  left: boolean | null;
  right: boolean | null;
}

/**
 * Reduce wall segments to the two gable ends' party status. A gable is a party wall
 * when ANY segment on that side says so; external when at least one says so and none
 * says party; otherwise unknown (`null`). Shared by the extractor and the engine so
 * the two can never read the same drawing differently.
 */
export function readPartyGables(
  walls: { position: string; isPartyWall?: boolean | null }[],
): PartyGableRead {
  const side = (pos: string): boolean | null => {
    const segs = walls.filter((w) => w.position.toLowerCase() === pos);
    if (segs.some((w) => w.isPartyWall === true)) return true;
    if (segs.some((w) => w.isPartyWall === false)) return false;
    return null;
  };
  return { left: side("gable_left"), right: side("gable_right") };
}

/** How the configuration was arrived at. */
export type ConfigurationBasis = "party-walls" | "structure";

/**
 * THE configuration decision. Party walls are the DIRECT structural reading of this
 * drawing, so they lead; the structure form is a proxy that is exact for a detached
 * house and a semi pair but only a DEFAULT for a terrace (docs/21 §B2).
 *
 * The two together beat either alone: the party count cannot separate a semi from an
 * end terrace (both have exactly one party gable and take off identically), so when
 * the count is 1 the structure form picks the label — a terrace/three-block reads
 * END_TERRACE, anything else SEMI_DETACHED.
 *
 * A contradiction (e.g. the form says detached but a gable is flagged party) keeps the
 * party-wall answer — it is the more specific reading — but drops `certain` so the
 * review screen asks for a human eye instead of asserting.
 */
export function resolveConfiguration(
  form: StructureForm | null | undefined,
  confidence: string | null | undefined,
  gables: PartyGableRead,
): DerivedConfiguration & { basis: ConfigurationBasis } {
  const known = gables.left !== null && gables.right !== null;
  const count = (gables.left ? 1 : 0) + (gables.right ? 1 : 0);
  const formAttached =
    form === "PAIR_SEMI" || form === "THREE_BLOCK" || form === "TERRACE"
      ? true
      : form === "DETACHED"
        ? false
        : null;

  // ASYMMETRIC TRUST. Marking a gable as a party wall is a POSITIVE sighting — the
  // model saw a separating wall. Marking one `false` is much weaker: it usually means
  // "I did not see one", and absence of evidence is not evidence of absence. So the
  // party-wall read may ADD attachment but never REMOVE it: when it reports no party
  // gable at all yet the building type says the house is attached, the building type
  // wins and the disagreement is flagged.
  // (Found live on Bloor Sorley, 2026-09-23: two runs of the SAME drawing returned
  // gable_right=party and then both gables=false. Letting the second override
  // PAIR_SEMI produced DETACHED — a regression on a case that used to be right.)
  if (!known || (count === 0 && formAttached === true))
    return { ...configFromStructure(form, confidence), basis: "structure" };

  const terraced = form === "TERRACE" || form === "THREE_BLOCK";
  const config: PlotConfiguration =
    count >= 2 ? "MID_TERRACE" : count === 1 ? (terraced ? "END_TERRACE" : "SEMI_DETACHED") : "DETACHED";

  const where =
    count === 0
      ? "neither gable is a party wall"
      : count === 1
        ? `one gable is a party wall (${gables.left ? "left" : "right"})`
        : "both gables are party walls";

  // Only an "attached per the party walls, detached per the form" clash can reach here
  // (the reverse was handed back to the structure branch above).
  const contradicts = formAttached !== null && formAttached !== count > 0;

  return {
    config,
    certain: !contradicts,
    basis: "party-walls",
    reason: contradicts
      ? `Read off the drawing: ${where} → ${config}. This CONTRADICTS the building type read (${form}) — check which is right.`
      : `Read off the drawing: ${where} → ${config}.${
          count === 1 && terraced
            ? " The building type is a terrace, so the one exposed gable makes this an END terrace."
            : ""
        }`,
  };
}
