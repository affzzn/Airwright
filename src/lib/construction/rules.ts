/**
 * The construction rules engine (docs/19 §6) — PURE, unit-tested. With no AI,
 * "rules" are editable PRE-FILL DEFAULTS + a validation pass: they suggest sensible
 * values so the estimator isn't starting blank, and flag what still needs a human.
 * Nothing here is binding — every suggestion becomes an editable line/field.
 */

import type { HeightBracket, SiteType } from "./types";

/** A Haki stair tower normally counts as 3 lifts (kicker + to-1st + to-2nd). ✅ */
export const HAKI_LIFTS = 3;

/** Height (m) → the rate bracket. ≤6 → up-to-6m, ≤12 → 6–12, ≤18 → 12–18, else 18–24. */
export function heightBracketFor(heightM: number | null | undefined): HeightBracket | null {
  if (heightM == null || !Number.isFinite(heightM) || heightM <= 0) return null;
  if (heightM <= 6) return "UP_TO_6M";
  if (heightM <= 12) return "H6_12M";
  if (heightM <= 18) return "H12_18M";
  return "H18_24M";
}

/** A rough lift-count hint from the height (~2 m/lift): ~4 m → 2 lifts. Editable. */
export function suggestedLiftsFor(heightM: number | null | undefined): number | null {
  if (heightM == null || !Number.isFinite(heightM) || heightM <= 0) return null;
  return Math.max(1, Math.round(heightM / 2));
}

/** A scaffold mat (2.7 m first walking lift) applies at schools + public streets. ✅ */
export function needsScaffoldMat(siteType: SiteType | null | undefined): boolean {
  return siteType === "SCHOOL" || siteType === "PUBLIC_STREET";
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
  siteType: SiteType | null;
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
  if (f.siteType == null)
    flags.push({ level: "info", message: "Site type not set — scaffold-mat / foam suggestions are off." });
  if (f.measurementCount === 0)
    flags.push({ level: "info", message: "No measurements recorded — add them so the quote is traceable." });
  if (f.hasInferredValues)
    flags.push({
      level: "info",
      message: "Some values were inferred (Google Earth / drawing) — they print as assumptions.",
    });
  return flags;
}
