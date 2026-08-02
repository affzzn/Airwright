import { describe, it, expect } from "vitest";
import {
  planPageRanges,
  parsePageRange,
  parseRangeString,
  buildRangeString,
} from "./pdf";

describe("planPageRanges", () => {
  it("keeps a small pack as one range", () => {
    expect(planPageRanges(12)).toEqual(["1-12"]);
  });

  it("splits an oversized pack into windows", () => {
    const ranges = planPageRanges(45);
    expect(ranges[0]).toBe("1-20");
    expect(ranges[ranges.length - 1]).toBe("41-45");
    expect(ranges).toHaveLength(3);
  });
});

describe("parsePageRange", () => {
  it("parses a range", () => {
    expect(parsePageRange("3-7")).toEqual({ start: 3, end: 7 });
  });
  it("parses a single page", () => {
    expect(parsePageRange("5")).toEqual({ start: 5, end: 5 });
  });
});

describe("buildRangeString / parseRangeString", () => {
  it("compacts page numbers into a range string", () => {
    expect(buildRangeString([1, 2, 3, 4, 10, 11, 13])).toBe("1-4,10-11,13");
  });
  it("expands a range string back into page numbers", () => {
    expect(parseRangeString("1-4,10-11,13")).toEqual([1, 2, 3, 4, 10, 11, 13]);
  });
  it("round-trips", () => {
    const pages = [2, 3, 7, 8, 9, 20];
    expect(parseRangeString(buildRangeString(pages))).toEqual(pages);
  });
});
