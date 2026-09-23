import { describe, it, expect } from "vitest";
import { reconcileDraftLines, aliasToLearn, normaliseAlias } from "./scopeDraft";
import type { DraftLine } from "./scopeSchema";

const line = (over: Partial<DraftLine>): DraftLine => ({
  clientText: "x",
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
