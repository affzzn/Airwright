import { describe, it, expect } from "vitest";
import {
  priceProject,
  type HouseTypeForPricing,
  type PlotForPricing,
} from "./priceProject";

const confirmed: HouseTypeForPricing = {
  id: "ht1",
  name: "Rosewood",
  code: null,
  buildType: "TRADITIONAL",
  takeoffStatus: "CONFIRMED",
  measurements: [
    { key: "STOREYS", valueNumber: 2 },
    { key: "HEIGHT_TO_SOFFIT", valueNumber: 4.8 },
    { key: "CORNER_COUNT", valueNumber: 4 },
    { key: "GABLE_QTY", valueNumber: 2 },
    { key: "BIRDCAGE_GF_M2", valueNumber: 40 },
    { key: "BIRDCAGE_FF_M2", valueNumber: 40 },
  ],
  walls: [
    { position: "FRONT", lengthM: 9.2 },
    { position: "REAR", lengthM: 9.2 },
    { position: "GABLE_LEFT", lengthM: 7.9 },
    { position: "GABLE_RIGHT", lengthM: 7.9 },
  ],
  warnings: { roofType: "PITCHED", structure: "SINGLE" },
};
const draft: HouseTypeForPricing = { ...confirmed, id: "ht2", name: "Dekker", takeoffStatus: "IN_REVIEW" };

const plots: PlotForPricing[] = [
  { id: "p1", plotNumber: "1", houseTypeId: "ht1", configuration: "DETACHED", isRendered: false, hasGarage: false, garageType: null },
  { id: "p2", plotNumber: "2", houseTypeId: "ht2", configuration: "DETACHED", isRendered: false, hasGarage: false, garageType: null },
  { id: "p3", plotNumber: "3", houseTypeId: "ht1", configuration: "SEMI_DETACHED", isRendered: false, hasGarage: true, garageType: "SINGLE" },
];

const rateItems = [
  { component: "LIFT", action: "ERECT", band: "MEDIUM", rate: 18.25 },
  { component: "LIFT", action: "DISMANTLE", band: "MEDIUM", rate: 6 },
  { component: "BIRDCAGE_GF", action: "ERECT", band: "MEDIUM", rate: 9 },
  { component: "BIRDCAGE_GF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "BIRDCAGE_FF", action: "ERECT", band: "MEDIUM", rate: 9 },
  { component: "BIRDCAGE_FF", action: "DISMANTLE", band: "MEDIUM", rate: 1.5 },
  { component: "GABLE", action: "ERECT", band: "MEDIUM", rate: 120 },
  { component: "GABLE_RAILS", action: "ERECT", band: "MEDIUM", rate: 40 },
];
const stageSplits = [
  { scenario: "STANDARD", name: "Plot Erect", percent: 50 },
  { scenario: "STANDARD", name: "Birdcage Erect", percent: 25 },
  { scenario: "STANDARD", name: "Dismantle", percent: 25 },
];

describe("priceProject", () => {
  const r = priceProject({ houseTypes: [confirmed, draft], plots, rateItems, stageSplits, band: "MEDIUM" });

  it("prices confirmed plots and skips unconfirmed ones", () => {
    const p1 = r.plots.find((p) => p.plotNumber === "1")!;
    const p2 = r.plots.find((p) => p.plotNumber === "2")!;
    expect(p1.status).toBe("PRICED");
    expect(p1.subtotal).toBeGreaterThan(0);
    expect(p2.status).toBe("NOT_CONFIRMED");
    expect(p2.subtotal).toBe(0);
    expect(r.confirmedCount).toBe(2);
  });

  it("configuration flows through per plot (semi < detached)", () => {
    const detached = r.plots.find((p) => p.plotNumber === "1")!;
    const semi = r.plots.find((p) => p.plotNumber === "3")!;
    expect(semi.subtotal).toBeLessThan(detached.subtotal);
  });

  it("grand total = sum of priced plot subtotals + garages (to the penny)", () => {
    const plotSum = r.plots
      .filter((p) => p.status === "PRICED")
      .reduce((a, p) => a + Math.round(p.subtotal * 100), 0);
    const garageSum = r.garages.reduce((a, g) => a + Math.round(g.subtotal * 100), 0);
    expect(Math.round(r.grandTotal * 100)).toBe(plotSum + garageSum);
  });

  it("each priced plot's stages reconcile to its subtotal", () => {
    for (const p of r.plots.filter((x) => x.status === "PRICED")) {
      const s = p.stages.reduce((a, x) => a + Math.round(x.amount * 100), 0);
      expect(s).toBe(Math.round(p.subtotal * 100));
    }
  });

  it("prices garages as their own section (folded into the grand total)", () => {
    expect(r.garageCount).toBe(1);
    expect(r.garages).toHaveLength(1);
    const g = r.garages[0];
    expect(g.plotNumber).toBe("3");
    expect(g.garageType).toBe("SINGLE");
    expect(g.subtotal).toBeGreaterThan(0);
    // Garage subtotal reconciles to its own stage split.
    const s = g.stages.reduce((a, x) => a + Math.round(x.amount * 100), 0);
    expect(s).toBe(Math.round(g.subtotal * 100));
  });
});
