import { describe, it, expect } from "vitest";
import {
  effectiveQuantity,
  lineAmount,
  lineExtraHirePerWeek,
  priceConstructionQuote,
  resolveConstructionRate,
  resolveConstructionRateRow,
  weeksBeyondBase,
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
  // Real construction rates for the up-to-6m band, Competitive (Airwright's sheet).
  const lines: LinePriceInput[] = [
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 2, rate: 300, baseHireWeeks: 4, extraHirePerWeek: 10, extraHireChargePct: 50 },
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 3, rate: 300, baseHireWeeks: 4, extraHirePerWeek: 10, extraHireChargePct: 50 },
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 2, rate: 300, baseHireWeeks: 4, extraHirePerWeek: 6, extraHireChargePct: 25 },
    { unit: "NR_PER_LIFT", quantity: 1, lifts: 3, rate: 300, baseHireWeeks: 4, extraHirePerWeek: 6, extraHireChargePct: 25 },
    { unit: "M2_PER_LIFT", quantity: 203.34, lifts: 2, rate: 24.06, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 25 },
    { unit: "M2_PER_LIFT", quantity: 123.88, lifts: 3, rate: 24.06, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 25 },
    { unit: "LM", quantity: 77.4, lifts: null, rate: 25.61, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50 },
    { unit: "LM_PER_LIFT", quantity: 35.2, lifts: 2, rate: 35.78, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50 },
    { unit: "LM_PER_LIFT", quantity: 42.2, lifts: 3, rate: 35.78, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50 },
  ];

  it("has the 9 lines and a penny-exact total", () => {
    const r = priceConstructionQuote({ lines, durationWeeks: 4 });
    expect(r.lineAmounts).toHaveLength(9);
    const expected = Math.round(r.lineAmounts.reduce((a, b) => a + b, 0) * 100) / 100;
    expect(r.total).toBe(expected);
    expect(r.lineAmounts[8]).toBe(Math.round(42.2 * 3 * 35.78 * 100) / 100);
    expect(r.lineAmounts[6]).toBe(Math.round(77.4 * 25.61 * 100) / 100);
  });

  it("charges nothing extra while the hire stays inside the base period", () => {
    const r = priceConstructionQuote({ lines, durationWeeks: 4 });
    expect(r.maxWeeksBeyondBase).toBe(0);
    expect(r.extraHireBeyondBase).toBe(0);
  });

  it("quotes extra hire per unit per week, not as a slice of the job", () => {
    const r = priceConstructionQuote({ lines, durationWeeks: 10 });
    // Every line runs 6 weeks past its 4-week base.
    expect(r.maxWeeksBeyondBase).toBe(6);
    const weekly = lines.reduce((a, l) => a + lineExtraHirePerWeek(l), 0);
    expect(r.extraHirePerWeek).toBe(Math.round(weekly * 100) / 100);
    expect(r.extraHireBeyondBase).toBe(Math.round(weekly * 6 * 100) / 100);
    // The old 0.05%-of-job placeholder was an order of magnitude out.
    expect(r.extraHirePerWeek!).toBeGreaterThan(r.total * 0.0005 * 10);
  });

  it("keeps extra hire OUT of the quoted total", () => {
    const short = priceConstructionQuote({ lines, durationWeeks: 4 });
    const long = priceConstructionQuote({ lines, durationWeeks: 26 });
    expect(long.total).toBe(short.total);
  });
});

describe("lineExtraHirePerWeek", () => {
  it("is quantity × lifts × E/H × the band percentage", () => {
    // 66 LM of independent scaffold, 2 lifts, £1.20/LM/week at 100%.
    const line: LinePriceInput = {
      unit: "LM_PER_LIFT", quantity: 66, lifts: 2, rate: 35.78,
      baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 100,
    };
    expect(lineExtraHirePerWeek(line)).toBe(158.4);
  });

  it("halves it on the Competitive band", () => {
    const line: LinePriceInput = {
      unit: "LM_PER_LIFT", quantity: 66, lifts: 2, rate: 35.78,
      baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50,
    };
    expect(lineExtraHirePerWeek(line)).toBe(79.2);
  });

  it("is zero when the item carries no extra-hire value", () => {
    expect(lineExtraHirePerWeek({ unit: "NR", quantity: 3, rate: 10 })).toBe(0);
  });
});

describe("weeksBeyondBase", () => {
  const line: LinePriceInput = { unit: "LM", quantity: 10, rate: 5, baseHireWeeks: 4 };

  it("counts only the weeks past the base period", () => {
    expect(weeksBeyondBase(line, 4)).toBe(0);
    expect(weeksBeyondBase(line, 3)).toBe(0);
    expect(weeksBeyondBase(line, 10)).toBe(6);
  });

  it("rounds a part week up, as Airwright bill it", () => {
    expect(weeksBeyondBase(line, 6.2)).toBe(3);
  });

  it("respects a timber-frame line's 12-week base", () => {
    expect(weeksBeyondBase({ ...line, baseHireWeeks: 12 }, 10)).toBe(0);
  });
});

describe("resolveConstructionRateRow — the hire terms travel with the rate", () => {
  const rows = [
    { band: "COMPETITIVE" as const, bracket: "UP_TO_6M" as const, rate: 35.78, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50 },
    { band: "COMPETITIVE" as const, bracket: "ANY" as const, rate: 30, baseHireWeeks: 4, extraHirePerWeek: 0.5, extraHireChargePct: 25 },
  ];

  it("returns the rate AND its hire terms", () => {
    expect(resolveConstructionRateRow(rows, "COMPETITIVE", "UP_TO_6M")).toEqual({
      rate: 35.78, baseHireWeeks: 4, extraHirePerWeek: 1.2, extraHireChargePct: 50,
    });
  });

  it("falls back to the flat ANY rate with its own terms", () => {
    expect(resolveConstructionRateRow(rows, "COMPETITIVE", "H24_30M")?.extraHirePerWeek).toBe(0.5);
  });

  it("is null when the band has nothing", () => {
    expect(resolveConstructionRateRow(rows, "HIGH", "UP_TO_6M")).toBeNull();
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
