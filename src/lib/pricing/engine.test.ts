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
  { component: "GABLE", action: "ERECT", band: "MEDIUM", rate: 120.0 },
  { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", rate: 40.0 },
  { component: "LOW_LEVEL", action: "ERECT", band: "MEDIUM", rate: 150.0 },
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

  it("prices apex as a table lift + apex handrail", () => {
    expect(result.lines.find((l) => l.component === "GABLE")?.quantity).toBe(2);
    expect(result.lines.find((l) => l.component === "GABLE_RAILS")?.quantity).toBe(2);
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
});
