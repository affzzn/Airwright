import { describe, it, expect } from "vitest";
import { estimateExpectedMs } from "./extraction-eta";

describe("estimateExpectedMs", () => {
  it("falls back to 40s when there is no history", () => {
    expect(estimateExpectedMs([])).toBe(40_000);
  });

  it("uses the median of real completions", () => {
    expect(estimateExpectedMs([30_000, 40_000, 50_000])).toBe(40_000);
  });

  it("ignores sub-3s completions (reuse/cache path)", () => {
    // Only 45s is a real read; the 500ms values are reuse-path completions.
    expect(estimateExpectedMs([500, 500, 45_000])).toBe(45_000);
  });

  it("clamps to a sane band", () => {
    expect(estimateExpectedMs([5_000])).toBe(15_000); // floor
    expect(estimateExpectedMs([600_000])).toBe(120_000); // ceiling
  });
});
