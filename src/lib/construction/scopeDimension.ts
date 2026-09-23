/**
 * Parse the dimensions a client's scope of works states — PURE, unit-tested.
 *
 * Tuned against the real Stanmore scope (`50172_Scaffold Scope_Rev.1.xlsx`),
 * whose "Approx. Plan Dimensions" column mixes formats in one sheet:
 *
 *   "20lin.m"  "560lin.m"  "45lin.m"     → a run, in linear metres
 *   "2.4x5.4m" "25x20m"    "3.6m x 2.4m" → a plan rectangle, so an area
 *   "10x1m"                              → a rectangle that is really a run
 *   "N/A"      ""                        → nothing stated
 *
 * and an "Approx. Height (m)" column that carries notes:
 *
 *   "10m"  "12m\n(top working platform level)"  "0.8m high"  "N/A"
 *
 * The model reports these strings VERBATIM (docs/20 doctrine B); the arithmetic
 * happens here, where it is testable.
 */

export type ScopeDimensionKind = "LINEAR" | "AREA" | "NONE";

export interface ScopeDimension {
  kind: ScopeDimensionKind;
  /** Linear metres, for a run. */
  lengthM: number | null;
  /** Square metres, for a plan rectangle. */
  areaM2: number | null;
  /** The two sides of a stated rectangle, in the order written. */
  sides: [number, number] | null;
  /** The exact text this came from, kept for provenance. */
  source: string;
}

const NONE: Omit<ScopeDimension, "source"> = {
  kind: "NONE",
  lengthM: null,
  areaM2: null,
  sides: null,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/** Is this cell a "nothing stated" marker? */
function isBlank(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "" || t === "n/a" || t === "na" || t === "-" || t === "tbc" || t === "tbd";
}

/**
 * Read a plan-dimension cell. A rectangle yields BOTH its area and its sides, so
 * the caller can decide which the item needs (a crash deck wants the area, a
 * loading bay just wants to know it is a 3.6 x 2.4 grid).
 */
export function parseScopeDimension(text: string): ScopeDimension {
  const source = (text ?? "").trim();
  if (isBlank(source)) return { ...NONE, source };

  const t = source.toLowerCase().replace(/\s+/g, " ");

  // "2.4x5.4m", "25 x 20m", "3.6m x 2.4m"
  const rect = /(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)\s*m?/.exec(t);
  if (rect) {
    const a = Number(rect[1]);
    const b = Number(rect[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      return {
        kind: "AREA",
        areaM2: round2(a * b),
        lengthM: null,
        sides: [a, b],
        source,
      };
    }
  }

  // "20lin.m", "560 lin.m", "45linear m", "77.357 m"
  const linear = /(\d+(?:\.\d+)?)\s*(?:lin(?:ear)?\.?\s*)?m\b/.exec(t);
  if (linear) {
    const v = Number(linear[1]);
    if (Number.isFinite(v) && v > 0) {
      return { kind: "LINEAR", lengthM: round3(v), areaM2: null, sides: null, source };
    }
  }

  // A bare number with no unit: treat as metres, which is what the sheet means.
  const bare = /^(\d+(?:\.\d+)?)$/.exec(t);
  if (bare) {
    const v = Number(bare[1]);
    if (v > 0) return { kind: "LINEAR", lengthM: round3(v), areaM2: null, sides: null, source };
  }

  return { ...NONE, source };
}

/**
 * Read a height cell. The sheet writes the working-platform level in brackets
 * underneath, and sometimes adds "high"; take the first number in metres.
 */
export function parseScopeHeight(text: string): number | null {
  const source = (text ?? "").trim();
  if (isBlank(source)) return null;
  const m = /(\d+(?:\.\d+)?)\s*m\b/i.exec(source.replace(/\s+/g, " "));
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? round3(v) : null;
  }
  const bare = /^(\d+(?:\.\d+)?)$/.exec(source);
  return bare && Number(bare[1]) > 0 ? round3(Number(bare[1])) : null;
}

/**
 * Read a hire-duration cell: "20wks", "8wks", "4w", "2 weeks". The scope gives a
 * duration PER LINE, which is why a construction quote cannot have one job-wide
 * hire period.
 */
export function parseScopeDurationWeeks(text: string): number | null {
  const source = (text ?? "").trim();
  if (isBlank(source)) return null;
  const m = /(\d+(?:\.\d+)?)\s*(?:w|wk|wks|week|weeks)\b/i.exec(source.replace(/\s+/g, " "));
  if (m) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? Math.ceil(v) : null;
  }
  const bare = /^(\d+)$/.exec(source);
  return bare && Number(bare[1]) > 0 ? Number(bare[1]) : null;
}

/**
 * Pick the quantity an item of this unit needs from a parsed dimension.
 * Returns null rather than guessing when the scope did not state a usable figure.
 */
export function quantityForUnit(
  dim: ScopeDimension,
  unit: string,
): { quantity: number; basis: string } | null {
  const wantsArea = unit === "M2" || unit === "M2_PER_LIFT";
  const wantsLinear = unit === "LM" || unit === "LM_PER_LIFT";

  if (wantsArea) {
    if (dim.areaM2 != null) return { quantity: dim.areaM2, basis: `${dim.source} = ${dim.areaM2} m2` };
    return null;
  }
  if (wantsLinear) {
    if (dim.lengthM != null) return { quantity: dim.lengthM, basis: dim.source };
    // A stated rectangle can still give a run: use its longer side, and say so.
    if (dim.sides) {
      const long = Math.max(dim.sides[0], dim.sides[1]);
      return { quantity: long, basis: `${dim.source}, longest side` };
    }
    return null;
  }
  return null; // counted items (NR) take their quantity from the scope's wording
}
