import { describe, it, expect } from "vitest";
import { buildTakeoff, type TakeoffInput } from "@/lib/takeoff/engine";
import { buildRateResolver, priceTakeoffLine } from "./engine";
import type { PricedPlot } from "./priceProject";
import { buildClientMatrix } from "./matrix";

/**
 * The client matrix is a pure RESHAPE of already-priced lines into Colin's column
 * layout. These lock the two invariants that make it trustworthy: the cost columns
 * sum to the plot total, and per-lift/per-floor lines land in the right columns.
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
  { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 18.25, liftLevel: 0 },
  { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 21.0, liftLevel: 1 },
  { component: "LIFT", action: "DISMANTLE", band: "MEDIUM", rate: 6.0 },
  { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", rate: 9.0 },
  { component: "BIRDCAGE_GF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "BIRDCAGE_FF", action: "ERECT", band: "MEDIUM", rate: 9.0 },
  { component: "BIRDCAGE_FF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "GABLE", action: "ERECT", band: "MEDIUM", rate: 120.0 },
];
const SPLITS = [
  { name: "Plot Erect", percent: 50 },
  { name: "Birdcage Erect", percent: 25 },
  { name: "Dismantle", percent: 25 },
];
const resolve = buildRateResolver(RATES, "MEDIUM");

function pricedPlot(config: TakeoffInput["config"], plotNumber: string): PricedPlot {
  const result = priceTakeoffLine(buildTakeoff({ ...base, config }), {
    resolveRate: resolve,
    stageSplits: SPLITS,
  });
  return {
    plotId: `plot-${plotNumber}`,
    plotNumber,
    houseTypeName: "Wollaton",
    houseTypeCode: "W1",
    configuration: config,
    status: "PRICED",
    subtotal: result.subtotal,
    stages: result.stages,
    lines: result.lines,
    unpricedCount: 0,
    hasGarage: false,
  };
}

describe("buildClientMatrix — Traditional", () => {
  const plots = [pricedPlot("DETACHED", "1"), pricedPlot("SEMI_DETACHED", "2")];
  const m = buildClientMatrix(plots, "TRADITIONAL");

  it("emits the confirmed Traditional column layout", () => {
    const keys = m.columns.map((c) => c.key);
    expect(keys.slice(0, 4)).toEqual(["plot", "code", "config", "storey"]);
    expect(keys).toContain("lift1");
    expect(keys).toContain("lift8");
    expect(keys).toContain("tableGable");
    expect(keys).toContain("bcageErectGF");
    expect(keys).toContain("bcageStripTF");
    expect(keys).toContain("dismantle");
    expect(keys).toContain("stage:Plot Erect");
    expect(keys.at(-1)).toBe("total");
    expect(m.columns.find((c) => c.key === "tableGable")?.header).toBe(
      "Table Lifts & Guard Rails to Gables",
    );
  });

  it("cost columns reconcile to the plot total (to the penny)", () => {
    for (const row of m.rows) {
      const costSum = m.columns
        .filter((c) => c.kind === "cost")
        .reduce((a, c) => a + (row.cells[c.key] ?? 0), 0);
      expect(Math.round(costSum * 100)).toBe(Math.round(row.costTotal * 100));
      const plot = plots.find((p) => p.plotId === row.plotId)!;
      expect(Math.round(row.costTotal * 100)).toBe(Math.round(plot.subtotal * 100));
    }
  });

  it("prices the 1st lift into its own dearer column (per-lift, P2)", () => {
    const det = m.rows.find((r) => r.plotNumber === "1")!;
    // 1st lift = 38.2 m × 21.0 ; 2nd = 38.2 × 18.25 — so lift1 > lift2.
    expect(det.cells.lift1).toBeGreaterThan(det.cells.lift2);
    expect(det.cells.lift1).toBe(802.2); // 38.2 × 21.0
  });

  it("carries the stage columns and reconciles the grand total", () => {
    const det = m.rows.find((r) => r.plotNumber === "1")!;
    expect(det.cells["stage:Plot Erect"]).toBeGreaterThan(0);
    const sumTotals = m.rows.reduce((a, r) => a + r.costTotal, 0);
    expect(Math.round(m.grandTotal * 100)).toBe(Math.round(sumTotals * 100));
  });
});

describe("buildClientMatrix — Timber Frame", () => {
  const m = buildClientMatrix([pricedPlot("DETACHED", "1")], "TIMBER_FRAME");

  it("collapses the envelope into one external-erect column + apex handrails", () => {
    const keys = m.columns.map((c) => c.key);
    expect(keys).toContain("externalErect");
    expect(keys).toContain("apexHandrails");
    expect(keys).toContain("adaption1");
    expect(keys).not.toContain("lift1"); // no per-lift erect columns
    expect(keys).not.toContain("bcageErectGF"); // no birdcage in TF plot rows
    expect(keys).toContain("stage:Plot Erect");
  });

  it("externalErect = sum of all lift erects", () => {
    const row = m.rows[0];
    // 4 lifts: 1st 38.2×21 + three at 38.2×18.25 = 802.2 + 2091.98 (approx)
    expect(row.cells.externalErect).toBeGreaterThan(row.cells.dismantle);
    expect(row.cells.externalErect).toBeCloseTo(802.2 + 3 * 38.2 * 18.25, 2);
  });
});
