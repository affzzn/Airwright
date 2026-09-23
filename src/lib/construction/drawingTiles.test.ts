import { describe, expect, it } from "vitest";
import { MAX_TILES, RENDER_LONG_EDGE_PX, planTiles } from "./drawingTiles";

/** Real page sizes, in points, measured off the example drawings. */
const A4 = { w: 595, h: 842 }; // eg-02 Block F Roof Plan
const A3_LANDSCAPE = { w: 1190, h: 841 }; // cons-data Layout & Elevations
const A1_CAD = { w: 2384, h: 1684 }; // eg-01 Wren, a true A1 CAD sheet

describe("planTiles", () => {
  it("leaves A4 alone: it reads fine whole", () => {
    const p = planTiles(A4.w, A4.h);
    expect(p.needed).toBe(false);
    expect(p.cols).toBe(1);
    expect(p.rows).toBe(1);
  });

  it("tiles the A3 sheet Airwright sent as their example", () => {
    const p = planTiles(A3_LANDSCAPE.w, A3_LANDSCAPE.h);
    expect(p.needed).toBe(true);
    expect(p.tiles).toHaveLength(p.cols * p.rows);
    // A real magnification over sending the sheet whole.
    const whole = RENDER_LONG_EDGE_PX / Math.max(A3_LANDSCAPE.w, A3_LANDSCAPE.h);
    expect(p.pxPerPt).toBeGreaterThan(whole * 1.3);
  });

  it("brings every tiled sheet up to the resolution an A4 already gets", () => {
    const a4Whole = RENDER_LONG_EDGE_PX / Math.max(A4.w, A4.h);
    for (const size of [A3_LANDSCAPE, A1_CAD]) {
      const p = planTiles(size.w, size.h);
      expect(p.pxPerPt).toBeGreaterThanOrEqual(a4Whole * 0.95);
    }
  });

  it("tiles a true A1 CAD sheet harder", () => {
    const p = planTiles(A1_CAD.w, A1_CAD.h);
    expect(p.cols).toBeGreaterThanOrEqual(2);
    expect(p.rows).toBeGreaterThanOrEqual(2);
  });

  it("never exceeds the tile budget", () => {
    const p = planTiles(5000, 4000);
    expect(p.tiles.length).toBeLessThanOrEqual(MAX_TILES);
  });

  it("respects a custom budget", () => {
    const p = planTiles(A1_CAD.w, A1_CAD.h, { maxTiles: 2 });
    expect(p.tiles.length).toBeLessThanOrEqual(2);
  });

  it("covers the whole sheet, with overlap on the seams", () => {
    const p = planTiles(A1_CAD.w, A1_CAD.h);
    const minX = Math.min(...p.tiles.map((t) => t.x));
    const maxX = Math.max(...p.tiles.map((t) => t.x + t.width));
    const minY = Math.min(...p.tiles.map((t) => t.y));
    const maxY = Math.max(...p.tiles.map((t) => t.y + t.height));
    expect(minX).toBe(0);
    expect(minY).toBe(0);
    expect(maxX).toBeCloseTo(A1_CAD.w, 1);
    expect(maxY).toBeCloseTo(A1_CAD.h, 1);
    // Neighbouring tiles in a row must overlap, not just touch.
    const row0 = p.tiles.filter((t) => t.row === 0).sort((a, b) => a.col - b.col);
    if (row0.length > 1) {
      expect(row0[0].x + row0[0].width).toBeGreaterThan(row0[1].x);
    }
  });

  it("numbers tiles in reading order and names their position", () => {
    const p = planTiles(A1_CAD.w, A1_CAD.h);
    expect(p.tiles[0].index).toBe(1);
    expect(p.tiles[0].row).toBe(0);
    expect(p.tiles[0].col).toBe(0);
    expect(p.tiles[0].label).toContain("top");
    expect(p.tiles[0].label).toContain("left");
    expect(p.tiles.at(-1)!.label).toContain("bottom");
  });

  it("puts row 0 at the TOP of the page, where PDF y is highest", () => {
    const p = planTiles(A1_CAD.w, A1_CAD.h);
    const top = p.tiles.find((t) => t.row === 0)!;
    const bottom = p.tiles.find((t) => t.row === p.rows - 1)!;
    expect(top.y + top.height).toBeCloseTo(A1_CAD.h, 1);
    expect(bottom.y).toBe(0);
  });

  it("handles a degenerate page without throwing", () => {
    const p = planTiles(0, 0);
    expect(p.needed).toBe(false);
    expect(p.tiles).toEqual([]);
  });
});
