import { describe, it, expect } from "vitest";
import {
  buildTakeoff,
  computeApex,
  computeLifts,
  computePerimeter,
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
