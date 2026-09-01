import { describe, it, expect } from "vitest";
import { buildTakeoff, type TakeoffInput } from "@/lib/takeoff/engine";
import { buildRateResolver, priceTakeoffLine, priceTimberFrameLine } from "./engine";
import type { PricedPlot } from "./priceProject";
import { buildClientMatrix, buildInclusions } from "./matrix";

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
  { component: "TABLE_LIFT", action: "ERECT", band: "MEDIUM", rate: 120.0 },
  { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", rate: 40.0 },
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
    storeys: 2,
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
    expect(keys).toContain("tableLifts");
    expect(keys).toContain("apexRails");
    expect(keys).toContain("bcageErectGF");
    expect(keys).toContain("bcageStripTF");
    expect(keys).toContain("dismantle");
    expect(keys).toContain("stage:Plot Erect");
    expect(keys.at(-1)).toBe("total");
    expect(m.columns.find((c) => c.key === "tableLifts")?.header).toBe("Table Lifts to Gables");
    expect(m.columns.find((c) => c.key === "apexRails")?.header).toBe("Apex Guard Rails to Gables");
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
  const TF_RATES = [
    { component: "TF_EXTERNAL", action: "ERECT", band: "MEDIUM", rate: 12.0 },
    { component: "TF_EXTERNAL", action: "DISMANTLE", band: "MEDIUM", rate: 4.0 },
    { component: "ADAPTION", action: "ERECT", band: "MEDIUM", rate: 5.0, liftLevel: 0 },
    { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", rate: 40.0 },
  ];
  const TF_SPLITS = [
    { name: "Plot Erect", percent: 80 },
    { name: "Dismantle", percent: 20 },
  ];
  const tfResolve = buildRateResolver(TF_RATES, "MEDIUM");
  const tfLine = priceTimberFrameLine(buildTakeoff(base), {
    resolveRate: tfResolve,
    stageSplits: TF_SPLITS,
  });
  const tfPlot: PricedPlot = {
    plotId: "tf-1",
    plotNumber: "1",
    houseTypeName: "Ashorn",
    houseTypeCode: "A1",
    configuration: "DETACHED",
    storeys: 2,
    status: "PRICED",
    subtotal: tfLine.subtotal,
    stages: tfLine.stages,
    lines: tfLine.lines,
    unpricedCount: 0,
    hasGarage: false,
  };
  const m = buildClientMatrix([tfPlot], "TIMBER_FRAME");

  it("collapses the envelope into one external-erect column + apex handrails", () => {
    const keys = m.columns.map((c) => c.key);
    expect(keys).toContain("externalErect");
    expect(keys).toContain("apexHandrails");
    expect(keys).toContain("adaption1");
    expect(keys).not.toContain("lift1"); // no per-lift erect columns
    expect(keys).not.toContain("bcageErectGF"); // no birdcage in TF plot rows
    expect(keys).toContain("stage:Plot Erect");
  });

  it("populates external erect, per-lift adaptions, and an 80/20 split", () => {
    const row = m.rows[0];
    // 4 lifts, perimeter/lift = 38.2 m: external = 38.2×4×12 ; adaption/lift = 38.2×5.
    expect(row.cells.externalErect).toBeCloseTo(38.2 * 4 * 12, 2);
    expect(row.cells.adaption1).toBeCloseTo(38.2 * 5, 2);
    expect(row.cells.adaption4).toBeCloseTo(38.2 * 5, 2);
    expect(row.cells.bcageErectGF).toBeUndefined(); // no birdcage on TF
    // cost columns still reconcile to the plot total.
    const costSum = m.columns
      .filter((c) => c.kind === "cost")
      .reduce((a, c) => a + (row.cells[c.key] ?? 0), 0);
    expect(Math.round(costSum * 100)).toBe(Math.round(row.costTotal * 100));
    expect(row.cells["stage:Plot Erect"]).toBeCloseTo(round2(row.costTotal * 0.8), 1);
  });
});

const round2 = (n: number) => Math.round(n * 100) / 100;

describe("standard inclusions (P6) — excluded from every total, listed once", () => {
  // Rates that DO price the inclusion items, so their exclusion is actually tested.
  const RATES_WITH_INCL = [
    ...RATES,
    { component: "LOW_LEVEL", action: "ERECT", band: "MEDIUM", rate: 150.0 },
    { component: "PARTY_WALL", action: "ERECT", band: "MEDIUM", rate: 80.0 },
  ];
  const resolveIncl = buildRateResolver(RATES_WITH_INCL, "MEDIUM");
  const price = (config: TakeoffInput["config"], plotNumber: string): PricedPlot => {
    const result = priceTakeoffLine(buildTakeoff({ ...base, config }), {
      resolveRate: resolveIncl,
      stageSplits: SPLITS,
    });
    return {
      plotId: `p-${plotNumber}`,
      plotNumber,
      houseTypeName: "Wollaton",
      houseTypeCode: "W1",
      configuration: config,
      storeys: 2,
      status: "PRICED",
      subtotal: result.subtotal,
      stages: result.stages,
      lines: result.lines,
      unpricedCount: 0,
      hasGarage: false,
    };
  };

  const plots = [price("DETACHED", "1"), price("SEMI_DETACHED", "2")];

  it("keeps the low-level line priced but OUT of the subtotal", () => {
    const det = plots[0];
    const low = det.lines.find((l) => l.component === "LOW_LEVEL")!;
    expect(low.amount).toBe(150); // still priced (audit)
    expect(low.inclusion).toBe(true);
    // subtotal excludes it: columned lines only.
    const columned = det.lines.filter((l) => !l.inclusion).reduce((a, l) => a + l.amount, 0);
    expect(round2(det.subtotal)).toBe(round2(columned));
  });

  it("stages reconcile to the plot total to the penny (fix #1/#2)", () => {
    for (const p of plots) {
      const stageSum = p.stages.reduce((a, s) => a + s.amount, 0);
      expect(Math.round(stageSum * 100)).toBe(Math.round(p.subtotal * 100));
    }
  });

  it("matrix cost columns, total and grand total all agree (fix #3)", () => {
    const m = buildClientMatrix(plots, "TRADITIONAL");
    for (const row of m.rows) {
      const costSum = m.columns
        .filter((c) => c.kind === "cost")
        .reduce((a, c) => a + (row.cells[c.key] ?? 0), 0);
      expect(Math.round(costSum * 100)).toBe(Math.round(row.costTotal * 100));
      const stageSum = m.columns
        .filter((c) => c.kind === "stage")
        .reduce((a, c) => a + (row.cells[c.key] ?? 0), 0);
      expect(Math.round(stageSum * 100)).toBe(Math.round(row.costTotal * 100));
    }
    const sumTotals = m.rows.reduce((a, r) => a + r.costTotal, 0);
    expect(Math.round(m.grandTotal * 100)).toBe(Math.round(sumTotals * 100));
  });

  it("aggregates the inclusions into one list (fix B)", () => {
    const inc = buildInclusions(plots);
    const low = inc.find((i) => i.component === "LOW_LEVEL")!;
    expect(low.label).toMatch(/low-level/i);
    expect(low.totalQty).toBe(2); // one per plot
    expect(low.plots).toEqual(["1", "2"]);
    const party = inc.find((i) => i.component === "PARTY_WALL")!;
    expect(party.plots).toEqual(["2"]); // only the semi
  });

  it("carries the storey into the matrix row (fix C)", () => {
    const m = buildClientMatrix(plots, "TRADITIONAL");
    expect(m.rows[0].storeys).toBe(2);
  });
});
