import { describe, it, expect } from "vitest";
import { buildDimensionHint, makeDimensionVerifier, dimRuns } from "./dimensions";

const PAGES = [
  { page: 1, tokens: ["302", "4877", "7904", "10660"] },
  { page: 2, tokens: ["2385", "5025"] },
];

describe("dimRuns", () => {
  it("pulls 3–5 digit runs, tolerant of separators", () => {
    expect(dimRuns("7904")).toEqual(["7904"]);
    expect(dimRuns("7904 / 302")).toEqual(["7904", "302"]);
    expect(dimRuns("7.904")).toContain("7904"); // separator-stripped form
  });
});

describe("buildDimensionHint", () => {
  it("lists the printed dimensions per page", () => {
    const hint = buildDimensionHint(PAGES);
    expect(hint).toContain("Page 1: 302, 4877, 7904, 10660");
    expect(hint).toContain("Page 2: 2385, 5025");
    expect(hint).toMatch(/SNAP your value/);
  });
  it("is empty when there is no text layer", () => {
    expect(buildDimensionHint([{ page: 1, tokens: [] }])).toBe("");
  });
});

describe("makeDimensionVerifier", () => {
  const verify = makeDimensionVerifier(PAGES);

  it("passes a dimension printed on the cited page", () => {
    expect(verify("7904", 1)).toBe(true);
  });
  it("passes a dimension printed on a different page (fallback to anywhere)", () => {
    expect(verify("5025", 1)).toBe(true); // actually on page 2, still accepted
  });
  it("passes a decimal-formatted match", () => {
    expect(verify("7.904", 1)).toBe(true);
  });
  it("FAILS a dimension that appears nowhere in the text layer (misread)", () => {
    expect(verify("7804", 1)).toBe(false); // model transposed 7904 → 7804
  });
  it("passes a non-numeric citation (nothing to check)", () => {
    expect(verify("U/S Wallplate", 2)).toBe(true);
  });
  it("passes everything when there is no text layer (scanned PDF)", () => {
    const none = makeDimensionVerifier([{ page: 1, tokens: [] }]);
    expect(none("7804", 1)).toBe(true);
  });
});
