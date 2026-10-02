import { describe, it, expect } from "vitest";
import { insetArea, lengthStringToM, parseGridRef, parseOutline, parseOutlineEntry, resolveOutline, type SegmentIn } from "./outline";
import type { GridSystem } from "../pack/sheetGeometry";

const seg = (id: string, direction: SegmentIn["direction"], lengthStrings: string[] = [], extra: Partial<SegmentIn> = {}): SegmentIn => ({
  id,
  direction,
  lengthStrings,
  fromGrid: null,
  toGrid: null,
  feature: "WALL",
  confidence: "high",
  ...extra,
});
const ctx = (printedMm: number[], grid: GridSystem | null = null) => ({ printedMm, grid, tolAbsM: 0.2, tolRel: 0.01 });

describe("length strings", () => {
  it("mm with and without commas, metres", () => {
    expect(lengthStringToM("28,903")).toBe(28.903);
    expect(lengthStringToM("20793")).toBe(20.793);
    expect(lengthStringToM("42.2 m")).toBe(42.2);
    expect(lengthStringToM("abc")).toBeNull();
  });
  it("grid refs", () => {
    expect(parseGridRef("C2")).toEqual({ col: "C", row: "2" });
    expect(parseGridRef("F")).toEqual({ col: "F", row: null });
    expect(parseGridRef("5")).toEqual({ col: null, row: "5" });
  });
});

describe("CBAND Sports Pavilion — a printed rectangle", () => {
  const segs = [seg("S1", "E", ["20793"]), seg("S2", "S", ["8965"]), seg("S3", "W", ["20793"]), seg("S4", "N", ["8965"])];
  const o = resolveOutline(segs, ctx([20793, 8965, 303, 8360]));
  it("closes, perimeter 59.516 m, 4 corners", () => {
    expect(o.closes).toBe(true);
    expect(o.perimeterM).toBe(59.516);
    expect(o.externalCorners).toBe(4);
    expect(o.internalCorners).toBe(0);
    expect(o.confidence).toBe("high");
    expect(o.sides).toEqual({ top: 20.793, right: 8.965, bottom: 20.793, left: 8.965 });
  });
  it("internal footprint inside 303 mm walls = 20.187 × 8.359", () => {
    expect(insetArea(o, 0.303)).toBeCloseTo(20.187 * 8.359, 3);
  });
  it("the same shape traced anticlockwise gives the same answer", () => {
    const ccw = resolveOutline([seg("S1", "S", ["8965"]), seg("S2", "E", ["20793"]), seg("S3", "N", ["8965"]), seg("S4", "W", ["20793"])], ctx([20793, 8965]));
    expect(ccw.externalCorners).toBe(4);
    expect(ccw.sides).toEqual({ top: 20.793, right: 8.965, bottom: 20.793, left: 8.965 });
  });
});

describe("an L-shape with one wall unprinted — solved by closure", () => {
  // Main hall 6.853 wide × 13.828 deep on the right, wing 10.463 long × 8.428 deep on the left.
  const segs = [
    seg("S1", "E", ["10463"]), // top of the wing (steps up at the hall)
    seg("S2", "N", ["5400"]), // up the hall's west wall above the wing
    seg("S3", "E", ["6853"]),
    seg("S4", "S", ["13828"]),
    seg("S5", "W", ["6853"]),
    seg("S6", "W", ["10463"]),
    seg("S7", "N", []), // the wing's west wall: no printed length
  ];
  const o = resolveOutline(segs, ctx([10463, 5400, 6853, 13828]));
  it("solves the missing wall, closes, 5 external + 1 internal corner", () => {
    expect(o.segments[6].source).toBe("CLOSURE");
    expect(o.segments[6].lengthM).toBe(8.428);
    expect(o.closes).toBe(true);
    expect(o.perimeterM).toBeCloseTo(2 * (17.316 + 13.828), 3);
    expect(o.externalCorners).toBe(5);
    expect(o.internalCorners).toBe(1);
    expect(o.confidence).toBe("medium");
  });
});

describe("guards", () => {
  it("a length that is not printed on the sheet is refused", () => {
    const o = resolveOutline([seg("S1", "E", ["20800"]), seg("S2", "S", ["8965"]), seg("S3", "W", ["20793"]), seg("S4", "N", ["8965"])], ctx([20793, 8965]));
    expect(o.segments[0].source).toBe("CLOSURE"); // refused, then solved from the others
    expect(o.segments[0].lengthM).toBe(20.793);
  });
  it("two missing walls cannot be solved — measure by hand", () => {
    const o = resolveOutline([seg("S1", "E"), seg("S2", "S", ["8965"]), seg("S3", "W"), seg("S4", "N", ["8965"])], ctx([8965]));
    expect(o.perimeterM).toBeNull();
    expect(o.flags[0]).toContain("measure by hand");
  });
  it("a shape that does not close is flagged low", () => {
    const o = resolveOutline([seg("S1", "E", ["20793"]), seg("S2", "S", ["8965"]), seg("S3", "W", ["20000"]), seg("S4", "N", ["8965"])], ctx([20793, 8965, 20000]));
    expect(o.closes).toBe(false);
    expect(o.confidence).toBe("low");
  });
});

describe("grid-based walls (KE style)", () => {
  const grid: GridSystem = {
    vertical: ["A", "B", "C", "D", "E", "F"].map((label, i) => ({ label, posPt: i * 100 })),
    horizontal: ["1", "2", "3"].map((label, i) => ({ label, posPt: 1000 - i * 100 })),
    spacings: [
      { from: "A", to: "B", measuredMm: 3715, printedMm: 3713 },
      { from: "B", to: "C", measuredMm: 3260, printedMm: 3262 },
      { from: "C", to: "D", measuredMm: 7090, printedMm: 7088 },
      { from: "D", to: "E", measuredMm: 3475, printedMm: null },
      { from: "E", to: "F", measuredMm: 11365, printedMm: 11363 },
      { from: "1", to: "2", measuredMm: 5000, printedMm: 5000 },
      { from: "2", to: "3", measuredMm: 4000, printedMm: 4000 },
    ],
  };
  it("A→F uses printed spacings, falls back to the measured one where none is printed", () => {
    const o = resolveOutline(
      [
        seg("S1", "E", [], { fromGrid: "A1", toGrid: "F1" }),
        seg("S2", "S", [], { fromGrid: "F1", toGrid: "F3" }),
        seg("S3", "W", [], { fromGrid: "F3", toGrid: "A3" }),
        seg("S4", "N", [], { fromGrid: "A3", toGrid: "A1" }),
      ],
      ctx([], grid),
    );
    expect(o.segments[0].lengthM).toBe(28.901);
    expect(o.segments[0].source).toBe("GRID_MEASURED");
    expect(o.segments[1].source).toBe("GRID_PRINTED");
    expect(o.segments[1].lengthM).toBe(9);
    expect(o.closes).toBe(true);
    expect(o.confidence).toBe("medium");
  });
  it("a printed chain that disagrees with the grid (window widths past a corner) loses to the grid, flagged", () => {
    const o = resolveOutline(
      [
        seg("S1", "E", ["20,000"], { fromGrid: "A1", toGrid: "F1" }), // printed, but the grid says 28.9 m
        seg("S2", "S", ["5,000", "4,000"], { fromGrid: "F1", toGrid: "F3" }), // printed and agrees
        seg("S3", "W", [], { fromGrid: "F3", toGrid: "A3" }),
        seg("S4", "N", [], { fromGrid: "A3", toGrid: "A1" }),
      ],
      ctx([20000, 5000, 4000], grid),
    );
    expect(o.segments[0].source).toBe("GRID_MEASURED");
    expect(o.segments[0].flags[0]).toContain("disagrees with the grid");
    expect(o.segments[1].source).toBe("PRINTED");
    expect(o.segments[1].provenance).toContain("grid agrees");
    expect(o.closes).toBe(true);
  });
});

describe("outline lines (the plan reader's string format)", () => {
  it("parses direction, printed pieces, grid points, feature and note", () => {
    expect(parseOutlineEntry("S | 6,965 + 1,463 | - | WALL | wing west wall", "S1")).toMatchObject({
      direction: "S",
      lengthStrings: ["6,965", "1,463"],
      fromGrid: null,
      feature: "WALL",
      note: "wing west wall",
    });
    expect(parseOutlineEntry("E | none | C2->D2 | WALL | -", "S2")).toMatchObject({ lengthStrings: [], fromGrid: "C2", toGrid: "D2", note: null });
    expect(parseOutlineEntry("se | 5000 | - | porch", "S3")).toMatchObject({ direction: "SE", feature: "PORCH" });
  });
  it("rejects a line with no direction instead of guessing", () => {
    const r = parseOutline(["E | 20793 | - | WALL", "then round the corner", "S | 8965 | - | WALL"]);
    expect(r.segments.map((s) => s.id)).toEqual(["S1", "S2"]);
    expect(r.rejected).toEqual(["then round the corner"]);
  });
});

describe("several walls with no printed length, all the same way (King Edward 1F)", () => {
  // The traced 1F: E 28.903 across the top, S 19.115 down the right, then three
  // west-going pieces with two short north-going steps that carry no dimension.
  const lines = [
    "E | 6,975 + 7,088 + 14,840 | - | WALL | north",
    "S | 19,115 | - | WALL | east",
    "W | 11,363 | - | WALL | south, east part",
    "N | none | - | WALL | step",
    "W | 13,827 | - | WALL | south, centre",
    "N | none | - | WALL | step",
    "W | 3,713 | - | WALL | south, west part",
    "N | 7,088 | - | WALL | west",
  ];
  const printedMm = [6975, 7088, 14840, 19115, 11363, 13827, 3713];
  const o = resolveOutline(parseOutline(lines).segments, { printedMm, grid: null, tolAbsM: 0.2, tolRel: 0.01 });
  it("solves the two steps' TOTAL by closure and gives the exact perimeter", () => {
    expect(o.perimeterM).toBe(Math.round((2 * 28.903 + 2 * 19.115) * 1000) / 1000);
    expect(o.externalCorners).toBe(6);
    expect(o.internalCorners).toBe(2);
    expect(o.confidence).toBe("low");
    expect(o.flags.some((f) => f.includes("comes from closing the outline"))).toBe(true);
  });
  it("does not solve unknowns that run opposite ways (their total is not fixed)", () => {
    const mixed = resolveOutline(
      parseOutline(["E | 10000 | - | WALL | -", "S | none | - | WALL | -", "W | 10000 | - | WALL | -", "N | none | - | WALL | -"]).segments,
      { printedMm: [10000], grid: null, tolAbsM: 0.2, tolRel: 0.01 },
    );
    expect(mixed.perimeterM).toBeNull();
  });
});

describe("printed overall vs a partly scaled grid (King Edward S2)", () => {
  const grid: GridSystem = {
    vertical: ["A", "F"].map((label, i) => ({ label, posPt: i * 100 })),
    horizontal: ["1", "2", "3"].map((label, i) => ({ label, posPt: 1000 - i * 100 })),
    spacings: [
      { from: "A", to: "F", measuredMm: 10000, printedMm: 10000 },
      { from: "1", to: "2", measuredMm: 12000, printedMm: 12000 },
      { from: "2", to: "3", measuredMm: 8900, printedMm: null }, // scaled
    ],
  };
  const walls = (s2: string): SegmentIn[] =>
    parseOutline(["E | 10000 | A1->F1 | WALL | -", `S | ${s2} | F1->F3 | WALL | -`, "W | 10000 | F3->A3 | WALL | -", `N | ${s2} | - | WALL | -`]).segments;
  it("the printed OVERALL wins over a scaled grid, flagged", () => {
    const o = resolveOutline(walls("19115"), { printedMm: [10000, 19115], grid, tolAbsM: 0.2, tolRel: 0.01, overallMm: [19115, 10000] });
    expect(o.segments[1].lengthM).toBe(19.115);
    expect(o.segments[1].source).toBe("PRINTED");
    expect(o.segments[1].flags[0]).toContain("partly scaled");
  });
  it("a printed string that is not the overall still loses to the grid", () => {
    const o = resolveOutline(walls("19115"), { printedMm: [10000, 19115], grid, tolAbsM: 0.2, tolRel: 0.01, overallMm: [10000] });
    expect(o.segments[1].source).toBe("GRID_MEASURED");
  });
});
