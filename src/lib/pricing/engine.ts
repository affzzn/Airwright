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
  note?: string;
}

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

  // --- Apex: ONE combined client item (table lift + guard rails to gables) ---
  // Colin's client matrix has ONE column M "Table Lifts & Guard Rails to Gables"
  // (docs/15 §3, P4). tableLifts == handrails == apex count, so price one item per
  // apex via the GABLE rate. (The GANG matrix — Build 2 — splits TABLE_LIFT +
  // GABLE_RAILS; keep that separation for the operatives self-bill, not here.)
  if (line.apex.count > 0) {
    add("GABLE", "ERECT", line.apex.count, "EACH", null, "table lift + gable rails");
  }

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
  const subtotalPence = lines.reduce((a, l) => a + Math.round(l.amount * 100), 0);

  // --- Stage split: presented as a % of the subtotal (NOT the item costs). ---
  // Round each to the penny; give the remainder to the last stage so the stages
  // always reconcile back to the subtotal exactly.
  const stages: StageAmount[] = [];
  let allocated = 0;
  opts.stageSplits.forEach((s, i) => {
    const isLast = i === opts.stageSplits.length - 1;
    const pence = isLast
      ? subtotalPence - allocated
      : Math.round((subtotalPence * s.percent) / 100);
    allocated += pence;
    stages.push({ name: s.name, percent: s.percent, amount: pence / 100 });
  });

  return { lines, subtotal: subtotalPence / 100, stages, unpriced };
}
