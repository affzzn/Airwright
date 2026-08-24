import { describe, it, expect } from "vitest";
import { computeHeight } from "./height";

/**
 * Height triangulation: direct soffit read vs the summed storey ladder, with the
 * H3 rule — a disagreement is flagged only when the two give a DIFFERENT lift
 * count (ceil(h/1.5)), not on a fixed mm gap.
 */

describe("computeHeight", () => {
  it("Dekker: direct read and storey ladder agree → high", () => {
    const r = computeHeight({
      directSoffitM: 4.725,
      storeyHeightsM: [2.662, 2.063], // sum 4.725
      storeys: 2,
      readConfidence: "high",
    });
    expect(r.ladderSumM).toBe(4.725);
    expect(r.soffitM).toBe(4.725);
    expect(r.liftsDirect).toBe(4); // ceil(4.725/1.5)
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("H3: small mm gap but SAME lift count still reconciles → high", () => {
    const r = computeHeight({
      directSoffitM: 4.7,
      storeyHeightsM: [2.55, 2.0], // sum 4.55 — 0.15 m apart, but both ceil to 4 lifts
      storeys: 2,
      readConfidence: "high",
    });
    expect(r.liftsDirect).toBe(4);
    expect(r.liftsLadder).toBe(4);
    expect(r.reconciled).toBe(true);
    expect(r.confidence).toBe("high");
  });

  it("H3: a DIFFERENT lift count is flagged → low", () => {
    const r = computeHeight({
      directSoffitM: 4.6, // ceil → 4 lifts
      storeyHeightsM: [2.0, 2.0], // sum 4.0 → ceil → 3 lifts
      storeys: 2,
      readConfidence: "high",
    });
    expect(r.liftsDirect).toBe(4);
    expect(r.liftsLadder).toBe(3);
    expect(r.reconciled).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/different lift count/i);
  });

  it("direct read only, within the storey band → medium", () => {
    const r = computeHeight({ directSoffitM: 4.725, storeyHeightsM: [], storeys: 2, readConfidence: "high" });
    expect(r.soffitM).toBe(4.725);
    expect(r.withinBand).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("direct read only, OUTSIDE the storey band → low + flag", () => {
    const r = computeHeight({ directSoffitM: 9.0, storeyHeightsM: [], storeys: 2, readConfidence: "high" });
    expect(r.withinBand).toBe(false);
    expect(r.confidence).toBe("low");
    expect(r.note).toMatch(/outside the expected band/i);
  });

  it("storey ladder only (no direct soffit) → uses the sum, medium", () => {
    const r = computeHeight({ directSoffitM: null, storeyHeightsM: [2.662, 2.063], storeys: 2, readConfidence: "high" });
    expect(r.soffitM).toBe(4.725);
    expect(r.confidence).toBe("medium");
  });

  it("nothing legible → null / unknown", () => {
    const r = computeHeight({ directSoffitM: null, storeyHeightsM: [], storeys: null });
    expect(r.soffitM).toBe(null);
    expect(r.confidence).toBe("unknown");
  });
});
