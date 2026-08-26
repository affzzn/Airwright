import { describe, it, expect } from "vitest";
import { lowLevelQty, type LowLevel } from "./schema";

const ll = (p: Partial<LowLevel>): LowLevel => ({
  porchCanopyCount: null,
  porchSolidCount: null,
  baySingleStoreyCount: null,
  bayTwoStoreyCount: null,
  confidence: "high",
  ...p,
});

/**
 * LOW_LEVEL_QTY = porches (canopy + solid) + single-storey bays. TWO-storey bays
 * are full height (main scaffold), NOT low levels — captured but excluded.
 */
describe("lowLevelQty", () => {
  it("sums porches (both kinds) + single-storey bays", () => {
    expect(lowLevelQty(ll({ porchCanopyCount: 1, porchSolidCount: 1, baySingleStoreyCount: 2 }))).toBe(4);
  });

  it("a canopy porch still counts as a low level", () => {
    expect(lowLevelQty(ll({ porchCanopyCount: 1 }))).toBe(1);
  });

  it("EXCLUDES two-storey bays from the count", () => {
    // 1 porch + 1 single-storey bay = 2; the two-storey bay does NOT add.
    expect(lowLevelQty(ll({ porchSolidCount: 1, baySingleStoreyCount: 1, bayTwoStoreyCount: 3 }))).toBe(2);
  });

  it("only a two-storey bay → 0 low levels (we looked; there are none)", () => {
    expect(lowLevelQty(ll({ bayTwoStoreyCount: 2 }))).toBe(0);
  });

  it("nothing read at all → null (unknown, not zero)", () => {
    expect(lowLevelQty(ll({}))).toBe(null);
  });

  it("treats missing sub-counts as zero once something was read", () => {
    expect(lowLevelQty(ll({ porchSolidCount: 1 }))).toBe(1);
  });
});
