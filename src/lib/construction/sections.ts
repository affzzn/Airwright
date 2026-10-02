/**
 * Airwright's real quote layout (docs/23 §15.4, Quote-1350 / Quote-1375) — PURE,
 * unit-tested. The client does not see priced lines: they see LUMP-SUM SECTIONS
 * per area ("External Works Community Hall"), each with an "Includes for" list, a
 * hire period and an extra-hire rate per week; inspections are their own line
 * (£150 × 16 weeks). This module folds the priced lines into those sections.
 *
 * The section a line belongs to is its `section` (the client's heading in a scope
 * job, else the area from `areaSection`) × its building. Money stays in pence.
 */

import { effectiveQuantity, lineAmount, lineExtraHirePerWeek, weeksBeyondBase, type LinePriceInput } from "./price";
import { elementRole, type ItemRole } from "./bindScope";
import type { ConstructionUnit } from "./types";

export interface SectionLineInput extends LinePriceInput {
  id: string;
  description: string;
  section: string | null;
  buildingId: string | null;
  sortOrder?: number;
}

export interface QuoteSection {
  key: string;
  title: string;
  /** The section name without the building ("External Works"). */
  name: string;
  buildingId: string | null;
  buildingName: string | null;
  lines: SectionLineInput[];
  /** The section's price (2 dp): Σ line amounts, plus its hire beyond base when P18 = INCLUDED. */
  price: number;
  /** What the summary prints in Qty × Rate: 1 × price, or weeks × £/week for inspections. */
  qty: number;
  rate: number;
  /** Weeks of hire the section is quoted for (the longest of its lines, else the job's). */
  hireWeeks: number | null;
  /** The fewest weeks any of its rates include (what the price covers when hire is quoted as terms). */
  baseWeeks: number | null;
  /** £ a week beyond the hire the price covers. */
  extraHirePerWeek: number | null;
  /** £ of hire beyond the rates' base weeks (in `price` only when included). */
  hireBeyondBase: number;
  /** "INDEPENDENT SCAFFOLD 2 LIFTS", "3no LADDER TOWER", … */
  includes: string[];
  isInspection: boolean;
  /** True when it holds a scaffold structure (the TG20 specification applies), not only protection / extras. */
  hasScaffold: boolean;
}

/** Items that are a scaffold STRUCTURE — the sections Airwright's TG20 specification describes. */
const STRUCTURE = new Set<ItemRole>([
  "INDEPENDENT",
  "BOARDED_LIFT",
  "LADDER_BAY",
  "LADDER_TOWER",
  "HAKI",
  "TOWER",
  "LOADING_BAY",
  "LB_PLATFORM",
  "BIRDCAGE",
  "INTERNAL_ACCESS",
  "LIFT_SHAFT",
  "STAIR_CORE",
  "CHUTE",
]);

const pence = (n: number) => Math.round(n * 100);

/** The section heading Airwright prints for an area. */
const AREA_TITLE: Record<string, string> = {
  External: "External Works",
  Internal: "Internal independent Works",
  "Internal Birdcage": "Internal Birdcage Works",
  Inspections: "Weekly Scaffold Inspections",
  Extras: "Extras",
};
const AREA_ORDER = ["External", "Internal", "Internal Birdcage", "Extras", "Inspections"];

/** One line as Airwright's "Includes for" list prints it. */
export function includesText(l: { description: string; unit: string; quantity: number; lifts?: number | null }): string {
  const name = l.description.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
  const q = Math.round(l.quantity * 1000) / 1000;
  const lifts = l.lifts != null && l.lifts > 0 ? `${l.lifts} LIFT${l.lifts === 1 ? "" : "S"}` : null;
  switch (l.unit as ConstructionUnit) {
    case "NR_PER_LIFT":
      return [q > 1 ? `${q}no ${name}` : name, lifts].filter(Boolean).join(" ");
    case "LM_PER_LIFT":
    case "M2_PER_LIFT":
      return [name, lifts].filter(Boolean).join(" ");
    case "NR":
      return q > 1 ? `${name} X${q}` : name;
    case "PER_WEEK":
      return `${name} ${q} WEEK${q === 1 ? "" : "S"}`;
    default:
      return name;
  }
}

export function buildQuoteSections(
  lines: SectionLineInput[],
  opts: { buildings: { id: string; name: string }[]; jobWeeks: number | null; hireInPrice: boolean },
): QuoteSection[] {
  const bName = new Map(opts.buildings.map((b) => [b.id, b.name]));
  const groups = new Map<string, SectionLineInput[]>();
  const order: string[] = [];
  const sorted = [...lines].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const l of sorted) {
    // A line with nothing to quote (still to be measured) is never shown to the client.
    if (effectiveQuantity(l.unit, l.quantity, l.lifts) <= 0) continue;
    const name = l.unit === "PER_WEEK" && !l.section ? "Inspections" : (l.section ?? "External");
    // Inspections and extras are one section for the whole job.
    const building = name === "Inspections" || name === "Extras" ? null : l.buildingId;
    const key = `${building ?? "job"}|${name}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(l);
  }

  const sections: QuoteSection[] = order.map((key) => {
    const ls = groups.get(key)!;
    const [bid, name] = [key.split("|")[0], key.slice(key.indexOf("|") + 1)];
    const buildingId = bid === "job" ? null : bid;
    const buildingName = buildingId ? (bName.get(buildingId) ?? null) : null;
    let amountP = 0;
    let weeklyP = 0;
    let beyondP = 0;
    let hireWeeks: number | null = null;
    let baseWeeks: number | null = null;
    for (const l of ls) {
      if (l.baseHireWeeks != null && l.baseHireWeeks > 0) baseWeeks = Math.min(baseWeeks ?? Infinity, l.baseHireWeeks);
      amountP += pence(lineAmount(l));
      const weekly = pence(lineExtraHirePerWeek(l));
      weeklyP += weekly;
      beyondP += weekly * weeksBeyondBase(l, opts.jobWeeks);
      const w = l.durationWeeks ?? opts.jobWeeks;
      if (w != null && w > 0) hireWeeks = Math.max(hireWeeks ?? 0, w);
    }
    const priceP = amountP + (opts.hireInPrice ? beyondP : 0);
    const isInspection = ls.every((l) => l.unit === "PER_WEEK");
    const single = ls.length === 1 && ls[0].unit === "PER_WEEK";
    const display = AREA_TITLE[name] ?? name;
    return {
      key,
      name: display,
      // The building is named when the job has more than one (CBAND); one building needs no suffix.
      title: buildingName && opts.buildings.length > 1 ? `${display} ${buildingName}` : display,
      buildingId,
      buildingName,
      lines: ls,
      price: priceP / 100,
      qty: single ? ls[0].quantity : 1,
      rate: single ? ls[0].rate : priceP / 100,
      hireWeeks: isInspection ? null : hireWeeks,
      baseWeeks: isInspection ? null : baseWeeks,
      extraHirePerWeek: weeklyP > 0 ? weeklyP / 100 : null,
      hireBeyondBase: beyondP / 100,
      includes: ls.map((l) => includesText(l)),
      isInspection,
      hasScaffold: ls.some((l) => STRUCTURE.has(elementRole(l.description))),
    };
  });

  // Building order, then the area order (client sections keep their own order).
  const bIndex = (id: string | null) => (id == null ? 1e6 : opts.buildings.findIndex((b) => b.id === id));
  const aIndex = (s: QuoteSection) => {
    const raw = s.key.slice(s.key.indexOf("|") + 1);
    const i = AREA_ORDER.indexOf(raw);
    return i < 0 ? -1 : i;
  };
  return sections
    .map((s, i) => ({ s, i }))
    .sort((a, b) => bIndex(a.s.buildingId) - bIndex(b.s.buildingId) || (aIndex(a.s) >= 0 && aIndex(b.s) >= 0 ? aIndex(a.s) - aIndex(b.s) : a.i - b.i))
    .map((x) => x.s);
}
