import { describe, it, expect } from "vitest";
import { reconcileDraftLines, aliasToLearn, normaliseAlias } from "./scopeDraft";
import type { DraftLine } from "./scopeSchema";

const line = (over: Partial<DraftLine>): DraftLine => ({
  clientText: "x",
  rowRef: null,
  section: null,
  liftsText: null,
  itemRef: null,
  location: null,
  dimensionText: null,
  heightText: null,
  hireDurationText: null,
  loadingRequirement: null,
  elementId: null,
  quantity: null,
  lifts: null,
  note: null,
  confidence: "medium",
  reason: null,
  ...over,
});

describe("reconcileDraftLines — reject invented ids, keep every line", () => {
  const valid = new Set(["ce-a", "ce-b"]);

  it("keeps a valid id", () => {
    const [r] = reconcileDraftLines([line({ elementId: "ce-a" })], valid);
    expect(r.elementId).toBe("ce-a");
    expect(r.invented).toBe(false);
  });

  it("rejects an invented id → null + flagged, line NOT dropped", () => {
    const out = reconcileDraftLines([line({ elementId: "ce-made-up" })], valid);
    expect(out).toHaveLength(1);
    expect(out[0].elementId).toBeNull();
    expect(out[0].invented).toBe(true);
  });

  it("passes a genuine null through as unmatched (not invented)", () => {
    const [r] = reconcileDraftLines([line({ elementId: null })], valid);
    expect(r.elementId).toBeNull();
    expect(r.invented).toBe(false);
  });

  it("sanitises quantity (finite, non-negative) and lifts (positive int)", () => {
    const [r] = reconcileDraftLines(
      [line({ quantity: -5, lifts: 2.9 })],
      valid,
    );
    expect(r.quantity).toBeNull(); // negative rejected
    expect(r.lifts).toBe(2); // truncated to int
    const [r2] = reconcileDraftLines([line({ quantity: 42.2, lifts: 0 })], valid);
    expect(r2.quantity).toBeCloseTo(42.2, 3);
    expect(r2.lifts).toBeNull(); // 0 lifts → null
  });

  it("accounts for every line (n in = n out)", () => {
    const out = reconcileDraftLines(
      [line({ elementId: "ce-a" }), line({ elementId: "nope" }), line({ elementId: null })],
      valid,
    );
    expect(out).toHaveLength(3);
  });
});

describe("aliasToLearn — learn a client's wording, deduped", () => {
  const el = { name: "Lift Gate", aliases: ["safegate"] };

  it("learns a new wording", () => {
    expect(aliasToLearn("Void protection gate", el)).toBe("Void protection gate");
  });
  it("skips a wording already covered by name or aliases (case-insensitive)", () => {
    expect(aliasToLearn("lift gate", el)).toBeNull();
    expect(aliasToLearn("  SAFEGATE ", el)).toBeNull();
  });
  it("skips empty / over-long", () => {
    expect(aliasToLearn("   ", el)).toBeNull();
    expect(aliasToLearn("x".repeat(200), el)).toBeNull();
  });
  it("collapses internal whitespace", () => {
    expect(aliasToLearn("crash   deck", { name: "Birdcage", aliases: [] })).toBe("crash deck");
  });
});

describe("normaliseAlias", () => {
  it("lowercases + collapses whitespace", () => {
    expect(normaliseAlias("  Crash   Deck ")).toBe("crash deck");
  });
});

import { attachScopeTables, countInWording, liftsFromText } from "./scopeDraft";
import { parseScopeGrid } from "./scopeTable";

describe("counts and lifts in the client's wording", () => {
  it("finds a count, never a dimension", () => {
    expect(countInWording("Staircase access towers; 2nr")).toBe(2);
    expect(countInWording("Safe gates x2")).toBe(2);
    expect(countInWording("3 no. ladder towers")).toBe(3);
    expect(countInWording("Crash deck 2.4x5.4m")).toBeNull();
    expect(countInWording("Independent tied scaffold")).toBeNull();
  });
  it("reads a lifts cell; 'at each level' is left to the rules", () => {
    expect(liftsFromText("2")).toBe(2);
    expect(liftsFromText("3 lifts")).toBe(3);
    expect(liftsFromText("at each level")).toBeNull();
  });
});

describe("tying the reader's lines back to the schedule rows", () => {
  const table = parseScopeGrid({
    name: "Scaffolding",
    rows: [
      { row: 7, cells: [{ col: 4, text: "Lifts", bold: true }, { col: 5, text: "Hire Period (weeks)", bold: true }, { col: 6, text: "Cost", bold: true }] },
      { row: 10, cells: [{ col: 3, text: "Perimeter Scaffolding" }] },
      { row: 12, cells: [{ col: 3, text: "Independent tied scaffold" }, { col: 5, text: "30" }] },
      { row: 13, cells: [{ col: 3, text: "Ladder access bays" }, { col: 4, text: "3" }, { col: 5, text: "30" }] },
      { row: 15, cells: [{ col: 3, text: "Edge Protection" }] },
      { row: 16, cells: [{ col: 3, text: "Slab edge protection" }, { col: 5, text: "16" }] },
    ],
  })!;
  const base = reconcileDraftLines(
    [
      line({ clientText: "Independent tied scaffold", rowRef: "[R12]", elementId: "ce-a", section: "Wrong section" }),
      line({ clientText: "Ladder access bays", rowRef: "R13", elementId: "ce-b" }),
      line({ clientText: "Made up", rowRef: "R99", elementId: "ce-a" }),
    ],
    new Set(["ce-a", "ce-b"]),
  );
  const out = attachScopeTables(base, [table]);
  it("takes section, hire and lifts from the row, not the model", () => {
    const ind = out.find((l) => l.rowRef === "R12")!;
    expect(ind.section).toBe("Perimeter Scaffolding");
    expect(ind.hireWeeks).toBe(30);
    expect(ind.needsMeasurement).toBe(true);
    expect(out.find((l) => l.rowRef === "R13")!.lifts).toBe(3);
  });
  it("adds back a row the reader missed and clears an unknown ref", () => {
    const missed = out.find((l) => l.rowRef === "R16")!;
    expect(missed.elementId).toBeNull();
    expect(missed.section).toBe("Edge Protection");
    expect(missed.hireWeeks).toBe(16);
    expect(out.find((l) => l.clientText === "Made up")!.rowRef).toBeNull();
  });
  it("keeps the schedule's order", () => {
    expect(out.map((l) => l.rowRef)).toEqual(["R12", "R13", "R16", null]);
  });
});
