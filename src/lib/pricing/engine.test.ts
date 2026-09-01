import { describe, it, expect } from "vitest";
import { buildTakeoff, type TakeoffInput } from "@/lib/takeoff/engine";
import { buildRateResolver, priceTakeoffLine } from "./engine";

/**
 * These exercise the pricing engine's arithmetic and the reconciliation
 * invariant. Rates are PLACEHOLDERS — penny-accurate validation against Colin's
 * Oadby matrix waits on his real rate sheet (see engine.ts header).
 */

const base: TakeoffInput = {
  storeys: 2,
  roomInRoof: false,
  heightToSoffitM: 4.8, // → 4 lifts
  roofType: "PITCHED",
  wallSegments: [
    { position: "front", lengthM: 9.2 },
    { position: "rear", lengthM: 9.2 },
    { position: "gable_left", lengthM: 7.9 },
    { position: "gable_right", lengthM: 7.9 },
  ],
  dwellingsWide: 1,
  isApartmentBlock: false,
  cornerCount: 4,
  apexByFace: { front: 0, rear: 0, left: 1, right: 1, other: 0 },
  renderSegmentsM: [],
  floors: [
    { level: "GF", m2: 40 },
    { level: "FF", m2: 40 },
  ],
  lowLevelCount: 1,
  chimney: false,
  config: "DETACHED",
};

const RATES = [
  { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 18.25 },
  { component: "LIFT", action: "DISMANTLE", band: "MEDIUM", rate: 6.0 },
  { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", rate: 9.0 },
  { component: "BIRDCAGE_GF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "BIRDCAGE_FF", action: "ERECT", band: "MEDIUM", rate: 9.0 },
  { component: "BIRDCAGE_FF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "TABLE_LIFT", action: "ERECT", band: "MEDIUM", rate: 120.0 },
  { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", rate: 40.0 },
  { component: "LOW_LEVEL", action: "ERECT", band: "MEDIUM", rate: 150.0 },
  { component: "PARTY_WALL", action: "ERECT", band: "MEDIUM", rate: 165.0 },
];
const SPLITS = [
  { name: "Plot Erect", percent: 50 },
  { name: "Birdcage Erect", percent: 25 },
  { name: "Dismantle", percent: 25 },
];

const resolve = buildRateResolver(RATES, "MEDIUM");

describe("priceTakeoffLine", () => {
  const line = buildTakeoff(base); // detached, 4 lifts
  const result = priceTakeoffLine(line, { resolveRate: resolve, stageSplits: SPLITS });

  it("prices each external lift separately", () => {
    const liftErects = result.lines.filter(
      (l) => l.component === "LIFT" && l.action === "ERECT",
    );
    expect(liftErects).toHaveLength(4);
    // perimeter per lift = walls (34.2) + 4 corners × 1 m = 38.2 m
    expect(liftErects[0].quantity).toBe(38.2);
    expect(liftErects[0].amount).toBe(697.15); // 38.2 × 18.25
  });

  it("erects AND strips a birdcage per floor", () => {
    expect(result.lines.filter((l) => l.component.startsWith("BIRDCAGE"))).toHaveLength(4);
    const gfErect = result.lines.find(
      (l) => l.component === "BIRDCAGE_GF" && l.action === "ERECT",
    );
    expect(gfErect?.amount).toBe(360); // 40 × 9
  });

  it("prices apex as TWO separate client items (table lifts + apex guard rails)", () => {
    // Split 2026-09-01 — table lifts and the guard rails are now their own lines,
    // each quantity = apex count (2). No combined GABLE line on the traditional path.
    expect(result.lines.find((l) => l.component === "TABLE_LIFT" && l.action === "ERECT")?.quantity).toBe(2);
    expect(result.lines.find((l) => l.component === "GABLE_RAILS" && l.action === "ERECT")?.quantity).toBe(2);
    expect(result.lines.find((l) => l.component === "GABLE")).toBeUndefined();
  });

  it("detached has no party-wall line", () => {
    expect(result.lines.find((l) => l.component === "PARTY_WALL")).toBeUndefined();
  });

  it("party wall is a PRICED spec item (not a free inclusion) on a non-detached plot", () => {
    const semi = priceTakeoffLine(buildTakeoff({ ...base, config: "SEMI_DETACHED" }), {
      resolveRate: resolve,
      stageSplits: SPLITS,
    });
    const pw = semi.lines.find((l) => l.component === "PARTY_WALL" && l.action === "ERECT");
    expect(pw?.quantity).toBe(1); // one unit per non-detached house
    expect(pw?.amount).toBe(165); // £165 provisional
    expect(pw?.inclusion).toBe(false); // counts toward the total, not bundled/free

    // Opting out drops the unit AND exactly £165 off the subtotal (nothing else changes).
    const semiNo = priceTakeoffLine(
      buildTakeoff({ ...base, config: "SEMI_DETACHED", includePartyWall: false }),
      { resolveRate: resolve, stageSplits: SPLITS },
    );
    expect(semiNo.lines.find((l) => l.component === "PARTY_WALL")).toBeUndefined();
    expect(Math.round((semi.subtotal - semiNo.subtotal) * 100)).toBe(16500);
  });

  it("stages always reconcile back to the subtotal (to the penny)", () => {
    const sum = result.stages.reduce((a, s) => a + s.amount, 0);
    expect(Math.round(sum * 100)).toBe(Math.round(result.subtotal * 100));
  });

  it("presented stage = subtotal × percent", () => {
    const plotErect = result.stages.find((s) => s.name === "Plot Erect");
    expect(plotErect?.amount).toBe(Math.round(result.subtotal * 0.5 * 100) / 100);
  });

  it("flags components with no rate as unpriced (not silently zero)", () => {
    // No DISMANTLE rate for birdcage strip is present, so those are priced; but
    // remove the LIFT dismantle rate to prove unpriced surfaces.
    const partial = buildRateResolver(
      RATES.filter((r) => !(r.component === "LIFT" && r.action === "DISMANTLE")),
      "MEDIUM",
    );
    const r = priceTakeoffLine(line, { resolveRate: partial, stageSplits: SPLITS });
    expect(r.unpriced).toContainEqual({ component: "LIFT", action: "DISMANTLE" });
    const dismantle = r.lines.find(
      (l) => l.component === "LIFT" && l.action === "DISMANTLE",
    );
    expect(dismantle?.priced).toBe(false);
    expect(dismantle?.amount).toBe(0);
  });

  it("a semi has a smaller perimeter than a detached (config flows through)", () => {
    const semi = priceTakeoffLine(buildTakeoff({ ...base, config: "SEMI_DETACHED" }), {
      resolveRate: resolve,
      stageSplits: SPLITS,
    });
    expect(semi.subtotal).toBeLessThan(result.subtotal);
  });

  it("prices the 1st lift at its own (dearer) rate; upper lifts at the base", () => {
    // Base LIFT ERECT 18.25 + a dearer 1st-lift rate at level 1 (docs/15 P2).
    const perLift = buildRateResolver(
      [
        { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 18.25, liftLevel: 0 },
        { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 21.0, liftLevel: 1 },
      ],
      "MEDIUM",
    );
    const r = priceTakeoffLine(line, { resolveRate: perLift, stageSplits: SPLITS });
    const erects = r.lines.filter((l) => l.component === "LIFT" && l.action === "ERECT");
    expect(erects[0].liftLevel).toBe(1);
    expect(erects[0].rate).toBe(21.0); // 1st lift → level-1 rate
    expect(erects[1].rate).toBe(18.25); // 2nd lift → base rate
    expect(erects[3].rate).toBe(18.25); // 4th lift → base rate (no level-4 entry)
  });

  it("prices birdcage per floor beyond FF (SF/TF get their own component)", () => {
    // A 3-storey with GF/FF/SF floors — SF must map to BIRDCAGE_SF, not fold into FF.
    const line3 = buildTakeoff({
      ...base,
      storeys: 3,
      floors: [
        { level: "GF", m2: 40 },
        { level: "FF", m2: 40 },
        { level: "SF", m2: 40 },
      ],
    });
    const r = priceTakeoffLine(line3, { resolveRate: resolve, stageSplits: SPLITS });
    const sfErect = r.lines.find((l) => l.component === "BIRDCAGE_SF" && l.action === "ERECT");
    expect(sfErect?.quantity).toBe(40);
    // erect + strip for each of the 3 floors = 6 birdcage lines.
    expect(r.lines.filter((l) => l.component.startsWith("BIRDCAGE"))).toHaveLength(6);
  });
});
