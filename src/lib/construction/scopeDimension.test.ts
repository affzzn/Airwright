import { describe, expect, it } from "vitest";
import {
  parseScopeDimension,
  parseScopeDurationWeeks,
  parseScopeHeight,
  quantityForUnit,
} from "./scopeDimension";

/**
 * Every literal here is copied from the real client scope of works
 * (`cons-data/50172_Scaffold Scope_Rev.1.xlsx`, Project Stanmore, 37 rows).
 */

describe("parseScopeDimension", () => {
  it("reads a linear run", () => {
    const d = parseScopeDimension("20lin.m");
    expect(d.kind).toBe("LINEAR");
    expect(d.lengthM).toBe(20);
    expect(d.areaM2).toBeNull();
  });

  it("reads the big plant-room runs", () => {
    expect(parseScopeDimension("560lin.m").lengthM).toBe(560);
    expect(parseScopeDimension("275lin.m").lengthM).toBe(275);
  });

  it("reads a plan rectangle as an area, keeping the sides", () => {
    const d = parseScopeDimension("2.4x5.4m");
    expect(d.kind).toBe("AREA");
    expect(d.areaM2).toBe(12.96);
    expect(d.sides).toEqual([2.4, 5.4]);
  });

  it("reads the control-room crash deck", () => {
    expect(parseScopeDimension("25x20m").areaM2).toBe(500);
  });

  it("reads a loading-bay grid written with units on both sides", () => {
    const d = parseScopeDimension("3.6m x 2.4m");
    expect(d.areaM2).toBe(8.64);
    expect(d.sides).toEqual([3.6, 2.4]);
  });

  it("treats N/A and blanks as nothing stated", () => {
    expect(parseScopeDimension("N/A").kind).toBe("NONE");
    expect(parseScopeDimension("").kind).toBe("NONE");
    expect(parseScopeDimension("   ").lengthM).toBeNull();
  });

  it("keeps the original text for provenance", () => {
    expect(parseScopeDimension("560lin.m").source).toBe("560lin.m");
  });
});

describe("parseScopeHeight", () => {
  it("reads a plain height", () => {
    expect(parseScopeHeight("10m")).toBe(10);
  });

  it("ignores the working-platform note underneath", () => {
    expect(parseScopeHeight("12m \n(top working platform level)")).toBe(12);
  });

  it("reads the stair-set transitions", () => {
    expect(parseScopeHeight("0.65m")).toBe(0.65);
    expect(parseScopeHeight("0.8m high")).toBe(0.8);
  });

  it("is null when not stated", () => {
    expect(parseScopeHeight("N/A")).toBeNull();
  });
});

describe("parseScopeDurationWeeks", () => {
  it("reads every spelling the sheet uses", () => {
    expect(parseScopeDurationWeeks("20wks")).toBe(20);
    expect(parseScopeDurationWeeks("8wks")).toBe(8);
    expect(parseScopeDurationWeeks("4w")).toBe(4);
    expect(parseScopeDurationWeeks("14w")).toBe(14);
    expect(parseScopeDurationWeeks("2 weeks")).toBe(2);
  });

  it("rounds a part week up, as hire is billed", () => {
    expect(parseScopeDurationWeeks("2.5wks")).toBe(3);
  });

  it("is null when not stated", () => {
    expect(parseScopeDurationWeeks("N/A")).toBeNull();
    expect(parseScopeDurationWeeks("")).toBeNull();
  });
});

describe("quantityForUnit", () => {
  it("gives an area item its area", () => {
    const d = parseScopeDimension("25x20m");
    expect(quantityForUnit(d, "M2_PER_LIFT")).toEqual({
      quantity: 500,
      basis: "25x20m = 500 m2",
    });
  });

  it("gives a linear item its run", () => {
    const d = parseScopeDimension("45lin.m");
    expect(quantityForUnit(d, "LM")?.quantity).toBe(45);
  });

  it("falls back to the longest side for a linear item given a rectangle, and says so", () => {
    const d = parseScopeDimension("10x1m");
    const q = quantityForUnit(d, "LM_PER_LIFT")!;
    expect(q.quantity).toBe(10);
    expect(q.basis).toContain("longest side");
  });

  it("refuses to invent an area from a run", () => {
    expect(quantityForUnit(parseScopeDimension("20lin.m"), "M2")).toBeNull();
  });

  it("leaves counted items to the scope's wording", () => {
    expect(quantityForUnit(parseScopeDimension("3.6m x 2.4m"), "NR")).toBeNull();
  });

  it("returns nothing when the scope stated nothing", () => {
    expect(quantityForUnit(parseScopeDimension("N/A"), "LM")).toBeNull();
  });
});
