import { describe, it, expect } from "vitest";
import { buildBuildingModel, heightStringToM, type SheetForModel } from "./buildingModel";
import { resolveJobParams } from "../params";
import { sheetGeometry, type TextItem } from "../pack/sheetGeometry";
import { planSchema, elevationSchema, sectionSchema, roofSchema, markupSchema } from "../readers/schemas";

const T = (s: string, x = 0, y = 0, vertical = false): TextItem => ({ s, x, y, w: 10, h: 7.8, vertical });
const geo = (items: TextItem[], scale = "1:50", kind = "PLAN") => sheetGeometry(items, { scale, kind });
const raw = (items: TextItem[]) => items.map((i) => i.s).join(" | ");
const params = resolveJobParams(null);

// A CBAND-like Sports Pavilion: a 20.793 × 8.965 rectangle, soffit 2850 above DPC, 35° pitch, two main gables.
const planItems = [T("20793", 692, 1085), T("20793", 692, 267), T("8965", 24, 696, true), T("8965", 1347, 696, true), T("303", 115, 335), T("8360", 600, 335), T("303", 1276, 335)];
const sectionItems = [T("2850DPC TO UNDERSIDE OF SOFFIT"), T("2990 Floor to ceiling"), T("35°")];
const elevItems = [T("2850 DPC TO U/S SOFFIT"), T("1650 DPC TO U/S SOFFIT"), T("35.00°")];

const sheets: SheetForModel[] = [
  {
    sheetId: "p",
    title: "0201 Ground Floor Plan",
    kind: "PLAN",
    level: "GF",
    geometry: geo(planItems),
    rawText: raw(planItems),
    plan: planSchema.parse({
      outlineReason: "a plain rectangle",
      outline: ["E | 20793 | - | WALL | north", "S | 8965 | - | WALL | -", "W | 20793 | - | WALL | -", "N | 8965 | - | WALL | -"],
      wallThicknessStrings: ["303", "303"],
    }),
  },
  {
    sheetId: "s",
    title: "0304 Section A-A",
    kind: "SECTION",
    level: null,
    geometry: geo(sectionItems, "1:50", "SECTION"),
    rawText: raw(sectionItems),
    section: sectionSchema.parse({
      heights: [{ string: "2850DPC TO UNDERSIDE OF SOFFIT", measures: "SOFFIT", from: "DPC", appliesTo: "main roof" }],
      internalClearHeights: [{ room: "Changing", string: "2990 Floor to ceiling", measures: "CEILING" }],
    }),
  },
  {
    sheetId: "e",
    title: "0402 Side Elevation",
    kind: "ELEVATION",
    level: null,
    geometry: geo(elevItems, "1:50", "ELEVATION"),
    rawText: raw(elevItems),
    elevation: elevationSchema.parse({
      heights: [
        { string: "2850 DPC TO U/S SOFFIT", measures: "SOFFIT", from: "DPC", appliesTo: "main roof" },
        { string: "1650 DPC TO U/S SOFFIT", measures: "SOFFIT", from: "DPC", appliesTo: "porch" },
      ],
      roof: { faceRoof: "GABLED", apexReason: "gable end", apexCount: 1, apexes: [{ kind: "MAIN" }] },
    }),
  },
  {
    sheetId: "r",
    title: "0308 Roof Plan",
    kind: "ROOF",
    level: "RF",
    geometry: null,
    rawText: "",
    roof: roofSchema.parse({
      roofForm: "PITCHED",
      gablesReason: "two main gable ends, a small porch gable at the front",
      gables: [{ where: "west", kind: "MAIN" }, { where: "east", kind: "MAIN" }, { where: "front porch", kind: "PORCH" }],
    }),
  },
  {
    sheetId: "m",
    title: "Sports - Scaffold mark up",
    kind: "MARKUP",
    level: null,
    geometry: null,
    rawText: "",
    markup: markupSchema.parse({
      zones: [
        { colour: "blue", legend: "Internal & External Scaffold", meaning: "EXTERNAL_AND_INTERNAL_SCAFFOLD", coversAllExternalWalls: true, internalWalls: ["changing room walls"] },
        { colour: "orange", legend: "Scaffold Crash Deck", meaning: "BIRDCAGE", coversWholeInterior: true },
      ],
    }),
  },
];

describe("building model — only what is read reliably (a CBAND-like pavilion)", () => {
  const m = buildBuildingModel("Sports Pavilion", sheets, { params, groundRelMm: [] });
  const byKey = (k: string) => m.measurements.find((x) => x.key.startsWith(k));

  it("heights from the printed soffits + 0.15 m DPC, with lifts (quote: 2 lifts)", () => {
    const main = m.measurements.find((x) => x.key === "height:soffit:2.85")!;
    expect(main.valueNumber).toBe(3);
    expect(main.lifts).toBe(2);
    expect(main.heightBracket).toBe("UP_TO_6M");
    expect(main.label).toContain("main roof");
    expect(main.confidence).toBe("high"); // printed on two sheets
    expect(main.note).toContain("Add 0.15 m");
    expect(main.provenance[0]).toContain('"2850');
  });
  it("a rectangle no second drawing confirms is NOT filled — only suggested", () => {
    expect(byKey("ext-perimeter")).toBeUndefined();
    const h = m.hints.find((x) => x.target === "ext-perimeter")!;
    expect(h.value).toBe(59.516);
    expect(h.corners).toBe(4);
    expect(h.text).toContain("only a suggestion");
  });
  it("gables: the roof plan (2) and the elevations (1) disagree → not filled, both shown", () => {
    expect(byKey("gables")).toBeUndefined();
    const h = m.hints.find((x) => x.target === "gables")!;
    expect(h.value).toBeNull();
    expect(h.text).toContain("roof plan shows 2");
  });
  it("a printed clear height is offered (labelled as reaching a ceiling)", () => {
    const c = byKey("clear:")!;
    expect(c.valueNumber).toBe(2.99);
    expect(c.note).toContain("about 1 lift");
  });
  it("nothing unreliable is produced any more", () => {
    for (const k of ["scaffold-run", "internal-footprint", "markup-", "pitch", "roof-", "openings", "void-edge", "risers", "lift-", "stair-cores", "external-doors", "slab-edge"])
      expect(m.measurements.some((x) => x.key.startsWith(k))).toBe(false);
  });
});

describe("building model — two drawings agree", () => {
  const roofItems = [T("20793", 692, 1085), T("20793", 692, 267), T("8965", 24, 696, true), T("8965", 1347, 696, true)];
  const roof: SheetForModel = { ...sheets[3], geometry: geo(roofItems, "1:50", "ROOF_PLAN"), rawText: raw(roofItems) };
  const elev2: SheetForModel = { ...sheets[2], sheetId: "e2", title: "0404 Other Side Elevation" };
  const m = buildBuildingModel("Sports Pavilion", [sheets[0], sheets[1], sheets[2], elev2, roof], { params, groundRelMm: [] });
  it("the plan's printed rectangle + the roof plan's overall size → the perimeter and 4 corners, checked", () => {
    const per = m.measurements.find((x) => x.key === "ext-perimeter")!;
    expect(per.valueNumber).toBe(59.516);
    expect(per.confidence).toBe("high");
    expect(per.note).toContain("2 × (20.793 + 8.965)");
    expect(per.provenance.some((p) => p.startsWith("0308 Roof Plan"))).toBe(true);
    expect(m.measurements.find((x) => x.key === "ext-corners")!.valueNumber).toBe(4);
  });
  it("roof plan and elevations both show 2 main gables → filled", () => {
    const g = m.measurements.find((x) => x.key === "gables")!;
    expect(g.valueNumber).toBe(2);
    expect(g.confidence).toBe("high");
  });
});

describe("building model — a stepped (not rectangular) plan", () => {
  const lItems = [T("10000", 10, 10), T("4000", 20, 20), T("6000", 30, 30)];
  const plan: SheetForModel = {
    sheetId: "l",
    title: "L Plan",
    kind: "PLAN",
    level: "GF",
    geometry: geo(lItems),
    rawText: raw(lItems),
    plan: planSchema.parse({
      outline: ["E | 10000 | - | WALL | -", "S | 4000 | - | WALL | -", "W | 6000 | - | WALL | -", "S | 6000 | - | WALL | -", "W | 4000 | - | WALL | -", "N | 10000 | - | WALL | -"],
    }),
  };
  it("is never filled automatically — it is for the estimator to measure", () => {
    const m = buildBuildingModel("Hall", [plan], { params, groundRelMm: [] });
    expect(m.measurements.find((x) => x.key === "ext-perimeter")).toBeUndefined();
    expect(m.hints.find((h) => h.target === "ext-perimeter")!.text).toContain("not a plain rectangle");
  });
});

describe("building model — a KE-like flat roof with a parapet", () => {
  const elev = [T("+9.725"), T("3 RF-Roof (87.875)"), T("+11.575"), T("4 Parapet (89.725)"), T("±0.000"), T("0 GF-Ground Floor (78.150)")];
  const m = buildBuildingModel(
    "Main building",
    [{ sheetId: "n", title: "1201 North", kind: "ELEVATION", level: null, geometry: geo(elev, "1:50", "ELEVATION"), rawText: raw(elev), elevation: elevationSchema.parse({}) }],
    { params, groundRelMm: [700, -350, 850] },
  );
  it("scaffold height = parapet top above the lowest proposed ground; 6 lifts; 6–12 m band", () => {
    const h = m.measurements.find((x) => x.kind === "HEIGHT_M" && x.label.includes("whole building"))!;
    expect(h.valueNumber).toBe(11.925);
    expect(h.lifts).toBe(6);
    expect(h.heightBracket).toBe("H6_12M");
    expect(m.suggestedBracket).toBe("H6_12M");
    expect(h.note).toContain("lowest ground level");
  });
});

describe("height strings", () => {
  it("parses printed heights and level markers", () => {
    expect(heightStringToM("3300 DPC TO U/S SOFFIT")).toBe(3.3);
    expect(heightStringToM("+11.575")).toBe(11.575);
    expect(heightStringToM("±0.000")).toBe(0);
  });
});

describe("building model — printed room areas, one row each (for a birdcage)", () => {
  const items = [T("CLASSROOM 1", 10, 10), T("50.467 m", 10, 20), T("2", 60, 20)];
  const m = buildBuildingModel("Block", [{ sheetId: "p1", title: "GA-100 Ground Floor Plan", kind: "PLAN", level: "GF", geometry: geo(items), rawText: raw(items), plan: planSchema.parse({ outline: [] }) }], { params, groundRelMm: [] });
  it("keeps each printed room as its own row", () => {
    const rooms = m.measurements.filter((x) => x.key.startsWith("room:"));
    for (const r of rooms) {
      expect(r.kind).toBe("AREA_M2");
      expect(r.confidence).toBe("high");
    }
  });
});
