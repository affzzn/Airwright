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
 *   - TIMBER_FRAME (docs/18) — external erect (flat) · apex scaffold · apex rails ·
 *     inside-board adaption · hop-up adaption · render/cladding · dismantle · 2 stage
 *     columns · total. NO birdcage, NO party wall.
 *
 * The reconciliation is Colin's: `total = Σ(cost columns)`, and each stage column
 * = total × stage%. This module only RESHAPES already-priced lines into columns —
 * it does no pricing itself, so the numbers can never drift from the engine.
 *
 * NOT here: the granular Operatives / gang-pay matrix (Build 2). See docs/16 §0.
 */

import type { PricedPlot, PricedGarage } from "./priceProject";
import type { PricedLine } from "./engine";
import { isInclusionComponent } from "./engine";

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
  storeys: number | null;
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

// Payment-stage columns render in a fixed order, and their header carries the %
// (both matches Colin's layout and disambiguates the stage "Dismantle 25%" from
// the cost "Dismantle" column). The % is recovered from the first priced row.
const STAGE_ORDER: Record<string, number> = {
  "Plot Erect": 0,
  "Gar Erect": 0,
  "Birdcage Erect": 1,
  Dismantle: 2,
};
interface StageCol {
  name: string;
  header: string;
}
function stageColumnsFrom(
  rows: { subtotal: number; stages: { name: string; amount: number }[] }[],
): StageCol[] {
  const first = rows.find((r) => r.stages.length);
  if (!first) return [];
  const total = first.subtotal || first.stages.reduce((a, s) => a + s.amount, 0);
  return [...first.stages]
    .sort((a, b) => (STAGE_ORDER[a.name] ?? 9) - (STAGE_ORDER[b.name] ?? 9))
    .map((s) => {
      const pct = total > 0 ? Math.round((s.amount / total) * 100) : 0;
      return { name: s.name, header: `${s.name} ${pct}%` };
    });
}

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

function traditionalColumns(stageCols: StageCol[]): MatrixColumn[] {
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Plot", kind: "id" },
    { key: "code", header: "House Type Code", kind: "id" },
    { key: "config", header: "Config", kind: "id" },
    { key: "storey", header: "Storey", kind: "id" },
  ];
  for (const lvl of TRADITIONAL_LIFT_LEVELS)
    cols.push({ key: `lift${lvl}`, header: ORDINAL[lvl], kind: "cost" });
  // Apex split into two client columns (2026-09-01): table lifts and the guard
  // rails are now presented separately. ⚠ Both rates are unconfirmed — Colin.
  cols.push({ key: "tableLifts", header: "Table Lifts to Gables", kind: "cost" });
  cols.push({ key: "apexRails", header: "Apex Guard Rails to Gables", kind: "cost" });
  cols.push({ key: "render", header: "Render Adaptions", kind: "cost" });
  for (const f of FLOORS)
    cols.push({ key: `bcageErect${f}`, header: FLOOR_ERECT_HEADER[f], kind: "cost" });
  for (const f of FLOORS)
    cols.push({ key: `bcageStrip${f}`, header: `Strip ${f} Birdcage`, kind: "cost" });
  cols.push({ key: "partyWall", header: "Party Wall", kind: "cost" });
  cols.push({ key: "dismantle", header: "Dismantle", kind: "cost" });
  for (const s of stageCols) cols.push({ key: `stage:${s.name}`, header: s.header, kind: "stage" });
  cols.push({ key: "total", header: "Erect & Strip Price", kind: "total" });
  return cols;
}

function timberFrameColumns(stageCols: StageCol[]): MatrixColumn[] {
  // docs/18: external erect (flat per-lift) · apex scaffold + rails · the two LM
  // adaptions · render · dismantle. No birdcage, no party wall.
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Plot", kind: "id" },
    { key: "code", header: "House Type Code", kind: "id" },
    { key: "config", header: "Config", kind: "id" },
    { key: "storey", header: "Storey", kind: "id" },
    { key: "externalErect", header: "Erect Timber Frame External", kind: "cost" },
    { key: "apexScaffold", header: "Apex Scaffold", kind: "cost" },
    { key: "apexRails", header: "Apex Rails", kind: "cost" },
    { key: "insideBoard", header: "Inside-Board Adaption", kind: "cost" },
    { key: "hopUp", header: "Hop-Up Adaption", kind: "cost" },
    { key: "render", header: "Render/Cladding Adaption", kind: "cost" },
    { key: "dismantle", header: "Dismantle", kind: "cost" },
  ];
  for (const s of stageCols) cols.push({ key: `stage:${s.name}`, header: s.header, kind: "stage" });
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
  put("tableLifts", sumPence(lines, (l) => l.component === "TABLE_LIFT" && l.action === "ERECT"));
  put("apexRails", sumPence(lines, (l) => l.component === "GABLE_RAILS" && l.action === "ERECT"));
  put("render", sumPence(lines, (l) => l.component === "RENDER_ADAPTION" && l.action === "ERECT"));
  for (const f of FLOORS) {
    put(`bcageErect${f}`, sumPence(lines, (l) => l.component === `BIRDCAGE_${f}` && l.action === "ERECT"));
    put(`bcageStrip${f}`, sumPence(lines, (l) => l.component === `BIRDCAGE_${f}` && l.action === "DISMANTLE"));
  }
  put("partyWall", sumPence(lines, (l) => l.component === "PARTY_WALL" && l.action === "ERECT"));
  // Dismantle = the external scaffold dismantle (the single LIFT DISMANTLE line).
  put("dismantle", sumPence(lines, (l) => l.component === "LIFT" && l.action === "DISMANTLE"));
  return cells;
}

/** Timber-frame (docs/18): external erect + apex scaffold/rails + the two LM
 *  adaptions + render + dismantle. No birdcage, no party wall. */
function timberFrameCells(lines: PricedLine[]): Record<string, number> {
  const cells: Record<string, number> = {};
  const put = (key: string, pence: number) => {
    if (pence !== 0) cells[key] = round2(pence / 100);
  };
  put("externalErect", sumPence(lines, (l) => l.component === "TF_EXTERNAL" && l.action === "ERECT"));
  put("apexScaffold", sumPence(lines, (l) => l.component === "TABLE_LIFT" && l.action === "ERECT"));
  put("apexRails", sumPence(lines, (l) => l.component === "GABLE_RAILS" && l.action === "ERECT"));
  put("insideBoard", sumPence(lines, (l) => l.component === "ADAPTION_INSIDE_BOARD" && l.action === "ERECT"));
  put("hopUp", sumPence(lines, (l) => l.component === "ADAPTION_HOP_UP" && l.action === "ERECT"));
  put("render", sumPence(lines, (l) => l.component === "RENDER_ADAPTION" && l.action === "ERECT"));
  put("dismantle", sumPence(lines, (l) => l.component === "TF_EXTERNAL" && l.action === "DISMANTLE"));
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
  const stageCols = stageColumnsFrom(priced);
  const columns =
    buildType === "TIMBER_FRAME" ? timberFrameColumns(stageCols) : traditionalColumns(stageCols);
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
      storeys: p.storeys,
      cells,
      costTotal: round2(costTotalPence / 100),
    });
    grandPence += costTotalPence;
  }

  return { buildType, columns, rows, grandTotal: round2(grandPence / 100) };
}

// --- Standard inclusions: items the matrix has NO column for ---
// Colin's templates have no low-level / party-wall / chimney column — their cost
// is covered by the rates and they're named in a standard-inclusions list (docs/15
// §3 P6, decision 2026-08-25). So they're EXCLUDED from every total and instead
// listed once here: what's included, and on which plots. Descriptive, not priced.

export interface InclusionItem {
  component: string;
  label: string;
  /** Total count across the development (informational — not a price). */
  totalQty: number;
  /** Plot numbers where the item applies. */
  plots: string[];
}

const INCLUSION_LABEL: Record<string, string> = {
  LOW_LEVEL: "Low-level towers (porch / bay)",
  OTHER: "Chimney scaffold",
};
const INCLUSION_ORDER = ["LOW_LEVEL", "OTHER"];

/**
 * Aggregate raw inclusion entries (component + qty + plot) into the display list,
 * in a stable order. Shared by the live path (`buildInclusions`) and the quote
 * view / export, which read frozen line items rather than PricedPlots.
 */
export function aggregateInclusions(
  entries: { component: string; quantity: number; plotNumber: string }[],
): InclusionItem[] {
  const byComponent = new Map<string, { qty: number; plots: Set<string> }>();
  for (const it of entries) {
    if (!isInclusionComponent(it.component) || it.quantity <= 0) continue;
    const e = byComponent.get(it.component) ?? { qty: 0, plots: new Set<string>() };
    e.qty += it.quantity;
    e.plots.add(it.plotNumber);
    byComponent.set(it.component, e);
  }
  return [...byComponent.entries()]
    .sort((a, b) => (INCLUSION_ORDER.indexOf(a[0]) + 1 || 99) - (INCLUSION_ORDER.indexOf(b[0]) + 1 || 99))
    .map(([component, e]) => ({
      component,
      label: INCLUSION_LABEL[component] ?? component,
      totalQty: round2(e.qty),
      plots: [...e.plots].sort((x, y) => {
        const nx = parseInt(x, 10);
        const ny = parseInt(y, 10);
        if (!Number.isNaN(nx) && !Number.isNaN(ny) && nx !== ny) return nx - ny;
        return x.localeCompare(y);
      }),
    }));
}

/**
 * Aggregate the inclusion lines across a priced development into one list. Empty
 * → no block rendered. (Live path; the quote view builds entries from frozen
 * line items and calls `aggregateInclusions` directly.)
 */
export function buildInclusions(plots: PricedPlot[]): InclusionItem[] {
  const entries: { component: string; quantity: number; plotNumber: string }[] = [];
  for (const p of plots) {
    if (p.status !== "PRICED") continue;
    for (const l of p.lines) {
      if (l.inclusion ?? isInclusionComponent(l.component)) {
        entries.push({ component: l.component, quantity: l.quantity, plotNumber: p.plotNumber });
      }
    }
  }
  return aggregateInclusions(entries);
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

function garageColumns(stageCols: StageCol[]): MatrixColumn[] {
  const cols: MatrixColumn[] = [
    { key: "plot", header: "Garage", kind: "id" },
    { key: "type", header: "Type", kind: "id" },
    { key: "lift1", header: "1st Lift", kind: "cost" },
    { key: "lift2", header: "2nd Lift", kind: "cost" },
    { key: "gableRails", header: "Gable Lift & Rails", kind: "cost" },
    { key: "gfBirdcage", header: "GF Birdcage", kind: "cost" },
    { key: "dismantle", header: "Dismantle", kind: "cost" },
  ];
  for (const s of stageCols) cols.push({ key: `stage:${s.name}`, header: s.header, kind: "stage" });
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
  const columns = garageColumns(stageColumnsFrom(garages));
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
