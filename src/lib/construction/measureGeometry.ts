/**
 * The measuring tool's arithmetic (2026-10-02) — PURE, unit-tested. Points are in
 * PDF points (1/72 inch on the printed sheet); the drawing's scale turns a distance
 * on the sheet into metres on site.
 */

export type Pt = [number, number];

/** "1:50" → 50 (null when there is no usable scale). */
export function scaleDenominator(scale: string | null | undefined): number | null {
  const m = /1\s*:\s*(\d{1,5})/.exec(scale ?? "");
  const d = m ? Number(m[1]) : NaN;
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Metres on site per PDF point on a sheet drawn at 1:denominator. */
export function metresPerPoint(denominator: number): number {
  return (denominator * 0.0254) / 72;
}

const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface MeasureResult {
  /** Each side in metres, in the order drawn. */
  sides: number[];
  lengthM: number;
  /** For a closed shape: its area in m² and its outside (convex) corners. */
  areaM2: number | null;
  externalCorners: number | null;
  internalCorners: number | null;
}

export function measure(points: Pt[], closed: boolean, mPerPt: number): MeasureResult {
  const pts = points;
  const sides: number[] = [];
  for (let i = 1; i < pts.length; i++) sides.push(r3(dist(pts[i - 1], pts[i]) * mPerPt));
  if (closed && pts.length >= 3) sides.push(r3(dist(pts[pts.length - 1], pts[0]) * mPerPt));
  const lengthM = r3(sides.reduce((a, b) => a + b, 0));
  if (!closed || pts.length < 3) return { sides, lengthM, areaM2: null, externalCorners: null, internalCorners: null };

  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area2 += x1 * y2 - x2 * y1;
  }
  let ext = 0;
  let int = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length];
    const b = pts[i];
    const c = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const turn = cross / (dist(a, b) * dist(b, c) || 1);
    if (Math.abs(turn) < 0.05) continue; // straight on: not a corner
    if (Math.sign(cross) === Math.sign(area2)) ext++;
    else int++;
  }
  return { sides, lengthM, areaM2: r3((Math.abs(area2) / 2) * mPerPt * mPerPt), externalCorners: ext, internalCorners: int };
}

/** Square a new point to the previous one when the line is within `deg` of level or plumb. */
export function snapOrtho(prev: Pt | null, p: Pt, deg = 8): Pt {
  if (!prev) return p;
  const dx = p[0] - prev[0];
  const dy = p[1] - prev[1];
  const t = Math.tan((deg * Math.PI) / 180);
  if (Math.abs(dy) <= t * Math.abs(dx)) return [p[0], prev[1]];
  if (Math.abs(dx) <= t * Math.abs(dy)) return [prev[0], p[1]];
  return p;
}

/**
 * Check (or set) the scale by measuring a printed dimension: the user clicks its two
 * ends and types the printed value. Returns metres per point, and how far it is from
 * the title-block scale (as a fraction), when there is one.
 */
export function calibrate(a: Pt, b: Pt, realM: number, titleDenominator: number | null): { mPerPt: number; offBy: number | null } | null {
  const d = dist(a, b);
  if (!(d > 0) || !(realM > 0)) return null;
  const mPerPt = realM / d;
  const offBy = titleDenominator ? Math.abs(mPerPt - metresPerPoint(titleDenominator)) / metresPerPoint(titleDenominator) : null;
  return { mPerPt, offBy };
}
