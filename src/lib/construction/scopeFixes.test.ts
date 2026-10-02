import { describe, expect, it } from "vitest";
import { applyScopeFixes, type FixElement } from "./scopeFixes";
import type { ReconciledDraftLine } from "./scopeDraft";
import { resolveJobParams } from "./params";

const els: FixElement[] = [
  { id: "ind", name: "Independent Scaffold", aliases: ["perimeter scaffold"], unit: "LM_PER_LIFT" },
  { id: "roof", name: "Roof Edge Protection", aliases: ["roof edge protection", "edge protection to roof"], unit: "LM" },
  { id: "haki", name: "Haki Stair Tower", aliases: ["haki", "stair tower"], unit: "NR_PER_LIFT" },
  { id: "steps", name: "Temporary Stair Set (treads + handrails)", aliases: ["stair sets"], unit: "NR" },
  { id: "dbl", name: "Double Handrail (+ toe board)", aliases: ["edge protection"], unit: "LM" },
  { id: "day", name: "Daywork (per man, per hour)", aliases: ["attendance"], unit: "NR" },
];
const line = (over: Partial<ReconciledDraftLine>): ReconciledDraftLine => ({
  clientText: "x",
  rowRef: "R1",
  sheet: "Scaffolding",
  section: null,
  statedCount: null,
  needsMeasurement: true,
  itemRef: null,
  location: null,
  hireWeeks: null,
  heightM: null,
  loadingRequirement: null,
  quantityBasis: null,
  elementId: null,
  quantity: null,
  lifts: null,
  note: null,
  confidence: "high",
  reason: null,
  invented: false,
  ...over,
});

describe("Ben's corrections (9 Sep 2026), on the National Grid schedule's own rows", () => {
  it("stair sets / up & over steps are temporary stairs, never a Haki — with the row's × 2", () => {
    const [a] = applyScopeFixes([line({ clientText: "Transitions between lower & higher level floor slabs", location: "Straight Stair sets x 2", elementId: "haki" })], els);
    expect(a.elementId).toBe("steps");
    expect(a.statedCount).toBe(2);
    expect(a.flags![0]).toContain("not a Haki");
    const [b] = applyScopeFixes([line({ clientText: "Access to courtyard over concrete upstand", location: "Up & over Stair sets x 2", elementId: "haki", quantity: 2 })], els);
    expect(b.elementId).toBe("steps");
    expect(b.quantity).toBe(2);
    // A real Haki row is left alone.
    const [c] = applyScopeFixes([line({ clientText: "Upper level & roof access for metal deckers", location: "Haki stairs", elementId: "haki" })], els);
    expect(c.elementId).toBe("haki");
  });

  it("one row asking for two items becomes two lines, each with the row's 20 m", () => {
    const out = applyScopeFixes([line({ clientText: "Perimeter access scaffolding and roof edge protection around roof structure.", elementId: "ind", quantity: 20, rowRef: "R7" })], els);
    expect(out.map((l) => [l.elementId, l.quantity, l.rowRef])).toEqual([
      ["ind", 20, "R7"],
      ["roof", 20, "R7"],
    ]);
    expect(out[1].flags![0]).toContain("split");
    // Running it again adds nothing (cached reads are fixed on every run).
    expect(applyScopeFixes(out, els)).toHaveLength(2);
    // "&" inside one item ("Triple guardrails & toe boards") is not a second item.
    expect(applyScopeFixes([line({ clientText: "Triple guardrails & toe boards", elementId: "dbl", quantity: 30 })], els)).toHaveLength(1);
  });

  it("hours in the wording are the quantity of an hourly item", () => {
    const [a] = applyScopeFixes([line({ clientText: "Allow 1600hrs meantime", elementId: "day" })], els);
    expect(a.quantity).toBe(1600);
    expect(a.quantityBasis).toContain("1600 hours");
  });

  it("20 m with a × 2 is flagged — in total, or each? — and the number is NOT changed", () => {
    const [a] = applyScopeFixes([line({ clientText: "Edge protection to internal of LV pits", location: "Edge Protection to LV Pits x 2", elementId: "dbl", quantity: 20 })], els);
    expect(a.quantity).toBe(20);
    expect(a.flags![0]).toContain("20 m in total, or 20 m each (40 m)");
    // Safe gates x2 is a count, not a length: no such question.
    const [g] = applyScopeFixes([line({ clientText: "Protection over lift door voids; Safe gates x2", elementId: "haki", quantity: 2 })], els);
    expect(g.flags ?? []).toHaveLength(0);
  });
});

describe("hire in the price (P18)", () => {
  it("a scope job prices all the hire weeks asked for; other jobs quote extra hire as terms", () => {
    expect(resolveJobParams(null, { scopeJob: true }).P18_hireInPrice.value).toBe("INCLUDED");
    expect(resolveJobParams(null).P18_hireInPrice.value).toBe("TERMS");
    expect(resolveJobParams({ P18_hireInPrice: { value: "TERMS" } }, { scopeJob: true }).P18_hireInPrice.value).toBe("TERMS");
    expect(resolveJobParams(null, { scopeJob: true }).P18_hireInPrice.confirmed).toBe(false);
  });
});
