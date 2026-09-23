import { describe, expect, it } from "vitest";
import {
  buildImport,
  categoryFor,
  parseHeightBracket,
  parseRateTitle,
  unitFromMeasure,
  type RateSheetRow,
} from "./rateSheet";

describe("parseHeightBracket", () => {
  it("normalises the two ways Airwright write the first band", () => {
    expect(parseHeightBracket("6m max")).toBe("UP_TO_6M");
    expect(parseHeightBracket("0-6m max")).toBe("UP_TO_6M");
  });

  it("reads every band in the sheet", () => {
    expect(parseHeightBracket("6-12m max")).toBe("H6_12M");
    expect(parseHeightBracket("12-18m max")).toBe("H12_18M");
    expect(parseHeightBracket("18-24m max")).toBe("H18_24M");
    expect(parseHeightBracket("24-30m max")).toBe("H24_30M");
  });

  it("reads the timber-frame spelling", () => {
    expect(parseHeightBracket("6m - 12m")).toBe("H6_12M");
  });

  it("returns null for something that is not a height", () => {
    expect(parseHeightBracket("per lift")).toBeNull();
    expect(parseHeightBracket("<8LM")).toBeNull();
  });
});

describe("parseRateTitle", () => {
  it("reads a fully specified construction title", () => {
    expect(parseRateTitle("(A) Con Ind Scaff (6-12m max) M")).toEqual({
      raw: "(A) Con Ind Scaff (6-12m max) M",
      current: true,
      line: "CONSTRUCTION",
      family: "Ind Scaff",
      bracket: "H6_12M",
      band: "MEDIUM",
      perLift: false,
    });
  });

  it("reads a band that sits BEFORE the bracket", () => {
    const p = parseRateTitle("(A) Con Birdcage Scaff H (6m max)")!;
    expect(p.family).toBe("Birdcage Scaff");
    expect(p.band).toBe("HIGH");
    expect(p.bracket).toBe("UP_TO_6M");
  });

  it("reads a per-lift item and keeps the marker in the name", () => {
    const p = parseRateTitle("(A) Con Haki Stairs (per lift) (18-24m max) C")!;
    expect(p.family).toBe("Haki Stairs (per lift)");
    expect(p.perLift).toBe(true);
    expect(p.bracket).toBe("H18_24M");
    expect(p.band).toBe("COMPETITIVE");
  });

  it("reads super competitive", () => {
    expect(parseRateTitle("(A) Con Birdcage Scaff SC (6m max)")!.band).toBe("SUPER_COMPETITIVE");
  });

  it("marks the legacy set", () => {
    expect(parseRateTitle("(Z) Adapt for Brickwork")!.current).toBe(false);
  });

  it("tags the business line", () => {
    expect(parseRateTitle("(A) TRAD Ind Scaff (6m max) C")!.line).toBe("TRADITIONAL");
    expect(parseRateTitle("(A) TF Loading bay (per lift) C")!.line).toBe("TIMBER_FRAME");
    expect(parseRateTitle("(A) Transformer Rack")!.line).toBe("GENERAL");
  });

  it("leaves band and bracket null when the title has neither", () => {
    const p = parseRateTitle("(A) Con Chimney Scaff (per lift)")!;
    expect(p.band).toBeNull();
    expect(p.bracket).toBeNull();
    expect(p.family).toBe("Chimney Scaff (per lift)");
  });

  it("does not mistake a non-height bracket for a height", () => {
    const p = parseRateTitle("(A) Con Suspended Scaffold (2M Drop Max)")!;
    expect(p.bracket).toBeNull();
    expect(p.family).toBe("Suspended Scaffold (2M Drop Max)");
  });

  it("keeps a length qualifier that is not a height band", () => {
    const p = parseRateTitle("(A) Con Ind Scaffold Tower (per lift) (<8LM) (6m max) SC")!;
    expect(p.family).toBe("Ind Scaffold Tower (per lift) (<8LM)");
    expect(p.bracket).toBe("UP_TO_6M");
    expect(p.band).toBe("SUPER_COMPETITIVE");
  });

  it("strips the stray bang Airwright leave on one row", () => {
    expect(parseRateTitle("(A) Con Cantilever 5 Board Wide (0-6m max) H !")!.family).toBe(
      "Cantilever 5 Board Wide",
    );
  });

  it("returns null for a blank title", () => {
    expect(parseRateTitle("   ")).toBeNull();
  });
});

describe("unitFromMeasure", () => {
  it("maps Airwright's measures, per lift or not", () => {
    expect(unitFromMeasure("LM", false)).toBe("LM");
    expect(unitFromMeasure("LM", true)).toBe("LM_PER_LIFT");
    expect(unitFromMeasure("SQM", false)).toBe("M2");
    expect(unitFromMeasure("SQM", true)).toBe("M2_PER_LIFT");
    expect(unitFromMeasure("Each", false)).toBe("NR");
    expect(unitFromMeasure("Each", true)).toBe("NR_PER_LIFT");
  });

  it("never guesses an unknown measure into a per-unit price", () => {
    expect(unitFromMeasure("M3", false)).toBe("FIXED");
  });
});

describe("categoryFor", () => {
  it("groups the picker sensibly", () => {
    expect(categoryFor("Haki Stairs (per lift)")).toBe("Access");
    expect(categoryFor("Double Handrail")).toBe("Protection");
    expect(categoryFor("Birdcage Scaff")).toBe("Internal");
    expect(categoryFor("Weekly Inspection")).toBe("Extras");
  });
});

// --- The importer -----------------------------------------------------------

const row = (title: string, over: Partial<RateSheetRow> = {}): RateSheetRow => ({
  title,
  measure: "LM",
  baseHireWeeks: 4,
  rate: 10,
  extraHirePerWeek: 1.2,
  extraHireChargePct: 100,
  ...over,
});

describe("buildImport", () => {
  it("groups a banded, bracketed family into one element with a rate per cell", () => {
    const { elements } = buildImport([
      row("(A) Con Ind Scaff (6m max) H", { rate: 55.84, extraHireChargePct: 100 }),
      row("(A) Con Ind Scaff (6m max) M", { rate: 42.11, extraHireChargePct: 75 }),
      row("(A) Con Ind Scaff (6m max) C", { rate: 35.78, extraHireChargePct: 50 }),
      row("(A) Con Ind Scaff (6-12m max) H", { rate: 64.29 }),
    ]);
    expect(elements).toHaveLength(1);
    const el = elements[0];
    expect(el.line).toBe("CONSTRUCTION");
    expect(el.name).toBe("Ind Scaff");
    expect(el.unit).toBe("LM");
    expect(el.usesHeightBracket).toBe(true);
    expect(el.rates).toHaveLength(4);
    const c6 = el.rates.find((r) => r.band === "COMPETITIVE" && r.bracket === "UP_TO_6M")!;
    expect(c6.rate).toBe(35.78);
    expect(c6.extraHirePerWeek).toBe(1.2);
    expect(c6.extraHireChargePct).toBe(50);
    expect(c6.baseHireWeeks).toBe(4);
    expect(c6.bandAssumed).toBe(false);
  });

  it("copies an unbanded price across every band, flagged as assumed", () => {
    const { elements } = buildImport([
      row("(A) Con Chimney Scaff (per lift)", { measure: "Each", rate: 350 }),
    ]);
    const el = elements[0];
    expect(el.usesLifts).toBe(true);
    expect(el.unit).toBe("NR_PER_LIFT");
    expect(el.rates).toHaveLength(4);
    expect(el.rates.every((r) => r.rate === 350 && r.bracket === "ANY")).toBe(true);
    expect(el.rates.every((r) => r.bandAssumed)).toBe(true);
  });

  it("lets an explicitly banded row beat a price copied across bands", () => {
    const { elements, collisions } = buildImport([
      row("(A) Con Chimney Scaff (per lift)", { measure: "Each", rate: 350 }),
      row("(A) Con Chimney Scaff (per lift) H", { measure: "Each", rate: 550 }),
    ]);
    const el = elements[0];
    const high = el.rates.find((r) => r.band === "HIGH")!;
    const comp = el.rates.find((r) => r.band === "COMPETITIVE")!;
    expect(high.rate).toBe(550);
    expect(high.bandAssumed).toBe(false);
    expect(comp.rate).toBe(350);
    expect(collisions).toBe(1);
  });

  it("skips the legacy set and rows with no rate", () => {
    const { elements, skipped } = buildImport([
      row("(Z) Adapt for Brickwork"),
      row("(A) Con Foot Scaff C", { rate: null }),
      row("(A) Con Foot Scaff H", { rate: 55.84 }),
    ]);
    expect(elements).toHaveLength(1);
    expect(elements[0].rates).toHaveLength(1);
    expect(skipped.map((s) => s.reason)).toContain("no rate");
  });

  it("keeps the business lines apart", () => {
    const { elements } = buildImport([
      row("(A) Con Ind Scaff (6m max) C", { rate: 35.78 }),
      row("(A) TF Ind Scaff (6m max) C", { rate: 33, baseHireWeeks: 12 }),
    ]);
    expect(elements).toHaveLength(2);
    expect(new Set(elements.map((e) => e.line))).toEqual(
      new Set(["CONSTRUCTION", "TIMBER_FRAME"]),
    );
    expect(elements.find((e) => e.line === "TIMBER_FRAME")!.rates[0].baseHireWeeks).toBe(12);
  });
});
