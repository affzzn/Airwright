import { describe, expect, it } from "vitest";
import { calibrate, measure, metresPerPoint, scaleDenominator, snapOrtho, type Pt } from "./measureGeometry";

describe("measuring on the drawing", () => {
  const mpp = metresPerPoint(50); // 1:50
  // A 20 m × 9 m rectangle at 1:50: 20 m = 400 mm on paper = 1133.86 pt.
  const ptFor = (m: number) => m / mpp;
  const rect: Pt[] = [
    [0, 0],
    [ptFor(20), 0],
    [ptFor(20), ptFor(9)],
    [0, ptFor(9)],
  ];
  it("reads the scale off the title block", () => {
    expect(scaleDenominator("1:50")).toBe(50);
    expect(scaleDenominator("1 : 100 @ A1")).toBe(100);
    expect(scaleDenominator(null)).toBeNull();
  });
  it("a closed outline gives its perimeter, area and 4 outside corners", () => {
    const r = measure(rect, true, mpp);
    expect(r.lengthM).toBe(58);
    expect(r.areaM2).toBe(180);
    expect(r.externalCorners).toBe(4);
    expect(r.internalCorners).toBe(0);
  });
  it("an L-shape has 5 outside corners and 1 inside corner, whichever way it is drawn", () => {
    const l: Pt[] = [
      [0, 0],
      [ptFor(10), 0],
      [ptFor(10), ptFor(4)],
      [ptFor(4), ptFor(4)],
      [ptFor(4), ptFor(10)],
      [0, ptFor(10)],
    ];
    for (const pts of [l, [...l].reverse()]) {
      const r = measure(pts, true, mpp);
      expect(r.externalCorners).toBe(5);
      expect(r.internalCorners).toBe(1);
      expect(r.lengthM).toBe(40);
    }
  });
  it("an open run is the sum of its sides", () => {
    expect(measure(rect.slice(0, 3), false, mpp).lengthM).toBe(29);
  });
  it("squares a nearly level or plumb line", () => {
    expect(snapOrtho([0, 0], [100, 5])).toEqual([100, 0]);
    expect(snapOrtho([0, 0], [4, 100])).toEqual([0, 100]);
    expect(snapOrtho([0, 0], [100, 60])).toEqual([100, 60]);
  });
  it("checking against a printed dimension confirms or corrects the scale", () => {
    const ok = calibrate([0, 0], [ptFor(20.793), 0], 20.793, 50)!;
    expect(ok.offBy).toBeLessThan(0.001);
    const off = calibrate([0, 0], [ptFor(20.793), 0], 20.793 * 2, 50)!; // the sheet is really 1:100
    expect(off.offBy).toBeCloseTo(1, 5);
  });
});
