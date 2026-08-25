/**
 * Birdcage geometry — the ONE place the internal floor area is computed.
 *
 * The model (Layer 1) reports only RAW printed observations per floor:
 *   - direct internal dims (internalWidthM / internalDepthM) if the drawing prints them,
 *   - OR overall external dims (overallWidthM / overallDepthM) + the wall thickness,
 *   - the stated GROSS-INTERNAL area (Setting Out / masonry) — Colin's number,
 *   - the NDSS usable "Total Floor Area" as a fallback.
 *
 * It NEVER multiplies or subtracts. This module does all the geometry, applying a
 * per-axis LADDER (docs/13 §3.10) — printed internal wins, else derive from the
 * overall minus the wall:
 *   depth  = internalDepthM ?? (overallDepthM − 2·wall)
 *   width  = internalWidthM ?? (overallWidthM − 2·wall) ÷ dwellingsWide
 *   wall   = wallThicknessMm (STRUCTURAL, plan) ?? legendWallThicknessMm (finished, fallback)
 *   area   = Σ (width × depth) over the rectangles (compound / L-shaped floors)
 * then reconciles the derived area against the stated gross-internal area and
 * turns the agreement into a COMPUTED confidence — not a model guess.
 *
 * There is NO default wall thickness: the birdcage is measured to the STRUCTURAL
 * (blockwork) face, and that value is read off THIS drawing (it differs on every
 * drawing — Miller 328, NSS 302, Augusta 392). If no internal span and no wall
 * thickness (plan or legend) are legible, the axis is left UNRESOLVED and flagged
 * for a human — never guessed.
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
  /** STRUCTURAL wall thickness off the plan's dimension chain (preferred). */
  wallThicknessMm?: number | null;
  /** WALL LEGEND cavity-wall thickness (finished face) — fallback only. */
  legendWallThicknessMm?: number | null;
}
export interface BirdcageFloorInput {
  statedGrossInternalM2?: number | null;
  statedNdssM2?: number | null;
  rectangles?: BirdcageRectInput[] | null;
  /** The model's own confidence in the raw reads for this floor (caps the result). */
  readConfidence?: Conf;
}

export type Basis = "internal" | "overall" | "none";
/** Which wall thickness a derived axis used (none = internal read, no wall needed). */
export type WallSource = "plan" | "legend" | "none";
export interface RectComputed {
  widthM: number | null;
  depthM: number | null;
  areaM2: number | null;
  widthBasis: Basis;
  depthBasis: Basis;
  /** The wall thickness (mm) actually used to strip an overall dim, or null if none was needed. */
  wallMm: number | null;
  wallSource: WallSource;
  /** True when a derived axis had to fall back to the finished-face legend wall. */
  usedLegendWall: boolean;
  /** True when an axis could not be resolved (no internal AND no wall to strip an overall). */
  incomplete: boolean;
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
  usedLegendWall: boolean; // any rectangle derived an axis off the finished-face legend wall
  note: string; // one-line audit trail for the tooltip
}

/**
 * Compute one rectangle's internal width × depth via the per-axis LADDER:
 * a directly-printed internal span wins; otherwise strip the STRUCTURAL wall
 * (plan value preferred, legend value as a fallback) off the overall dimension.
 * There is NO default wall — an overall dimension with no wall thickness is left
 * UNRESOLVED (that axis is null, so the area is null) and flagged upstream.
 */
function computeRect(r: BirdcageRectInput, dwellingsWide: number): RectComputed {
  const dw = dwellingsWide >= 1 ? dwellingsWide : 1;
  // Prefer the STRUCTURAL (plan) wall; fall back to the finished-face legend wall.
  const planWall = r.wallThicknessMm != null && r.wallThicknessMm > 0 ? r.wallThicknessMm : null;
  const legendWall =
    r.legendWallThicknessMm != null && r.legendWallThicknessMm > 0 ? r.legendWallThicknessMm : null;
  const wallMm = planWall ?? legendWall; // null when neither is printed
  const t = wallMm != null ? wallMm / 1000 : null;

  let widthM: number | null = null;
  let widthBasis: Basis = "none";
  if (r.internalWidthM != null && r.internalWidthM > 0) {
    // A directly-read INTERNAL span is already per-dwelling — no division.
    widthM = r.internalWidthM;
    widthBasis = "internal";
  } else if (r.overallWidthM != null && r.overallWidthM > 0 && t != null) {
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
  } else if (r.overallDepthM != null && r.overallDepthM > 0 && t != null) {
    depthM = round3(r.overallDepthM - 2 * t);
    depthBasis = "overall";
  }

  const derivedAxis = widthBasis === "overall" || depthBasis === "overall";
  // Which wall we actually leant on (only meaningful when an axis was derived).
  const wallSource: WallSource = !derivedAxis
    ? "none"
    : planWall != null
      ? "plan"
      : "legend";
  const areaM2 = widthM != null && depthM != null ? round3(widthM * depthM) : null;
  // Incomplete: an axis wanted an overall but had no wall to strip it (or nothing legible).
  const incomplete = widthM == null || depthM == null;
  return {
    widthM,
    depthM,
    areaM2,
    widthBasis,
    depthBasis,
    wallMm: derivedAxis ? wallMm : null,
    wallSource,
    usedLegendWall: wallSource === "legend",
    incomplete,
  };
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
  const usedLegendWall = rects.some((r) => r.usedLegendWall);
  // A rectangle we were given but couldn't fully compute — e.g. an overall
  // dimension with no wall thickness to strip. Never silently guessed a wall.
  const hasUnresolvedRect = rects.length > 0 && rects.some((r) => r.incomplete);
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
        confidence: conf, reconciled, relDiff, usedLegendWall, note,
      };
    }
    return {
      m2: statedM2, source: "stated", statedM2, ndssM2, derivedM2: null, rectangles: rects,
      confidence: worseConf("medium", readConf), reconciled: null, relDiff: null, usedLegendWall,
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
          // The finished-face legend wall is ~1% off the structural face, so a
          // legend-derived footprint corroborated by NDSS is medium, not high.
          confidence: usedLegendWall ? "medium" : "high",
          reconciled: true, relDiff: over, usedLegendWall,
          note: `Derived gross-internal ${derivedM2} m² ✓ cross-checked vs NDSS usable ${ndssM2} m² (+${pctOver}, as expected — usable excludes voids).${usedLegendWall ? " (Used the finished-face legend wall — confirm.)" : ""}`,
        };
      return {
        m2: derivedM2, source: "derived", statedM2: null, ndssM2, derivedM2, rectangles: rects,
        confidence: "low", reconciled: false, relDiff: over, usedLegendWall,
        note: `Derived ${derivedM2} m² vs NDSS usable ${ndssM2} m² differ by ${pctOver} (expected gross-internal 0–12% ABOVE usable) — check the dimensions.`,
      };
    }
    // No stated area, no NDSS — a bare derived footprint. Full confidence when it
    // used the structural (plan) wall; capped to medium when it leant on the
    // finished-face legend wall (the wrong face by ~1%, so flag to confirm).
    const base: Conf = usedLegendWall ? "low" : "medium";
    const note = usedLegendWall
      ? `Derived ${derivedM2} m² using the finished-face legend wall (no structural wall dimensioned) — confirm. No stated area to cross-check.`
      : `Derived ${derivedM2} m² from the printed dimensions (structural wall). No stated gross-internal area to cross-check.`;
    return {
      m2: derivedM2, source: "derived", statedM2: null, ndssM2, derivedM2, rectangles: rects,
      confidence: worseConf(base, readConf), reconciled: null, relDiff: null, usedLegendWall, note,
    };
  }

  if (ndssM2 != null) {
    return {
      m2: ndssM2, source: "ndss", statedM2: null, ndssM2, derivedM2: null, rectangles: rects,
      confidence: worseConf("medium", readConf), reconciled: null, relDiff: null, usedLegendWall: false,
      note: `NDSS usable area ${ndssM2} m² — no gross-internal available; usable area reads ~1–2% low.`,
    };
  }

  return {
    m2: null, source: "none", statedM2: null, ndssM2: null, derivedM2: null, rectangles: rects,
    confidence: "unknown", reconciled: null, relDiff: null, usedLegendWall: false,
    note: hasUnresolvedRect
      ? "Dimensions given but no wall thickness to derive the internal footprint (and no stated area) — birdcage unresolved, needs a human."
      : "No legible internal area or dimensions — birdcage not computed.",
  };
}
