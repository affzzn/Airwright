import { describe, it, expect } from "vitest";
import {
  effectiveQuantity,
  lineAmount,
  priceConstructionQuote,
  resolveConstructionRate,
  type LinePriceInput,
} from "./price";

/**
 * Acceptance: reproduce the real Wren Park schedule shape (docs/19 §2 —
 * `data/construction/eg-01/Wren - Scaffolding Schedule.xlsx`) and prove the
 * reconciliation invariant (total = Σ lines, to the penny). Rates are placeholders
 * (the real schedule left the rate column blank), so we assert the STRUCTURE +
 * arithmetic, not a £ figure Colin owns.
 */

describe("effectiveQuantity — per-lift vs flat", () => {
  it("multiplies a per-lift unit by the lifts", () => {
    expect(effectiveQuantity("LM_PER_LIFT", 42.2, 3)).toBeCloseTo(126.6, 3);
    expect(effectiveQuantity("M2_PER_LIFT", 203.34, 2)).toBeCloseTo(406.68, 3);
    expect(effectiveQuantity("NR_PER_LIFT", 1, 3)).toBe(3);
  });
  it("leaves a flat unit as-is (roof handrail perimeter, inspections)", () => {
    expect(effectiveQuantity("LM", 77.4, null)).toBe(77.4);
    expect(effectiveQuantity("PER_WEEK", 10, null)).toBe(10);
    expect(effectiveQuantity("NR", 5, null)).toBe(5);
  });
  it("defaults missing lifts to 1 for a per-lift unit", () => {
    expect(effectiveQuantity("LM_PER_LIFT", 20, null)).toBe(20);
    expect(effectiveQuantity("LM_PER_LIFT", 20, 0)).toBe(20);
  });
});

describe("lineAmount", () => {
  it("prices quantity × lifts × rate", () => {
    // 42.2 m × 3 lifts × £11.50 = £1,455.90
    expect(lineAmount({ unit: "LM_PER_LIFT", quantity: 42.2, lifts: 3, rate: 11.5 })).toBe(1455.9);
  });
  it("is £0 when the rate is missing", () => {
    expect(lineAmount({ unit: "LM", quantity: 77.4, lifts: null, rate: 0 })).toBe(0);
  });
});

describe("Wren Park schedule — the 9 lines reconcile", () => {
  // Placeholder rates (£) just to exercise the maths.
  const lines: LinePriceInput[] = [
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 2, rate: 110 }, // Haki 2-lift
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 3, rate: 110 }, // Haki 3-lift
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 2, rate: 150 }, // Loading bay 2-lift
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 3, rate: 150 }, // Loading bay 3-lift
    { unit: "M2_PER_LIFT", quantity: 203.34, lifts: 2, rate: 8.5 }, // Birdcage 2-lift
    { unit: "M2_PER_LIFT", quantity: 123.88, lifts: 3, rate: 8.5 }, // Birdcage 3-lift
    { unit: "LM", quantity: 77.4, lifts: null, rate: 33.36 }, // Roof edge protection (green)
    { unit: "LM_PER_LIFT", quantity: 35.2, lifts: 2, rate: 13.0 }, // External 2-lift (red zone)
    { unit: "LM_PER_LIFT", quantity: 42.2, lifts: 3, rate: 13.0 }, // External 3-lift (blue zone)
  ];

  it("has the 9 lines and a penny-exact total", () => {
    const r = priceConstructionQuote({ lines, extraHirePctPerWeek: 0.05 });
    expect(r.lineAmounts).toHaveLength(9);
    // total = Σ line amounts, computed independently here
    const expected = Math.round(r.lineAmounts.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(r.total).toBe(expected);
    // spot-check a couple of lines
    expect(r.lineAmounts[8]).toBe(Math.round(42.2 * 3 * 13.0 * 100) / 100); // 1645.80
    expect(r.lineAmounts[6]).toBe(Math.round(77.4 * 33.36 * 100) / 100); // roof edge
  });

  it("computes extra hire as 0.05% of the total per week (terms, not in total)", () => {
    const r = priceConstructionQuote({ lines, extraHirePctPerWeek: 0.05 });
    expect(r.extraHirePerWeek).toBe(Math.round(r.total * 0.0005 * 100) / 100);
  });

  it("no extra-hire % → null", () => {
    const r = priceConstructionQuote({ lines, extraHirePctPerWeek: null });
    expect(r.extraHirePerWeek).toBeNull();
  });
});

describe("resolveConstructionRate — band + bracket ladder", () => {
  const rates = [
    { band: "COMPETITIVE" as const, bracket: "UP_TO_6M" as const, rate: 11.5 },
    { band: "COMPETITIVE" as const, bracket: "H6_12M" as const, rate: 13.0 },
    { band: "COMPETITIVE" as const, bracket: "ANY" as const, rate: 9.0 },
  ];
  it("takes the exact (band, bracket)", () => {
    expect(resolveConstructionRate(rates, "COMPETITIVE", "H6_12M")).toBe(13.0);
  });
  it("falls back to the ANY (flat) rate", () => {
    expect(resolveConstructionRate(rates, "COMPETITIVE", "H18_24M")).toBe(9.0);
    expect(resolveConstructionRate(rates, "COMPETITIVE", null)).toBe(9.0);
  });
  it("returns null when the band has no rate", () => {
    expect(resolveConstructionRate(rates, "HIGH", "UP_TO_6M")).toBeNull();
  });
});
