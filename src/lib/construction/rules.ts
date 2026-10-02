/**
 * The construction rules engine (docs/19 §6) — PURE, unit-tested. With no AI,
 * "rules" are editable PRE-FILL DEFAULTS + a validation pass: they suggest sensible
 * values so the estimator isn't starting blank, and flag what still needs a human.
 * Nothing here is binding — every suggestion becomes an editable line/field.
 */

import type { HeightBracket, SiteType } from "./types";

/**
 * Lift height for construction external scaffold (docs/23 §15.1, ⚠ PARAM P1):
 * 2.0 m reproduces the lifts Airwright actually quoted on all four real jobs
 * (Murray Park 4 m → 2, Wren 4.955 m → 3, CBAND hall 3.3 m → 2, pavilion
 * 2.85 m → 2), where the house-build 1.5 m rule misfits three of them. Still a
 * placeholder until Colin confirms; job settings can override it.
 */
export const DEFAULT_LIFT_HEIGHT_M = 2.0;

/**
 * Fallback Haki lift count when nothing tells us the height. The calls' "a Haki is
 * 3 lifts" was one example (a two-storey building); the real quotes show a Haki
 * follows the scaffold it serves (CBAND: 2 lifts on 2-lift buildings; Wren ×3 and
 * ×2), so this is only a starting SUGGESTION — see `suggestedHakiLifts`.
 */
export const HAKI_LIFTS_FALLBACK = 3;

/** Height (m) → the rate bracket: ≤6 · ≤12 · ≤18 · ≤24 · above → 24–30 m. */
export function heightBracketFor(heightM: number | null | undefined): HeightBracket | null {
  if (heightM == null || !Number.isFinite(heightM) || heightM <= 0) return null;
  if (heightM <= 6) return "UP_TO_6M";
  if (heightM <= 12) return "H6_12M";
  if (heightM <= 18) return "H12_18M";
  if (heightM <= 24) return "H18_24M";
  return "H24_30M";
}

/**
 * A lift-count SUGGESTION from the height: ceil(height ÷ lift height). With the
 * 2.0 m default, 4 m → 2 lifts and 4.955 m → 3. Always editable.
 */
export function suggestedLiftsFor(
  heightM: number | null | undefined,
  liftHeightM: number = DEFAULT_LIFT_HEIGHT_M,
): number | null {
  if (heightM == null || !Number.isFinite(heightM) || heightM <= 0) return null;
  if (!Number.isFinite(liftHeightM) || liftHeightM <= 0) return null;
  // Guard float noise (4.000000001 m must not become 3 lifts at 2 m).
  return Math.max(1, Math.ceil(heightM / liftHeightM - 1e-9));
}

/**
 * Suggested lifts for a Haki stair tower (or a loading bay): it follows the
 * external scaffold it serves, so the height decides; with no height we fall back
 * to 3. A suggestion only — the estimator sets the final number.
 */
export function suggestedHakiLifts(
  heightM: number | null | undefined,
  liftHeightM: number = DEFAULT_LIFT_HEIGHT_M,
): number {
  return suggestedLiftsFor(heightM, liftHeightM) ?? HAKI_LIFTS_FALLBACK;
}

/** A scaffold mat (2.7 m first walking lift) applies where the public can be — public sector (schools, streets…). ✅ */
export function needsScaffoldMat(siteType: SiteType | null | undefined): boolean {
  return siteType === "PUBLIC_SECTOR";
}

/** Foam count = doorways + fire exits + pedestrian walk-unders (docs/19 §6 rule 5). */
export function foamCount(
  doorways: number | null | undefined,
  fireExits: number | null | undefined,
  pedestrian: number | null | undefined,
): number {
  return (doorways ?? 0) + (fireExits ?? 0) + (pedestrian ?? 0);
}

/** The default handrail for a roof / building edge is TRIPLE, unless stated. ✅ */
export const ROOF_HANDRAIL_DEFAULT = "TRIPLE" as const;

/** Inspection weeks = the inclusive hire duration (one inspection per hire week). ✅ */
export function inspectionWeeks(durationWeeks: number | null | undefined): number {
  return durationWeeks != null && durationWeeks > 0 ? Math.trunc(durationWeeks) : 0;
}

// --- Validation / assumptions (docs/19 §7 + §11) ----------------------------

export interface QuoteFactsForValidation {
  durationWeeks: number | null;
  buildingHeightM: number | null;
  defaultHeightBracket: HeightBracket | null;
  siteType?: SiteType | null;
  lineCount: number;
  measurementCount: number;
  /** Any line whose resolved rate is 0 (no rate found) — surfaced as unpriced. */
  unpricedLineCount: number;
  /** Lines that need a lift count (a per-lift unit) but have none. */
  perLiftLinesMissingLifts: number;
  /** Any measurement/line the estimator marked as inferred (Google Earth / drawing). */
  hasInferredValues: boolean;
}

export interface ValidationFlag {
  level: "warn" | "info";
  message: string;
}

/**
 * Flag what still needs the estimator's eye before the quote is generated. These
 * never block — they show as an assumptions/validation checklist (docs/19 §11).
 */
export function validateConstructionQuote(f: QuoteFactsForValidation): ValidationFlag[] {
  const flags: ValidationFlag[] = [];
  if (f.lineCount === 0)
    flags.push({ level: "warn", message: "No priced items yet — add scaffold elements from the library." });
  if (f.durationWeeks == null || f.durationWeeks <= 0)
    flags.push({ level: "warn", message: "No hire duration set — needed for inspections and extra-hire terms." });
  if (f.buildingHeightM == null && f.defaultHeightBracket == null)
    flags.push({ level: "warn", message: "No building height / bracket — bracketed rates can't resolve." });
  if (f.perLiftLinesMissingLifts > 0)
    flags.push({
      level: "warn",
      message: `${f.perLiftLinesMissingLifts} per-lift line(s) have no number of lifts — set the lifts.`,
    });
  if (f.unpricedLineCount > 0)
    flags.push({
      level: "warn",
      message: `${f.unpricedLineCount} line(s) have no rate for this band/bracket — priced at £0 until a rate is set.`,
    });
  if (f.measurementCount === 0)
    flags.push({ level: "info", message: "No measurements recorded — add them so the quote is traceable." });
  if (f.hasInferredValues)
    flags.push({
      level: "info",
      message: "Some values were inferred (Google Earth / drawing) — they print as assumptions.",
    });
  return flags;
}
