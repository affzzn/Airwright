import { describe, it, expect } from "vitest";
import { assembleDrawingDraft, type AssembleLibEl, type CallOff } from "./assemble";
import type { DrawingObservations, NumberField } from "./drawingSchema";

// The seeded library subset (ids + names + aliases + units), as loadConstructionLibrary returns.
const LIB: AssembleLibEl[] = [
  { id: "ce-independent-scaffold", name: "Independent Scaffold", aliases: ["working platform", "access scaffold"], unit: "LM_PER_LIFT", usesLifts: true },
  { id: "ce-double-handrail", name: "Double Handrail (+ toe board)", aliases: ["edge protection"], unit: "LM_PER_LIFT", usesLifts: true },
  { id: "ce-triple-handrail", name: "Triple Handrail (roof / edge)", aliases: ["roof edge protection"], unit: "LM", usesLifts: false },
  { id: "ce-haki-stair", name: "Haki Stair Tower", aliases: ["hacky stairs"], unit: "NR_PER_LIFT", usesLifts: true },
  { id: "ce-loading-bay", name: "Loading Bay", aliases: [], unit: "NR_PER_LIFT", usesLifts: true },
  { id: "ce-birdcage", name: "Internal Birdcage (crash deck)", aliases: ["crash deck"], unit: "M2_PER_LIFT", usesLifts: true },
  { id: "ce-lift-gate", name: "Lift Gate (Safegate)", aliases: ["safegate"], unit: "NR", usesLifts: false },
  { id: "ce-foam", name: "Foam Protection", aliases: [], unit: "NR", usesLifts: false },
];

const nf = (value: number | null, confidence: NumberField["confidence"] = "high", src: string | null = null): NumberField => ({
  value,
  confidence,
  sourceDimension: src,
  sourceSheet: null,
  sourcePage: 1,
});

const emptyObs = (over: Partial<DrawingObservations>): DrawingObservations => ({
  sheet: { kind: "MARKED_UP", title: null, hasTextLayer: true, siteTypeHint: "NONE", confidence: "high" },
  buildingHeightM: nf(null, "unknown"),
  liftShafts: [],
  lvPits: [],
  stairs: [],
  loadingBays: [],
  hakiStairs: [],
  externalRuns: [],
  birdcages: [],
  roofEdgePerimeterM: nf(null, "unknown"),
  markups: [],
  accessPoints: { doorways: nf(null, "unknown"), fireExits: nf(null, "unknown") },
  notes: "",
  ...over,
});

// The real reader output for the Wren marked-up Measure sheet (metres, structured).
const WREN_MEASURE = emptyObs({
  sheet: { kind: "MARKED_UP", title: "GA Ground Floor Setting Out Plan", hasTextLayer: true, siteTypeHint: "SCHOOL", confidence: "high" },
  externalRuns: [
    { zone: "red", lengthM: nf(35.157, "high", "35,157.46 mm"), liftsMarked: 2 },
    { zone: "blue", lengthM: nf(42.199, "high", "42,198.96 mm"), liftsMarked: 3 },
  ],
  birdcages: [
    { zone: "red", areaM2: nf(203.34, "high", "203.34 sq m"), liftsMarked: 2 },
    { zone: "blue", areaM2: nf(123.88, "high", "123.88 sq m"), liftsMarked: 3 },
  ],
  roofEdgePerimeterM: nf(77.357, "high", "77,357.25 mm"),
  hakiStairs: [
    { label: "2nr Lift Haki Staircase", liftsMarked: 2, heightM: nf(null, "unknown") },
    { label: "3nr Lift Haki Staircase", liftsMarked: 3, heightM: nf(null, "unknown") },
  ],
  loadingBays: [
    { label: "2nr Lift Loading Bay", widthM: nf(null, "unknown"), lengthM: nf(null, "unknown"), heightM: nf(null, "unknown"), liftsMarked: 2 },
    { label: "3nr Lift Loading Bay", widthM: nf(null, "unknown"), lengthM: nf(null, "unknown"), heightM: nf(null, "unknown"), liftsMarked: 3 },
  ],
  accessPoints: { doorways: nf(4, "medium", "4x Classroom Entrance"), fireExits: nf(1, "medium", "Fire Egress only") },
});

// The elevation sheet gives the building height.
const WREN_ELEVATION = emptyObs({
  sheet: { kind: "ELEVATION", title: "Proposed Detail Elevations", hasTextLayer: true, siteTypeHint: "SCHOOL", confidence: "high" },
  buildingHeightM: nf(4.955, "high", "4955"),
});

describe("assembleDrawingDraft — Wren Park (acceptance: reproduce the schedule)", () => {
  const r = assembleDrawingDraft([WREN_MEASURE, WREN_ELEVATION], LIB);
  const byDesc = (id: string) => r.lines.filter((l) => l.elementId === id);

  it("emits the two external independent-scaffold runs, per lift", () => {
    const ext = byDesc("ce-independent-scaffold");
    expect(ext).toHaveLength(2);
    expect(ext.map((l) => [l.quantity, l.lifts]).sort()).toEqual([[35.157, 2], [42.199, 3]]);
    expect(ext.every((l) => l.unit === "LM_PER_LIFT")).toBe(true);
  });

  it("emits the two birdcages, m² per lift", () => {
    const bc = byDesc("ce-birdcage");
    expect(bc.map((l) => [l.quantity, l.lifts]).sort()).toEqual([[123.88, 3], [203.34, 2]]);
    expect(bc.every((l) => l.unit === "M2_PER_LIFT")).toBe(true);
  });

  it("emits roof edge protection as a triple handrail, flat LM", () => {
    const roof = byDesc("ce-triple-handrail");
    expect(roof).toHaveLength(1);
    expect(roof[0].quantity).toBe(77.357);
    expect(roof[0].unit).toBe("LM");
    expect(roof[0].lifts).toBeNull();
  });

  it("emits Haki towers and loading bays, per lift", () => {
    expect(byDesc("ce-haki-stair").map((l) => l.lifts).sort()).toEqual([2, 3]);
    expect(byDesc("ce-loading-bay").map((l) => l.lifts).sort()).toEqual([2, 3]);
    expect(byDesc("ce-haki-stair").every((l) => l.unit === "NR_PER_LIFT" && l.quantity === 1)).toBe(true);
  });

  it("emits foam from the access-point counts (4 doors + 1 exit = 5)", () => {
    const foam = byDesc("ce-foam");
    expect(foam).toHaveLength(1);
    expect(foam[0].quantity).toBe(5);
  });

  it("reads the building height off the elevation and suggests the ≤6 m bracket", () => {
    expect(r.buildingHeightM).toBe(4.955);
    expect(r.suggestedHeightBracket).toBe("UP_TO_6M");
    expect(r.measurements.some((m) => m.kind === "HEIGHT_M" && m.valueNumber === 4.955)).toBe(true);
  });

  it("every mapped line resolved to a real library element (nothing invented)", () => {
    expect(r.lines.filter((l) => l.needsItem)).toHaveLength(0);
    expect(r.lines.every((l) => l.elementId && LIB.some((e) => e.id === l.elementId))).toBe(true);
  });

  it("records traceable measurements for the perimeters + birdcages", () => {
    expect(r.measurements.filter((m) => m.kind === "PERIMETER_LM")).toHaveLength(2);
    expect(r.measurements.filter((m) => m.kind === "BIRDCAGE_M2")).toHaveLength(2);
  });
});

describe("cross-check — the client call-off vs the drawing (Ben's '3 not 4')", () => {
  const obs = emptyObs({
    liftShafts: [
      { label: "Lift 02", entrancesByFloor: [{ floor: "GF", count: 1 }, { floor: "FF", count: 1 }, { floor: "SF", count: 1 }], totalEntrances: nf(3, "high") },
    ],
  });
  it("flags when the call-off says 4 but the drawing shows 3", () => {
    const callOffs: CallOff[] = [{ keyword: "lift gate", quantity: 4, lifts: null }];
    const r = assembleDrawingDraft([obs], LIB, callOffs);
    const gate = r.lines.find((l) => l.elementId === "ce-lift-gate");
    expect(gate?.quantity).toBe(3); // the DRAWING wins
    expect(r.flags.some((f) => /verify/i.test(f))).toBe(true);
  });
  it("no flag when they agree", () => {
    const r = assembleDrawingDraft([obs], LIB, [{ keyword: "lift gate", quantity: 3, lifts: null }]);
    expect(r.flags.some((f) => /verify/i.test(f))).toBe(false);
  });
});

describe("graceful degradation + no-invention", () => {
  it("flags a raster (no text layer) drawing for manual measurement", () => {
    const raster = emptyObs({ sheet: { kind: "ROOF_PLAN", title: "Block F", hasTextLayer: false, siteTypeHint: "SCHOOL", confidence: "medium" } });
    const r = assembleDrawingDraft([raster], LIB);
    expect(r.flags.some((f) => /measure those by hand/i.test(f))).toBe(true);
  });
  it("an unmatched feature becomes a flagged one-off, never an invented item", () => {
    const obs = emptyObs({ stairs: [{ label: "Up-and-over 01", kind: "UP_OVER", heightM: nf(0.8, "low"), perimeterM: nf(null, "unknown") }] });
    const r = assembleDrawingDraft([obs], LIB);
    const line = r.lines.find((l) => l.needsItem);
    expect(line).toBeTruthy();
    expect(line?.elementId).toBeNull();
    expect(line?.note).toMatch(/needs a picking-list item|measure by hand/i);
  });
});
