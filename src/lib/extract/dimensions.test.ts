import { describe, it, expect } from "vitest";
import { buildDimensionHint, makeDimensionVerifier, dimRuns } from "./dimensions";

const PAGES = [
  { page: 1, tokens: ["302", "4877", "7904", "10660"] },
  { page: 2, tokens: ["2385", "5025"] },
];

describe("dimRuns", () => {
  it("pulls 3–5 digit runs, tolerant of separators", () => {
    expect(dimRuns("7904")).toEqual(["7904"]);
    expect(dimRuns("7904 / 302")).toEqual(["7904", "302"]);
    expect(dimRuns("7.904")).toContain("7904"); // separator-stripped form
  });
});

describe("buildDimensionHint", () => {
  it("lists the printed dimensions per page", () => {
    const hint = buildDimensionHint(PAGES);
    expect(hint).toContain("Page 1: 302, 4877, 7904, 10660");
    expect(hint).toContain("Page 2: 2385, 5025");
    expect(hint).toMatch(/SNAP your value/);
  });
  it("is empty when there is no text layer", () => {
    expect(buildDimensionHint([{ page: 1, tokens: [] }])).toBe("");
  });
});

describe("makeDimensionVerifier", () => {
  const verify = makeDimensionVerifier(PAGES);

  it("passes a dimension printed on the cited page", () => {
    expect(verify("7904", 1)).toBe(true);
  });
  it("passes a dimension printed on a different page (fallback to anywhere)", () => {
    expect(verify("5025", 1)).toBe(true); // actually on page 2, still accepted
  });
  it("passes a decimal-formatted match", () => {
    expect(verify("7.904", 1)).toBe(true);
  });
  it("FAILS a dimension that appears nowhere in the text layer (misread)", () => {
    expect(verify("7804", 1)).toBe(false); // model transposed 7904 → 7804
  });
  it("passes a non-numeric citation (nothing to check)", () => {
    expect(verify("U/S Wallplate", 2)).toBe(true);
  });
  it("passes everything when there is no text layer (scanned PDF)", () => {
    const none = makeDimensionVerifier([{ page: 1, tokens: [] }]);
    expect(none("7804", 1)).toBe(true);
  });
});

import { makeTokenMatcher, reconcileRectRoles } from "./dimensions";

/**
 * Role reconciliation — catch the model filing an INTERNAL span into the
 * `overall` field (Tilia: 327 | 8111 | 327 = 8765; the engine wrongly stripped
 * walls off 8111). Uses `internal + 2·wall = overall` against printed tokens.
 */
describe("reconcileRectRoles", () => {
  // Tilia GF: 8765 / 8111 / 327 across, 6290 / 5636 / 327 down.
  const tiliaPages = [{ page: 1, tokens: ["327", "8111", "8765", "5636", "6290"] }];
  const isPrinted = makeTokenMatcher(tiliaPages);

  it("reclassifies an internal span mislabeled as overall (Tilia)", () => {
    const { rect, notes } = reconcileRectRoles(
      { overallWidthM: 8.111, overallDepthM: 5.636, wallThicknessMm: 327 },
      isPrinted,
    );
    // 8111 + 654 = 8765 (printed), 8111 − 654 = 7457 (not) → 8111 is the internal
    expect(rect.internalWidthM).toBe(8.111);
    expect(rect.overallWidthM).toBe(8.765);
    expect(rect.internalDepthM).toBe(5.636);
    expect(rect.overallDepthM).toBe(6.29);
    expect(notes.length).toBe(2);
  });

  it("leaves a GENUINE overall untouched (its internal IS printed)", () => {
    // Whitton-style: overall 5.942, wall 328 → internal 5.286 ≈ printed 5287.
    const pages = [{ page: 1, tokens: ["328", "5287", "5942"] }];
    const { rect, notes } = reconcileRectRoles(
      { overallWidthM: 5.942, wallThicknessMm: 328 },
      makeTokenMatcher(pages),
    );
    expect(rect.internalWidthM).toBeUndefined();
    expect(rect.overallWidthM).toBe(5.942);
    expect(notes.length).toBe(0);
  });

  it("skips when the model already gave BOTH internal and overall", () => {
    const { rect, notes } = reconcileRectRoles(
      { internalWidthM: 8.111, overallWidthM: 8.765, wallThicknessMm: 327 },
      isPrinted,
    );
    expect(rect.internalWidthM).toBe(8.111);
    expect(notes.length).toBe(0);
  });

  it("reverse: an overall mislabeled as internal → moved to overall (engine strips)", () => {
    const { rect, notes } = reconcileRectRoles(
      { internalWidthM: 8.765, wallThicknessMm: 327 }, // 8765 is really the overall
      isPrinted,
    );
    // 8765 − 654 = 8111 (printed), 8765 + 654 = 9419 (not) → 8765 is the overall
    expect(rect.overallWidthM).toBe(8.765);
    expect(rect.internalWidthM).toBeNull();
    expect(notes[0]).toMatch(/OVERALL envelope/);
  });

  it("no wall → cannot reconcile (leaves it alone)", () => {
    const { rect, notes } = reconcileRectRoles({ overallWidthM: 8.111 }, isPrinted);
    expect(rect.overallWidthM).toBe(8.111);
    expect(notes.length).toBe(0);
  });

  it("no text layer → matcher never matches, nothing reclassified", () => {
    const { notes } = reconcileRectRoles(
      { overallWidthM: 8.111, wallThicknessMm: 327 },
      makeTokenMatcher(undefined),
    );
    expect(notes.length).toBe(0);
  });
});
