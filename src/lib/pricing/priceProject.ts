/**
 * Price a whole development, plot by plot (per-plot pricing at quote time — the
 * confirmed decision). For each plot it runs the measurement engine with THAT
 * plot's configuration + render flag, prices the result, picks the stage split
 * for the house shape, and reconciles to a grand total.
 *
 * Pure + unit-tested. Shared-item apportionment (loading bay / chute / access)
 * and garages are FLAGGED as pending: those items come from the builder profile,
 * which isn't wired into the take-off yet (Phase 4/7).
 */

import { buildTakeoff, DEFAULT_PARAMS, type Configuration } from "@/lib/takeoff/engine";
import { takeoffInputFromStored } from "@/lib/takeoff/fromStored";
import { buildGarageTakeoff, type GarageType } from "@/lib/takeoff/garage";
import {
  buildRateResolver,
  priceTakeoffLine,
  priceTimberFrameLine,
  priceGarageLine,
  type PricedLine,
} from "./engine";

export interface HouseTypeForPricing {
  id: string;
  name: string;
  code: string | null;
  buildType: string | null; // TRADITIONAL | TIMBER_FRAME | null → selects the matrix
  takeoffStatus: string; // DRAFT | IN_REVIEW | CONFIRMED
  measurements: { key: string; valueNumber: number | null }[];
  walls: { position: string; lengthM: number }[];
  warnings: Record<string, unknown>;
}
export interface PlotForPricing {
  id: string;
  plotNumber: string;
  houseTypeId: string;
  configuration: string;
  isRendered: boolean;
  /** Include the party-wall spec item (default true; a customer opt-out sets false). */
  includePartyWall: boolean;
  hasGarage: boolean;
  garageType: string | null;
}
export interface RateItemLite {
  component: string;
  action: string;
  band: string;
  rate: number;
  liftLevel?: number | null;
}
export interface StageSplitLite {
  scenario: string;
  name: string;
  percent: number;
}

export type PlotStatus = "PRICED" | "NOT_CONFIRMED" | "NO_HOUSE_TYPE";

export interface PricedPlot {
  plotId: string;
  plotNumber: string;
  houseTypeName: string;
  houseTypeCode: string | null;
  configuration: string;
  /** Storeys (1 / 2 / 2.5 / 3) — populates the matrix's Storey column. */
  storeys: number | null;
  status: PlotStatus;
  subtotal: number;
  stages: { name: string; percent: number; amount: number }[];
  /** The true-cost priced operations behind this plot (for the quote snapshot). */
  lines: PricedLine[];
  unpricedCount: number;
  hasGarage: boolean;
}

export interface PricedGarage {
  plotId: string;
  plotNumber: string;
  garageType: string;
  subtotal: number;
  stages: { name: string; percent: number; amount: number }[];
  lines: PricedLine[];
  unpricedCount: number;
}

export interface ProjectPricing {
  band: string;
  hasRateCard: boolean;
  plots: PricedPlot[];
  /** Priced garages (own section; docs/15 §6) — folded into the grand total. */
  garages: PricedGarage[];
  grandTotal: number;
  /** Distinct "COMPONENT ACTION" strings that had no rate — surfaced for review. */
  unpricedComponents: string[];
  confirmedCount: number;
  garageCount: number;
  /** Scenarios a plot needed but the rate card didn't define — fell back to STANDARD. */
  missingScenarios: string[];
}

function scenarioFor(storeys: number | null, floorCount: number): string {
  if (floorCount === 0) return "NO_BIRDCAGE";
  if (storeys !== null && storeys <= 1) return "BUNGALOW";
  return "STANDARD";
}

const natural = (a: string, b: string): number => {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
};

export function priceProject(input: {
  houseTypes: HouseTypeForPricing[];
  plots: PlotForPricing[];
  rateItems: RateItemLite[];
  stageSplits: StageSplitLite[];
  band: string;
  /** Build system for the whole tender (project-level — docs/18). Selects the
   *  take-off + pricing logic. Falls back to TRADITIONAL. */
  buildType?: string;
  /** Per-builder storey→lifts template; falls back to the Standard default. */
  storeyLiftTemplate?: Record<string, number>;
}): ProjectPricing {
  const htById = new Map(input.houseTypes.map((h) => [h.id, h]));
  const isTimberFrame = input.buildType === "TIMBER_FRAME";
  const resolve = buildRateResolver(input.rateItems, input.band);
  const params = {
    ...DEFAULT_PARAMS,
    storeyLiftTemplate: input.storeyLiftTemplate ?? DEFAULT_PARAMS.storeyLiftTemplate,
  };
  const missingScenarios = new Set<string>();
  const splitsFor = (scenario: string) => {
    const s = input.stageSplits.filter((x) => x.scenario === scenario);
    if (!s.length && scenario !== "STANDARD") missingScenarios.add(scenario);
    const use = s.length ? s : input.stageSplits.filter((x) => x.scenario === "STANDARD");
    return use.map((x) => ({ name: x.name, percent: x.percent }));
  };

  const plots: PricedPlot[] = [];
  const garages: PricedGarage[] = [];
  const unpriced = new Set<string>();
  let grandTotalPence = 0;
  let confirmedCount = 0;
  let garageCount = 0;

  for (const plot of [...input.plots].sort((a, b) => natural(a.plotNumber, b.plotNumber))) {
    const ht = htById.get(plot.houseTypeId);
    const shell = {
      plotId: plot.id,
      plotNumber: plot.plotNumber,
      houseTypeName: ht?.name ?? "—",
      houseTypeCode: ht?.code ?? null,
      configuration: plot.configuration,
      storeys: null as number | null,
      hasGarage: plot.hasGarage,
      unpricedCount: 0,
      subtotal: 0,
      stages: [] as { name: string; percent: number; amount: number }[],
      lines: [] as PricedLine[],
    };

    if (!ht) {
      plots.push({ ...shell, status: "NO_HOUSE_TYPE" });
      continue;
    }
    if (ht.takeoffStatus !== "CONFIRMED") {
      plots.push({ ...shell, status: "NOT_CONFIRMED" });
      continue;
    }

    const engineInput = takeoffInputFromStored(
      ht.measurements,
      ht.walls,
      ht.warnings,
      plot.configuration as Configuration,
      isTimberFrame ? "TIMBER_FRAME" : "TRADITIONAL",
    );
    // Render is per plot — a non-rendered plot drops the house type's render.
    if (!plot.isRendered) engineInput.renderSegmentsM = [];
    // Party wall is a per-plot spec item — a customer opt-out drops the unit.
    engineInput.includePartyWall = plot.includePartyWall;

    const line = buildTakeoff(engineInput, params);
    // Timber-frame is one 80/20 split; traditional picks by house shape.
    const scenario = isTimberFrame
      ? "TIMBER_FRAME"
      : scenarioFor(engineInput.storeys, line.birdcage.floorCount);
    const priceOpts = { resolveRate: resolve, stageSplits: splitsFor(scenario) };
    const result = isTimberFrame
      ? priceTimberFrameLine(line, priceOpts)
      : priceTakeoffLine(line, priceOpts);
    result.unpriced.forEach((u) => unpriced.add(`${u.component} ${u.action}`));

    confirmedCount += 1;
    if (plot.hasGarage) garageCount += 1;
    grandTotalPence += Math.round(result.subtotal * 100);

    plots.push({
      ...shell,
      status: "PRICED",
      storeys: engineInput.storeys,
      subtotal: result.subtotal,
      stages: result.stages,
      lines: result.lines,
      unpricedCount: result.unpriced.length,
    });

    // Garage — priced as its own section, own split (docs/15 §6). Quantities from
    // the flagged placeholder garage template until Colin's real take-off lands.
    if (plot.hasGarage && plot.garageType) {
      const garageLine = buildGarageTakeoff(plot.garageType as GarageType);
      const garageScenario = garageLine.hasBirdcage ? "GARAGE" : "GARAGE_NO_BCAGE";
      const gResult = priceGarageLine(garageLine, {
        resolveRate: resolve,
        stageSplits: splitsFor(garageScenario),
      });
      gResult.unpriced.forEach((u) => unpriced.add(`${u.component} ${u.action}`));
      grandTotalPence += Math.round(gResult.subtotal * 100);
      garages.push({
        plotId: plot.id,
        plotNumber: plot.plotNumber,
        garageType: plot.garageType,
        subtotal: gResult.subtotal,
        stages: gResult.stages,
        lines: gResult.lines,
        unpricedCount: gResult.unpriced.length,
      });
    }
  }

  return {
    band: input.band,
    hasRateCard: input.rateItems.length > 0,
    plots,
    garages,
    grandTotal: grandTotalPence / 100,
    unpricedComponents: [...unpriced].sort(),
    confirmedCount,
    garageCount,
    missingScenarios: [...missingScenarios].sort(),
  };
}
