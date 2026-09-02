import { describe, it, expect } from "vitest";
import { computeBirdcageFloor, cornerBirdcageWarning, pairBirdcageWidthWarning } from "./birdcage";

/**
 * The birdcage is derived PURELY from the measured footprint dimensions — no stated
 * area, no NDSS. These prove the per-axis LADDER (printed internal → overall − 2·
 * structural wall → overall − 2·legend wall → UNRESOLVED); that there is NO default
 * wall thickness; that a directly printed internal span wins over deriving; that
 * per-side walls subtract separately (never 2×wall); that compound floors sum; and
 * that the confidence is COMPUTED — from the internal-vs-(overall−walls) cross-check
 * when both exist, else from the wall source and the model's read confidence.
 */

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

describe("computeBirdcageFloor", () => {
  it("Dekker: direct internal width + depth derived off the structural plan wall (302)", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ internalWidthM: 4.877, internalDepthM: null, overallDepthM: 7.904, wallThicknessMm: 302 }],
      readConfidence: "high",
    });
    // depth = 7.904 − 2×0.302 = 7.300; area = 4.877 × 7.300 = 35.602
    expect(r.rectangles[0].depthM).toBe(7.3);
    expect(r.m2).toBe(35.602);
    expect(r.source).toBe("derived");
    // internal width read + structural derived depth, but no full overall−walls
    // cross-check (no overallWidth) → medium.
    expect(r.confidence).toBe("medium");
    expect(r.usedLegendWall).toBe(false);
  });

  it("Whitton: printed internal + overall both axes → corroborated by overall−walls → high", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        {
          internalWidthM: 5.287,
          internalDepthM: 8.447,
          overallWidthM: 5.942,
          overallDepthM: 9.103,
          wallThicknessMm: 328, // structural (plan), preferred
          legendWallThicknessMm: 353, // finished (legend), ignored while a plan wall exists
        },
      ],
      readConfidence: "high",
    });
    const rc = r.rectangles[0];
    expect(rc.widthBasis).toBe("internal");
    expect(rc.widthM).toBe(5.287);
    expect(rc.depthBasis).toBe("internal");
    expect(rc.wallSource).toBe("none"); // internal used for the value; walls only feed the cross-check
    expect(r.usedLegendWall).toBe(false);
    // internal 5.287×8.447=44.659 corroborated by (5.942−0.656)×(9.103−0.656) → high
    expect(r.m2).toBe(44.659);
    expect(r.source).toBe("derived");
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("prefers a printed internal span over deriving from overall − 2·wall", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 5.287, internalDepthM: 8.448, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
      ],
      readConfidence: "high",
    });
    expect(r.rectangles[0].widthBasis).toBe("internal");
    expect(r.rectangles[0].depthBasis).toBe("internal");
    expect(r.m2).toBe(round3(5.287 * 8.448));
    expect(r.source).toBe("derived");
  });

  it("subtracts ASYMMETRIC per-side walls (never 2× one wall)", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        {
          overallWidthM: 5.5, // gable line: external 328 one side, party wall 215 the other
          wallWidthLeftMm: 328,
          wallWidthRightMm: 215,
          internalDepthM: 9, // depth read directly
        },
      ],
      readConfidence: "high",
    });
    // width = 5.5 − 0.328 − 0.215 = 4.957 (NOT 5.5 − 2×0.328)
    expect(r.rectangles[0].widthM).toBe(4.957);
    expect(r.rectangles[0].wallWidthAMm).toBe(328);
    expect(r.rectangles[0].wallWidthBMm).toBe(215);
    expect(r.m2).toBe(round3(4.957 * 9));
    expect(r.confidence).toBe("medium"); // structural walls, no full cross-check
  });

  it("one side dimensioned → assumes the other equal, flagged, low", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ overallWidthM: 5.942, wallWidthLeftMm: 328, internalDepthM: 8 }], // no right wall
      readConfidence: "high",
    });
    // width = 5.942 − 0.328 − 0.328 (assumed symmetric)
    expect(r.rectangles[0].widthM).toBe(5.286);
    expect(r.assumedSymmetric).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/symmetric/i);
  });

  it("printed internal corroborated by overall − walls → high", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 5.287, internalDepthM: 8.447, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
      ],
      readConfidence: "high",
    });
    expect(r.source).toBe("derived");
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.note).toMatch(/cross-checked vs overall/i);
  });

  it("internal vs overall − walls DIVERGE (>5%) → keep internal, flag low", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 6, internalDepthM: 8, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
      ],
      readConfidence: "high",
    });
    // internal 48 vs derived 5.286×8.447=44.65 → ~7% → diverge; internal kept
    expect(r.m2).toBe(48);
    expect(r.reconciled).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/DIVERGE/);
  });

  it("derives off the STRUCTURAL plan wall when no internal is printed → medium", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328, legendWallThicknessMm: 353 }],
      readConfidence: "high",
    });
    // width = 5.942 − 2×0.328 = 5.286 ; depth = 9.103 − 2×0.328 = 8.447
    expect(r.rectangles[0].widthM).toBe(5.286);
    expect(r.rectangles[0].wallSource).toBe("plan");
    expect(r.usedLegendWall).toBe(false);
    expect(r.m2).toBe(round3(5.286 * 8.447));
    expect(r.confidence).toBe("medium"); // no independent cross-check (derived == overall−walls)
  });

  it("falls back to the LEGEND (finished-face) wall only when no plan wall is printed → low, flagged", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: null, legendWallThicknessMm: 353 }],
      readConfidence: "high",
    });
    // width = 5.942 − 2×0.353 = 5.236 ; depth = 9.103 − 2×0.353 = 8.397
    expect(r.rectangles[0].widthM).toBe(5.236);
    expect(r.rectangles[0].wallSource).toBe("legend");
    expect(r.usedLegendWall).toBe(true);
    expect(r.confidence).toBe("low"); // wrong face
    expect(r.note).toMatch(/legend/i);
  });

  it("NO wall anywhere (overall only, no internal, no plan or legend wall) → UNRESOLVED, never guessed", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103 }], // no wall of any kind
      readConfidence: "high",
    });
    expect(r.rectangles[0].widthM).toBe(null);
    expect(r.rectangles[0].incomplete).toBe(true);
    expect(r.derivedM2).toBe(null);
    expect(r.m2).toBe(null);
    expect(r.source).toBe("none");
    expect(r.confidence).toBe("unknown");
    expect(r.note).toMatch(/no wall thickness|unresolved/i);
  });

  it("an un-corroborated derived value is capped at the model's read confidence", () => {
    const r = computeBirdcageFloor({
      rectangles: [{ internalWidthM: 4, internalDepthM: 5 }], // no overall to cross-check against
      readConfidence: "low", // model wasn't sure it read the numbers
    });
    expect(r.source).toBe("derived");
    expect(r.m2).toBe(20);
    expect(r.confidence).toBe("low"); // capped — no independent cross-check
  });

  it("compound / L-shaped floor: sums the rectangles", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 4, internalDepthM: 5 }, // 20
        { internalWidthM: 2, internalDepthM: 3 }, // 6
      ],
      readConfidence: "high",
    });
    expect(r.derivedM2).toBe(26);
    expect(r.m2).toBe(26);
    expect(r.source).toBe("derived");
    expect(r.usedLegendWall).toBe(false);
    expect(r.confidence).toBe("medium");
  });

  it("per-house overall + wall → strips walls, NOT divided by dwellings (birdcage is per house)", () => {
    // Byron regression: the model reports ONE house's overall width off the
    // setting-out plan. The engine must NOT halve it (that halved the birdcage).
    const r = computeBirdcageFloor({
      rectangles: [{ overallWidthM: 5.253, overallDepthM: 8.804, wallThicknessMm: 302 }],
      readConfidence: "high",
    });
    // width = 5.253 − 0.302 − 0.302 = 4.649 (NOT ÷2 → would be 2.325) ; depth = 8.2
    expect(r.rectangles[0].widthM).toBe(4.649);
    expect(r.rectangles[0].depthM).toBe(8.2);
    expect(r.rectangles[0].widthBasis).toBe("overall");
    expect(r.m2).toBe(round3(4.649 * 8.2)); // 38.12, not 19.06
    expect(r.source).toBe("derived");
  });

  it("printed internal on a pair is used per-house AND cross-checks vs overall−walls → high", () => {
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 4.8, internalDepthM: 8.2, overallWidthM: 5.42, overallDepthM: 8.804, wallThicknessMm: 302 },
      ],
      readConfidence: "high",
    });
    // internal 4.8×8.2=39.36 ; derived (5.42−0.604)×(8.804−0.604)=4.816×8.2=39.49 → Δ0.3% → high
    expect(r.m2).toBe(round3(4.8 * 8.2));
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("nothing legible → null / unknown, never a guess", () => {
    const r = computeBirdcageFloor({ rectangles: [], readConfidence: "unknown" });
    expect(r.m2).toBe(null);
    expect(r.source).toBe("none");
    expect(r.confidence).toBe("unknown");
  });

  it("Hallam: a STEPPED front tiles into two rectangles (deep + shallow column), summed", () => {
    // Real Hallam GF: front is 675 deeper on the lounge side. Deep column
    // 3.211 × 8.599, shallow column 3.041 × 7.924 — each with its OWN depth.
    const r = computeBirdcageFloor({
      rectangles: [
        { internalWidthM: 3.211, internalDepthM: 8.599 }, // deep (lounge/kitchen)
        { internalWidthM: 3.041, internalDepthM: 7.924 }, // shallow (entrance/hall/WC)
      ],
      readConfidence: "high",
    });
    expect(r.rectangles[0].areaM2).toBe(round3(3.211 * 8.599)); // 27.611
    expect(r.rectangles[1].areaM2).toBe(round3(3.041 * 7.924)); // 24.097
    expect(r.m2).toBe(round3(3.211 * 8.599 + 3.041 * 7.924)); // 51.708
    expect(r.m2).toBe(51.708);
    expect(r.source).toBe("derived");
    // A single bounding rectangle would WRONGLY give 6.252 × 8.599 = 53.759.
    expect(r.m2).toBeLessThan(round3(6.252 * 8.599));
  });
});

describe("cornerBirdcageWarning (C12: corners ↔ birdcage shape)", () => {
  it("no warning when a rectangle has 4 corners and 1 birdcage rectangle", () => {
    expect(cornerBirdcageWarning(4, 1)).toBeNull();
  });
  it("no warning when a stepped footprint has >4 corners and a split birdcage", () => {
    expect(cornerBirdcageWarning(5, 2)).toBeNull();
  });
  it("flags >4 corners but a single (unsplit) birdcage rectangle", () => {
    expect(cornerBirdcageWarning(5, 1)).toMatch(/should be split/i);
  });
  it("flags a split birdcage but only 4 corners", () => {
    expect(cornerBirdcageWarning(4, 2)).toMatch(/more than 4/i);
  });
  it("null when the corner count is unknown", () => {
    expect(cornerBirdcageWarning(null, 1)).toBeNull();
    expect(cornerBirdcageWarning(undefined, 3)).toBeNull();
  });
});

describe("pairBirdcageWidthWarning (C13: per-house width vs shared frontage)", () => {
  it("no warning for a detached house (dwellingsWide 1)", () => {
    expect(pairBirdcageWidthWarning(1, 9.406, 9.0)).toBeNull();
  });
  it("no warning when a semi reports one house's width (~half the frontage)", () => {
    // Sinclair: front 9.406, per-house birdcage width 4.25.
    expect(pairBirdcageWidthWarning(2, 9.406, 4.25)).toBeNull();
    // Kilburn: front 10.506, per-house 4.8.
    expect(pairBirdcageWidthWarning(2, 10.506, 4.8)).toBeNull();
    // SM1 shared-core: front 14.727, per-house 6.873.
    expect(pairBirdcageWidthWarning(2, 14.727, 6.873)).toBeNull();
  });
  it("flags the whole-pair over-read (birdcage width ≈ full frontage)", () => {
    // SM1 bug: model reported 14.073 (whole pair internal) on a 14.727 frontage.
    expect(pairBirdcageWidthWarning(2, 14.727, 14.073)).toMatch(/per house/i);
  });
  it("null when frontage or width is missing", () => {
    expect(pairBirdcageWidthWarning(2, 0, 4.25)).toBeNull();
    expect(pairBirdcageWidthWarning(2, 9.406, 0)).toBeNull();
  });
});
