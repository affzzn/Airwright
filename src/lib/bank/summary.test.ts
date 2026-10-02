import { describe, it, expect } from "vitest";
import { summarizeSnapshot } from "./summary";
import type { TakeoffSnapshot } from "./snapshot";

const semi: TakeoffSnapshot = {
  snapshotVersion: 1,
  buildType: "TRADITIONAL",
  configuration: "SEMI_DETACHED",
  includePartyWall: true,
  measurements: { STOREYS: 2, HEIGHT_TO_SOFFIT: 5.2, BIRDCAGE_GF_M2: 35.6, BIRDCAGE_FF_M2: 35.6, CORNER_COUNT: 2 },
  walls: [
    { position: "FRONT", lengthM: 5.082 },
    { position: "REAR", lengthM: 5.082 },
    { position: "GABLE_LEFT", lengthM: 10.003, isPartyWall: true },
    { position: "GABLE_RIGHT", lengthM: 10.003, isPartyWall: false },
  ],
  warnings: { structure: "PAIR", dwellingsWide: 1, roofType: "PITCHED" },
};

describe("summarizeSnapshot (a bank version in Colin's words)", () => {
  it("runs the engine on the stored numbers: perimeter per lift, lifts, birdcage, rounded to 2 dp", () => {
    const s = summarizeSnapshot(semi);
    expect(s.perLiftM).toBe(22.17); // 5.082 + 5.082 + 10.003 + 2 corners × 1 m
    expect(s.lifts).toBe(4);
    expect(s.birdcageFloors).toBe(2);
    expect(s.storeys).toBe(2);
  });

  it("timber frame: no birdcage", () => {
    const s = summarizeSnapshot({ ...semi, buildType: "TIMBER_FRAME" });
    expect(s.birdcageFloors).toBe(0);
  });
});
