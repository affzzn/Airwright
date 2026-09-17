/**
 * The construction pricing engine (Layer 3 for construction) — PURE, unit-tested.
 * Unlike the house-build engine there is NO derivation from a drawing: the
 * estimator has entered every line by hand. This module only does the arithmetic:
 *   line amount   = effective quantity × rate            (per-lift units × lifts)
 *   quote total   = Σ line amounts                        (reconciles to the penny)
 *   extra hire/wk = total × extraHirePct%                 (terms, not in the total)
 *
 * Money is handled in integer PENCE internally so totals reconcile exactly;
 * amounts are returned in pounds (2 dp). Rates resolve per (band, height bracket)
 * with a fallback to the bracket-agnostic ANY rate (docs/19 §4.3).
 */

import { PER_LIFT_UNITS, type ConstructionUnit, type HeightBracket, type RateBand } from "./types";

const round2 = (n: number): number => Math.round(n * 100) / 100;
const penceOf = (n: number): number => Math.round(n * 100);

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
}

/** One line's £ amount (2 dp). Missing/zero rate → £0 (surfaced as unpriced upstream). */
export function lineAmount(line: LinePriceInput): number {
  const qty = effectiveQuantity(line.unit, line.quantity, line.lifts);
  const rate = Number.isFinite(line.rate) && line.rate > 0 ? line.rate : 0;
  return penceOf(qty * rate) / 100;
}

export interface QuotePriceResult {
  /** Per-line £ amounts, in the same order as the input. */
  lineAmounts: number[];
  /** Σ of all line amounts, 2 dp — the quoted (inclusive-period) figure. */
  total: number;
  /** The extra-hire weekly charge (terms only, NOT in `total`), or null if no %. */
  extraHirePerWeek: number | null;
}

export interface QuotePriceInput {
  lines: LinePriceInput[];
  /** e.g. 0.05 → 0.05% of the total per extra week (docs/19 §7). Null → no extra hire. */
  extraHirePctPerWeek?: number | null;
}

/**
 * Price a whole construction quote. `total` is Σ lines (reconciles to the penny);
 * extra hire is computed from the total as a weekly rate and returned separately
 * (it is quoted as TERMS, billed only if the job overruns the inclusive weeks).
 */
export function priceConstructionQuote(input: QuotePriceInput): QuotePriceResult {
  let totalPence = 0;
  const lineAmounts: number[] = [];
  for (const line of input.lines) {
    const amt = lineAmount(line);
    lineAmounts.push(amt);
    totalPence += penceOf(amt);
  }
  const total = totalPence / 100;
  const pct = input.extraHirePctPerWeek;
  const extraHirePerWeek =
    pct != null && Number.isFinite(pct) && pct > 0 ? round2(total * (pct / 100)) : null;
  return { lineAmounts, total, extraHirePerWeek };
}

/**
 * Resolve a rate for an element from its library rates: exact (band, bracket) →
 * (band, ANY) → null. Mirrors the house-build resolver's fallback ladder so a
 * bracket-agnostic (flat) item, or a not-yet-priced bracket, resolves cleanly.
 */
export function resolveConstructionRate(
  rates: { band: RateBand; bracket: HeightBracket; rate: number }[],
  band: RateBand,
  bracket: HeightBracket | null | undefined,
): number | null {
  const inBand = rates.filter((r) => r.band === band);
  if (bracket && bracket !== "ANY") {
    const exact = inBand.find((r) => r.bracket === bracket);
    if (exact) return exact.rate;
  }
  const any = inBand.find((r) => r.bracket === "ANY");
  if (any) return any.rate;
  // No ANY and no matching bracket → fall back to the first in-band rate, if any.
  return inBand[0]?.rate ?? null;
}
