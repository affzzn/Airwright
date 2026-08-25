/**
 * The CLIENT pricing matrix (Layer 3, output). Pure + unit-tested. It pivots a
 * priced development (the true-cost `PricedLine[]` per plot from priceProject)
 * into Colin's actual matrix column layout — the format he sends the client and
 * keys into Strike. Two build types = two column sets (docs/15 §3, §7; the exact
 * headers were read verbatim off his real templates, captured in docs/16 §2):
 *
 *   - TRADITIONAL — 27 cols: plot/code/config/storey · per-lift erect 1st…8th ·
 *     table+rails · render · birdcage erect GF→TF · birdcage strip GF→TF ·
 *     dismantle · the 3 payment-stage columns · Erect & Strip total.
 *   - TIMBER_FRAME — 17 cols: single external erect · apex handrails · per-lift
 *     adaptions 1st…6th · render/cladding · dismantle · 2 stage columns · total.
 *
 * The reconciliation is Colin's: `total = Σ(cost columns)`, and each stage column
 * = total × stage%. This module only RESHAPES already-priced lines into columns —
 * it does no pricing itself, so the numbers can never drift from the engine.
 *
 * NOT here: the granular Operatives / gang-pay matrix (Build 2). See docs/16 §0.
 */

import type { PricedPlot, PricedGarage } from "./priceProject";
import type { PricedLine } from "./engine";

export type MatrixBuildType = "TRADITIONAL" | "TIMBER_FRAME";

/** One priced cell (a named column carrying a £ amount, 2 dp). */
export interface MatrixCell {
  key: string; // stable column key (e.g. "lift1", "birdcageErectGF", "stage:Plot Erect")
  amount: number;
}

/** One plot's row in the client matrix — identity + the priced column cells. */
export interface MatrixRow {
  plotId: string;
  plotNumber: string;
  houseTypeName: string;
  houseTypeCode: string | null;
  configuration: string;
  cells: Record<string, number>; // column key → £ amount
  costTotal: number; // Σ cost columns = "Erect & Strip Price" (AA/Q)
}

/** A column definition for rendering (order + header text + whether it's a stage col). */
export interface MatrixColumn {
  key: string;
  header: string;
  kind: "id" | "cost" | "stage" | "total";
}

export interface ClientMatrix {
  buildType: MatrixBuildType;
  columns: MatrixColumn[];
  rows: MatrixRow[];
  /** Σ of every row's costTotal (the plots' Erect & Dismantle price). */
  grandTotal: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const penceOf = (n: number): number => Math.round(n * 100);

// --- Column layouts (headers verbatim from Colin's templates — docs/16 §2) ---

const TRADITIONAL_LIFT_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const ORDINAL = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
const FLOORS = ["GF", "FF", "SF", "TF"] as const;
const FLOOR_ERECT_HEADER: Record<string, string> = {
  GF: "Ground Floor Birdcage",
  FF: "1st Floor Birdcage",
  SF: "2nd Floor Birdcage",
  TF: "3rd Floor Birdcage",
};

function traditionalColumns(stageNames: string[]): MatrixColumn[] {
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Plot", kind: "id" },
    { key: "code", header: "House Type Code", kind: "id" },
    { key: "config", header: "Config", kind: "id" },
    { key: "storey", header: "Storey", kind: "id" },
  ];
  for (const lvl of TRADITIONAL_LIFT_LEVELS)
    cols.push({ key: `lift${lvl}`, header: ORDINAL[lvl], kind: "cost" });
  cols.push({ key: "tableGable", header: "Table Lifts & Guard Rails to Gables", kind: "cost" });
  cols.push({ key: "render", header: "Render Adaptions", kind: "cost" });
  for (const f of FLOORS)
    cols.push({ key: `bcageErect${f}`, header: FLOOR_ERECT_HEADER[f], kind: "cost" });
  for (const f of FLOORS)
    cols.push({ key: `bcageStrip${f}`, header: `Strip ${f} Birdcage`, kind: "cost" });
  cols.push({ key: "dismantle", header: "Dismantle", kind: "cost" });
  for (const s of stageNames) cols.push({ key: `stage:${s}`, header: s, kind: "stage" });
  cols.push({ key: "total", header: "Erect & Strip Price", kind: "total" });
  return cols;
}

const TF_ADAPTION_LEVELS = [1, 2, 3, 4, 5, 6] as const;

function timberFrameColumns(stageNames: string[]): MatrixColumn[] {
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Plot", kind: "id" },
    { key: "code", header: "House Type Code", kind: "id" },
    { key: "config", header: "Config", kind: "id" },
    { key: "storey", header: "Storey", kind: "id" },
    { key: "externalErect", header: "Erect Timber Frame External 2-4 Lifts", kind: "cost" },
    { key: "apexHandrails", header: "Erect Apex Handrails", kind: "cost" },
  ];
  for (const lvl of TF_ADAPTION_LEVELS)
    cols.push({ key: `adaption${lvl}`, header: `Adaption ${ORDINAL[lvl]} Lift`, kind: "cost" });
  cols.push({ key: "render", header: "Render/Cladding Adaption", kind: "cost" });
  cols.push({ key: "dismantle", header: "Dismantle", kind: "cost" });
  for (const s of stageNames) cols.push({ key: `stage:${s}`, header: s, kind: "stage" });
  cols.push({ key: "total", header: "Erect & Strip Price", kind: "total" });
  return cols;
}

// --- Map priced lines → column cells (one build type at a time) ---

/** Sum matching priced lines to pence. */
function sumPence(lines: PricedLine[], match: (l: PricedLine) => boolean): number {
  return lines.filter(match).reduce((a, l) => a + penceOf(l.amount), 0);
}

/** Traditional: external erect goes into per-lift columns; birdcage per floor; etc. */
function traditionalCells(lines: PricedLine[]): Record<string, number> {
  const cells: Record<string, number> = {};
  const put = (key: string, pence: number) => {
    if (pence !== 0) cells[key] = round2(pence / 100);
  };
  // Per-lift erect — one column per level; the resolver already priced each level.
  for (const lvl of TRADITIONAL_LIFT_LEVELS)
    put(`lift${lvl}`, sumPence(lines, (l) => l.component === "LIFT" && l.action === "ERECT" && l.liftLevel === lvl));
  put("tableGable", sumPence(lines, (l) => l.component === "GABLE" && l.action === "ERECT"));
  put("render", sumPence(lines, (l) => l.component === "RENDER_ADAPTION" && l.action === "ERECT"));
  for (const f of FLOORS) {
    put(`bcageErect${f}`, sumPence(lines, (l) => l.component === `BIRDCAGE_${f}` && l.action === "ERECT"));
    put(`bcageStrip${f}`, sumPence(lines, (l) => l.component === `BIRDCAGE_${f}` && l.action === "DISMANTLE"));
  }
  // Dismantle = the external scaffold dismantle (the single LIFT DISMANTLE line).
  put("dismantle", sumPence(lines, (l) => l.component === "LIFT" && l.action === "DISMANTLE"));
  return cells;
}

/** Timber-frame: one external erect, apex handrails, per-lift adaptions, render, dismantle. */
function timberFrameCells(lines: PricedLine[]): Record<string, number> {
  const cells: Record<string, number> = {};
  const put = (key: string, pence: number) => {
    if (pence !== 0) cells[key] = round2(pence / 100);
  };
  // The whole external envelope is one erect column (docs/15 §7); dismantle is one column.
  put("externalErect", sumPence(lines, (l) => l.component === "TF_EXTERNAL" && l.action === "ERECT"));
  put("apexHandrails", sumPence(lines, (l) => l.component === "GABLE_RAILS" && l.action === "ERECT"));
  put("render", sumPence(lines, (l) => l.component === "RENDER_ADAPTION" && l.action === "ERECT"));
  put("dismantle", sumPence(lines, (l) => l.component === "TF_EXTERNAL" && l.action === "DISMANTLE"));
  // Per-lift adaptions (cols G–L) — one column per lift level, priced by priceTimberFrameLine.
  for (const lvl of TF_ADAPTION_LEVELS)
    put(`adaption${lvl}`, sumPence(lines, (l) => l.component === "ADAPTION" && l.action === "ERECT" && l.liftLevel === lvl));
  return cells;
}

/**
 * Build the client matrix for one build type. `stageNames` come from the priced
 * plots' stage split (already scenario-correct). Cost columns are pivoted from
 * each plot's priced lines; stage columns are copied from the plot's stage split;
 * the total is Σ(cost columns) — and it equals the plot subtotal to the penny.
 */
export function buildClientMatrix(
  plots: PricedPlot[],
  buildType: MatrixBuildType = "TRADITIONAL",
): ClientMatrix {
  const priced = plots.filter((p) => p.status === "PRICED");
  const stageNames = priced.find((p) => p.stages.length)?.stages.map((s) => s.name) ?? [];
  const columns =
    buildType === "TIMBER_FRAME" ? timberFrameColumns(stageNames) : traditionalColumns(stageNames);
  const cellsFor = buildType === "TIMBER_FRAME" ? timberFrameCells : traditionalCells;

  const rows: MatrixRow[] = [];
  let grandPence = 0;
  for (const p of priced) {
    const costCells = cellsFor(p.lines);
    const costTotalPence = Object.values(costCells).reduce((a, v) => a + penceOf(v), 0);
    // Stage columns are the presented payment split (a share of the total).
    const cells: Record<string, number> = { ...costCells };
    for (const s of p.stages) cells[`stage:${s.name}`] = s.amount;
    rows.push({
      plotId: p.plotId,
      plotNumber: p.plotNumber,
      houseTypeName: p.houseTypeName,
      houseTypeCode: p.houseTypeCode,
      configuration: p.configuration,
      cells,
      costTotal: round2(costTotalPence / 100),
    });
    grandPence += costTotalPence;
  }

  return { buildType, columns, rows, grandTotal: round2(grandPence / 100) };
}

// --- Garages: a separate priced section (docs/15 §6, docs/16 §2) ---

export interface GarageMatrixRow {
  plotNumber: string;
  garageType: string;
  cells: Record<string, number>;
  costTotal: number; // Σ cost columns = the garage Total Price
}
export interface GarageMatrix {
  columns: MatrixColumn[];
  rows: GarageMatrixRow[];
  total: number;
}

const GARAGE_TYPE_LABEL: Record<string, string> = {
  SINGLE: "Single",
  TWIN: "Twin",
  CAR_PORT: "Car Port",
};

function garageColumns(stageNames: string[]): MatrixColumn[] {
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Garage", kind: "id" },
    { key: "type", header: "Type", kind: "id" },
    { key: "lift1", header: "1st Lift", kind: "cost" },
    { key: "lift2", header: "2nd Lift", kind: "cost" },
    { key: "gableRails", header: "Gable Lift & Rails", kind: "cost" },
    { key: "gfBirdcage", header: "GF Birdcage", kind: "cost" },
    { key: "dismantle", header: "Dismantle", kind: "cost" },
  ];
  for (const s of stageNames) cols.push({ key: `stage:${s}`, header: s, kind: "stage" });
  cols.push({ key: "total", header: "Total Price", kind: "total" });
  return cols;
}

/** One garage's cost cells. The Dismantle column folds the external dismantle AND
 * the birdcage strip (Colin's garage block has a single Dismantle column). */
function garageCells(lines: PricedLine[]): Record<string, number> {
  const cells: Record<string, number> = {};
  const put = (key: string, pence: number) => {
    if (pence !== 0) cells[key] = round2(pence / 100);
  };
  put("lift1", sumPence(lines, (l) => l.component === "LIFT" && l.action === "ERECT" && l.liftLevel === 1));
  put("lift2", sumPence(lines, (l) => l.component === "LIFT" && l.action === "ERECT" && l.liftLevel === 2));
  put("gableRails", sumPence(lines, (l) => l.component === "GABLE" && l.action === "ERECT"));
  put("gfBirdcage", sumPence(lines, (l) => l.component === "BIRDCAGE_GF" && l.action === "ERECT"));
  put(
    "dismantle",
    sumPence(lines, (l) => l.action === "DISMANTLE" && (l.component === "LIFT" || l.component === "BIRDCAGE_GF")),
  );
  return cells;
}

/** Build the garages block. Reconciles the same way: total = Σ cost columns. */
export function buildGarageMatrix(garages: PricedGarage[]): GarageMatrix {
  const stageNames = garages.find((g) => g.stages.length)?.stages.map((s) => s.name) ?? [];
  const columns = garageColumns(stageNames);
  const rows: GarageMatrixRow[] = [];
  let totalPence = 0;
  for (const g of garages) {
    const costCells = garageCells(g.lines);
    const costTotalPence = Object.values(costCells).reduce((a, v) => a + penceOf(v), 0);
    const cells: Record<string, number> = { ...costCells };
    for (const s of g.stages) cells[`stage:${s.name}`] = s.amount;
    rows.push({
      plotNumber: g.plotNumber,
      garageType: GARAGE_TYPE_LABEL[g.garageType] ?? g.garageType,
      cells,
      costTotal: round2(costTotalPence / 100),
    });
    totalPence += costTotalPence;
  }
  return { columns, rows, total: round2(totalPence / 100) };
}
