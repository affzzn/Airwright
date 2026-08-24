/**
 * Height triangulation — the ONE place the soffit height is reconciled.
 *
 * The model reports TWO independent things off the drawing (numbers only):
 *   - directSoffitM  — the printed U/S wallplate / soffit dimension, and
 *   - storeyHeightsM — the printed floor-to-floor storey heights (last one up to
 *                      the soffit), whose SUM is a second estimate of the height.
 * This module sums the ladder and reconciles it against the direct read, plus a
 * storey sanity band, and turns the agreement into a COMPUTED confidence.
 *
 * H3 (confirmed): a disagreement is only flagged when the two estimates give a
 * DIFFERENT LIFT COUNT (ceil(h / liftHeight)) — that's the thing that changes the
 * price — not on a fixed millimetre gap.
 *
 * Pure + unit-tested. The datum is fixed to the SOFFIT / underside of wallplate
 * (user-confirmed, docs/11 §8a) — this module does not choose a datum.
 */

import { type Conf, worseConf } from "./birdcage";

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface HeightInput {
  directSoffitM: number | null; // the printed soffit / U-S wallplate value
  storeyHeightsM: number[]; // printed floor-to-floor heights (last = to soffit)
  storeys: number | null;
  liftHeightM?: number; // default 1.5 (matches the take-off engine)
  readConfidence?: Conf; // the model's confidence in the direct read (caps some paths)
}

export interface HeightResult {
  soffitM: number | null; // the height to store / price off
  directM: number | null;
  ladderSumM: number | null; // Σ storeyHeightsM, or null if none given
  liftsDirect: number | null; // ceil(direct / liftHeight)
  liftsLadder: number | null; // ceil(ladderSum / liftHeight)
  reconciled: boolean | null; // do the two give the SAME lift count? (H3) null if not comparable
  withinBand: boolean | null; // direct within the storey sanity band? null if no storeys
  confidence: Conf; // COMPUTED
  note: string;
}

/** Rough soffit band per storey count (~2.2–3.0 m/storey). A sanity check, not a rule. */
function storeyBand(storeys: number | null): { lo: number; hi: number } | null {
  if (storeys === null || storeys <= 0) return null;
  return { lo: storeys * 2.2, hi: storeys * 3.0 };
}

const liftsOf = (h: number | null, lift: number): number | null =>
  h !== null && h > 0 ? Math.ceil(h / lift) : null;

export function computeHeight(input: HeightInput): HeightResult {
  const lift = input.liftHeightM ?? 1.5;
  const readConf: Conf = input.readConfidence ?? "medium";

  const directM =
    input.directSoffitM !== null && input.directSoffitM > 0
      ? round3(input.directSoffitM)
      : null;
  const ladderSumM = input.storeyHeightsM.length
    ? round3(input.storeyHeightsM.reduce((a, h) => a + h, 0))
    : null;

  const liftsDirect = liftsOf(directM, lift);
  const liftsLadder = liftsOf(ladderSumM, lift);

  const band = storeyBand(input.storeys);
  const withinBand = band && directM !== null ? directM >= band.lo && directM <= band.hi : null;

  const soffitM = directM ?? ladderSumM;

  // --- Pick the confidence. ---
  // Both present → the lift-count agreement is the signal (H3).
  if (directM !== null && ladderSumM !== null) {
    const reconciled = liftsDirect === liftsLadder;
    const note = reconciled
      ? `Soffit ${directM} m ✓ cross-checked: storey ladder sums to ${ladderSumM} m — both give ${liftsDirect} lift(s).`
      : `Soffit reads ${directM} m (${liftsDirect} lifts) but the storey ladder sums to ${ladderSumM} m (${liftsLadder} lifts) — different lift count, CHECK.`;
    return {
      soffitM, directM, ladderSumM, liftsDirect, liftsLadder,
      reconciled, withinBand,
      confidence: reconciled ? "high" : "low",
      note,
    };
  }

  // Only the direct read → lean on the storey sanity band.
  if (directM !== null) {
    if (withinBand === false)
      return {
        soffitM, directM, ladderSumM, liftsDirect, liftsLadder,
        reconciled: null, withinBand,
        confidence: "low",
        note: `Soffit ${directM} m is outside the expected band for a ${input.storeys}-storey (${band?.lo}–${band?.hi} m) — CHECK.`,
      };
    return {
      soffitM, directM, ladderSumM, liftsDirect, liftsLadder,
      reconciled: null, withinBand,
      confidence: worseConf("medium", readConf),
      note: `Soffit ${directM} m (no storey ladder to cross-check${withinBand ? "; within the storey band" : ""}).`,
    };
  }

  // Only the ladder → use its sum.
  if (ladderSumM !== null) {
    return {
      soffitM, directM, ladderSumM, liftsDirect, liftsLadder,
      reconciled: null, withinBand: null,
      confidence: worseConf("medium", readConf),
      note: `Soffit ${ladderSumM} m derived from the storey ladder (no direct soffit dimension read).`,
    };
  }

  return {
    soffitM: null, directM: null, ladderSumM: null, liftsDirect: null, liftsLadder: null,
    reconciled: null, withinBand: null,
    confidence: "unknown",
    note: "No soffit dimension or storey heights legible — height not established.",
  };
}
