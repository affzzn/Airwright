import { describe, it, expect } from "vitest";
import { buildGarageTakeoff } from "@/lib/takeoff/garage";
import { buildRateResolver, priceGarageLine } from "./engine";
import { buildGarageMatrix } from "./matrix";
import type { PricedGarage } from "./priceProject";

/**
 * Garages are a separate priced section (docs/15 §6). Quantities are flagged
 * placeholders (no extracted geometry); these lock the mechanism + reconciliation.
 */

const RATES = [
  { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 18.25 },
  { component: "LIFT", action: "DISMANTLE", band: "MEDIUM", rate: 6.0 },
  { component: "GABLE", action: "ERECT", band: "MEDIUM", rate: 120.0 },
  { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", rate: 9.0 },
  { component: "BIRDCAGE_GF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
];
const GARAGE_SPLITS = [
  { name: "Gar Erect", percent: 65 },
  { name: "Birdcage Erect", percent: 10 },
  { name: "Dismantle", percent: 25 },
];
const resolve = buildRateResolver(RATES, "MEDIUM");

describe("garage take-off + pricing", () => {
  it("flags that quantities are placeholders", () => {
    const line = buildGarageTakeoff("SINGLE");
    expect(line.flags.join(" ")).toMatch(/PLACEHOLDER/i);
    expect(line.lifts).toBe(2);
    expect(line.hasBirdcage).toBe(true);
  });

  it("prices per-lift erect + gable + GF birdcage + dismantle; stages reconcile", () => {
    const result = priceGarageLine(buildGarageTakeoff("SINGLE"), {
      resolveRate: resolve,
      stageSplits: GARAGE_SPLITS,
    });
    expect(result.lines.filter((l) => l.component === "LIFT" && l.action === "ERECT")).toHaveLength(2);
    expect(result.subtotal).toBeGreaterThan(0);
    const staged = result.stages.reduce((a, s) => a + Math.round(s.amount * 100), 0);
    expect(staged).toBe(Math.round(result.subtotal * 100));
  });

  it("a car port has no birdcage line", () => {
    const result = priceGarageLine(buildGarageTakeoff("CAR_PORT"), {
      resolveRate: resolve,
      stageSplits: GARAGE_SPLITS,
    });
    expect(result.lines.some((l) => l.component === "BIRDCAGE_GF")).toBe(false);
  });
});

describe("buildGarageMatrix", () => {
  const g: PricedGarage = (() => {
    const r = priceGarageLine(buildGarageTakeoff("TWIN"), { resolveRate: resolve, stageSplits: GARAGE_SPLITS });
    return {
      plotId: "p1",
      plotNumber: "12",
      garageType: "TWIN",
      subtotal: r.subtotal,
      stages: r.stages,
      lines: r.lines,
      unpricedCount: 0,
    };
  })();
  const m = buildGarageMatrix([g]);

  it("emits Colin's garage columns and reconciles to the total", () => {
    const keys = m.columns.map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(["plot", "type", "lift1", "lift2", "gableRails", "gfBirdcage", "dismantle", "total"]),
    );
    const row = m.rows[0];
    expect(row.garageType).toBe("Twin");
    const costSum = m.columns
      .filter((c) => c.kind === "cost")
      .reduce((a, c) => a + (row.cells[c.key] ?? 0), 0);
    expect(Math.round(costSum * 100)).toBe(Math.round(row.costTotal * 100));
    expect(Math.round(m.total * 100)).toBe(Math.round(g.subtotal * 100));
  });

  it("folds the birdcage strip into the single Dismantle column", () => {
    const row = m.rows[0];
    // dismantle = external LIFT dismantle + GF birdcage strip.
    const line = priceGarageLine(buildGarageTakeoff("TWIN"), { resolveRate: resolve, stageSplits: GARAGE_SPLITS });
    const extDismantle = line.lines.find((l) => l.component === "LIFT" && l.action === "DISMANTLE")!.amount;
    const strip = line.lines.find((l) => l.component === "BIRDCAGE_GF" && l.action === "DISMANTLE")!.amount;
    expect(row.cells.dismantle).toBeCloseTo(extDismantle + strip, 2);
  });
});
