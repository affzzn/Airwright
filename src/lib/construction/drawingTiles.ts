/**
 * Tiling a large drawing so it can actually be READ (docs/20 §3.2, promoted from
 * "v2" on 2026-09-24 after probing Airwright's own example sheet).
 *
 * The problem, measured: the representative construction drawing Airwright sent
 * (`cons-data/Layout & Elevations.pdf`) is A3 — 1190 x 841 pt — with NO text
 * layer, carrying a 150 dpi colour raster plus 300 dpi bitonal stencils, and a
 * true A1 CAD sheet (eg-01) is 2384 x 1684 pt. Claude renders a page to at most
 * ~1568 px on its long edge, so an A1 sheet arrives at 0.66 px/pt and printed
 * dimension text (2-3 pt tall) is illegible.
 *
 * The fix needs no new dependency and no rasteriser: pdf-lib can copy a page and
 * move its MediaBox over a sub-rectangle. Claude then renders THAT crop at its
 * own full budget, so a 3 x 2 grid is about three times the effective resolution.
 * Every tiled sheet lands at roughly the same 1.86 px/pt an A4 already gets.
 * We send one document whose page 1 is the whole sheet (for context and layout)
 * and whose later pages are the numbered tiles.
 *
 * This module is pure apart from `buildTiledPdf`, which only touches pdf-lib.
 */

import { PDFDocument } from "pdf-lib";

/** Claude renders a page to about this many pixels on its longest edge. */
export const RENDER_LONG_EDGE_PX = 1568;

/**
 * The resolution we want on a tile, in pixels per PDF point. 1.8 px/pt is what an
 * A4 page already gets rendered whole, so it is the bar a bigger sheet has to be
 * tiled up to; below it, printed dimension text starts to break down.
 */
export const TARGET_PX_PER_PT = 1.8;

/** Tiles overlap slightly so a feature on a seam is whole in one of them. */
export const TILE_OVERLAP = 0.08;

/** Never explode a sheet into more tiles than this (cost + context ceiling). */
export const MAX_TILES = 8;

export interface TilePlan {
  cols: number;
  rows: number;
  tiles: TileRect[];
  /** Effective pixels per point once a tile is rendered. */
  pxPerPt: number;
  /** False when the sheet is small enough to read whole. */
  needed: boolean;
}

export interface TileRect {
  /** 1-based, reading order (left to right, top to bottom). */
  index: number;
  col: number;
  row: number;
  /** Where the tile sits, in PDF points, measured from the page's bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** A human position, e.g. "top left", used in the prompt. */
  label: string;
}

const COL_WORDS = ["left", "centre", "right"];
const ROW_WORDS = ["top", "middle", "bottom"];

function position(col: number, cols: number, row: number, rows: number): string {
  const c = cols === 1 ? "" : cols === 2 ? (col === 0 ? "left" : "right") : COL_WORDS[Math.min(col, 2)];
  const r = rows === 1 ? "" : rows === 2 ? (row === 0 ? "top" : "bottom") : ROW_WORDS[Math.min(row, 2)];
  return [r, c].filter(Boolean).join(" ") || "whole sheet";
}

/**
 * Work out the grid a sheet needs. A4 comes back as a single tile (it already
 * renders at the target); anything larger gets a grid, capped at `MAX_TILES`.
 */
export function planTiles(
  widthPt: number,
  heightPt: number,
  opts: { targetPxPerPt?: number; maxTiles?: number } = {},
): TilePlan {
  const target = opts.targetPxPerPt ?? TARGET_PX_PER_PT;
  const maxTiles = opts.maxTiles ?? MAX_TILES;

  if (!(widthPt > 0) || !(heightPt > 0)) {
    return { cols: 1, rows: 1, tiles: [], pxPerPt: 0, needed: false };
  }

  // How many tiles each axis needs for the target resolution.
  let cols = Math.max(1, Math.ceil((widthPt * target) / RENDER_LONG_EDGE_PX));
  let rows = Math.max(1, Math.ceil((heightPt * target) / RENDER_LONG_EDGE_PX));

  // Trim the longer axis first until the grid fits the budget.
  while (cols * rows > maxTiles) {
    if (cols >= rows && cols > 1) cols--;
    else if (rows > 1) rows--;
    else break;
  }

  const needed = cols * rows > 1;
  const tileW = widthPt / cols;
  const tileH = heightPt / rows;
  const padX = tileW * TILE_OVERLAP;
  const padY = tileH * TILE_OVERLAP;

  const tiles: TileRect[] = [];
  let index = 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // PDF y grows upwards, so row 0 (the top) is the HIGHEST y.
      const x0 = Math.max(0, col * tileW - padX);
      const x1 = Math.min(widthPt, (col + 1) * tileW + padX);
      const yTop = heightPt - row * tileH + padY;
      const yBottom = heightPt - (row + 1) * tileH - padY;
      const y0 = Math.max(0, yBottom);
      const y1 = Math.min(heightPt, yTop);
      tiles.push({
        index: index++,
        col,
        row,
        x: round2(x0),
        y: round2(y0),
        width: round2(x1 - x0),
        height: round2(y1 - y0),
        label: position(col, cols, row, rows),
      });
    }
  }

  const longestTileEdge = Math.max(widthPt / cols, heightPt / rows);
  return {
    cols,
    rows,
    tiles,
    pxPerPt: round2(RENDER_LONG_EDGE_PX / longestTileEdge),
    needed,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface TiledPdf {
  /** The document to send: page 1 the whole sheet, then one page per tile. */
  bytes: Buffer;
  plan: TilePlan;
  /** One line per tile, for the prompt, e.g. "page 2 = top left quarter". */
  pageGuide: string[];
}

/**
 * Build the document to send for ONE page of a drawing. Returns null when the
 * sheet needs no tiling, so the caller can send the original untouched.
 */
export async function buildTiledPdf(
  source: Buffer,
  pageIndex = 0,
  opts: { targetPxPerPt?: number; maxTiles?: number } = {},
): Promise<TiledPdf | null> {
  const src = await PDFDocument.load(source, { updateMetadata: false });
  if (pageIndex >= src.getPageCount()) return null;

  const page = src.getPage(pageIndex);
  // Work in the page's own visible box: a CAD export often crops its media box.
  const box = page.getCropBox?.() ?? page.getMediaBox();
  const plan = planTiles(box.width, box.height, opts);
  if (!plan.needed) return null;

  const out = await PDFDocument.create();

  // Embed the source page ONCE as a shared form XObject. Copying the page per
  // tile would duplicate its images: on the Wren A1 sheet that was 16.7 MB for
  // seven pages, against ~2.5 MB this way.
  const embedded = await out.embedPage(page);

  // Page 1: the sheet whole, for layout and context.
  const overview = out.addPage([box.width, box.height]);
  overview.drawPage(embedded, {
    x: -box.x,
    y: -box.y,
    width: box.width,
    height: box.height,
  });

  for (const tile of plan.tiles) {
    const p = out.addPage([tile.width, tile.height]);
    p.drawPage(embedded, {
      x: -box.x - tile.x,
      y: -box.y - tile.y,
      width: box.width,
      height: box.height,
    });
  }

  const pageGuide = plan.tiles.map(
    (t) =>
      `page ${t.index + 1} = the ${t.label} of the sheet, magnified about ${plan.pxPerPt.toFixed(1)}x`,
  );

  const bytes = Buffer.from(await out.save());
  return { bytes, plan, pageGuide };
}
