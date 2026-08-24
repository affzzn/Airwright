import { describe, it, expect } from "vitest";
import { computeBirdcageFloor, DEFAULT_WALL_MM } from "./birdcage";

/**
 * The birdcage geometry lives here (not in the model). These prove: derived
 * depth = overall − 2·wall; area = width × depth; compound floors sum; the
 * derived footprint reconciles against the stated gross-internal area; and the
 * confidence is COMPUTED from that agreement, not taken from the model.
 */

describe("computeBirdcageFloor", () => {
  it("Dekker: direct internal width + derived depth, reconciled to the stated GIA", () => {
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
    expect(r.usedDefaultWall).toBe(false);
  });

  it("a reconciled cross-check reads high even if the model's read confidence was lower", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: 35.6,
        rectangles: [{ internalWidthM: 4.877, overallDepthM: 7.904, wallThicknessMm: 302 }],
        readConfidence: "medium", // model understated itself…
      },
      1,
    );
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high"); // …but stated≈derived is its own strong evidence
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
    expect(r.usedDefaultWall).toBe(false);
    expect(r.confidence).toBe("medium");
  });

  it("no printed wall thickness → uses the flagged default and drops confidence", () => {
    const r = computeBirdcageFloor(
      {
        statedGrossInternalM2: null,
        rectangles: [{ internalWidthM: 4.877, overallDepthM: 7.904 }], // no wallThicknessMm
        readConfidence: "high",
      },
      1,
    );
    // depth = 7.904 − 2×(302/1000) = 7.300
    expect(r.derivedM2).toBe(35.602);
    expect(r.usedDefaultWall).toBe(true);
    expect(r.confidence).toBe("low");
    expect(r.note).toContain(`${DEFAULT_WALL_MM} mm`);
  });

  it("pair given only the full external frontage → strips walls then divides", () => {
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
