import { describe, it, expect } from "vitest";
import { scopeOnlyLines } from "./scopeOnly";
import type { BindLibEl } from "./bindScope";
import type { ReconciledDraftLine } from "./scopeDraft";

const lib: BindLibEl[] = [
  { id: "ind", name: "Independent scaffold", aliases: [], unit: "LM_PER_LIFT", usesLifts: true, usesHeightBracket: true },
  { id: "insp", name: "Weekly inspection", aliases: [], unit: "PER_WEEK", usesLifts: false, usesHeightBracket: false },
  { id: "stairs", name: "Temporary stair set", aliases: [], unit: "NR", usesLifts: false, usesHeightBracket: false },
  { id: "day", name: "Daywork", aliases: [], unit: "NR", usesLifts: false, usesHeightBracket: false },
];

const item = (p: Partial<ReconciledDraftLine>): ReconciledDraftLine => ({
  clientText: "line",
  rowRef: null,
  sheet: null,
  section: null,
  statedCount: null,
  needsMeasurement: false,
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
  ...p,
});

describe("Scenario 1 — the client's lines, the client's numbers", () => {
  const r = scopeOnlyLines({
    items: [
      item({ clientText: "Independent tied scaffold 20 m × 2", elementId: "ind", quantity: 40, lifts: 4, hireWeeks: 30, section: "Externals", heightM: 9, quantityBasis: "20 m × 2", flags: ["20 m × 2 — in total or each?"] }),
      item({ clientText: "Temporary stairs 2nr", elementId: "stairs", statedCount: 2, hireWeeks: 16 }),
      item({ clientText: "Labour 1600hrs", elementId: "day", statedCount: 1600 }),
      item({ clientText: "Inspections", elementId: "insp", quantity: 1, hireWeeks: 10 }),
      item({ clientText: "Loading bay", elementId: "ind" }),
      item({ clientText: "Something odd" }),
    ],
    library: lib,
    sections: ["Externals", "Birdcages"],
  });

  it("uses the client's numbers exactly", () => {
    const ind = r.lines[0];
    expect(ind).toMatchObject({ elementId: "ind", quantity: 40, lifts: 4, hireWeeks: 30, section: "Externals", heightBracket: "H6_12M" });
    expect(r.lines[1]).toMatchObject({ quantity: 2, lifts: null, hireWeeks: 16 });
    expect(r.lines[2].quantity).toBe(1600);
  });
  it("no cross-checking: no formula, no status, no drawing flags", () => {
    for (const l of r.lines) {
      expect(l.formula).toBeNull();
      expect(l.status).toBeUndefined();
      expect(l.buildingId).toBeNull();
    }
  });
  it("keeps the note on the client's own wording", () => {
    expect(r.lines[0].flags).toEqual(["20 m × 2 — in total or each?"]);
    expect(r.lines[0].note).toBe("20 m × 2");
  });
  it("weekly inspections are priced for the row's hire weeks", () => {
    expect(r.lines[3].quantity).toBe(10);
  });
  it("a line with no number is left blank", () => {
    expect(r.lines[4].quantity).toBeNull();
    expect(r.flags.join(" ")).toContain("left blank");
  });
  it("an unmatched line asks for an item", () => {
    expect(r.lines[5]).toMatchObject({ elementId: null, needsItem: true });
  });
  it("a section listed with nothing under it is flagged", () => {
    expect(r.emptySections).toEqual(["Birdcages"]);
  });
});

describe("Scenario 1 — the email adds extra lines only", () => {
  const r = scopeOnlyLines({
    items: [
      item({ clientText: "[R10] Progressive External Perimetre", rowRef: "R10", elementId: "ind", quantity: 35.157, lifts: 2 }),
      item({ clientText: "A scaffold wrap around the building for brickwork lifts.", elementId: "ind" }),
      item({ clientText: "Access stairs to the first floor.", elementId: "stairs" }),
    ],
    library: lib,
    sections: [],
  });
  it("an email line for an item the schedule prices is not repeated, but is listed", () => {
    expect(r.lines.map((l) => l.clientRef?.text)).toEqual(["[R10] Progressive External Perimetre", "Access stairs to the first floor."]);
    expect(r.flags.join(" ")).toContain("not repeated from the email");
  });
  it("a scope with no schedule keeps every line", () => {
    const flat = scopeOnlyLines({ items: [item({ elementId: "ind", quantity: 10 }), item({ elementId: "ind" })], library: lib, sections: [] });
    expect(flat.lines).toHaveLength(2);
  });
});
