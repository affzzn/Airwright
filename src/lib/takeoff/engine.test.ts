import { describe, it, expect } from "vitest";
import {
  buildTakeoff,
  computeAdaptions,
  partyGables,
  configFromPartyGables,
  computeApex,
  computeLifts,
  computeLiftsTimberFrame,
  computePerimeter,
  partyWalls,
  storeyLifts,
  DEFAULT_PARAMS,
  type TakeoffInput,
} from "./engine";

/**
 * These fixtures reproduce lines from Colin's real handwritten take-off sheets
 * (colin-data/). The engine must reproduce his lifts, birdcage floors and apex
 * counts exactly, and his perimeter under the default 1 m/corner rule.
 */

const base: TakeoffInput = {
  storeys: null,
  roomInRoof: false,
  heightToSoffitM: null,
  roofType: null,
  wallSegments: [],
  dwellingsWide: 1,
  isApartmentBlock: false,
  cornerCount: null,
  apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 0 },
  renderSegmentsM: [],
  floors: [],
  lowLevelCount: 0,
  chimney: false,
  config: "DETACHED",
};

describe("computePerimeter — corners derived from cornerCount for every config", () => {
  const walls = [
    { position: "front" as const, lengthM: 9 },
    { position: "rear" as const, lengthM: 9 },
    { position: "gable_left" as const, lengthM: 8 },
    { position: "gable_right" as const, lengthM: 8 },
  ];
  it("plain rectangle: detached 4 / semi 2 / mid 0 (unchanged)", () => {
    const b = { ...base, wallSegments: walls, cornerCount: 4 };
    expect(computePerimeter({ ...b, config: "DETACHED" }, 1).corners).toBe(4);
    expect(computePerimeter({ ...b, config: "SEMI_DETACHED" }, 1).corners).toBe(2);
    expect(computePerimeter({ ...b, config: "MID_TERRACE" }, 1).corners).toBe(0);
  });
  it("L-shape (6 corners): detached 6 / semi 4 / mid 2", () => {
    const b = { ...base, wallSegments: walls, cornerCount: 6 };
    expect(computePerimeter({ ...b, config: "DETACHED" }, 1).corners).toBe(6);
    expect(computePerimeter({ ...b, config: "SEMI_DETACHED" }, 1).corners).toBe(4);
    expect(computePerimeter({ ...b, config: "MID_TERRACE" }, 1).corners).toBe(2);
  });
  it("null cornerCount falls back to the flat 2/0 for non-detached", () => {
    const b = { ...base, wallSegments: walls, cornerCount: null };
    expect(computePerimeter({ ...b, config: "SEMI_DETACHED" }, 1).corners).toBe(2);
    expect(computePerimeter({ ...b, config: "MID_TERRACE" }, 1).corners).toBe(0);
  });
  it("flags an L-shaped non-detached footprint", () => {
    const line = buildTakeoff({
      ...base, wallSegments: walls, cornerCount: 6, storeys: 2, heightToSoffitM: 4.8,
      config: "SEMI_DETACHED",
    });
    expect(line.flags.some((f) => /L-shaped\/stepped footprint/.test(f))).toBe(true);
  });
});

describe("builder-specific storey→lifts template", () => {
  const BARRATT = { ...DEFAULT_PARAMS, storeyLiftTemplate: { "1": 2, "2": 3, "2.5": 5, "3": 6 } };
  it("storeyLifts reads the passed template (Barratt 2 → 3)", () => {
    expect(storeyLifts(2)).toBe(4); // default Standard
    expect(storeyLifts(2, BARRATT.storeyLiftTemplate)).toBe(3); // Barratt
  });
  it("computeLifts uses the Barratt template: 2-storey → 3 (template wins over height's 4), flagged", () => {
    const r = computeLifts({ ...base, storeys: 2, heightToSoffitM: 4.7 }, BARRATT);
    expect(r.heightLifts).toBe(4);
    expect(r.storeyLifts).toBe(3);
    expect(r.lifts).toBe(3); // whole storey → template wins
    expect(r.flag).toBe(true);
  });
});

describe("computeLifts (height ÷ 1.5, round up, +1 room-in-roof)", () => {
  it("garage @ 2.25 m → 2 lifts", () => {
    expect(computeLifts({ ...base, storeys: 1, heightToSoffitM: 2.25 }).lifts).toBe(2);
  });
  it("bungalow @ 2.2 m → 2 lifts", () => {
    expect(computeLifts({ ...base, storeys: 1, heightToSoffitM: 2.2 }).lifts).toBe(2);
  });
  it("two-storey @ 4.8 m → 4 lifts", () => {
    expect(computeLifts({ ...base, storeys: 2, heightToSoffitM: 4.8 }).lifts).toBe(4);
  });
  it("two-and-a-half storey (Harton) @ 5.42 m + room in roof → 5 lifts", () => {
    const r = computeLifts({ ...base, storeys: 2.5, heightToSoffitM: 5.42, roomInRoof: true });
    expect(r.lifts).toBe(5); // ceil(3.61)=4, +1 room-in-roof
  });
  it("2.5-storey infers room-in-roof from the fractional storey even if flag is false", () => {
    expect(computeLifts({ ...base, storeys: 2.5, heightToSoffitM: 5.42 }).lifts).toBe(5);
  });
  it("three-storey @ 8.1 m → 6 lifts", () => {
    expect(computeLifts({ ...base, storeys: 3, heightToSoffitM: 8.1 }).lifts).toBe(6);
  });
  it("falls back to the storey template when height is missing", () => {
    const r = computeLifts({ ...base, storeys: 2, heightToSoffitM: null });
    expect(r.lifts).toBe(4);
    expect(r.basis).toBe("storey");
  });
  it("flags a height-vs-storey disagreement", () => {
    // 2-storey but a mis-read 7 m → height gives 5, storey gives 4.
    const r = computeLifts({ ...base, storeys: 2, heightToSoffitM: 7 });
    expect(r.flag).toBe(true);
  });
  it("whole 3-storey @ 7.5 m: storey template wins (6), not the height boundary (5)", () => {
    // Augusta case: ceil(7.5/1.5)=5, but a whole 3-storey is 6 lifts.
    const r = computeLifts({ ...base, storeys: 3, heightToSoffitM: 7.5 });
    expect(r.heightLifts).toBe(5);
    expect(r.storeyLifts).toBe(6);
    expect(r.lifts).toBe(6); // whole storey → template wins
    expect(r.basis).toBe("storey");
    expect(r.flag).toBe(true);
  });
  it("half storey (2.5) keeps the height rule when it disagrees with the template", () => {
    // If a 2.5-storey height reads low, height+room-in-roof still drives.
    const r = computeLifts({ ...base, storeys: 2.5, roomInRoof: true, heightToSoffitM: 4.6 });
    expect(r.basis).toBe("height");
  });
});

describe("apartment block — scaffolded as one whole building", () => {
  const block = {
    ...base,
    isApartmentBlock: true,
    roofType: "MIXED" as const,
    cornerCount: 4,
    apexByFace: { front: 2, rear: 0, left: 1, right: 1, other: 0 },
    dwellingsWide: 2, // model may still report 2; the block flag overrides it
    wallSegments: [
      { position: "front" as const, lengthM: 19 },
      { position: "rear" as const, lengthM: 19 },
      { position: "gable_left" as const, lengthM: 8.3 },
      { position: "gable_right" as const, lengthM: 8.3 },
    ],
  };
  it("does NOT divide the frontage (ignores dwellingsWide)", () => {
    const p = computePerimeter(block, 6);
    expect(p.perLiftM).toBe(58.6); // 19+19+8.3+8.3 + 4 corners — not halved
  });
  it("keeps every apex (no config reduction)", () => {
    expect(computeApex(block).count).toBe(4);
  });
  it("has no party walls and flags itself", () => {
    const t = buildTakeoff({ ...block, config: "DETACHED", storeys: 3 });
    expect(t.partyWalls).toBe(0);
    expect(t.flags.some((f) => /Apartment block/.test(f))).toBe(true);
  });
});

describe("computePerimeter by configuration (+1 m/corner default)", () => {
  // Dekker footprint: front = rear = 5.3, both sides = 7.9.
  const dekkerWalls: TakeoffInput["wallSegments"] = [
    { position: "front", lengthM: 5.3 },
    { position: "rear", lengthM: 5.3 },
    { position: "gable_left", lengthM: 7.9 },
    { position: "gable_right", lengthM: 7.9 },
  ];

  it("Dekker Semi/End → 20.5 m per lift (front+rear+one side + 2 corners)", () => {
    const p = computePerimeter(
      { ...base, wallSegments: dekkerWalls, config: "SEMI_DETACHED" },
      4,
    );
    expect(p.perLiftM).toBe(20.5);
    expect(p.corners).toBe(2);
    expect(p.totalM).toBe(82); // 20.5 × 4 lifts
  });

  it("Dekker Mid → 10.6 m per lift (front+rear only, no corners)", () => {
    const p = computePerimeter(
      { ...base, wallSegments: dekkerWalls, config: "MID_TERRACE" },
      4,
    );
    expect(p.perLiftM).toBe(10.6);
    expect(p.corners).toBe(0);
  });

  it("halves the front/rear frontage for a semi-detached PAIR (dwellingsWide=2)", () => {
    // Model reports the pair's printed frontage (10.66) + dwellingsWide=2; the
    // engine divides front/rear to one dwelling. Gables stay full depth (7.9).
    const pairWalls: TakeoffInput["wallSegments"] = [
      { position: "front", lengthM: 10.66 },
      { position: "rear", lengthM: 10.66 },
      { position: "gable_left", lengthM: 7.904 },
      { position: "gable_right", lengthM: 7.904 },
    ];
    const semi = computePerimeter(
      { ...base, wallSegments: pairWalls, dwellingsWide: 2, config: "SEMI_DETACHED" },
      4,
    );
    expect(semi.perLiftM).toBe(20.564); // 5.33 + 5.33 + 7.904 + 2 corners ≈ Colin's 20.5
    const mid = computePerimeter(
      { ...base, wallSegments: pairWalls, dwellingsWide: 2, config: "MID_TERRACE" },
      4,
    );
    expect(mid.perLiftM).toBe(10.66); // 5.33 + 5.33 ≈ Colin's 10.6
  });

  it("Rosewood bungalow → 48.5 m per lift (detached, 4 corners)", () => {
    // walls sum 44.5 + 4×1 corner = 48.5 (matches Colin's sheet)
    const p = computePerimeter(
      {
        ...base,
        config: "DETACHED",
        cornerCount: 4,
        wallSegments: [
          { position: "front", lengthM: 15 },
          { position: "rear", lengthM: 15 },
          { position: "gable_left", lengthM: 7.25 },
          { position: "gable_right", lengthM: 7.25 },
        ],
      },
      2,
    );
    expect(p.perLiftM).toBe(48.5);
    expect(p.totalM).toBe(97);
  });
});

describe("computeApex reduces by configuration (Dekker: gable apex on each side)", () => {
  const dekkerApex = {
    ...base,
    roofType: "PITCHED" as const,
    apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
  };
  it("detached keeps both gable apexes → 2", () => {
    expect(computeApex({ ...dekkerApex, config: "DETACHED" }).count).toBe(2);
  });
  it("semi/end drops the party-wall gable → 1", () => {
    expect(computeApex({ ...dekkerApex, config: "SEMI_DETACHED" }).count).toBe(1);
  });
  it("mid-terrace drops both gables → 0", () => {
    expect(computeApex({ ...dekkerApex, config: "MID_TERRACE" }).count).toBe(0);
  });
  it("a hipped roof is always 0 regardless of reported apexes", () => {
    expect(
      computeApex({ ...dekkerApex, roofType: "HIPPED", config: "DETACHED" }).count,
    ).toBe(0);
  });
  it("a front (projecting) gable still counts on a mid-terrace", () => {
    expect(
      computeApex({
        ...base,
        roofType: "PITCHED",
        config: "MID_TERRACE",
        apexByFace: { front: 1, rear: 0, left: 1, right: 1, other: 0 },
      }).count,
    ).toBe(1);
  });
});

describe("party wall — one spec unit per non-detached house (Colin, 2026-09-01)", () => {
  it("detached has none", () => {
    expect(partyWalls("DETACHED")).toBe(0);
  });
  it("semi / end / mid each get exactly ONE (mid is NOT two)", () => {
    expect(partyWalls("SEMI_DETACHED")).toBe(1);
    expect(partyWalls("END_TERRACE")).toBe(1);
    expect(partyWalls("MID_TERRACE")).toBe(1);
  });
  it("buildTakeoff carries the unit for a non-detached plot", () => {
    expect(buildTakeoff({ ...base, config: "SEMI_DETACHED" }).partyWalls).toBe(1);
  });
  it("a customer opt-out (includePartyWall=false) drops the unit", () => {
    expect(
      buildTakeoff({ ...base, config: "SEMI_DETACHED", includePartyWall: false }).partyWalls,
    ).toBe(0);
  });
  it("an apartment block never gets a party-wall unit", () => {
    expect(
      buildTakeoff({ ...base, isApartmentBlock: true, config: "SEMI_DETACHED" }).partyWalls,
    ).toBe(0);
  });
});

describe("buildTakeoff — full lines from Colin's sheets", () => {
  it("Rosewood · Detached · 1-storey · Hipped → 2 lifts, 1 birdcage floor, 0 apex", () => {
    const t = buildTakeoff({
      ...base,
      config: "DETACHED",
      storeys: 1,
      heightToSoffitM: 2.2,
      roofType: "HIPPED",
      cornerCount: 4,
      apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 0 },
      wallSegments: [
        { position: "front", lengthM: 15 },
        { position: "rear", lengthM: 15 },
        { position: "gable_left", lengthM: 7.25 },
        { position: "gable_right", lengthM: 7.25 },
      ],
      floors: [{ level: "GF", m2: 107 }],
    });
    expect(t.lifts.lifts).toBe(2);
    expect(t.perimeter.perLiftM).toBe(48.5);
    expect(t.birdcage.floorCount).toBe(1);
    expect(t.birdcage.totalM2).toBe(107);
    expect(t.apex.count).toBe(0); // hipped
    expect(t.partyWalls).toBe(0); // detached
  });

  it("Dekker · Semi/End · 2-storey · Pitched → 20.5×4, 35.6×2 floors, 1 apex, 1 party wall", () => {
    const t = buildTakeoff({
      ...base,
      config: "SEMI_DETACHED",
      storeys: 2,
      heightToSoffitM: 4.8,
      roofType: "PITCHED",
      apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 }, // both gables; semi drops one → 1
      lowLevelCount: 1,
      wallSegments: [
        { position: "front", lengthM: 5.3 },
        { position: "rear", lengthM: 5.3 },
        { position: "gable_left", lengthM: 7.9 },
        { position: "gable_right", lengthM: 7.9 },
      ],
      floors: [
        { level: "GF", m2: 17.8 },
        { level: "FF", m2: 17.8 },
      ],
    });
    expect(t.lifts.lifts).toBe(4);
    expect(t.perimeter.perLiftM).toBe(20.5);
    expect(t.birdcage.floorCount).toBe(2);
    expect(t.birdcage.totalM2).toBe(35.6);
    expect(t.apex.count).toBe(1);
    expect(t.apex.tableLifts).toBe(1);
    expect(t.apex.handrails).toBe(1);
    expect(t.partyWalls).toBe(1);
  });

  it("Baildon · Semi · 2.5-storey → 5 lifts and 3 birdcage floors", () => {
    const t = buildTakeoff({
      ...base,
      config: "SEMI_DETACHED",
      storeys: 2.5,
      roomInRoof: true,
      heightToSoffitM: 5.4,
      roofType: "PITCHED",
      apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
      wallSegments: [
        { position: "front", lengthM: 5 },
        { position: "rear", lengthM: 5 },
        { position: "gable_left", lengthM: 7.9 },
        { position: "gable_right", lengthM: 7.9 },
      ],
      floors: [
        { level: "GF", m2: 11.1 },
        { level: "FF", m2: 11.1 },
        { level: "SF", m2: 11.2 },
      ],
    });
    expect(t.lifts.lifts).toBe(5);
    expect(t.birdcage.floorCount).toBe(3);
  });

  it("Kone · Semi · 2-storey · Render → render length × 2 lifts", () => {
    const t = buildTakeoff({
      ...base,
      config: "SEMI_DETACHED",
      storeys: 2,
      heightToSoffitM: 4.8,
      roofType: "PITCHED",
      apexByFace: { front: 1, rear: 0, left: 1, right: 1, other: 0 }, // front gable + one exposed gable → 2 on a semi
      renderSegmentsM: [9.23],
      wallSegments: [
        { position: "front", lengthM: 6 },
        { position: "rear", lengthM: 6 },
        { position: "gable_left", lengthM: 8 },
        { position: "gable_right", lengthM: 8 },
      ],
      floors: [
        { level: "GF", m2: 20.7 },
        { level: "FF", m2: 20.7 },
      ],
    });
    expect(t.render?.lengthM).toBe(9.23);
    expect(t.render?.lifts).toBe(2);
    expect(t.apex.count).toBe(2);
  });

  it("Double garage → 30.5×2 lifts, 1 birdcage floor", () => {
    const t = buildTakeoff({
      ...base,
      config: "DETACHED",
      storeys: 1,
      heightToSoffitM: 2.7,
      roofType: "HIPPED",
      cornerCount: 4,
      wallSegments: [
        { position: "front", lengthM: 8.25 },
        { position: "rear", lengthM: 8.25 },
        { position: "gable_left", lengthM: 5 },
        { position: "gable_right", lengthM: 5 },
      ],
      floors: [{ level: "GF", m2: 37.8 }],
    });
    expect(t.lifts.lifts).toBe(2);
    expect(t.perimeter.perLiftM).toBe(30.5);
  });
});

// ---------------------------------------------------------------------------
// Timber frame (docs/18). The take-off engine becomes build-system-aware: a
// different lift rule (450 mm top step + 2 m lifts → fewer lifts), NO birdcage,
// and two LM adaptions. Everything else (perimeter, apex, render) is shared.
// ---------------------------------------------------------------------------

describe("timber-frame lifts (storey template 2→3, 2.5→4, 3→4)", () => {
  const tf = (over: Partial<TakeoffInput>) =>
    computeLiftsTimberFrame({ ...base, buildSystem: "TIMBER_FRAME", ...over });

  it("2-storey → 3 lifts; 2.5 → 4; 3 → 4", () => {
    expect(tf({ storeys: 2, heightToSoffitM: 4.8 }).lifts).toBe(3);
    expect(tf({ storeys: 2.5, heightToSoffitM: 5.5 }).lifts).toBe(4);
    expect(tf({ storeys: 3, heightToSoffitM: 6.5 }).lifts).toBe(4);
  });

  it("a 2-storey WITH a room-in-roof reads as 2.5 → 4 lifts", () => {
    expect(tf({ storeys: 2, roomInRoof: true, heightToSoffitM: 5.5 }).lifts).toBe(4);
  });

  it("the height method agrees with the storey rule at typical heights (no flag)", () => {
    expect(tf({ storeys: 2, heightToSoffitM: 4.8 }).flag).toBe(false);
    expect(tf({ storeys: 3, heightToSoffitM: 6.5 }).flag).toBe(false);
  });

  it("an unusually tall 2-storey flags a height↔storey divergence (storey still wins)", () => {
    const r = tf({ storeys: 2, heightToSoffitM: 5.6 }); // height method → 4, storey → 3
    expect(r.lifts).toBe(3);
    expect(r.heightLifts).toBe(4);
    expect(r.flag).toBe(true);
  });

  it("no storey read → falls back to the height method", () => {
    expect(tf({ storeys: null, heightToSoffitM: 4.8 }).lifts).toBe(3);
    expect(tf({ storeys: null, heightToSoffitM: 4.8 }).basis).toBe("height");
  });
});

describe("computeAdaptions — Laura's revised Aspen-semi example (docs/18)", () => {
  it("inside-board = perim × adaption lifts; hop-up = drop the kicker; apex = a UNIT", () => {
    // perimeter 20.83 LM (incl. 2 corners), 3 adaption lifts, 1 apex.
    const a = computeAdaptions(20.83, 3, 1);
    expect(a.adaptionLifts).toBe(3);
    expect(a.insideBoardLM).toBe(62.49); // 20.83 × 3 (NO apex in the LM)
    expect(a.hopUpLM).toBe(41.66); // 20.83 × 2 (all except the 1st/kicker)
    expect(a.apexInsideBoardUnits).toBe(1); // apex is a unit, not LM
    expect(a.apexHopUpUnits).toBe(1);
  });

  it("no apex → the apex units are 0 (LM unchanged)", () => {
    const a = computeAdaptions(20.83, 3, 0);
    expect(a.insideBoardLM).toBe(62.49);
    expect(a.hopUpLM).toBe(41.66);
    expect(a.apexInsideBoardUnits).toBe(0);
    expect(a.apexHopUpUnits).toBe(0);
  });

  it("a single adaption lift → hop-up LM is 0 (only the apex unit remains)", () => {
    const a = computeAdaptions(20, 1, 1);
    expect(a.insideBoardLM).toBe(20); // 20 × 1
    expect(a.hopUpLM).toBe(0); // 20 × 0
    expect(a.apexHopUpUnits).toBe(1);
  });
});

describe("buildTakeoff — timber-frame Aspen semi (full line)", () => {
  // Walls chosen so the SEMI per-lift perimeter is exactly 20.83 (18.83 walls + 2 corners).
  const aspen: TakeoffInput = {
    ...base,
    buildSystem: "TIMBER_FRAME",
    config: "SEMI_DETACHED",
    storeys: 2,
    heightToSoffitM: 4.8,
    roofType: "PITCHED",
    cornerCount: 4, // semi → 2 corners
    wallSegments: [
      { position: "front", lengthM: 6.5 },
      { position: "rear", lengthM: 6.5 },
      { position: "gable_left", lengthM: 5.83 }, // the exposed gable
      { position: "gable_right", lengthM: 0 }, // party-wall side
    ],
    apexByFace: { front: 0, rear: 0, left: 1, right: 0, other: 0 },
    floors: [{ level: "GF", m2: 40 }, { level: "FF", m2: 40 }], // present, but ignored on TF
  };

  it("3 lifts, perimeter 20.83, apex 1", () => {
    const t = buildTakeoff(aspen);
    expect(t.buildSystem).toBe("TIMBER_FRAME");
    expect(t.lifts.lifts).toBe(3);
    expect(t.perimeter.perLiftM).toBe(20.83);
    expect(t.apex.count).toBe(1);
  });

  it("NO birdcage even though floor areas were provided", () => {
    const t = buildTakeoff(aspen);
    expect(t.birdcage.floorCount).toBe(0);
    expect(t.birdcage.totalM2).toBe(0);
    expect(t.flags.some((f) => /birdcage/i.test(f))).toBe(false);
  });

  it("adaptions reproduce 62.49 / 41.66 LM + 1 apex unit each (revised email)", () => {
    const t = buildTakeoff(aspen);
    expect(t.adaptions?.adaptionLifts).toBe(3); // 2-storey → 3 adaption lifts
    expect(t.adaptions?.insideBoardLM).toBe(62.49);
    expect(t.adaptions?.hopUpLM).toBe(41.66);
    expect(t.adaptions?.apexInsideBoardUnits).toBe(1);
    expect(t.adaptions?.apexHopUpUnits).toBe(1);
  });

  it("2.5-storey uses 3 adaption lifts (the 1 m lift is excluded), 3-storey uses 4", () => {
    // 2.5-storey: 4 total lifts, but 3 adaption lifts.
    const t25 = buildTakeoff({ ...aspen, storeys: 2.5, heightToSoffitM: 5.5 });
    expect(t25.lifts.lifts).toBe(4); // total lifts
    expect(t25.adaptions?.adaptionLifts).toBe(3); // adaption lifts (1 m lift excluded)
    expect(t25.adaptions?.insideBoardLM).toBe(62.49); // 20.83 × 3
    // 3-storey: 4 total lifts, 4 adaption lifts.
    const t3 = buildTakeoff({ ...aspen, storeys: 3, heightToSoffitM: 6.5 });
    expect(t3.lifts.lifts).toBe(4);
    expect(t3.adaptions?.adaptionLifts).toBe(4);
    expect(t3.adaptions?.insideBoardLM).toBe(83.32); // 20.83 × 4
  });

  it("no party-wall unit on timber frame (Laura's semi line has none)", () => {
    expect(buildTakeoff(aspen).partyWalls).toBe(0);
  });

  it("traditional path still computes birdcage + a party wall (unchanged)", () => {
    const trad = buildTakeoff({ ...aspen, buildSystem: "TRADITIONAL" });
    expect(trad.adaptions).toBeNull();
    expect(trad.birdcage.floorCount).toBe(2);
    expect(trad.partyWalls).toBe(1);
    expect(trad.lifts.lifts).toBe(4); // traditional 2-storey = 4
  });
});


// ---------------------------------------------------------------------------
// Party walls read off the drawing (docs/21 §B2/§B3)
// ---------------------------------------------------------------------------

const W = (position: string, lengthM: number, isPartyWall: boolean | null = null) =>
  ({ position, lengthM, isPartyWall }) as never;

describe("partyGables — reading the party wall off the drawing", () => {
  it("detached: both gables external → 0, nothing unknown", () => {
    const pg = partyGables([W("gable_left", 8, false), W("gable_right", 8, false)]);
    expect(pg).toMatchObject({ left: false, right: false, count: 0, unknown: false });
    expect(configFromPartyGables(pg)).toBe("DETACHED");
  });
  it("semi: one gable is the party wall → 1", () => {
    const pg = partyGables([W("gable_left", 8, true), W("gable_right", 8, false)]);
    expect(pg).toMatchObject({ count: 1, unknown: false });
    expect(configFromPartyGables(pg)).toBe("SEMI_DETACHED");
  });
  it("mid-terrace: both gables are party walls → 2", () => {
    const pg = partyGables([W("gable_left", 8, true), W("gable_right", 8, true)]);
    expect(pg).toMatchObject({ count: 2, unknown: false });
    expect(configFromPartyGables(pg)).toBe("MID_TERRACE");
  });
  it("silent on an unknown gable — never guesses a config", () => {
    const pg = partyGables([W("gable_left", 8, null), W("gable_right", 8, false)]);
    expect(pg.unknown).toBe(true);
    expect(configFromPartyGables(pg)).toBeNull();
  });
  it("a missing gable is unknown, not external", () => {
    expect(partyGables([W("front", 5, false)]).unknown).toBe(true);
  });
});

describe("perimeter keeps the EXPOSED gable, not the longer one", () => {
  // The party wall is the LONGER gable — the old max() heuristic got this backwards.
  const walls = [W("front", 6), W("rear", 6), W("gable_left", 9, true), W("gable_right", 7, false)];
  const base = {
    storeys: 2, roomInRoof: false, heightToSoffitM: 4.8, roofType: "PITCHED" as const,
    wallSegments: walls, cornerCount: 4, dwellingsWide: 1, floors: [],
    apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 0 },
    renderSegmentsM: [], rendered: false, isApartmentBlock: false,
    lowLevelCount: 0, chimney: false,
    config: "SEMI_DETACHED" as const,
  };
  it("drops the party gable (9) and keeps the external one (7)", () => {
    const p = computePerimeter(base, 1);
    expect(p.wallsM).toBe(19); // 6 + 6 + 7
    expect(p.gableBasis).toBe("party");
  });
  it("falls back to the longer gable when the drawing does not say, and says so", () => {
    const unknown = walls.map((w) => ({ ...(w as object), isPartyWall: null })) as never[];
    const p = computePerimeter({ ...base, wallSegments: unknown }, 1);
    expect(p.wallsM).toBe(21); // 6 + 6 + 9 — the old behaviour, preserved
    expect(p.gableBasis).toBe("size");
  });
  it("the fallback is flagged for a human", () => {
    const unknown = walls.map((w) => ({ ...(w as object), isPartyWall: null })) as never[];
    const line = buildTakeoff({ ...base, wallSegments: unknown });
    expect(line.flags.some((f) => /does not say which gable is the party wall/.test(f))).toBe(true);
  });
});

describe("apex on the exposed gable (the hipped-end bug)", () => {
  const mk = (over: Record<string, unknown>) =>
    computeApex({
      storeys: 2, roomInRoof: false, heightToSoffitM: 4.8, roofType: "PITCHED",
      wallSegments: [], cornerCount: 4, dwellingsWide: 1, floors: [],
      apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 0 },
      renderSegmentsM: [], rendered: false, isApartmentBlock: false,
    lowLevelCount: 0, chimney: false,
      config: "SEMI_DETACHED", ...over,
    } as never);

  it("exposed end HIPPED (0) + party end GABLED (1) → 0, not 1", () => {
    const a = mk({
      apexByFace: { front: 0, rear: 0, left: 1, right: 0, other: 0 },
      wallSegments: [W("gable_left", 8, true), W("gable_right", 8, false)],
    });
    expect(a.count).toBe(0); // the apex sits on the party wall — never scaffolded
    expect(a.gableBasis).toBe("party");
  });
  it("exposed end GABLED (1) + party end HIPPED (0) → 1", () => {
    const a = mk({
      apexByFace: { front: 0, rear: 0, left: 0, right: 1, other: 0 },
      wallSegments: [W("gable_left", 8, true), W("gable_right", 8, false)],
    });
    expect(a.count).toBe(1);
  });
  it("unknown party status falls back to the old max() behaviour", () => {
    const a = mk({ apexByFace: { front: 0, rear: 0, left: 1, right: 0, other: 0 } });
    expect(a.count).toBe(1);
    expect(a.gableBasis).toBe("size");
  });
});

describe("'other' faces and walls are no longer silently dropped", () => {
  const base = {
    storeys: 2, roomInRoof: false, heightToSoffitM: 4.8, roofType: "PITCHED" as const,
    wallSegments: [W("front", 6), W("rear", 6), W("other", 2)],
    cornerCount: 4, dwellingsWide: 1, floors: [],
    apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 1 },
    renderSegmentsM: [], rendered: false, isApartmentBlock: false,
    lowLevelCount: 0, chimney: false,
  };
  it("an 'other'-face apex counts on a semi AND a mid (it is not a gable end)", () => {
    expect(computeApex({ ...base, config: "SEMI_DETACHED" } as never).count).toBe(1);
    expect(computeApex({ ...base, config: "MID_TERRACE" } as never).count).toBe(1);
    expect(computeApex({ ...base, config: "DETACHED" } as never).count).toBe(1);
  });
  it("a mid-terrace now INCLUDES its 'other' external wall (was dropped)", () => {
    const p = computePerimeter({ ...base, config: "MID_TERRACE" } as never, 1);
    expect(p.wallsM).toBe(14); // 6 + 6 + 2
    expect(p.irregular).toBe(true); // still flagged for a human
  });
});

describe("the drawing's config vs the chosen config", () => {
  const mk = (config: string, walls: never[]) =>
    buildTakeoff({
      storeys: 2, roomInRoof: false, heightToSoffitM: 4.8, roofType: "PITCHED",
      wallSegments: walls, cornerCount: 4, dwellingsWide: 1, floors: [],
      apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
      renderSegmentsM: [], rendered: false, isApartmentBlock: false,
    lowLevelCount: 0, chimney: false, config,
    } as never);
  const semiWalls = [W("front", 6), W("rear", 6), W("gable_left", 8, true), W("gable_right", 8, false)];

  it("exposes what the drawing implies", () => {
    expect(mk("SEMI_DETACHED", semiWalls as never[]).drawingConfig).toBe("SEMI_DETACHED");
  });
  it("flags a disagreement instead of overriding", () => {
    const line = mk("DETACHED", semiWalls as never[]);
    expect(line.config).toBe("DETACHED"); // the estimator's choice is NOT overridden
    expect(line.flags.some((f) => /party gable wall\(s\)/.test(f))).toBe(true);
  });
  it("does NOT flag semi vs end terrace — they take off identically", () => {
    const line = mk("END_TERRACE", semiWalls as never[]);
    expect(line.flags.some((f) => /party gable wall\(s\)/.test(f))).toBe(false);
  });
});


describe("wall-role swap guard (Miller Delmont, real miss 2026-09-23)", () => {
  const mk = (front: number, gable: number, config: string) =>
    buildTakeoff({
      storeys: 2, roomInRoof: false, heightToSoffitM: 4.65, roofType: "HIPPED",
      wallSegments: [
        W("front", front), W("rear", front),
        W("gable_left", gable), W("gable_right", gable),
      ],
      cornerCount: 4, dwellingsWide: 1, floors: [],
      apexByFace: { front: 0, rear: 0, left: 0, right: 0, other: 0 },
      renderSegmentsM: [], rendered: false, isApartmentBlock: false,
      lowLevelCount: 0, chimney: false, config,
    } as never);
  const swapped = (l: { flags: string[] }) =>
    l.flags.some((f) => /wall roles may be swapped/.test(f));

  it("flags the real Delmont read (front 9.44 wider than gable 4.567)", () => {
    expect(swapped(mk(9.44, 4.567, "MID_TERRACE"))).toBe(true);
  });
  it("does NOT flag the corrected Delmont geometry", () => {
    expect(swapped(mk(4.567, 9.44, "MID_TERRACE"))).toBe(false);
  });
  it("does NOT flag Whitton, which was read correctly (5.766 < 9.103)", () => {
    expect(swapped(mk(5.766, 9.103, "SEMI_DETACHED"))).toBe(false);
  });
  it("never flags a detached house — square footprints are normal there", () => {
    expect(swapped(mk(8.335, 8.203, "DETACHED"))).toBe(false);
  });
  it("corrected roles reproduce Colin's bank LM (mid 9, semi 20.5)", () => {
    expect(mk(4.567, 9.44, "MID_TERRACE").perimeter.perLiftM).toBeCloseTo(9.134, 2);
    expect(mk(4.567, 9.44, "SEMI_DETACHED").perimeter.perLiftM).toBeCloseTo(20.574, 2);
  });
});

/**
 * Attached houses (docs/21 §B6, 2026-09-29). The fixtures are REAL model reads from the
 * stored extractions, graded against Colin's House Take-Offs Bank (data/pricing-data).
 * Before this fix the engine halved a one-house frontage when the model said
 * dwellingsWide 2 (five bank types ~25% under), and priced a Miller type whose plan
 * roles were swapped (~22% over).
 */
describe("resolveFrontage — how many houses the reported frontage spans", () => {
  const semi = (front: number, depth: number, dw: number, extra: Partial<TakeoffInput> = {}) => ({
    ...base,
    dwellingsWide: dw,
    cornerCount: 4,
    wallSegments: [
      { position: "front" as const, lengthM: front },
      { position: "rear" as const, lengthM: front },
      { position: "gable_left" as const, lengthM: depth },
      { position: "gable_right" as const, lengthM: depth },
    ],
    ...extra,
  });

  it("TW Avonsford: one house (4.265) read with dwellingsWide 2 is NOT halved (bank semi 20 / mid 8)", () => {
    const i = semi(4.265, 8.948, 2);
    const s = computePerimeter({ ...i, config: "SEMI_DETACHED" }, 1);
    expect(s.frontage.divisor).toBe(1);
    expect(s.frontage.basis).toBe("physical-minimum");
    expect(s.frontage.blockDrawn).toBe(false);
    expect(s.perLiftM).toBe(19.478); // was 15.21 (halved)
    expect(computePerimeter({ ...i, config: "MID_TERRACE" }, 1).perLiftM).toBe(8.53); // was 4.26
  });

  it("Vistry Jackdaw / TW Eynsford reproduce Colin's semi + mid (23 / 11)", () => {
    const jd = semi(5.5638, 9.7775, 2);
    expect(computePerimeter({ ...jd, config: "SEMI_DETACHED" }, 1).perLiftM).toBe(22.905);
    expect(computePerimeter({ ...jd, config: "MID_TERRACE" }, 1).perLiftM).toBe(11.128);
    const ey = semi(5.7275, 9.5025, 2);
    expect(computePerimeter({ ...ey, config: "SEMI_DETACHED" }, 1).perLiftM).toBe(22.958);
    expect(computePerimeter({ ...ey, config: "MID_TERRACE" }, 1).perLiftM).toBe(11.455);
  });

  it("a real pair frontage is still divided (Bloor Sinclair 9.406 over 2 → bank semi 20 / mid 9)", () => {
    const i = semi(9.406, 8.757, 2);
    const s = computePerimeter({ ...i, config: "SEMI_DETACHED" }, 1);
    expect(s.frontage.divisor).toBe(2);
    expect(s.frontage.basis).toBe("declared");
    expect(s.frontage.blockDrawn).toBe(true);
    expect(s.perLiftM).toBe(20.163);
    expect(computePerimeter({ ...i, config: "MID_TERRACE" }, 1).perLiftM).toBe(9.406);
  });

  it("the birdcage width CROSS-CHECKS the frame but never re-frames it (the SM1 trap)", () => {
    // A whole-pair birdcage (14.073 m wide) next to a correctly-read pair frontage:
    // trusting the birdcage would re-frame the frontage to one house = the SM1 bug.
    const sm1 = computePerimeter(
      { ...semi(14.727, 8.224, 2), houseInternalWidthM: 14.073, houseInternalWidthSingleRect: true, config: "SEMI_DETACHED" },
      1,
    );
    expect(sm1.frontage.divisor).toBe(2);
    expect(sm1.frontage.birdcageMismatch).toBe(true);
    expect(sm1.frontage.note).toMatch(/NARROWER than its own internal birdcage width/);
    // Dekker read as one house by mistake: flagged, not silently re-divided.
    const dk = computePerimeter(
      { ...semi(10.66, 7.904, 1), houseInternalWidthM: 4.877, houseInternalWidthSingleRect: true, config: "SEMI_DETACHED" },
      1,
    );
    expect(dk.frontage.divisor).toBe(1);
    expect(dk.frontage.birdcageMismatch).toBe(true);
    // Consistent reads raise nothing.
    const ok = computePerimeter(
      { ...semi(10.66, 7.904, 2), houseInternalWidthM: 4.877, houseInternalWidthSingleRect: true, config: "SEMI_DETACHED" },
      1,
    );
    expect(ok.frontage.birdcageMismatch).toBe(false);
    expect(ok.frontage.note).toBeNull();
  });

  it("an apartment block is never divided", () => {
    const r = computePerimeter({ ...semi(16, 9, 3), isApartmentBlock: true, config: "DETACHED" }, 1);
    expect(r.frontage.divisor).toBe(1);
  });
});

describe("whole-pair drawings — the gables are the block's OUTER ends (Dekker)", () => {
  // The model reads a pair drawing correctly: full frontage over 2, and both end
  // gables EXTERNAL (the party wall is the central 302, inside the block).
  const dekker: TakeoffInput = {
    ...base,
    storeys: 2,
    heightToSoffitM: 4.725,
    roofType: "PITCHED",
    dwellingsWide: 2,
    cornerCount: 4,
    wallSegments: [
      { position: "front", lengthM: 10.66, isPartyWall: false },
      { position: "rear", lengthM: 10.66, isPartyWall: false },
      { position: "gable_left", lengthM: 7.904, isPartyWall: false },
      { position: "gable_right", lengthM: 7.904, isPartyWall: false },
    ],
    apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
    floors: [
      { level: "GF", m2: 35.602 },
      { level: "FF", m2: 35.602 },
    ],
  };
  it("semi 20.56 / mid 10.66 with NO false flags", () => {
    const s = buildTakeoff({ ...dekker, config: "SEMI_DETACHED" });
    expect(s.perimeter.perLiftM).toBe(20.564);
    expect(s.perimeter.gableBasis).toBe("block-end");
    expect(s.apex.count).toBe(1);
    expect(s.apex.gableBasis).toBe("block-end");
    expect(s.drawingConfig).toBeNull(); // not "0 party gables → DETACHED"
    expect(s.flags.join(" ")).not.toMatch(/LONGER gable|party gable wall\(s\)|DETACHED/);
    const m = buildTakeoff({ ...dekker, config: "MID_TERRACE" });
    expect(m.perimeter.perLiftM).toBe(10.66);
    expect(m.apex.count).toBe(0);
  });
  it("the birdcage is the same one house whatever the configuration (Colin: 35.6 semi AND mid)", () => {
    expect(buildTakeoff({ ...dekker, config: "SEMI_DETACHED" }).birdcage.totalM2).toBe(71.204);
    expect(buildTakeoff({ ...dekker, config: "MID_TERRACE" }).birdcage.totalM2).toBe(71.204);
  });
  it("a block whose two ends differ flags which end the plot is", () => {
    const t = buildTakeoff({
      ...dekker,
      wallSegments: [
        ...dekker.wallSegments.filter((w) => !w.position.startsWith("gable")),
        { position: "gable_left", lengthM: 7.904 },
        { position: "gable_right", lengthM: 9.1 },
      ],
      config: "END_TERRACE",
    });
    expect(t.flags.join(" ")).toMatch(/block's two ends differ/);
  });
});

describe("wall roles follow the PARTY wall (Miller Millfield + Delmont)", () => {
  it("Millfield: the 11.138 m wall read as a party 'front' → roles renamed (bank semi 25)", () => {
    const t = buildTakeoff({
      ...base,
      cornerCount: 4,
      wallSegments: [
        { position: "front", lengthM: 11.138, isPartyWall: true },
        { position: "rear", lengthM: 11.138, isPartyWall: false },
        { position: "gable_left", lengthM: 5.957, isPartyWall: false },
        { position: "gable_right", lengthM: 5.957, isPartyWall: false },
      ],
      config: "SEMI_DETACHED",
    });
    expect(t.perimeter.perLiftM).toBe(25.052); // was 30.233
    expect(t.flags.join(" ")).toMatch(/PARTY wall, but a party wall is always a SIDE wall/);
    expect(t.flags.join(" ")).not.toMatch(/WIDER than the side wall/);
  });
  it("Delmont: semi 20.57 / mid 9.13 once the 9.44 m party wall is a side wall (bank 20.5 / 9)", () => {
    const walls = [
      { position: "front" as const, lengthM: 9.44, isPartyWall: true },
      { position: "rear" as const, lengthM: 9.44 },
      { position: "gable_left" as const, lengthM: 4.567 },
      { position: "gable_right" as const, lengthM: 4.567 },
    ];
    const b = { ...base, cornerCount: 4, wallSegments: walls };
    expect(buildTakeoff({ ...b, config: "SEMI_DETACHED" }).perimeter.perLiftM).toBe(20.574);
    expect(buildTakeoff({ ...b, config: "MID_TERRACE" }).perimeter.perLiftM).toBe(9.134);
  });
  it("never swaps on SHAPE alone — a genuinely wide attached type only flags (Vistry Birchden)", () => {
    const t = buildTakeoff({
      ...base,
      cornerCount: 4,
      wallSegments: [
        { position: "front", lengthM: 9.25 },
        { position: "rear", lengthM: 9.25 },
        { position: "gable_left", lengthM: 6.0, isPartyWall: true },
        { position: "gable_right", lengthM: 6.0, isPartyWall: false },
      ],
      config: "SEMI_DETACHED",
    });
    expect(t.perimeter.perLiftM).toBe(26.5); // Colin's Birchden semi: 26.5
    expect(t.flags.join(" ")).toMatch(/WIDER than the side wall/);
    expect(t.flags.join(" ")).not.toMatch(/always a SIDE wall/);
  });
});

describe("resolveFrontage — an internal dimension read as the wall is flagged", () => {
  it("TW Avonsford: front 3.61 (the 'finished dim') against a 3.61 internal width → flagged", () => {
    const r = computePerimeter(
      {
        ...base,
        wallSegments: [
          { position: "front", lengthM: 3.61 },
          { position: "rear", lengthM: 3.61 },
          { position: "gable_left", lengthM: 9.553, isPartyWall: true },
          { position: "gable_right", lengthM: 9.553, isPartyWall: false },
        ],
        houseInternalWidthM: 3.61,
        houseInternalWidthSingleRect: true,
        config: "SEMI_DETACHED",
      },
      1,
    );
    expect(r.frontage.birdcageMismatch).toBe(true);
    expect(r.frontage.note).toMatch(/INTERNAL dimension was probably read as the front wall/);
    // …and the correct external read (4114 GABLE to C/L) is clean: semi 19.781 (Colin 20).
    const ok = computePerimeter(
      {
        ...base,
        cornerCount: 4,
        wallSegments: [
          { position: "front", lengthM: 4.114 },
          { position: "rear", lengthM: 4.114 },
          { position: "gable_left", lengthM: 9.553, isPartyWall: true },
          { position: "gable_right", lengthM: 9.553, isPartyWall: false },
        ],
        houseInternalWidthM: 3.61,
        houseInternalWidthSingleRect: true,
        config: "SEMI_DETACHED",
      },
      1,
    );
    expect(ok.frontage.birdcageMismatch).toBe(false);
    expect(ok.perLiftM).toBe(19.781);
  });
});

describe("resolveFrontage — a mirrored pair's inside width is fixed by its frontage", () => {
  const pair = (front: number, w: number, t: number | null) =>
    computePerimeter(
      {
        ...base,
        dwellingsWide: 2,
        wallSegments: [
          { position: "front", lengthM: front },
          { position: "rear", lengthM: front },
          { position: "gable_left", lengthM: 8.804 },
          { position: "gable_right", lengthM: 8.804 },
        ],
        houseInternalWidthM: w,
        houseInternalWidthSingleRect: true,
        houseWallThicknessM: t,
        config: "SEMI_DETACHED",
      },
      1,
    ).frontage;
  it("Bloor Byron: a depth-chain room segment (4.407) read as the width is flagged — (10.506 − 3×0.302)/2 = 4.800", () => {
    const f = pair(10.506, 4.407, 0.302);
    expect(f.birdcageMismatch).toBe(true);
    expect(f.note).toMatch(/= 4\.8 m, but the birdcage read 4\.407 m/);
    expect(f.divisor).toBe(2); // the frame itself is untouched
  });
  it("Dekker 4.877, Sinclair 4.25 and Byron's true 4.8 all reconcile exactly", () => {
    expect(pair(10.66, 4.877, 0.302).birdcageMismatch).toBe(false);
    expect(pair(9.406, 4.25, 0.302).birdcageMismatch).toBe(false);
    expect(pair(10.506, 4.8, 0.302).birdcageMismatch).toBe(false);
  });
  it("no wall read → no derivation, no flag", () => {
    expect(pair(10.506, 4.407, null).birdcageMismatch).toBe(false);
  });
});

describe("the engine reports its own working (review screen shows exactly this)", () => {
  // Miller Millfield as read end-to-end (2026-09-29): one house, party wall on gable L,
  // a small entrance gable on the front elevation + a gable on each side face.
  const millfield: TakeoffInput = {
    ...base,
    storeys: 1,
    heightToSoffitM: 2.325,
    roofType: "PITCHED",
    cornerCount: 4,
    wallSegments: [
      { position: "front", lengthM: 5.957, isPartyWall: false },
      { position: "rear", lengthM: 5.957, isPartyWall: false },
      { position: "gable_right", lengthM: 11.138, isPartyWall: false },
      { position: "gable_left", lengthM: 11.138, isPartyWall: true },
    ],
    apexByFace: { front: 1, rear: 0, left: 1, right: 1, other: 0 },
  };
  it("semi: perimeter parts = front + rear + gable R (the party gable L is not in the sum)", () => {
    const t = buildTakeoff({ ...millfield, config: "SEMI_DETACHED" });
    expect(t.perimeter.parts).toEqual([
      { label: "front", lengthM: 5.957 },
      { label: "rear", lengthM: 5.957 },
      { label: "gable R", lengthM: 11.138 },
    ]);
    expect(t.perimeter.corners).toBe(2);
    expect(t.perimeter.cornerAllowanceM).toBe(1);
    expect(t.perimeter.perLiftM).toBe(25.052);
    expect(t.perimeter.totalM).toBe(50.104);
  });
  it("semi: 3 apexes read, 2 priced — gable L dropped as the party wall", () => {
    const t = buildTakeoff({ ...millfield, config: "SEMI_DETACHED" });
    expect(t.apex.count).toBe(2);
    expect(t.apex.faces).toEqual([
      { face: "front", read: 1, priced: 1 },
      { face: "gable L", read: 1, priced: 0, why: "party wall — not scaffolded" },
      { face: "gable R", read: 1, priced: 1 },
    ]);
  });
  it("detached keeps all four walls + every apex; mid keeps front + rear and drops both side apexes", () => {
    const d = buildTakeoff({ ...millfield, config: "DETACHED" });
    expect(d.perimeter.parts.map((p) => p.label)).toEqual(["front", "rear", "gable L", "gable R"]);
    expect(d.apex.faces.every((f) => f.read === f.priced)).toBe(true);
    const m = buildTakeoff({ ...millfield, config: "MID_TERRACE" });
    expect(m.perimeter.parts.map((p) => p.label)).toEqual(["front", "rear"]);
    expect(m.apex.faces.filter((f) => f.why).map((f) => f.face)).toEqual(["gable L", "gable R"]);
  });
  it("a whole-pair drawing shows the division (Dekker 10.66 ÷ 2) and the other end's apex as the neighbour's", () => {
    const t = buildTakeoff({
      ...base,
      dwellingsWide: 2,
      cornerCount: 4,
      wallSegments: [
        { position: "front", lengthM: 10.66 },
        { position: "rear", lengthM: 10.66 },
        { position: "gable_left", lengthM: 7.904 },
        { position: "gable_right", lengthM: 7.904 },
      ],
      apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
      config: "SEMI_DETACHED",
    });
    expect(t.perimeter.parts[0]).toEqual({ label: "front", lengthM: 5.33, dividedFrom: "10.66 ÷ 2" });
    expect(t.apex.faces.find((f) => f.why)?.why).toMatch(/other end of the pair/);
  });
  it("a hipped roof reads apexes as 0 priced, with the reason", () => {
    const t = buildTakeoff({ ...millfield, roofType: "HIPPED", config: "SEMI_DETACHED" });
    expect(t.apex.count).toBe(0);
    expect(t.apex.faces.every((f) => f.priced === 0 && f.why?.startsWith("hipped"))).toBe(true);
  });
});
