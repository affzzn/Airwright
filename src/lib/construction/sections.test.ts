import { describe, expect, it } from "vitest";
import { buildQuoteSections, includesText, type SectionLineInput } from "./sections";
import { priceConstructionQuote } from "./price";

const line = (over: Partial<SectionLineInput>): SectionLineInput => ({
  id: Math.random().toString(36).slice(2),
  description: "Independent Scaffold",
  unit: "LM_PER_LIFT",
  quantity: 60,
  lifts: 2,
  rate: 10,
  baseHireWeeks: 4,
  extraHirePerWeek: 1,
  extraHireChargePct: 50,
  durationWeeks: 16,
  section: "External",
  buildingId: "hall",
  ...over,
});
const buildings = [
  { id: "hall", name: "Community Hall" },
  { id: "pav", name: "Sports Pavillion" },
];

describe("Airwright's lump-sum sections (Quote-1350 layout)", () => {
  it("groups by building × area, prices each section, carries hire and extra hire", () => {
    const s = buildQuoteSections(
      [
        line({ id: "a" }),
        line({ id: "b", description: "Haki Stair Tower", unit: "NR_PER_LIFT", quantity: 1, lifts: 2, rate: 300, extraHirePerWeek: 10 }),
        line({ id: "c", section: "Internal Birdcage", description: "Internal Birdcage (crash deck)", unit: "M2_PER_LIFT", quantity: 100, lifts: 2, rate: 5, durationWeeks: 4 }),
        line({ id: "d", buildingId: "pav" }),
        line({ id: "e", description: "Weekly Inspection", unit: "PER_WEEK", quantity: 16, lifts: null, rate: 150, section: null, buildingId: null, extraHirePerWeek: 0 }),
      ],
      { buildings, jobWeeks: null, hireInPrice: false },
    );
    expect(s.map((x) => x.title)).toEqual([
      "External Works Community Hall",
      "Internal Birdcage Works Community Hall",
      "External Works Sports Pavillion",
      "Weekly Scaffold Inspections",
    ]);
    const ext = s[0];
    expect(ext.price).toBe(60 * 2 * 10 + 1 * 2 * 300); // 1200 + 600
    expect(ext.qty).toBe(1);
    expect(ext.hireWeeks).toBe(16);
    expect(ext.extraHirePerWeek).toBe(60 * 2 * 1 * 0.5 + 2 * 10 * 0.5); // 60 + 10
    expect(ext.includes).toEqual(["INDEPENDENT SCAFFOLD 2 LIFTS", "HAKI STAIR TOWER 2 LIFTS"]);
    const insp = s[3];
    expect(insp.isInspection).toBe(true);
    expect(insp.qty).toBe(16);
    expect(insp.rate).toBe(150);
    expect(insp.price).toBe(2400);
  });

  it("P18 INCLUDED adds the hire beyond the base weeks into the section price", () => {
    const l = line({ id: "a" }); // 12 weeks beyond 4, at 60/wk
    const [terms] = buildQuoteSections([l], { buildings, jobWeeks: null, hireInPrice: false });
    const [incl] = buildQuoteSections([l], { buildings, jobWeeks: null, hireInPrice: true });
    expect(terms.price).toBe(1200);
    expect(incl.price).toBe(1200 + 60 * 12);
    expect(incl.hireBeyondBase).toBe(720);
  });

  it("the sections reconcile with the quote total", () => {
    const ls = [line({ id: "a" }), line({ id: "b", buildingId: "pav", quantity: 33.333, rate: 7.77 })];
    for (const hireInPrice of [false, true]) {
      const sum = buildQuoteSections(ls, { buildings, jobWeeks: null, hireInPrice }).reduce((a, x) => a + Math.round(x.price * 100), 0) / 100;
      expect(sum).toBe(priceConstructionQuote({ lines: ls, hireInPrice }).total);
    }
  });

  it("prints each line the way Airwright's 'Includes for' list does", () => {
    expect(includesText({ description: "Ladder Tower", unit: "NR_PER_LIFT", quantity: 3, lifts: 2 })).toBe("3no LADDER TOWER 2 LIFTS");
    expect(includesText({ description: "Lift Gate (Safegate)", unit: "NR", quantity: 3, lifts: null })).toBe("LIFT GATE X3");
    expect(includesText({ description: "Triple Handrail", unit: "LM", quantity: 40, lifts: null })).toBe("TRIPLE HANDRAIL");
  });
});

describe("per-line hire (a scope states hire per line)", () => {
  it("a line's own weeks win over the job's", () => {
    const base = { unit: "LM" as const, quantity: 10, rate: 1, baseHireWeeks: 4, extraHirePerWeek: 1, extraHireChargePct: 100 };
    const p = priceConstructionQuote({ lines: [{ ...base, durationWeeks: 10 }, { ...base }], durationWeeks: 6 });
    // 6 weeks beyond (10 − 4) × £10 + 2 weeks beyond (6 − 4) × £10
    expect(p.extraHireBeyondBase).toBe(80);
    expect(p.total).toBe(20);
    expect(priceConstructionQuote({ lines: [{ ...base, durationWeeks: 10 }, { ...base }], durationWeeks: 6, hireInPrice: true }).total).toBe(100);
  });
});

describe("what the client sees", () => {
  it("leaves out lines still to be measured, names one building only when there are several, and puts the TG20 text on scaffold sections only", () => {
    const s = buildQuoteSections(
      [
        line({ id: "a" }),
        line({ id: "b", description: "Loading Bay", unit: "NR_PER_LIFT", quantity: 0, lifts: 6 }),
        line({ id: "c", section: "Roof", description: "Roof Edge Protection", unit: "LM", quantity: 90, lifts: null, rate: 4 }),
      ],
      { buildings: [{ id: "hall", name: "Main building" }], jobWeeks: null, hireInPrice: false },
    );
    expect(s.map((x) => x.title)).toEqual(["External Works", "Roof"]);
    expect(s[0].includes).toEqual(["INDEPENDENT SCAFFOLD 2 LIFTS"]);
    expect(s[0].hasScaffold).toBe(true);
    expect(s[1].hasScaffold).toBe(false);
  });
});
