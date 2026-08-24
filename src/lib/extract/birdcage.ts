/**
 * Birdcage geometry — the ONE place the internal floor area is computed.
 *
 * The model (Layer 1) reports only RAW printed observations per floor:
 *   - direct internal dims (internalWidthM / internalDepthM) if the drawing prints them,
 *   - OR overall external dims (overallWidthM / overallDepthM) + the wall build-up,
 *   - the stated GROSS-INTERNAL area (Setting Out / masonry) — Colin's number,
 *   - the NDSS usable "Total Floor Area" as a fallback.
 *
 * It NEVER multiplies or subtracts. This module does all the geometry:
 *   depth  = internalDepthM ?? (overallDepthM − 2·wallThickness)
 *   width  = internalWidthM ?? (overallWidthM − 2·wallThickness) ÷ dwellingsWide
 *   area   = Σ (width × depth) over the rectangles (compound / L-shaped floors)
 * then reconciles the derived area against the stated gross-internal area and
 * turns the agreement into a COMPUTED confidence — not a model guess.
 *
 * Pure + unit-tested. Shared by persist.ts (storage), provenance.ts (the review
 * tooltip breakdown) and the offline runner, so they can never disagree.
 */

export type Conf = "high" | "medium" | "low" | "unknown";
const CONF_RANK: Record<Conf, number> = { unknown: 0, low: 1, medium: 2, high: 3 };
/** The worse (lower) of two confidences — a result is only as strong as its weakest part. */
export function worseConf(a: Conf, b: Conf): Conf {
  return CONF_RANK[a] <= CONF_RANK[b] ? a : b;
}

/**
 * Default external wall build-up (mm) used ONLY when the drawing prints no wall
 * thickness and we must derive depth/width from an overall dimension.
 * ⚠ OPEN (docs/11 §8): the cavity deduction is unconfirmed (600 vs 900 mm was
 * discussed). 302 mm ≈ a standard brick+cavity+block skin. Any floor that falls
 * back to this is flagged and never rated "high".
 */
export const DEFAULT_WALL_MM = 302;

/**
 * How close the derived area must be to the stated gross-internal area to count
 * as cross-checked. ⚠ A sign-off tolerance to confirm with Colin (docs/11 §8 #11).
 */
export const BIRDCAGE_TOLERANCE = 0.02; // 2%

/**
 * NDSS cross-check band. When no gross-internal area is stated, the derived
 * (gross-internal) footprint can still be checked against the NDSS "usable"
 * area: gross-internal should sit SLIGHTLY ABOVE usable (NDSS excludes stair
 * voids etc.). Expected over-read ≈ 0–12%. ⚠ Approximate — confirm with Colin.
 */
export const BIRDCAGE_NDSS_MIN_OVER = -0.02; // allow a marginal rounding dip
export const BIRDCAGE_NDSS_MAX_OVER = 0.12;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface BirdcageRectInput {
  internalWidthM?: number | null;
  internalDepthM?: number | null;
  overallWidthM?: number | null;
  overallDepthM?: number | null;
  wallThicknessMm?: number | null;
}
export interface BirdcageFloorInput {
  statedGrossInternalM2?: number | null;
  statedNdssM2?: number | null;
  rectangles?: BirdcageRectInput[] | null;
  /** The model's own confidence in the raw reads for this floor (caps the result). */
  readConfidence?: Conf;
}

export type Basis = "internal" | "overall" | "none";
export interface RectComputed {
  widthM: number | null;
  depthM: number | null;
  areaM2: number | null;
  widthBasis: Basis;
  depthBasis: Basis;
  wallMm: number;
  usedDefaultWall: boolean;
}
export type BirdcageSource = "stated" | "derived" | "ndss" | "none";
export interface BirdcageResult {
  m2: number | null; // the area to store (BIRDCAGE_*_M2)
  source: BirdcageSource; // which number won
  statedM2: number | null;
  ndssM2: number | null;
  derivedM2: number | null; // Σ rectangles, or null if any rectangle was incomplete
  rectangles: RectComputed[];
  confidence: Conf; // COMPUTED (reconciliation ∧ read confidence)
  reconciled: boolean | null; // stated vs derived agree within tolerance? null if not comparable
  relDiff: number | null; // |derived − stated| / stated
  usedDefaultWall: boolean; // any rectangle relied on the assumed wall thickness
  note: string; // one-line audit trail for the tooltip
}

/** Compute one rectangle's internal width × depth from whatever the model read. */
function computeRect(r: BirdcageRectInput, dwellingsWide: number): RectComputed {
  const dw = dwellingsWide >= 1 ? dwellingsWide : 1;
  const hasWall = r.wallThicknessMm != null && r.wallThicknessMm > 0;
  const wallMm = hasWall ? (r.wallThicknessMm as number) : DEFAULT_WALL_MM;
  const t = wallMm / 1000;

  let widthM: number | null = null;
  let widthBasis: Basis = "none";
  if (r.internalWidthM != null && r.internalWidthM > 0) {
    // A directly-read INTERNAL span is already per-dwelling — no division.
    widthM = r.internalWidthM;
    widthBasis = "internal";
  } else if (r.overallWidthM != null && r.overallWidthM > 0) {
    // External overall: strip the two external walls, then split across dwellings
    // (exact for a single dwelling; approximate for a pair — flagged downstream).
    widthM = round3((r.overallWidthM - 2 * t) / dw);
    widthBasis = "overall";
  }

  let depthM: number | null = null;
  let depthBasis: Basis = "none";
  if (r.internalDepthM != null && r.internalDepthM > 0) {
    depthM = r.internalDepthM;
    depthBasis = "internal";
  } else if (r.overallDepthM != null && r.overallDepthM > 0) {
    depthM = round3(r.overallDepthM - 2 * t);
    depthBasis = "overall";
  }

  const areaM2 = widthM != null && depthM != null ? round3(widthM * depthM) : null;
  // The default wall only actually mattered if we used an overall dimension.
  const usedDefaultWall =
    !hasWall && (widthBasis === "overall" || depthBasis === "overall");
  return { widthM, depthM, areaM2, widthBasis, depthBasis, wallMm, usedDefaultWall };
}

/**
 * Resolve one floor's birdcage area + a computed confidence, reconciling the
 * derived footprint against the stated gross-internal area.
 */
export function computeBirdcageFloor(
  floor: BirdcageFloorInput,
  dwellingsWide = 1,
): BirdcageResult {
  const readConf: Conf = floor.readConfidence ?? "medium";
  const statedM2 =
    floor.statedGrossInternalM2 != null && floor.statedGrossInternalM2 > 0
      ? round3(floor.statedGrossInternalM2)
      : null;
  const ndssM2 =
    floor.statedNdssM2 != null && floor.statedNdssM2 > 0 ? round3(floor.statedNdssM2) : null;

  const rects = (floor.rectangles ?? []).map((r) => computeRect(r, dwellingsWide));
  const usedDefaultWall = rects.some((r) => r.usedDefaultWall);
  // Derived area is trustworthy only if EVERY rectangle computed fully.
  const allComplete = rects.length > 0 && rects.every((r) => r.areaM2 != null);
  const derivedM2 = allComplete
    ? round3(rects.reduce((a, r) => a + (r.areaM2 as number), 0))
    : null;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  // --- Pick the number and compute the confidence. Priority: stated → derived → NDSS. ---
  if (statedM2 != null) {
    if (derivedM2 != null) {
      const relDiff = Math.abs(derivedM2 - statedM2) / statedM2;
      const reconciled = relDiff <= BIRDCAGE_TOLERANCE;
      // The stated number and an independently-derived footprint agreeing is
      // strong corroboration in its own right — so a reconciled birdcage is HIGH
      // regardless of the model's (often understated) per-floor read confidence.
      // A divergence is LOW and flagged.
      const conf: Conf = reconciled ? "high" : "low";
      const note = reconciled
        ? `Stated gross-internal ${statedM2} m² ✓ cross-checked (derived ${derivedM2} m², Δ ${pct(relDiff)}).`
        : `Stated ${statedM2} m² vs derived ${derivedM2} m² DIVERGE (Δ ${pct(relDiff)}) — check the dimensions.`;
      return {
        m2: statedM2, source: "stated", statedM2, ndssM2, derivedM2, rectangles: rects,
        confidence: conf, reconciled, relDiff, usedDefaultWall, note,
      };
    }
    return {
      m2: statedM2, source: "stated", statedM2, ndssM2, derivedM2: null, rectangles: rects,
      confidence: worseConf("medium", readConf), reconciled: null, relDiff: null, usedDefaultWall,
      note: `Stated gross-internal ${statedM2} m² (no internal dimensions to cross-check).`,
    };
  }

  if (derivedM2 != null) {
    // Cross-check the derived gross-internal footprint against the NDSS usable
    // area when there's no stated gross-internal: gross-internal should sit
    // slightly ABOVE usable. Within the band → corroborated (high, or medium if
    // the derivation leaned on an assumed wall). Outside → flag.
    if (ndssM2 != null) {
      const over = round3((derivedM2 - ndssM2) / ndssM2);
      const consistent = over >= BIRDCAGE_NDSS_MIN_OVER && over <= BIRDCAGE_NDSS_MAX_OVER;
      const pctOver = `${(over * 100).toFixed(1)}%`;
      if (consistent)
        return {
          m2: derivedM2, source: "derived", statedM2: null, ndssM2, derivedM2, rectangles: rects,
          confidence: usedDefaultWall ? "medium" : "high",
          reconciled: true, relDiff: over, usedDefaultWall,
          note: `Derived gross-internal ${derivedM2} m² ✓ cross-checked vs NDSS usable ${ndssM2} m² (+${pctOver}, as expected — usable excludes voids).`,
        };
      return {
        m2: derivedM2, source: "derived", statedM2: null, ndssM2, derivedM2, rectangles: rects,
        confidence: "low", reconciled: false, relDiff: over, usedDefaultWall,
        note: `Derived ${derivedM2} m² vs NDSS usable ${ndssM2} m² differ by ${pctOver} (expected gross-internal 0–12% ABOVE usable) — check the dimensions.`,
      };
    }
    const base: Conf = usedDefaultWall ? "low" : "medium";
    const note = usedDefaultWall
      ? `Derived ${derivedM2} m² from dimensions, using an ASSUMED ${DEFAULT_WALL_MM} mm wall (none printed) — confirm. No stated area to cross-check.`
      : `Derived ${derivedM2} m² from the printed dimensions. No stated gross-internal area to cross-check.`;
    return {
      m2: derivedM2, source: "derived", statedM2: null, ndssM2, derivedM2, rectangles: rects,
      confidence: worseConf(base, readConf), reconciled: null, relDiff: null, usedDefaultWall, note,
    };
  }

  if (ndssM2 != null) {
    return {
      m2: ndssM2, source: "ndss", statedM2: null, ndssM2, derivedM2: null, rectangles: rects,
      confidence: worseConf("medium", readConf), reconciled: null, relDiff: null, usedDefaultWall: false,
      note: `NDSS usable area ${ndssM2} m² — no gross-internal available; usable area reads ~1–2% low.`,
    };
  }

  return {
    m2: null, source: "none", statedM2: null, ndssM2: null, derivedM2: null, rectangles: rects,
    confidence: "unknown", reconciled: null, relDiff: null, usedDefaultWall: false,
    note: "No legible internal area or dimensions — birdcage not computed.",
  };
}
