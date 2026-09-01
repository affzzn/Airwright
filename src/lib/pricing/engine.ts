/**
 * The deterministic pricing engine (pure, unit-tested). It turns ONE
 * configuration's take-off line (from src/lib/takeoff/engine.ts) plus a rate
 * lookup into priced line items, a plot subtotal, and the payment-stage split.
 *
 * Two concepts kept separate (a hard requirement from the checklist §9):
 *   - the TRUE item cost   → `lines[].amount`, summing to `subtotal`;
 *   - the PRESENTED stage   → `stages[].amount` = subtotal × stage%.
 * The matrix shows the stage split; the real per-item cost is what actually adds
 * up. Never let one overwrite the other.
 *
 * Money is handled in integer PENCE internally so totals reconcile to the penny;
 * `amount`/`subtotal` are returned in pounds (2 dp). Persistence (Phase 5) writes
 * Decimals.
 *
 * ⚠ The operation → rate-component MAPPING below is Innate's best reading of
 * Colin's matrix and must be confirmed against his rate sheet. Every mapping
 * choice is marked; nothing here is a settled rule until the rate sheet lands.
 */

import type { TakeoffLine } from "@/lib/takeoff/engine";
import type { GarageLine } from "@/lib/takeoff/garage";

export type Action = "ERECT" | "DISMANTLE";

export interface PricedLine {
  component: string;
  action: Action;
  liftLevel: number | null;
  quantity: number;
  unit: string;
  rate: number; // £ per unit (0 when unpriced)
  amount: number; // £, 2 dp
  priced: boolean; // false when no rate was found for this component/action/band
  /**
   * True for items Colin's client matrix has NO column for — low level, party
   * wall, chimney. In his files these are covered by a "standard inclusions" list
   * (their cost is inside the rates), so they are EXCLUDED from the plot subtotal,
   * the stage split and the grand total (docs/15 §3 P6, decision 2026-08-25). They
   * are still carried here (and in the Line-items audit) so the inclusions list can
   * name them. When Colin's rate sheet confirms the bundling this stays; if he ever
   * wants one priced as an extra, drop it from INCLUSION_COMPONENTS.
   */
  inclusion?: boolean;
  note?: string;
}

/** Components the client matrix has no column for — listed as standard inclusions. */
export const INCLUSION_COMPONENTS = new Set(["LOW_LEVEL", "PARTY_WALL", "OTHER"]);
export const isInclusionComponent = (component: string): boolean =>
  INCLUSION_COMPONENTS.has(component);

/** Σ of the COLUMNED lines (pence) — inclusions are excluded from every total. */
const columnedSubtotalPence = (lines: PricedLine[]): number =>
  lines.reduce((a, l) => (l.inclusion ? a : a + Math.round(l.amount * 100)), 0);

export interface StageAmount {
  name: string;
  percent: number;
  amount: number; // £, 2 dp
}

export interface PriceResult {
  lines: PricedLine[];
  subtotal: number; // £, 2 dp
  stages: StageAmount[];
  /** Components with no matching rate — priced at £0 and surfaced for review. */
  unpriced: { component: string; action: Action }[];
}

/**
 * Resolve the £/unit rate for a component + action (already scoped to a band),
 * optionally for a specific lift level. `liftLevel` 1..8 asks for that level's
 * rate; null/0/undefined asks for the base rate (upper lifts + non-lift items).
 */
export type RateResolver = (
  component: string,
  action: Action,
  liftLevel?: number | null,
) => number | null;

/**
 * Build a rate resolver from a rate card's items, scoped to one band. Per-lift
 * pricing (docs/15 P2): an item's `liftLevel` (default 0) is the level it prices;
 * 0 is the BASE rate. Lookup for a given level tries the exact level, then the
 * base — so a sparse card (just a base rate, or base + a dearer 1st lift) prices.
 */
export function buildRateResolver(
  items: {
    component: string;
    action: string;
    band: string;
    rate: number;
    liftLevel?: number | null;
  }[],
  band: string,
): RateResolver {
  const map = new Map<string, number>(); // `component|action|level` → rate
  for (const it of items) {
    if (it.band !== band) continue;
    map.set(`${it.component}|${it.action}|${it.liftLevel ?? 0}`, it.rate);
  }
  return (component, action, liftLevel) => {
    const lvl = liftLevel ?? 0;
    if (lvl > 0) {
      const exact = map.get(`${component}|${action}|${lvl}`);
      if (exact !== undefined) return exact;
    }
    return map.get(`${component}|${action}|0`) ?? null;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface PriceOpts {
  resolveRate: RateResolver;
  stageSplits: { name: string; percent: number }[];
}

/**
 * Price one configuration's take-off line. `line` is the output of
 * `buildTakeoff(...)` for the plot's configuration.
 */
export function priceTakeoffLine(line: TakeoffLine, opts: PriceOpts): PriceResult {
  const lines: PricedLine[] = [];
  const unpriced: { component: string; action: Action }[] = [];

  // Records one operation. rate missing → amount 0 and flagged for review.
  const add = (
    component: string,
    action: Action,
    quantity: number,
    unit: string,
    liftLevel: number | null = null,
    note?: string,
  ) => {
    if (quantity <= 0) return;
    const rate = opts.resolveRate(component, action, liftLevel);
    const priced = rate !== null;
    const pence = priced ? Math.round(quantity * (rate as number) * 100) : 0;
    if (!priced) unpriced.push({ component, action });
    lines.push({
      component,
      action,
      liftLevel,
      quantity: round2(quantity),
      unit,
      rate: rate ?? 0,
      amount: pence / 100,
      priced,
      inclusion: isInclusionComponent(component),
      note,
    });
  };

  // --- External scaffold: one ERECT line per lift, one DISMANTLE line total ---
  // ⚠ MAPPING: external perimeter priced as LIFT × LM, per lift. Colin's matrix
  // has separate 1st..8th columns (often a higher base lift) — confirm.
  const lifts = line.lifts.lifts ?? 0;
  const perLift = line.perimeter.perLiftM;
  for (let lvl = 1; lvl <= lifts; lvl++) {
    add("LIFT", "ERECT", perLift, "LM", lvl);
  }
  if (lifts > 0) add("LIFT", "DISMANTLE", round2(perLift * lifts), "LM", null, "external dismantle");

  // --- Birdcage: erect + strip per floor (GF / FF / SF / TF — matrix cols O–V) ---
  for (const f of line.birdcage.floors) {
    const component = `BIRDCAGE_${f.level}`; // BIRDCAGE_GF | _FF | _SF | _TF
    add(component, "ERECT", f.m2, "M2", null, `${f.level} birdcage`);
    add(component, "DISMANTLE", f.m2, "M2", null, `strip ${f.level} birdcage`);
  }

  // --- Apex: TWO separate client items — table lifts + apex guard rails (split
  //     2026-09-01). Colin's original client matrix had ONE column M "Table Lifts
  //     & Guard Rails to Gables" (docs/15 §3, P4); we now present the rails as
  //     their own line/column. `computeApex` already returns tableLifts and
  //     handrails separately (both == apex count for a traditional build).
  //     ⚠ RATES: splitting the one combined column into two needs a SEPARATE rate
  //     for each — BOTH are unconfirmed and MUST come from Colin's rate sheet
  //     (docs/15 §11). Until then each resolves independently and, if no rate is
  //     set, surfaces in `unpriced` (priced at £0, never silently guessed). ---
  if (line.apex.tableLifts > 0)
    add("TABLE_LIFT", "ERECT", line.apex.tableLifts, "EACH", null, "table lifts to gables");
  if (line.apex.handrails > 0)
    add("GABLE_RAILS", "ERECT", line.apex.handrails, "EACH", null, "apex guard rails");

  // --- Render adaption: rendered LM × render lifts ---
  if (line.render && line.render.lifts) {
    add(
      "RENDER_ADAPTION",
      "ERECT",
      round2(line.render.lengthM * line.render.lifts),
      "LM",
      null,
      `render ${line.render.lengthM} m × ${line.render.lifts} lifts`,
    );
  }

  // --- Low level, party walls, chimney ---
  if (line.lowLevel > 0) add("LOW_LEVEL", "ERECT", line.lowLevel, "EACH");
  if (line.partyWalls > 0) add("PARTY_WALL", "ERECT", line.partyWalls, "EACH");
  if (line.chimney) add("OTHER", "ERECT", 1, "EACH", null, "chimney scaffold"); // ⚠ no CHIMNEY enum

  // --- Subtotal (pence, then pounds) ---
  const subtotalPence = columnedSubtotalPence(lines);

  // --- Stage split: presented as a % of the subtotal (NOT the item costs). ---
  // Rounded to the penny with the remainder on the last stage, so the stages
  // always reconcile back to the subtotal exactly.
  const stages = allocateStages(subtotalPence, opts.stageSplits);

  return { lines, subtotal: subtotalPence / 100, stages, unpriced };
}

/** Allocate a subtotal (pence) across stage %s, remainder to the last stage. */
function allocateStages(
  subtotalPence: number,
  stageSplits: { name: string; percent: number }[],
): StageAmount[] {
  const stages: StageAmount[] = [];
  let allocated = 0;
  stageSplits.forEach((s, i) => {
    const isLast = i === stageSplits.length - 1;
    const pence = isLast ? subtotalPence - allocated : Math.round((subtotalPence * s.percent) / 100);
    allocated += pence;
    stages.push({ name: s.name, percent: s.percent, amount: pence / 100 });
  });
  return stages;
}

/**
 * Price a TIMBER-FRAME house type (docs/15 §7). The frame contractor's own
 * scaffold is ADAPTED as it rises, so the client matrix is a single external
 * erect + apex handrails + per-lift adaptions + render + dismantle, with an 80/20
 * split and NO birdcage stage. The take-off line is the same; only the priced
 * operation set + columns differ.
 *
 * ⚠ MAPPING (rates open — docs/15 §11.7): external erect + dismantle priced on the
 * total external LM; each adaption on the per-lift LM. Confirm quantities/£ with Colin.
 */
export function priceTimberFrameLine(line: TakeoffLine, opts: PriceOpts): PriceResult {
  const lines: PricedLine[] = [];
  const unpriced: { component: string; action: Action }[] = [];
  const add = (
    component: string,
    action: Action,
    quantity: number,
    unit: string,
    liftLevel: number | null = null,
    note?: string,
  ) => {
    if (quantity <= 0) return;
    const rate = opts.resolveRate(component, action, liftLevel);
    const priced = rate !== null;
    const pence = priced ? Math.round(quantity * (rate as number) * 100) : 0;
    if (!priced) unpriced.push({ component, action });
    lines.push({
      component,
      action,
      liftLevel,
      quantity: round2(quantity),
      unit,
      rate: rate ?? 0,
      amount: pence / 100,
      priced,
      inclusion: isInclusionComponent(component),
      note,
    });
  };

  const lifts = line.lifts.lifts ?? 0;
  const perLift = line.perimeter.perLiftM;
  const totalExternal = round2(perLift * lifts);

  // One external erect for the whole envelope (matrix col E).
  add("TF_EXTERNAL", "ERECT", totalExternal, "LM", 0, "erect timber-frame external");
  // Apex handrails — TF has handrails, not table lifts (matrix col F).
  if (line.apex.count > 0) add("GABLE_RAILS", "ERECT", line.apex.count, "EACH", null, "apex handrails");
  // Per-lift adaptions as the frame rises (matrix cols G–L; up to 6).
  for (let lvl = 1; lvl <= Math.min(lifts, 6); lvl++)
    add("ADAPTION", "ERECT", perLift, "LM", lvl, `adaption lift ${lvl}`);
  // Render / cladding adaption (matrix col M).
  if (line.render && line.render.lifts)
    add(
      "RENDER_ADAPTION",
      "ERECT",
      round2(line.render.lengthM * line.render.lifts),
      "LM",
      null,
      `render ${line.render.lengthM} m × ${line.render.lifts} lifts`,
    );
  // Single external dismantle (matrix col N). No birdcage in the TF plot matrix.
  if (totalExternal > 0) add("TF_EXTERNAL", "DISMANTLE", totalExternal, "LM", null, "dismantle");

  const subtotalPence = columnedSubtotalPence(lines);
  return {
    lines,
    subtotal: subtotalPence / 100,
    stages: allocateStages(subtotalPence, opts.stageSplits),
    unpriced,
  };
}

/**
 * Price one garage (docs/15 §6). Own section, own columns: per-lift erect (1st,
 * 2nd), gable lift & rails, GF birdcage erect + strip, dismantle — and the garage
 * stage split (65/10/25, or 75/0/25 with no birdcage). Quantities come from the
 * garage template (flagged placeholders until Colin's real garage take-off).
 */
export function priceGarageLine(garage: GarageLine, opts: PriceOpts): PriceResult {
  const lines: PricedLine[] = [];
  const unpriced: { component: string; action: Action }[] = [];
  const add = (
    component: string,
    action: Action,
    quantity: number,
    unit: string,
    liftLevel: number | null = null,
    note?: string,
  ) => {
    if (quantity <= 0) return;
    const rate = opts.resolveRate(component, action, liftLevel);
    const priced = rate !== null;
    const pence = priced ? Math.round(quantity * (rate as number) * 100) : 0;
    if (!priced) unpriced.push({ component, action });
    lines.push({
      component,
      action,
      liftLevel,
      quantity: round2(quantity),
      unit,
      rate: rate ?? 0,
      amount: pence / 100,
      priced,
      inclusion: isInclusionComponent(component),
      note,
    });
  };

  // Per-lift erect (garage cols 1st/2nd lift) — reuses the LIFT rate + lift level.
  for (let lvl = 1; lvl <= garage.lifts; lvl++)
    add("LIFT", "ERECT", garage.perimeterPerLiftM, "LM", lvl, `garage lift ${lvl}`);
  // Gable lift & rails (garage col G).
  if (garage.gableCount > 0) add("GABLE", "ERECT", garage.gableCount, "EACH", null, "garage gable lift & rails");
  // GF birdcage erect + strip (garage col H / strip).
  if (garage.hasBirdcage && garage.gfBirdcageM2 > 0) {
    add("BIRDCAGE_GF", "ERECT", garage.gfBirdcageM2, "M2", null, "garage GF birdcage");
    add("BIRDCAGE_GF", "DISMANTLE", garage.gfBirdcageM2, "M2", null, "strip garage GF birdcage");
  }
  // Dismantle the garage external scaffold.
  if (garage.lifts > 0)
    add("LIFT", "DISMANTLE", round2(garage.perimeterPerLiftM * garage.lifts), "LM", null, "garage dismantle");

  const subtotalPence = columnedSubtotalPence(lines);
  return {
    lines,
    subtotal: subtotalPence / 100,
    stages: allocateStages(subtotalPence, opts.stageSplits),
    unpriced,
  };
}
