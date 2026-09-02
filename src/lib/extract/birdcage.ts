/**
 * Birdcage geometry — the ONE place the internal floor area is computed.
 *
 * The birdcage is derived PURELY from the MEASURED footprint dimensions — never a
 * stated/printed area. The model (Layer 1) reports only RAW printed observations
 * per floor:
 *   - direct internal dims (internalWidthM / internalDepthM) if the drawing prints them,
 *   - OR overall external dims (overallWidthM / overallDepthM) + the wall thickness.
 *
 * It NEVER multiplies or subtracts. This module does all the geometry, applying a
 * per-axis LADDER (docs/13 §3.10) — printed internal wins, else derive from the
 * overall minus the wall:
 *   depth  = internalDepthM ?? (overallDepthM − 2·wall)
 *   width  = internalWidthM ?? (overallWidthM − 2·wall)   [per house — NOT divided]
 *   wall   = wallThicknessMm (STRUCTURAL, plan) ?? legendWallThicknessMm (finished, fallback)
 *   area   = Σ (width × depth) over the rectangles (compound / L-shaped floors)
 * The confidence is COMPUTED — when an internal span AND an independent overall−walls
 * derivation both exist, they cross-check each other; otherwise it reflects the wall
 * source (structural / legend / assumed-symmetric) and the model's read confidence.
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

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Per-house birdcage width sanity (C13). On a pair/terrace the FRONTAGE is shared,
 * so one house's birdcage width should be ≈ frontage ÷ dwellings — NOT the whole
 * frontage. If the widest reported birdcage rectangle is close to the full pair
 * frontage, the model grabbed the pair (the shared-frontage over-read). Returns a
 * one-line warning, or null. All lengths in metres.
 */
export function pairBirdcageWidthWarning(
  dwellingsWide: number | null | undefined,
  frontFrontageM: number,
  maxBirdcageWidthM: number,
): string | null {
  if (dwellingsWide == null || dwellingsWide < 2) return null;
  if (frontFrontageM <= 0 || maxBirdcageWidthM <= 0) return null;
  // A per-house width is ~frontage/dwellings; >0.7× the full frontage means the
  // whole pair was reported (one house should be at most ~half on a pair).
  if (maxBirdcageWidthM > 0.7 * frontFrontageM) {
    const perHouse = round3(frontFrontageM / dwellingsWide);
    return `a birdcage rectangle is ${round3(maxBirdcageWidthM)} m wide — close to the full ${round3(frontFrontageM)} m frontage across ${dwellingsWide} dwellings. The birdcage is PER HOUSE: report one house's width (≈ ${perHouse} m), not the whole pair/terrace.`;
  }
  return null;
}

/**
 * Corner ↔ birdcage-shape consistency (C12). A footprint with >4 EXTERNAL corners
 * is non-rectangular, so at least one floor's birdcage must be split into >1
 * rectangle — and a split birdcage implies >4 corners. They are the same reentrant
 * feature, so a mismatch is a model error. Returns a one-line warning, or null.
 * `maxRects` = the most rectangles reported on any single floor.
 */
export function cornerBirdcageWarning(
  cornerCount: number | null | undefined,
  maxRects: number,
): string | null {
  if (cornerCount == null) return null;
  if (cornerCount > 4 && maxRects <= 1)
    return `${cornerCount} external corners but the birdcage is a single rectangle — a stepped / L / T / U footprint should be split into rectangles. Check the shape.`;
  if (cornerCount <= 4 && maxRects > 1)
    return `birdcage split into ${maxRects} rectangles but only ${cornerCount} external corners — a split footprint should have more than 4. Check.`;
  return null;
}

export interface BirdcageRectInput {
  internalWidthM?: number | null;
  internalDepthM?: number | null;
  overallWidthM?: number | null;
  overallDepthM?: number | null;
  /** STRUCTURAL wall thickness on the WIDTH dimension, per side (they can differ:
   *  a party wall vs an external gable, a rendered face vs a brick face). */
  wallWidthLeftMm?: number | null;
  wallWidthRightMm?: number | null;
  /** STRUCTURAL wall thickness on the DEPTH dimension, per side (front/rear). */
  wallDepthFrontMm?: number | null;
  wallDepthRearMm?: number | null;
  /** Legacy / uniform STRUCTURAL wall — used for a side when its per-side value
   *  isn't given (a plan whose walls are all the same thickness). */
  wallThicknessMm?: number | null;
  /** WALL LEGEND cavity-wall thickness (finished face) — fallback only. */
  legendWallThicknessMm?: number | null;
}
export interface BirdcageFloorInput {
  rectangles?: BirdcageRectInput[] | null;
  /** The model's own confidence in the raw reads for this floor (caps the result). */
  readConfidence?: Conf;
}

export type Basis = "internal" | "overall" | "none";
/** Which wall thickness a derived axis used (none = internal read, no wall needed). */
export type WallSource = "plan" | "legend" | "none";
export interface RectComputed {
  widthM: number | null; // the VALUE used (internal preferred)
  depthM: number | null;
  areaM2: number | null;
  widthBasis: Basis;
  depthBasis: Basis;
  /** The purely-derived axis (overall − wallA − wallB), computed even when the
   *  internal was used — for the internal-vs-derived cross-check. null if not derivable. */
  derivedWidthM: number | null;
  derivedDepthM: number | null;
  derivedAreaM2: number | null;
  /** The two structural walls actually used to strip each overall (mm), for the tooltip. */
  wallWidthAMm: number | null;
  wallWidthBMm: number | null;
  wallDepthAMm: number | null;
  wallDepthBMm: number | null;
  wallSource: WallSource;
  /** A derived axis fell back to the finished-face legend wall. */
  usedLegendWall: boolean;
  /** A derived axis had a wall on only one side and assumed the other equal. */
  assumedSymmetric: boolean;
  /** The value area could not be resolved (no internal AND no wall to strip an overall). */
  incomplete: boolean;
}
export type BirdcageSource = "derived" | "none";
export interface BirdcageResult {
  m2: number | null; // the area to store (BIRDCAGE_*_M2)
  source: BirdcageSource; // "derived" from the dimensions, or "none" if unresolved
  derivedM2: number | null; // Σ chosen rectangle areas (internal-preferred), or null if any incomplete
  crossCheckM2: number | null; // Σ purely-derived areas (overall − walls), for the internal-vs-derived check
  rectangles: RectComputed[];
  confidence: Conf; // COMPUTED (internal-vs-derived cross-check ∧ wall source ∧ read confidence)
  reconciled: boolean | null; // internal & overall−walls agree within tolerance? null if N/A
  relDiff: number | null; // the relative gap that drove `reconciled`
  usedLegendWall: boolean; // a stored value derived an axis off the finished-face legend wall
  assumedSymmetric: boolean; // a stored value assumed a one-sided wall was symmetric
  note: string; // one-line audit trail for the tooltip
}

const pos = (x: number | null | undefined): number | null => (x != null && x > 0 ? x : null);

interface AxisWalls {
  a: number | null;
  b: number | null;
  source: WallSource;
  assumedSymmetric: boolean;
}
/**
 * Resolve the two structural walls flanking one axis. Prefer the two printed
 * per-side values; if only ONE side is printed, assume the other equal (flagged);
 * if a uniform legacy wall is given, use it both sides; else the finished-face
 * legend wall (fallback); else nothing. NEVER a hard-coded default.
 */
function resolveAxisWalls(
  side1: number | null | undefined,
  side2: number | null | undefined,
  legacy: number | null | undefined,
  legend: number | null | undefined,
): AxisWalls {
  const s1 = pos(side1);
  const s2 = pos(side2);
  const lg = pos(legacy);
  const leg = pos(legend);
  if (s1 != null || s2 != null || lg != null) {
    const a = s1 ?? s2 ?? lg;
    const b = s2 ?? s1 ?? lg;
    if (a != null && b != null) {
      // We assumed symmetry only if exactly one per-side value was read (and we
      // had to borrow it for the other side — not when a uniform legacy wall was given).
      const assumedSymmetric = (s1 == null) !== (s2 == null) && lg == null;
      return { a, b, source: "plan", assumedSymmetric };
    }
  }
  if (leg != null) return { a: leg, b: leg, source: "legend", assumedSymmetric: false };
  return { a: null, b: null, source: "none", assumedSymmetric: false };
}

/**
 * Compute one rectangle. PRIORITY: a directly-printed internal span is the VALUE.
 * The overall − wallA − wallB derivation is ALSO computed (when possible) as an
 * independent cross-check, and becomes the value only when no internal is printed.
 * Walls are subtracted PER SIDE (they can differ) — never `2 × wall` — and there
 * is NO default: an overall with no wall on a side is left UNRESOLVED and flagged.
 */
function computeRect(r: BirdcageRectInput): RectComputed {
  const wWall = resolveAxisWalls(r.wallWidthLeftMm, r.wallWidthRightMm, r.wallThicknessMm, r.legendWallThicknessMm);
  const dWall = resolveAxisWalls(r.wallDepthFrontMm, r.wallDepthRearMm, r.wallThicknessMm, r.legendWallThicknessMm);

  // --- WIDTH: derived (overall − both walls) computed if possible. NOT divided
  //     by dwellings: the birdcage is measured PER HOUSE, and the model reports a
  //     single house's footprint (the setting-out plan shows one house). The pair
  //     frontage is only for the perimeter walls — that division lives in the
  //     take-off engine, not here. ---
  const overallW = pos(r.overallWidthM);
  const derivedWidthM =
    overallW != null && wWall.a != null && wWall.b != null
      ? round3(overallW - wWall.a / 1000 - wWall.b / 1000)
      : null;
  let widthM: number | null;
  let widthBasis: Basis;
  if (pos(r.internalWidthM) != null) {
    widthM = r.internalWidthM as number; // a printed internal span is already one house
    widthBasis = "internal";
  } else if (derivedWidthM != null) {
    widthM = derivedWidthM;
    widthBasis = "overall";
  } else {
    widthM = null;
    widthBasis = "none";
  }

  // --- DEPTH: same, but never divided by dwellings ---
  const overallD = pos(r.overallDepthM);
  const derivedDepthM =
    overallD != null && dWall.a != null && dWall.b != null
      ? round3(overallD - dWall.a / 1000 - dWall.b / 1000)
      : null;
  let depthM: number | null;
  let depthBasis: Basis;
  if (pos(r.internalDepthM) != null) {
    depthM = r.internalDepthM as number;
    depthBasis = "internal";
  } else if (derivedDepthM != null) {
    depthM = derivedDepthM;
    depthBasis = "overall";
  } else {
    depthM = null;
    depthBasis = "none";
  }

  const areaM2 = widthM != null && depthM != null ? round3(widthM * depthM) : null;
  const derivedAreaM2 =
    derivedWidthM != null && derivedDepthM != null ? round3(derivedWidthM * derivedDepthM) : null;

  // Flags reflect only what the stored VALUE relied on (a derived axis) — not the cross-check.
  const usedLegendWall =
    (widthBasis === "overall" && wWall.source === "legend") ||
    (depthBasis === "overall" && dWall.source === "legend");
  const assumedSymmetric =
    (widthBasis === "overall" && wWall.assumedSymmetric) ||
    (depthBasis === "overall" && dWall.assumedSymmetric);
  const wallSource: WallSource =
    widthBasis !== "overall" && depthBasis !== "overall"
      ? "none"
      : usedLegendWall
        ? "legend"
        : "plan";

  return {
    widthM,
    depthM,
    areaM2,
    widthBasis,
    depthBasis,
    derivedWidthM,
    derivedDepthM,
    derivedAreaM2,
    wallWidthAMm: wWall.a,
    wallWidthBMm: wWall.b,
    wallDepthAMm: dWall.a,
    wallDepthBMm: dWall.b,
    wallSource,
    usedLegendWall,
    assumedSymmetric,
    incomplete: widthM == null || depthM == null,
  };
}

/**
 * Tolerance for the INTERNAL-vs-derived cross-check: how close a printed internal
 * span must sit to the independent overall−walls derivation to corroborate it.
 * ⚠ Approximate — confirm the sign-off band with Colin (docs/11 §8 #11).
 */
export const BIRDCAGE_INTERNAL_XCHECK_TOLERANCE = 0.05; // 5%

/**
 * Resolve one floor's birdcage area + a computed confidence, PURELY from the
 * measured footprint (no stated area, no NDSS). The VALUE is the derived footprint
 * — internal span preferred, else overall − walls. When BOTH exist the overall −
 * walls derivation is an independent cross-check of the printed internal span.
 */
export function computeBirdcageFloor(floor: BirdcageFloorInput): BirdcageResult {
  const readConf: Conf = floor.readConfidence ?? "medium";

  const rects = (floor.rectangles ?? []).map((r) => computeRect(r));
  const usedLegendWall = rects.some((r) => r.usedLegendWall);
  const assumedSymmetric = rects.some((r) => r.assumedSymmetric);
  const anyInternal = rects.some((r) => r.widthBasis === "internal" || r.depthBasis === "internal");
  // A rectangle we were given but couldn't fully compute — e.g. an overall
  // dimension with no wall thickness to strip. Never silently guessed a wall.
  const hasUnresolvedRect = rects.length > 0 && rects.some((r) => r.incomplete);
  // The stored VALUE area (internal-preferred): only if EVERY rectangle computed.
  const allComplete = rects.length > 0 && rects.every((r) => r.areaM2 != null);
  const derivedM2 = allComplete
    ? round3(rects.reduce((a, r) => a + (r.areaM2 as number), 0))
    : null;
  // The independent overall − walls area, for the internal-vs-derived cross-check.
  const allXCheck = rects.length > 0 && rects.every((r) => r.derivedAreaM2 != null);
  const crossCheckM2 = allXCheck
    ? round3(rects.reduce((a, r) => a + (r.derivedAreaM2 as number), 0))
    : null;

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const flags = (extra = "") =>
    `${extra}${assumedSymmetric ? " (One wall side not dimensioned — assumed symmetric.)" : ""}`;

  if (derivedM2 != null) {
    // --- A printed internal footprint, corroborated by the independent overall −
    //     walls derivation. Both are strictly per-house (the birdcage never divides
    //     by dwellings), so this cross-check runs for pairs/terraces too — it
    //     catches a per-house-vs-pair read mismatch instead of hiding it. ---
    if (anyInternal && crossCheckM2 != null && crossCheckM2 !== derivedM2) {
      const relDiff = Math.abs(derivedM2 - crossCheckM2) / derivedM2;
      const reconciled = relDiff <= BIRDCAGE_INTERNAL_XCHECK_TOLERANCE;
      if (reconciled) {
        // Symmetric assumption on a passed check is fine but not "high".
        const conf: Conf = assumedSymmetric ? "medium" : "high";
        return {
          m2: derivedM2, source: "derived", derivedM2, crossCheckM2, rectangles: rects,
          confidence: conf, reconciled: true, relDiff, usedLegendWall, assumedSymmetric,
          note: flags(`Internal footprint ${derivedM2} m² ✓ cross-checked vs overall − walls ${crossCheckM2} m² (Δ ${pct(relDiff)}).`),
        };
      }
      // Keep the internal value (preferred), but flag the disagreement.
      return {
        m2: derivedM2, source: "derived", derivedM2, crossCheckM2, rectangles: rects,
        confidence: "low", reconciled: false, relDiff, usedLegendWall, assumedSymmetric,
        note: flags(`Internal footprint ${derivedM2} m² vs overall − walls ${crossCheckM2} m² DIVERGE (Δ ${pct(relDiff)}) — internal used, check the reads.`),
      };
    }

    // A bare footprint with no independent cross-check (internal with no overall, a
    // pair, or a pure overall − walls derivation). Structural wall → medium; a
    // legend fallback or a one-sided (assumed-symmetric) wall → low; flagged.
    const base: Conf = usedLegendWall || assumedSymmetric ? "low" : "medium";
    const how = anyInternal
      ? `Internal footprint ${derivedM2} m²`
      : usedLegendWall
        ? `Derived ${derivedM2} m² using the finished-face legend wall (no structural wall dimensioned) — confirm`
        : `Derived ${derivedM2} m² from the printed dimensions (structural wall)`;
    return {
      m2: derivedM2, source: "derived", derivedM2, crossCheckM2, rectangles: rects,
      confidence: worseConf(base, readConf), reconciled: null, relDiff: null, usedLegendWall, assumedSymmetric,
      note: flags(`${how}. Computed from the printed dimensions.`),
    };
  }

  return {
    m2: null, source: "none", derivedM2: null, crossCheckM2: null, rectangles: rects,
    confidence: "unknown", reconciled: null, relDiff: null, usedLegendWall: false, assumedSymmetric: false,
    note: hasUnresolvedRect
      ? "Dimensions given but no wall thickness to derive the internal footprint — birdcage unresolved, needs a human."
      : "No legible internal dimensions — birdcage not computed.",
  };
}
