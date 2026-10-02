import { describe, it, expect } from "vitest";
import {
  HAKI_LIFTS_FALLBACK,
  heightBracketFor,
  suggestedHakiLifts,
  suggestedLiftsFor,
  needsScaffoldMat,
  foamCount,
  inspectionWeeks,
  validateConstructionQuote,
} from "./rules";

describe("construction rules — pre-fill defaults", () => {
  it("Haki lifts follow the height, 3 only as a fallback", () => {
    expect(HAKI_LIFTS_FALLBACK).toBe(3);
    expect(suggestedHakiLifts(null)).toBe(3);
    expect(suggestedHakiLifts(3.3)).toBe(2); // CBAND hall: Haki 2 lifts
    expect(suggestedHakiLifts(4.955)).toBe(3); // Wren: Haki 3 lifts
  });
  it("height → bracket", () => {
    expect(heightBracketFor(4)).toBe("UP_TO_6M");
    expect(heightBracketFor(6)).toBe("UP_TO_6M");
    expect(heightBracketFor(9)).toBe("H6_12M");
    expect(heightBracketFor(15)).toBe("H12_18M");
    expect(heightBracketFor(20)).toBe("H18_24M");
    expect(heightBracketFor(26)).toBe("H24_30M");
    expect(heightBracketFor(null)).toBeNull();
  });
  it("lifts = ceil(height ÷ 2.0 m) — reproduces the four real quotes", () => {
    expect(suggestedLiftsFor(4)).toBe(2); // Murray Park, 4 m → 2
    expect(suggestedLiftsFor(4.955)).toBe(3); // Wren → 3
    expect(suggestedLiftsFor(3.3)).toBe(2); // CBAND hall → 2
    expect(suggestedLiftsFor(2.85)).toBe(2); // CBAND pavilion → 2
    expect(suggestedLiftsFor(4.000000001)).toBe(2); // float noise is not a lift
    expect(suggestedLiftsFor(4.955, 1.5)).toBe(4); // a different lift height
    expect(suggestedLiftsFor(null)).toBeNull();
    expect(suggestedLiftsFor(4, 0)).toBeNull();
  });
  it("scaffold mat for schools + public streets only", () => {
    expect(needsScaffoldMat("PUBLIC_SECTOR")).toBe(true);
    expect(needsScaffoldMat("CONSTRUCTION")).toBe(false);
    expect(needsScaffoldMat("SMALL_WORKS")).toBe(false);
    expect(needsScaffoldMat(null)).toBe(false);
  });
  it("foam count sums the access points", () => {
    expect(foamCount(3, 2, 1)).toBe(6);
    expect(foamCount(null, null, null)).toBe(0);
  });
  it("inspection weeks = duration", () => {
    expect(inspectionWeeks(10)).toBe(10);
    expect(inspectionWeeks(null)).toBe(0);
  });
});

describe("validateConstructionQuote — the assumptions checklist", () => {
  it("flags an empty quote", () => {
    const flags = validateConstructionQuote({
      durationWeeks: null,
      buildingHeightM: null,
      defaultHeightBracket: null,
      siteType: null,
      lineCount: 0,
      measurementCount: 0,
      unpricedLineCount: 0,
      perLiftLinesMissingLifts: 0,
      hasInferredValues: false,
    });
    const msgs = flags.map((f) => f.message).join(" ");
    expect(msgs).toContain("No priced items");
    expect(msgs).toContain("No hire duration");
    expect(msgs).toContain("No building height");
  });
  it("a complete quote raises no warnings", () => {
    const flags = validateConstructionQuote({
      durationWeeks: 10,
      buildingHeightM: 4,
      defaultHeightBracket: "UP_TO_6M",
      siteType: "PUBLIC_SECTOR",
      lineCount: 9,
      measurementCount: 3,
      unpricedLineCount: 0,
      perLiftLinesMissingLifts: 0,
      hasInferredValues: false,
    });
    expect(flags.filter((f) => f.level === "warn")).toHaveLength(0);
  });
});
