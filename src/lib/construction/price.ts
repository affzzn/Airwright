/**
 * The construction pricing engine (Layer 3 for construction) — PURE, unit-tested.
 * Unlike the house-build engine there is NO derivation from a drawing: the
 * estimator has entered every line by hand. This module only does the arithmetic:
 *   line amount   = effective quantity × rate            (per-lift units × lifts)
 *   quote total   = Σ line amounts                        (reconciles to the penny)
 *
 * HIRE (corrected 2026-09-24 from Airwright's own rate sheet). Every rate is
 * quoted "based on" a hire period — 4 weeks for construction, 12 for timber
 * frame. Beyond it, extra hire is charged **per unit per week** at a percentage
 * set by the commercial band (their "E/H Value" × "%age to charge"), NOT as a
 * percentage of the job. On the real Murray Park quote that came to £389.74 a
 * week; the old 0.05%-of-job placeholder would have said £9.59.
 *
 * Money is handled in integer PENCE internally so totals reconcile exactly;
 * amounts are returned in pounds (2 dp). Rates resolve per (band, height bracket)
 * with a fallback to the bracket-agnostic ANY rate (docs/19 §4.3).
 */

import { PER_LIFT_UNITS, type ConstructionUnit, type HeightBracket, type RateBand } from "./types";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const penceOf = (n: number): number => Math.round(n * 100);
const clean = (n: number | null | undefined, fallback = 0): number =>
  n != null && Number.isFinite(n) && n >= 0 ? n : fallback;

/**
 * The effective quantity the rate multiplies: a per-lift unit multiplies by the
 * number of lifts (min 1), everything else is the quantity as-is.
 */
export function effectiveQuantity(
  unit: ConstructionUnit,
  quantity: number,
  lifts?: number | null,
): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  if (PER_LIFT_UNITS.has(unit)) {
    const n = lifts != null && lifts > 0 ? Math.trunc(lifts) : 1;
    return quantity * n;
  }
  return quantity;
}

export interface LinePriceInput {
  unit: ConstructionUnit;
  quantity: number;
  lifts?: number | null;
  rate: number;
  /** Weeks of hire the rate already includes (4 construction, 12 timber frame). */
  baseHireWeeks?: number | null;
  /** £ per unit per week beyond the base period, before the band percentage. */
  extraHirePerWeek?: number | null;
  /** Percentage of `extraHirePerWeek` actually charged (25 / 50 / 75 / 100). */
  extraHireChargePct?: number | null;
}

/** One line's £ amount (2 dp). Missing/zero rate → £0 (surfaced as unpriced upstream). */
export function lineAmount(line: LinePriceInput): number {
  const qty = effectiveQuantity(line.unit, line.quantity, line.lifts);
  const rate = Number.isFinite(line.rate) && line.rate > 0 ? line.rate : 0;
  return penceOf(qty * rate) / 100;
}

/**
 * What this line costs for each week of hire beyond its base period:
 * effective quantity × E/H value × the band's percentage.
 */
export function lineExtraHirePerWeek(line: LinePriceInput): number {
  const perWeek = clean(line.extraHirePerWeek);
  if (perWeek <= 0) return 0;
  const pct = clean(line.extraHireChargePct, 100);
  const qty = effectiveQuantity(line.unit, line.quantity, line.lifts);
  return penceOf(qty * perWeek * (pct / 100)) / 100;
}

/** How many weeks of the quoted hire fall beyond this line's base period. */
export function weeksBeyondBase(line: LinePriceInput, quotedWeeks: number | null): number {
  if (quotedWeeks == null || !Number.isFinite(quotedWeeks) || quotedWeeks <= 0) return 0;
  const base = clean(line.baseHireWeeks, 0);
  return Math.max(0, Math.ceil(quotedWeeks) - Math.trunc(base));
}

export interface QuotePriceResult {
  /** Per-line £ amounts, in the same order as the input. */
  lineAmounts: number[];
  /** Σ of all line amounts, 2 dp — the quoted figure, base hire included. */
  total: number;
  /** Σ of the per-line weekly extra hire — quoted as TERMS, not in `total`. */
  extraHirePerWeek: number | null;
  /**
   * What the quoted duration would cost in extra hire, because it runs beyond
   * what the rates include. NOT added to `total`: whether it is billed or just
   * stated as terms is Airwright's call (docs/19 §13 #2).
   */
  extraHireBeyondBase: number;
  /** The largest number of weeks any line runs beyond its base period. */
  maxWeeksBeyondBase: number;
}

export interface QuotePriceInput {
  lines: LinePriceInput[];
  /** The hire period being quoted, in weeks. */
  durationWeeks?: number | null;
}

/**
 * Price a whole construction quote. `total` is Σ lines (reconciles to the penny).
 * Extra hire is returned separately, both as a weekly rate (what the client sees
 * as terms) and as the amount the quoted duration implies.
 */
export function priceConstructionQuote(input: QuotePriceInput): QuotePriceResult {
  let totalPence = 0;
  let weeklyPence = 0;
  let beyondPence = 0;
  let maxWeeks = 0;
  const lineAmounts: number[] = [];

  for (const line of input.lines) {
    const amt = lineAmount(line);
    lineAmounts.push(amt);
    totalPence += penceOf(amt);

    const weekly = lineExtraHirePerWeek(line);
    weeklyPence += penceOf(weekly);
    const weeks = weeksBeyondBase(line, input.durationWeeks ?? null);
    if (weeks > maxWeeks) maxWeeks = weeks;
    beyondPence += penceOf(weekly) * weeks;
  }

  return {
    lineAmounts,
    total: totalPence / 100,
    extraHirePerWeek: weeklyPence > 0 ? weeklyPence / 100 : null,
    extraHireBeyondBase: beyondPence / 100,
    maxWeeksBeyondBase: maxWeeks,
  };
}

/** A rate with the hire terms that come with it. */
export interface ResolvedRate {
  rate: number;
  baseHireWeeks: number;
  extraHirePerWeek: number;
  extraHireChargePct: number;
}

export interface RateRow extends ResolvedRate {
  band: RateBand;
  bracket: HeightBracket;
}

/**
 * Resolve a rate for an element from its library rates: exact (band, bracket) →
 * (band, ANY) → the first rate in the band. Mirrors the house-build resolver's
 * fallback ladder so a bracket-agnostic (flat) item, or a not-yet-priced bracket,
 * resolves cleanly. Returns the hire terms with it, since they vary per rate.
 */
export function resolveConstructionRateRow(
  rates: RateRow[],
  band: RateBand,
  bracket: HeightBracket | null | undefined,
): ResolvedRate | null {
  const inBand = rates.filter((r) => r.band === band);
  const pick =
    (bracket && bracket !== "ANY" ? inBand.find((r) => r.bracket === bracket) : undefined) ??
    inBand.find((r) => r.bracket === "ANY") ??
    inBand[0];
  if (!pick) return null;
  return {
    rate: pick.rate,
    baseHireWeeks: pick.baseHireWeeks,
    extraHirePerWeek: pick.extraHirePerWeek,
    extraHireChargePct: pick.extraHireChargePct,
  };
}

/** The £ rate alone, for callers that only need the number. */
export function resolveConstructionRate(
  rates: { band: RateBand; bracket: HeightBracket; rate: number }[],
  band: RateBand,
  bracket: HeightBracket | null | undefined,
): number | null {
  const rows: RateRow[] = rates.map((r) => ({
    ...r,
    baseHireWeeks: 0,
    extraHirePerWeek: 0,
    extraHireChargePct: 100,
  }));
  return resolveConstructionRateRow(rows, band, bracket)?.rate ?? null;
}

export { round2 };
