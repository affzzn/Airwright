import { describe, it, expect } from "vitest";
import {
  HAKI_LIFTS,
  heightBracketFor,
  suggestedLiftsFor,
  needsScaffoldMat,
  foamCount,
  inspectionWeeks,
  validateConstructionQuote,
} from "./rules";

describe("construction rules — pre-fill defaults", () => {
  it("Haki = 3 lifts", () => {
    expect(HAKI_LIFTS).toBe(3);
  });
  it("height → bracket", () => {
    expect(heightBracketFor(4)).toBe("UP_TO_6M");
    expect(heightBracketFor(6)).toBe("UP_TO_6M");
    expect(heightBracketFor(9)).toBe("H6_12M");
    expect(heightBracketFor(15)).toBe("H12_18M");
    expect(heightBracketFor(20)).toBe("H18_24M");
    expect(heightBracketFor(null)).toBeNull();
  });
  it("a ~4 m building suggests 2 lifts", () => {
    expect(suggestedLiftsFor(4)).toBe(2);
    expect(suggestedLiftsFor(null)).toBeNull();
  });
  it("scaffold mat for schools + public streets only", () => {
    expect(needsScaffoldMat("SCHOOL")).toBe(true);
    expect(needsScaffoldMat("PUBLIC_STREET")).toBe(true);
    expect(needsScaffoldMat("CONSTRUCTION_SITE")).toBe(false);
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
      siteType: "SCHOOL",
      lineCount: 9,
      measurementCount: 3,
      unpricedLineCount: 0,
      perLiftLinesMissingLifts: 0,
      hasInferredValues: false,
    });
    expect(flags.filter((f) => f.level === "warn")).toHaveLength(0);
  });
});
