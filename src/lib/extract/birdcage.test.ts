import { describe, it, expect } from "vitest";
import { computeBirdcageFloor } from "./birdcage";

/**
 * The birdcage geometry lives here (not in the model). These prove the per-axis
 * LADDER (printed internal → overall − 2·structural wall → overall − 2·legend
 * wall → UNRESOLVED); that there is NO default wall thickness; that a directly
 * printed internal span wins over deriving; that compound floors sum; that the
 * derived footprint reconciles against the stated gross-internal area; and that
 * the confidence is COMPUTED from that agreement, not taken from the model.
 */

describe("computeBirdcageFloor", () => {
  it("Dekker: direct internal width + derived depth (plan wall 302), reconciled to the stated GIA", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: 35.6,
        statedNdssM2: 35.0,
        rectangles: [
          { internalWidthM: 4.877, internalDepthM: null, overallDepthM: 7.904, wallThicknessMm: 302 },
        ],
        readConfidence: "high",
      },
      2, // pair — but the internal width is per-dwelling, so no division
    );
    // depth = 7.904 − 2×0.302 = 7.300; area = 4.877 × 7.300 = 35.602
    expect(r.derivedM2).toBe(35.602);
    // stated and derived agree within 2% → use the stated gross-internal
    expect(r.m2).toBe(35.6);
    expect(r.source).toBe("stated");
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.usedLegendWall).toBe(false);
  });

  it("Whitton: printed internal width + depth derived off the structural plan wall (328)", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          {
            internalWidthM: 5.287, // printed directly — used as-is
            overallWidthM: 5.942,
            overallDepthM: 9.103,
            wallThicknessMm: 328, // structural (plan), preferred
            legendWallThicknessMm: 353, // finished (legend), ignored while a plan wall exists
          },
        ],
        readConfidence: "high",
      },
      2,
    );
    const rc = r.rectangles[0];
    expect(rc.widthBasis).toBe("internal");
    expect(rc.widthM).toBe(5.287); // NOT divided (internal is per-dwelling)
    expect(rc.depthBasis).toBe("overall");
    expect(rc.depthM).toBe(8.447); // 9.103 − 2×0.328
    expect(rc.wallSource).toBe("plan");
    expect(r.usedLegendWall).toBe(false);
    // area = 5.287 × 8.447 = 44.659; derived, no stated/NDSS → medium
    expect(r.derivedM2).toBe(44.659);
    expect(r.m2).toBe(44.659);
    expect(r.source).toBe("derived");
    expect(r.confidence).toBe("medium");
  });

  it("prefers a printed internal span over deriving from overall − 2·wall", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          { internalWidthM: 5.287, internalDepthM: 8.448, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
        ],
        readConfidence: "high",
      },
      1,
    );
    expect(r.rectangles[0].widthBasis).toBe("internal");
    expect(r.rectangles[0].depthBasis).toBe("internal");
    expect(r.rectangles[0].wallSource).toBe("none"); // no wall needed
    expect(r.m2).toBe(round3(5.287 * 8.448));
  });

  it("subtracts ASYMMETRIC per-side walls (never 2× one wall)", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          {
            overallWidthM: 5.5, // gable line: external 328 one side, party wall 215 the other
            wallWidthLeftMm: 328,
            wallWidthRightMm: 215,
            internalDepthM: 9, // depth read directly
          },
        ],
        readConfidence: "high",
      },
      1,
    );
    // width = 5.5 − 0.328 − 0.215 = 4.957 (NOT 5.5 − 2×0.328)
    expect(r.rectangles[0].widthM).toBe(4.957);
    expect(r.rectangles[0].wallWidthAMm).toBe(328);
    expect(r.rectangles[0].wallWidthBMm).toBe(215);
    expect(r.m2).toBe(round3(4.957 * 9));
  });

  it("one side dimensioned → assumes the other equal, flagged", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ overallWidthM: 5.942, wallWidthLeftMm: 328, internalDepthM: 8 }], // no right wall
        readConfidence: "high",
      },
      1,
    );
    // width = 5.942 − 0.328 − 0.328 (assumed symmetric)
    expect(r.rectangles[0].widthM).toBe(5.286);
    expect(r.assumedSymmetric).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/symmetric/i);
  });

  it("printed internal corroborated by overall − walls (single dwelling) → high", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          { internalWidthM: 5.287, internalDepthM: 8.447, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
        ],
        readConfidence: "high",
      },
      1,
    );
    // internal 5.287×8.447=44.659 ; derived (5.942−0.656)×(9.103−0.656)=5.286×8.447=44.65 → Δ<5% → corroborated
    expect(r.source).toBe("derived");
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.note).toMatch(/cross-checked vs overall/i);
  });

  it("internal vs overall − walls DIVERGE (>5%) → keep internal, flag low", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          { internalWidthM: 6, internalDepthM: 8, overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328 },
        ],
        readConfidence: "high",
      },
      1,
    );
    // internal 48 vs derived 5.286×8.447=44.65 → ~7% → diverge; internal kept
    expect(r.m2).toBe(48);
    expect(r.reconciled).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/DIVERGE/);
  });

  it("derives off the STRUCTURAL plan wall when no internal is printed", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: 328, legendWallThicknessMm: 353 }],
        readConfidence: "high",
      },
      1,
    );
    // width = 5.942 − 2×0.328 = 5.286 ; depth = 9.103 − 2×0.328 = 8.447
    expect(r.rectangles[0].widthM).toBe(5.286);
    expect(r.rectangles[0].wallSource).toBe("plan");
    expect(r.usedLegendWall).toBe(false);
    expect(r.confidence).toBe("medium");
  });

  it("falls back to the LEGEND (finished-face) wall only when no plan wall is printed → capped, flagged", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103, wallThicknessMm: null, legendWallThicknessMm: 353 }],
        readConfidence: "high",
      },
      1,
    );
    // width = 5.942 − 2×0.353 = 5.236 ; depth = 9.103 − 2×0.353 = 8.397
    expect(r.rectangles[0].widthM).toBe(5.236);
    expect(r.rectangles[0].wallSource).toBe("legend");
    expect(r.usedLegendWall).toBe(true);
    expect(r.confidence).toBe("low"); // wrong face + no cross-check
    expect(r.note).toMatch(/legend/i);
  });

  it("legend-wall derive corroborated by NDSS → medium (not high)", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        statedNdssM2: 38,
        rectangles: [{ overallWidthM: 5.606, overallDepthM: 8.606, legendWallThicknessMm: 300 }], // → 5.006×8.006 ≈ 40, +5.3% over 38
        readConfidence: "high",
      },
      1,
    );
    expect(r.usedLegendWall).toBe(true);
    expect(r.source).toBe("derived");
    expect(r.confidence).toBe("medium");
  });

  it("NO wall anywhere (overall only, no internal, no plan or legend wall) → UNRESOLVED, never guessed", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ overallWidthM: 5.942, overallDepthM: 9.103 }], // no wall of any kind
        readConfidence: "high",
      },
      1,
    );
    expect(r.rectangles[0].widthM).toBe(null);
    expect(r.rectangles[0].incomplete).toBe(true);
    expect(r.derivedM2).toBe(null);
    expect(r.m2).toBe(null);
    expect(r.source).toBe("none");
    expect(r.confidence).toBe("unknown");
    expect(r.note).toMatch(/no wall thickness|unresolved/i);
  });

  it("an UN-corroborated derived value is capped at the model's read confidence", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null, // nothing to reconcile against
        rectangles: [{ internalWidthM: 4, internalDepthM: 5 }],
        readConfidence: "low", // model wasn't sure it read the numbers
      },
      1,
    );
    expect(r.source).toBe("derived");
    expect(r.confidence).toBe("low"); // capped — no independent cross-check
  });

  it("flags a divergence: stated wins but confidence drops and it's marked unreconciled", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: 40, // ~12% off the derived 35.6
        rectangles: [{ internalWidthM: 4.877, overallDepthM: 7.904, wallThicknessMm: 302 }],
        readConfidence: "high",
      },
      1,
    );
    expect(r.m2).toBe(40);
    expect(r.reconciled).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/DIVERGE/);
  });

  it("stated area only (no dimensions to cross-check) → medium", () => {
    const r = computeBirdcageFloor(
      { statedGrossInternalM2: 107, rectangles: [], readConfidence: "high" },
      1,
    );
    expect(r.m2).toBe(107);
    expect(r.source).toBe("stated");
    expect(r.reconciled).toBe(null);
    expect(r.confidence).toBe("medium");
  });

  it("compound / L-shaped floor: sums the rectangles", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [
          { internalWidthM: 4, internalDepthM: 5 }, // 20
          { internalWidthM: 2, internalDepthM: 3 }, // 6
        ],
        readConfidence: "high",
      },
      1,
    );
    expect(r.derivedM2).toBe(26);
    expect(r.m2).toBe(26);
    expect(r.source).toBe("derived");
    expect(r.usedLegendWall).toBe(false);
    expect(r.confidence).toBe("medium");
  });

  it("pair given only the full external frontage → strips the structural wall then divides", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ overallWidthM: 10.66, overallDepthM: 7.904, wallThicknessMm: 302 }],
        readConfidence: "high",
      },
      2,
    );
    // width = (10.66 − 0.604) / 2 = 5.028 ; depth = 7.300
    expect(r.rectangles[0].widthM).toBe(5.028);
    expect(r.rectangles[0].widthBasis).toBe("overall");
    expect(r.source).toBe("derived");
  });

  it("no stated GIA but NDSS present: derived cross-checks vs NDSS (gross slightly above usable) → high", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        statedNdssM2: 38, // usable; derived gross-internal should sit slightly above
        rectangles: [{ internalWidthM: 5, internalDepthM: 8 }], // derived 40 → +5.3%
        readConfidence: "high",
      },
      1,
    );
    expect(r.derivedM2).toBe(40);
    expect(r.m2).toBe(40);
    expect(r.source).toBe("derived");
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
    expect(r.note).toMatch(/cross-checked vs NDSS/);
  });

  it("NDSS cross-check out of band (derived BELOW usable) → low + flag", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        statedNdssM2: 45, // derived 40 is 11% BELOW usable — impossible for gross-internal
        rectangles: [{ internalWidthM: 5, internalDepthM: 8 }],
        readConfidence: "high",
      },
      1,
    );
    expect(r.reconciled).toBe(false);
    expect(r.confidence).toBe("low");
  });

  it("only NDSS available → uses it, notes it reads low", () => {
    const r = computeBirdcageFloor(
      { statedGrossInternalM2: null, statedNdssM2: 35.0, rectangles: [], readConfidence: "high" },
      1,
    );
    expect(r.m2).toBe(35);
    expect(r.source).toBe("ndss");
    expect(r.confidence).toBe("medium");
  });

  it("nothing legible → null / unknown, never a guess", () => {
    const r = computeBirdcageFloor(
      { statedGrossInternalM2: null, rectangles: [], readConfidence: "unknown" },
      1,
    );
    expect(r.m2).toBe(null);
    expect(r.source).toBe("none");
    expect(r.confidence).toBe("unknown");
  });
});

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
