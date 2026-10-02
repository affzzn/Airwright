import { describe, expect, it } from "vitest";
import { bindScope, elementRole, levelInWording, levelsAboveGround, withinTolerance, type BindLibEl } from "./bindScope";
import type { BuildingModel, MeasurementDraft } from "./model/buildingModel";
import { resolveJobParams } from "./params";
import type { ReconciledDraftLine } from "./scopeDraft";
import type { DrawingDraftLine } from "./assemble";

const lib: BindLibEl[] = [
  { id: "ind", name: "Independent Scaffold", aliases: [], unit: "LM_PER_LIFT", usesLifts: true, category: "Access" },
  { id: "abl", name: "Additional Boarded Lift", aliases: [], unit: "LM_PER_LIFT", usesLifts: true, category: "Access" },
  { id: "tri", name: "Triple Handrail", aliases: [], unit: "LM", usesLifts: false, category: "Protection" },
  { id: "lab", name: "Ladder Access Bay (gate + door)", aliases: [], unit: "NR_PER_LIFT", usesLifts: true, category: "Access" },
  { id: "haki", name: "Haki Stair Tower", aliases: [], unit: "NR_PER_LIFT", usesLifts: true, category: "Access" },
  { id: "slab", name: "Slab Edge Protection", aliases: [], unit: "LM", usesLifts: false, category: "Protection" },
  { id: "void", name: "Opening / Void Edge Protection", aliases: [], unit: "LM", usesLifts: false, category: "Protection" },
  { id: "lead", name: "Leading Edge Protection", aliases: [], unit: "LM", usesLifts: false, category: "Protection" },
  { id: "int", name: "Internal Access Scaffold", aliases: [], unit: "LM_PER_LIFT", usesLifts: true, category: "Internal" },
  { id: "shaft", name: "Lift Shaft Scaffold", aliases: [], unit: "NR_PER_LIFT", usesLifts: true, category: "Internal" },
  { id: "core", name: "Stair Core Scaffold", aliases: [], unit: "NR_PER_LIFT", usesLifts: true, category: "Internal" },
  { id: "riser", name: "Riser Access Platform", aliases: [], unit: "NR", usesLifts: false, category: "Internal" },
  { id: "roof", name: "Roof Edge Protection", aliases: [], unit: "LM", usesLifts: false, category: "Protection" },
  { id: "insp", name: "Weekly Inspection", aliases: [], unit: "PER_WEEK", usesLifts: false, category: "Extras" },
  { id: "adapt", name: "Adaption (general)", aliases: [], unit: "FIXED", usesLifts: false, category: "Extras" },
  { id: "gate", name: "Lift Gate (Safegate)", aliases: [], unit: "NR", usesLifts: false, category: "Protection" },
];

const m = (key: string, valueNumber: number, over: Partial<MeasurementDraft> = {}): MeasurementDraft => ({
  key,
  label: key,
  kind: "PERIMETER_LM",
  valueNumber,
  unit: "m",
  lifts: null,
  heightBracket: null,
  confidence: "high",
  provenance: [`GA-01 ${key}`],
  paramsUsed: [],
  note: null,
  ...over,
});

/** A King-Edward-shaped building: 3 storeys + roof, 11.925 m, a traced outline. */
const keModel: BuildingModel = {
  measurements: [
    m("ext-perimeter", 93.8),
    m("ext-corners", 8, { kind: "COUNT", unit: "nr" }),
    m("height:top of parapet:11.575", 11.925, { kind: "HEIGHT_M", lifts: 6, heightBracket: "H6_12M" }),
    m("gables", 2, { kind: "COUNT", unit: "nr" }),
  ],
  hints: [],
  flags: [],
  outline: null,
  maxScaffoldHeightM: 11.925,
  suggestedBracket: "H6_12M",
  externalLifts: 6,
  levels: [
    { name: "GF", valueM: 0 },
    { name: "1F", valueM: 3.225 },
    { name: "2F", valueM: 6.45 },
    { name: "RF", valueM: 9.725 },
    { name: "PARAPET", valueM: 11.575 },
  ],
};

const item = (over: Partial<ReconciledDraftLine>): ReconciledDraftLine => ({
  clientText: "x",
  rowRef: null,
  sheet: null,
  section: null,
  statedCount: null,
  needsMeasurement: true,
  itemRef: null,
  location: null,
  hireWeeks: null,
  heightM: null,
  loadingRequirement: null,
  quantityBasis: null,
  elementId: null,
  quantity: null,
  lifts: null,
  note: null,
  confidence: "high",
  reason: null,
  invented: false,
  ...over,
});

const params = resolveJobParams(null);
const bind = (items: ReconciledDraftLine[], extra: Partial<Parameters<typeof bindScope>[0]> = {}) =>
  bindScope({ items, buildings: [{ key: "b1", name: "King Edward", model: keModel }], library: lib, params, sections: [], ...extra });
const one = (i: Partial<ReconciledDraftLine>) => bind([item(i)]).lines[0];

describe("roles", () => {
  it("names each dev picking-list item's role", () => {
    expect(elementRole("Independent Scaffold")).toBe("INDEPENDENT");
    expect(elementRole("Haki Stair Tower")).toBe("HAKI");
    expect(elementRole("Loading Bay Gate")).toBe("LB_GATE");
    expect(elementRole("Loading Bay Platform (offset / cantilever)")).toBe("LB_PLATFORM");
    expect(elementRole("Loading Bay")).toBe("LOADING_BAY");
    expect(elementRole("Lift Gate (Safegate)")).toBe("LIFT_GATE");
    expect(elementRole("Lift Shaft Scaffold")).toBe("LIFT_SHAFT");
    expect(elementRole("Stair Core Scaffold")).toBe("STAIR_CORE");
    expect(elementRole("Internal Birdcage (crash deck)")).toBe("BIRDCAGE");
    expect(elementRole("(A) Con Independent Scaffold")).toBe("INDEPENDENT");
  });
  it("reads levels from the level table and the client's wording", () => {
    expect(levelsAboveGround(keModel.levels)).toEqual(["1F", "2F", "RF"]);
    expect(levelInWording("Second floor blockwork walls")).toBe("2F");
    expect(levelInWording("Ground floor blockwork walls")).toBe("GF");
  });
  it("tolerance is the larger of 0.2 m and 1 %; counts are exact", () => {
    expect(withinTolerance(100, 100.9, params)).toBe(true);
    expect(withinTolerance(100, 101.2, params)).toBe(false);
    expect(withinTolerance(10, 10.15, params)).toBe(true);
    expect(withinTolerance(3, 4, params, true)).toBe(false);
  });
});

describe("binding a scope line — only the reliable numbers fill a line", () => {
  it("independent scaffold = the perimeter + corners, lifts from the printed height", () => {
    const l = one({ clientText: "Independent tied scaffold", elementId: "ind", hireWeeks: 30, section: "Perimeter Scaffolding" });
    expect(l.quantity).toBe(101.8);
    expect(l.lifts).toBe(6);
    expect(l.heightBracket).toBe("H6_12M");
    expect(l.formula).toContain("93.8 m wall + 1 m × 8 corners = 101.8 m");
    expect(l.formula).toContain("6 lifts (11.925 m high)");
    expect(l.status).toBe("MEASURED");
    expect(l.hireWeeks).toBe(30);
    expect(l.section).toBe("Perimeter Scaffolding");
    expect(l.clientRef?.text).toBe("Independent tied scaffold");
  });

  it("no reliable perimeter → blank for the estimator, lifts still shown", () => {
    const noRun: BuildingModel = { ...keModel, measurements: keModel.measurements.filter((x) => !x.key.startsWith("ext-")) };
    const r = bindScope({ items: [item({ clientText: "Independent tied scaffold", elementId: "ind" })], buildings: [{ key: "b1", name: "KE", model: noRun }], library: lib, params, sections: [] });
    expect(r.lines[0].quantity).toBeNull();
    expect(r.lines[0].status).toBe("MEASURE_BY_HAND");
    expect(r.lines[0].lifts).toBe(6);
  });

  it("the estimator's own measure beats the drawings and fills the line", () => {
    const noRun: BuildingModel = { ...keModel, measurements: keModel.measurements.filter((x) => !x.key.startsWith("ext-")) };
    const mine = (key: string, v: number) => ({ key, label: key, valueNumber: v, unit: "m", lifts: null, confidence: "high", source: "DRAWN", provenance: ["measured"], note: null, buildingId: "b1", runId: null });
    const r = bindScope({
      items: [item({ clientText: "Independent tied scaffold", elementId: "ind" })],
      buildings: [{ key: "b1", name: "KE", model: noRun, manual: [mine("ext-perimeter", 96.036), mine("ext-corners", 6)] }],
      library: lib,
      params,
      sections: [],
    });
    expect(r.lines[0].quantity).toBe(102.036);
  });

  it("'lifts at each level' = one boarded lift per level above ground (P19)", () => {
    const l = one({ clientText: "Lifts at each level", elementId: "abl" });
    expect(l.quantity).toBe(101.8);
    expect(l.lifts).toBe(3);
  });

  it("triple guardrail = the run, not per lift; on a roof it is the estimator's", () => {
    expect(one({ clientText: "Triple guardrails & toe boards", elementId: "tri" }).quantity).toBe(101.8);
    expect(one({ clientText: "Edge protection", section: "Roof", elementId: "tri" }).quantity).toBeNull();
  });

  it("a count in the wording is the client's (Staircase access towers; 2nr)", () => {
    const l = one({ clientText: "Staircase access towers; 2nr", elementId: "haki", statedCount: 2 });
    expect(l.quantity).toBe(2);
    expect(l.lifts).toBe(6);
    expect(l.status).toBe("STATED");
  });

  it("no count anywhere → blank, never invented", () => {
    const l = one({ clientText: "Ladder access bays", elementId: "lab" });
    expect(l.quantity).toBeNull();
    expect(l.status).toBe("MEASURE_BY_HAND");
    expect(l.lifts).toBe(6);
  });

  it("slab / void / leading edges, blockwork, cores, risers, roof edges are NOT read — blank for the estimator", () => {
    for (const [text, id] of [
      ["Slab edge protection", "slab"],
      ["Edge protection (lift, stairs, risers)", "void"],
      ["Leading edge protection during precast install", "lead"],
      ["Ground floor blockwork walls", "int"],
      ["Riser access platform", "riser"],
      ["Edge protection", "roof"],
      ["Lift shaf internal scaffold", "shaft"],
    ] as const) {
      const l = one({ clientText: text, elementId: id });
      expect(l.quantity, text).toBeNull();
      expect(l.status, text).toBe("MEASURE_BY_HAND");
    }
  });

  it("…but the client's own figure on such a line is kept (Stanmore)", () => {
    const l = one({ clientText: "Edge protection to building perimeter", elementId: "slab", quantity: 45 });
    expect(l.quantity).toBe(45);
    expect(l.status).toBe("STATED");
  });

  it("inspections run for the longest hire on the scope (P16)", () => {
    const r = bind([item({ clientText: "Independent tied scaffold", elementId: "ind", hireWeeks: 30 }), item({ clientText: "Inspections", elementId: "insp" })]);
    expect(r.lines[1].quantity).toBe(30);
  });

  it("a client number is a cross-check: the drawing is kept, a difference flagged (D6)", () => {
    expect(one({ clientText: "Independent tied scaffold", elementId: "ind", quantity: 101 }).status).toBe("AGREES");
    const differ = one({ clientText: "Independent tied scaffold", elementId: "ind", quantity: 80 });
    expect(differ.status).toBe("DIFFERS");
    expect(differ.quantity).toBe(101.8);
    expect(differ.flags!.some((f) => f.includes("The client says 80"))).toBe(true);
  });

  it("an unmatched scope line is kept, flagged as needing an item", () => {
    const l = one({ clientText: "Some mystery item", elementId: null });
    expect(l.needsItem).toBe(true);
    expect(l.status).toBe("NEEDS_ITEM");
  });

  it("main gables the scope does not ask for go on the information list", () => {
    const r = bind([item({ clientText: "Independent tied scaffold", elementId: "ind" })]);
    expect(r.info.map((i) => i.label)).toEqual(["Main gables"]);
    expect(r.lines).toHaveLength(1);
  });

  it("an empty section becomes 'confirm none required'", () => {
    const r = bind([item({ clientText: "Independent tied scaffold", elementId: "ind", section: "Perimeter Scaffolding" })], {
      sections: ["Perimeter Scaffolding", "Birdcages"],
      emptyTableSections: ["Birdcages"],
    });
    expect(r.emptySections).toEqual(["Birdcages"]);
  });

  it("every scope line is accounted for", () => {
    const r = bind([
      item({ clientText: "Independent tied scaffold", elementId: "ind" }),
      item({ clientText: "Leading edge", elementId: "lead" }),
      item({ clientText: "Ladder access bays", elementId: "lab" }),
      item({ clientText: "Mystery", elementId: null }),
    ]);
    const a = r.account;
    expect(a.scopeLines).toBe(4);
    expect(a.measured + a.stated + a.agrees + a.differs + a.measureByHand + a.unknownBasis + a.needsItem).toBe(4);
  });

  it("with no drawings, a stated figure is used and flagged (Stanmore)", () => {
    const r = bindScope({
      items: [item({ clientText: "Edge protection to building perimeter", elementId: "tri", quantity: 275, hireWeeks: 16 })],
      buildings: [],
      library: lib,
      params,
      sections: [],
    });
    expect(r.lines[0].quantity).toBe(275);
    expect(r.lines[0].status).toBe("STATED");
  });

  it("two buildings: a measured item gets one line per building", () => {
    const two = (text: string) =>
      bindScope({
        items: [item({ clientText: text, elementId: "ind" })],
        buildings: [
          { key: "hall", name: "Community Hall", model: keModel },
          { key: "pav", name: "Sports Pavilion", model: keModel },
        ],
        library: lib,
        params,
        sections: [],
      });
    expect(two("Independent scaffold").lines.map((l) => l.buildingId)).toEqual(["hall", "pav"]);
    expect(two("Independent scaffold to the pavilion").lines.map((l) => l.buildingId)).toEqual(["pav"]);
  });
});

describe("printed level names", () => {
  it("map to plan codes", async () => {
    const { levelCode } = await import("./bindScope");
    expect(levelCode("01-First Floor")).toBe("1F");
    expect(levelCode("02 - Second Floor")).toBe("2F");
    expect(levelCode("RF-Roof")).toBe("RF");
    expect(levelCode("GF-Ground Floor")).toBe("GF");
    expect(levelsAboveGround([
      { name: "F1-Foundation", valueM: -0.9 },
      { name: "GF-Ground Floor", valueM: 0 },
      { name: "01-First Floor", valueM: 3.225 },
      { name: "02 - Second Floor", valueM: 6.45 },
      { name: "RF-Roof", valueM: 9.725 },
      { name: "Parapet", valueM: 11.575 },
    ])).toEqual(["1F", "2F", "RF"]);
  });
});

describe("a numbered mark-up with a schedule that lists each item twice (Wren)", () => {
  const ml = (id: string, q: number, lifts: number | null): DrawingDraftLine => ({
    elementId: id, description: id, unit: "NR_PER_LIFT", quantity: q, lifts, heightBracket: null, confidence: "high", note: null, needsItem: false,
  });
  const markup = [ml("haki", 1, 3), ml("haki", 1, 2), ml("ind", 42.199, 3), ml("ind", 35.157, 2)];
  const r = bind(
    [
      item({ clientText: "Haki Stair Tower", rowRef: "R3", elementId: "haki", lifts: 2, quantity: 1, hireWeeks: 7 }),
      item({ clientText: "Haki Stair Tower", rowRef: "R4", elementId: "haki", lifts: 3, quantity: 1, hireWeeks: 7 }),
      item({ clientText: "Progressive External Perimetre", rowRef: "R10", elementId: "ind", lifts: 2, quantity: 35.15746, hireWeeks: 7 }),
      item({ clientText: "Progressive External Perimetre", rowRef: "R11", elementId: "ind", lifts: 3, quantity: 42.19896, hireWeeks: 7 }),
      item({ clientText: "A scaffold wrap around the building", elementId: "ind" }), // the email, again
    ],
    { markupLines: markup },
  );
  it("pairs each row with one mark-up line by lifts — no duplicates", () => {
    expect(r.lines).toHaveLength(4);
    expect(r.lines.find((l) => l.elementId === "haki" && l.lifts === 2)!.clientRef!.rowRef).toBe("R3");
    expect(r.lines.find((l) => l.elementId === "haki" && l.lifts === 3)!.clientRef!.rowRef).toBe("R4");
    expect(r.lines.find((l) => l.elementId === "ind" && l.lifts === 2)!.clientRef!.rowRef).toBe("R10");
  });
  it("cross-checks the client's figure against the mark-up", () => {
    expect(r.lines.find((l) => l.elementId === "ind" && l.lifts === 3)!.status).toBe("AGREES");
    expect(r.account.scopeLines).toBe(5);
    expect(r.account.agrees + r.account.measured).toBe(5);
  });
});

describe("scope wording that names one core", () => {
  it("'Stair core 2 access scaffold' is one; 'Lift shaft scaffold' is left to the estimator", () => {
    const r = bindScope({
      items: [item({ clientText: "Stair core 2 access scaffold", elementId: "core" }), item({ clientText: "Lift shaf internal scaffold", elementId: "shaft" })],
      buildings: [{ key: "b1", name: "KE", model: keModel }],
      library: lib,
      params,
      sections: [],
    });
    expect(r.lines[0].quantity).toBe(1);
    expect(r.lines[1].quantity).toBeNull();
  });
  it("a blank 'lifts at each level' still shows the boarded lifts per floor", () => {
    const noRun: BuildingModel = { ...keModel, measurements: keModel.measurements.filter((x) => !x.key.startsWith("ext-")) };
    const r = bindScope({ items: [item({ clientText: "Lifts at each level", elementId: "abl" })], buildings: [{ key: "b1", name: "KE", model: noRun }], library: lib, params, sections: [] });
    expect(r.lines[0].quantity).toBeNull();
    expect(r.lines[0].lifts).toBe(3);
  });
});
