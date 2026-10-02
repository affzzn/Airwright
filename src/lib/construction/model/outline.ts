/**
 * The outline engine (docs/23 §9.B1–B2, doctrine D3) — PURE, unit-tested.
 *
 * The model names the SHAPE: an ordered list of wall segments, each tied to the
 * printed dimension(s) that measure it or to grid lines. This module does every
 * number: it verifies each string really is printed on the sheet, sums printed
 * pieces, takes grid spacings from the printed chain between the bubbles, closes
 * the polygon (and can solve ONE missing wall from the closure), then derives the
 * perimeter, the external / internal corner counts, the area and the length on
 * each side of the sheet.
 */

import type { GridSystem } from "../pack/sheetGeometry";

export type Dir = "E" | "S" | "W" | "N" | "NE" | "SE" | "SW" | "NW";

export interface SegmentIn {
  id: string; // "S1", "S2" …
  direction: Dir;
  lengthStrings: string[];
  fromGrid: string | null;
  toGrid: string | null;
  feature: string;
  confidence: string;
  note?: string | null;
}

export type LengthSource = "PRINTED" | "GRID_PRINTED" | "GRID_MEASURED" | "CLOSURE" | "NONE";

export interface ResolvedSegment extends SegmentIn {
  lengthM: number | null;
  source: LengthSource;
  /** The printed strings behind the length, verified against the sheet. */
  provenance: string;
  flags: string[];
}

export type Side = "top" | "right" | "bottom" | "left";

export interface OutlineResult {
  segments: ResolvedSegment[];
  closes: boolean;
  misfitM: { dx: number; dy: number } | null;
  perimeterM: number | null;
  areaM2: number | null;
  externalCorners: number | null;
  internalCorners: number | null;
  /** Length of wall facing each side of the sheet (sheet orientation, not true north). */
  sides: Record<Side, number> | null;
  boundingM: { width: number; depth: number } | null;
  orthogonal: boolean;
  confidence: "high" | "medium" | "low" | "unknown";
  flags: string[];
}

const UNIT: Record<Dir, [number, number]> = {
  E: [1, 0],
  W: [-1, 0],
  N: [0, 1],
  S: [0, -1],
  NE: [Math.SQRT1_2, Math.SQRT1_2],
  SE: [Math.SQRT1_2, -Math.SQRT1_2],
  SW: [-Math.SQRT1_2, -Math.SQRT1_2],
  NW: [-Math.SQRT1_2, Math.SQRT1_2],
};
const AXIAL = new Set<Dir>(["E", "W", "N", "S"]);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A printed length string → metres. Millimetre dimensions ("28,903", "20793"),
 * or an explicit metre value ("20.793m", "42.2 m"). Null when it is not a length.
 */
export function lengthStringToM(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, " ");
  let m = /^(\d{1,3}(?:,\d{3})+|\d{2,6})(?:\s*mm)?$/i.exec(s);
  if (m) return Number(m[1].replace(/,/g, "")) / 1000;
  m = /^(\d{1,3}(?:\.\d{1,3})?)\s*m$/i.exec(s);
  if (m) return Number(m[1]);
  m = /^(\d{1,3}(?:,\d{3})+|\d{3,6})\.(\d{1,2})\s*mm$/i.exec(s);
  if (m) return Number(`${m[1].replace(/,/g, "")}.${m[2]}`) / 1000;
  return null;
}

/** Split "C2" / "C" / "2" / "C-2" into its vertical-line letter and horizontal-line number. */
export function parseGridRef(ref: string | null): { col: string | null; row: string | null } {
  if (!ref) return { col: null, row: null };
  const m = /^\s*([A-Z]{1,2})?\s*[-/,]?\s*(\d{1,2})?\s*$/i.exec(ref);
  if (!m) return { col: null, row: null };
  return { col: m[1]?.toUpperCase() ?? null, row: m[2] ?? null };
}

/** The distance between two grid lines on one axis, from the printed spacings where possible. */
function gridDistance(
  grid: GridSystem,
  axis: "vertical" | "horizontal",
  a: string,
  b: string,
): { mm: number; printed: boolean; provenance: string } | null {
  const lines = grid[axis];
  const ia = lines.findIndex((l) => l.label === a);
  const ib = lines.findIndex((l) => l.label === b);
  if (ia < 0 || ib < 0 || ia === ib) return null;
  const [lo, hi] = ia < ib ? [ia, ib] : [ib, ia];
  let mm = 0;
  let printed = true;
  const parts: string[] = [];
  for (let i = lo; i < hi; i++) {
    const from = lines[i].label;
    const to = lines[i + 1].label;
    const sp = grid.spacings.find((s) => (s.from === from && s.to === to) || (s.from === to && s.to === from));
    if (!sp) return null;
    if (sp.printedMm != null) {
      mm += sp.printedMm;
      parts.push(String(sp.printedMm));
    } else {
      mm += sp.measuredMm;
      printed = false;
      parts.push(`~${sp.measuredMm}`);
    }
  }
  return { mm, printed, provenance: `grid ${a}→${b}: ${parts.join(" + ")}` };
}

export interface OutlineContext {
  /** Every millimetre dimension printed on the sheet (for verifying the model's strings). */
  printedMm: number[];
  grid: GridSystem | null;
  /** Closure tolerance: max(absolute, relative × perimeter). */
  tolAbsM: number;
  tolRel: number;
  /** The sheet's outermost chain totals (its overall sizes), in mm. */
  overallMm?: number[];
}

export function resolveOutline(segsIn: SegmentIn[], ctx: OutlineContext): OutlineResult {
  const flags: string[] = [];
  const printedSet = ctx.printedMm;
  const isPrinted = (mm: number) => printedSet.some((p) => Math.abs(p - mm) <= 1);
  const isOverall = (m: number) => (ctx.overallMm ?? []).some((o) => Math.abs(o / 1000 - m) <= 0.002);

  // 1. A length for each segment: the printed string(s) (verified on the sheet) and,
  //    independently, the grid distance. When both exist they must agree; the
  //    printed one wins when they do, the grid one (with a flag) when they do not —
  //    a chain of window widths that runs past a corner is the classic misread.
  const segs: ResolvedSegment[] = segsIn.map((s) => {
    const seg: ResolvedSegment = { ...s, lengthM: null, source: "NONE", provenance: "", flags: [] };
    let printed: number | null = null;
    if (s.lengthStrings.length) {
      const vals = s.lengthStrings.map((x) => lengthStringToM(x));
      const ok = vals.every(
        (v, i) => v != null && (isPrinted(Math.round(v * 1000)) || /m$/i.test(s.lengthStrings[i].trim())),
      );
      if (ok) printed = r3(vals.reduce((a: number, v) => a + (v ?? 0), 0));
      else seg.flags.push(`"${s.lengthStrings.join(" + ")}" is not printed on the sheet — not used`);
    }
    let grid: { m: number; printed: boolean; provenance: string } | null = null;
    if (ctx.grid && (s.fromGrid || s.toGrid) && AXIAL.has(s.direction)) {
      const a = parseGridRef(s.fromGrid);
      const b = parseGridRef(s.toGrid);
      const horizontalRun = s.direction === "E" || s.direction === "W";
      const d = horizontalRun
        ? a.col && b.col
          ? gridDistance(ctx.grid, "vertical", a.col, b.col)
          : null
        : a.row && b.row
          ? gridDistance(ctx.grid, "horizontal", a.row, b.row)
          : null;
      if (d) grid = { m: r3(d.mm / 1000), printed: d.printed, provenance: d.provenance };
    }
    const agree = (x: number, y: number) => Math.abs(x - y) <= Math.max(0.3, 0.02 * Math.max(x, y));
    if (printed != null && (!grid || agree(printed, grid.m))) {
      seg.lengthM = printed;
      seg.source = "PRINTED";
      seg.provenance = s.lengthStrings.join(" + ") + (grid ? ` (grid agrees: ${grid.provenance})` : "");
    } else if (grid && (grid.printed || printed == null || !isOverall(printed))) {
      // The grid beats a printed string that disagrees with it (a chain of window
      // widths running past a corner) — unless the grid is partly SCALED and the
      // printed length is the sheet's own overall dimension (D4: printed > scaled).
      seg.lengthM = grid.m;
      seg.source = grid.printed ? "GRID_PRINTED" : "GRID_MEASURED";
      seg.provenance = grid.provenance;
      if (printed != null) seg.flags.push(`printed "${s.lengthStrings.join(" + ")}" = ${printed} m disagrees with the grid ${grid.m} m — grid used`);
    } else if (printed != null && grid) {
      seg.lengthM = printed;
      seg.source = "PRINTED";
      seg.provenance = s.lengthStrings.join(" + ");
      seg.flags.push(`the grid (${grid.provenance}, partly scaled) gives ${grid.m} m against the printed overall ${printed} m — the printed overall used`);
    }
    return seg;
  });

  const orthogonal = segs.every((s) => AXIAL.has(s.direction));
  if (segs.length < 3) {
    return {
      segments: segs,
      closes: false,
      misfitM: null,
      perimeterM: null,
      areaM2: null,
      externalCorners: null,
      internalCorners: null,
      sides: null,
      boundingM: null,
      orthogonal,
      confidence: "unknown",
      flags: [segs.length === 0 ? "No outline was traced" : "Outline has fewer than three walls"],
    };
  }

  // 2. Close the polygon: one missing axial wall can be solved from the others.
  const unknown = segs.filter((s) => s.lengthM == null);
  if (unknown.length === 1 && AXIAL.has(unknown[0].direction)) {
    const u = unknown[0];
    const [ux, uy] = UNIT[u.direction];
    let sx = 0;
    let sy = 0;
    for (const s of segs) {
      if (s === u) continue;
      const [dx, dy] = UNIT[s.direction];
      sx += dx * s.lengthM!;
      sy += dy * s.lengthM!;
    }
    const need = ux !== 0 ? -sx / ux : -sy / uy;
    const offAxis = ux !== 0 ? Math.abs(sy) : Math.abs(sx);
    if (need > 0.05 && offAxis <= Math.max(ctx.tolAbsM, 0.01)) {
      u.lengthM = r3(need);
      u.source = "CLOSURE";
      u.provenance = "solved from the other walls (the outline must close)";
      u.flags.push("length solved by closing the outline — no printed dimension");
    }
  }
  const stillUnknown = segs.filter((s) => s.lengthM == null);
  // Several walls with no printed length, all running the SAME way (KE: two short
  // north-going steps). Their lengths are not known one by one, but closure fixes
  // their TOTAL — and the perimeter, the corners and the length on each side only
  // need totals. Code does that sum; the shape is the model's, so it stays low.
  if (stillUnknown.length > 1 && orthogonal && stillUnknown.every((s) => s.direction === stillUnknown[0].direction)) {
    const dir = stillUnknown[0].direction;
    const [ux, uy] = UNIT[dir];
    let sx = 0;
    let sy = 0;
    for (const s of segs) {
      if (s.lengthM == null) continue;
      const [dx, dy] = UNIT[s.direction];
      sx += dx * s.lengthM;
      sy += dy * s.lengthM;
    }
    const need = r3(ux !== 0 ? -sx / ux : -sy / uy);
    const offAxis = ux !== 0 ? Math.abs(sy) : Math.abs(sx);
    const knownPerimeter = segs.reduce((a, s) => a + (s.lengthM ?? 0), 0);
    if (need > 0.05 * stillUnknown.length && offAxis <= Math.max(ctx.tolAbsM, ctx.tolRel * knownPerimeter)) {
      for (const u of stillUnknown) {
        u.source = "CLOSURE";
        u.provenance = `together ${need} m with ${stillUnknown.filter((x) => x !== u).map((x) => x.id).join(", ")}, solved from the other walls`;
        u.flags.push("no printed length — counted in a total solved by closing the outline");
      }
      // Corners from the turns alone: an orthogonal outline turns a net ±4 times.
      let turn = 0;
      for (let i = 0; i < segs.length; i++) {
        const a = UNIT[segs[i].direction];
        const b = UNIT[segs[(i + 1) % segs.length].direction];
        turn += Math.sign(a[0] * b[1] - a[1] * b[0]);
      }
      const clockwise = turn < 0;
      let ext = 0;
      let int = 0;
      for (let i = 0; i < segs.length; i++) {
        const a = UNIT[segs[i].direction];
        const b = UNIT[segs[(i + 1) % segs.length].direction];
        const cross = a[0] * b[1] - a[1] * b[0];
        if (Math.abs(cross) < 1e-9) continue;
        if (clockwise ? cross < 0 : cross > 0) ext++;
        else int++;
      }
      const sides: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
      const addSide = (d: Dir, len: number) => {
        const [dx, dy] = UNIT[d];
        const nx = clockwise ? -dy : dy;
        const ny = clockwise ? dx : -dx;
        const side: Side = Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? "right" : "left") : ny > 0 ? "top" : "bottom";
        sides[side] = r3(sides[side] + len);
      };
      for (const s of segs) if (s.lengthM != null) addSide(s.direction, s.lengthM);
      addSide(dir, need);
      // The extent across the solved direction is known exactly when the unknowns run up/down (or across).
      const xs: number[] = [0];
      let x = 0;
      for (const s of segs) {
        const [dx] = UNIT[s.direction];
        if (dx !== 0) x += dx * (s.lengthM ?? 0);
        xs.push(x);
      }
      for (const s of segs) flags.push(...s.flags.map((f) => `${s.id}: ${f}`));
      flags.push(
        `${stillUnknown.map((s) => s.id).join(" + ")} have no printed length; their total (${need} m) comes from closing the outline, so the perimeter is exact only if the traced shape is right — check it`,
      );
      return {
        segments: segs,
        closes: true,
        misfitM: { dx: 0, dy: 0 },
        perimeterM: r3(knownPerimeter + need),
        areaM2: null,
        externalCorners: ext,
        internalCorners: int,
        sides,
        boundingM: ux === 0 ? { width: r3(Math.max(...xs) - Math.min(...xs)), depth: 0 } : null,
        orthogonal,
        confidence: "low",
        flags,
      };
    }
  }
  if (stillUnknown.length) {
    flags.push(`${stillUnknown.length} wall${stillUnknown.length === 1 ? "" : "s"} with no printed length: ${stillUnknown.map((s) => s.id).join(", ")} — measure by hand`);
    return {
      segments: segs,
      closes: false,
      misfitM: null,
      perimeterM: null,
      areaM2: null,
      externalCorners: null,
      internalCorners: null,
      sides: null,
      boundingM: null,
      orthogonal,
      confidence: "low",
      flags,
    };
  }

  // 3. Walk it: closure misfit, area (shoelace), bounding box.
  let x = 0;
  let y = 0;
  const pts: [number, number][] = [[0, 0]];
  for (const s of segs) {
    const [dx, dy] = UNIT[s.direction];
    x += dx * s.lengthM!;
    y += dy * s.lengthM!;
    pts.push([x, y]);
  }
  const perimeterM = r3(segs.reduce((a, s) => a + s.lengthM!, 0));
  const misfit = { dx: r3(x), dy: r3(y) };
  const tol = Math.max(ctx.tolAbsM, ctx.tolRel * perimeterM);
  const closes = Math.abs(misfit.dx) <= tol && Math.abs(misfit.dy) <= tol;
  if (!closes) flags.push(`The outline does not close (off by ${Math.abs(misfit.dx).toFixed(3)} m across, ${Math.abs(misfit.dy).toFixed(3)} m up/down) — a wall length is wrong or missing`);

  let area2 = 0;
  for (let i = 0; i < pts.length - 1; i++) area2 += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  const signedArea = area2 / 2;
  const clockwise = signedArea < 0; // y up: clockwise traversal has negative signed area
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const boundingM = { width: r3(Math.max(...xs) - Math.min(...xs)), depth: r3(Math.max(...ys) - Math.min(...ys)) };

  // 4. Corners: a turn the same way as the traversal is convex (external).
  let ext = 0;
  let int = 0;
  for (let i = 0; i < segs.length; i++) {
    const a = UNIT[segs[i].direction];
    const b = UNIT[segs[(i + 1) % segs.length].direction];
    const cross = a[0] * b[1] - a[1] * b[0];
    if (Math.abs(cross) < 1e-9) continue; // straight on (two pieces of one wall)
    const convex = clockwise ? cross < 0 : cross > 0;
    if (convex) ext++;
    else int++;
  }
  if (orthogonal && closes && ext - int !== 4) flags.push(`Corner count does not balance (${ext} external, ${int} internal)`);

  // 5. Which side of the sheet each wall faces (its outward normal).
  const sides: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const s of segs) {
    const [dx, dy] = UNIT[s.direction];
    // Outward normal: rotate the travel direction toward the outside.
    const nx = clockwise ? -dy : dy;
    const ny = clockwise ? dx : -dx;
    const side: Side = Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? "right" : "left") : ny > 0 ? "top" : "bottom";
    sides[side] = r3(sides[side] + s.lengthM!);
  }

  const sources = new Set(segs.map((s) => s.source));
  const confidence: OutlineResult["confidence"] = !closes
    ? "low"
    : sources.has("CLOSURE") || sources.has("GRID_MEASURED")
      ? "medium"
      : "high";

  for (const s of segs) flags.push(...s.flags.map((f) => `${s.id}: ${f}`));

  return {
    segments: segs,
    closes,
    misfitM: misfit,
    perimeterM,
    areaM2: r3(Math.abs(signedArea)),
    externalCorners: ext,
    internalCorners: int,
    sides,
    boundingM,
    orthogonal,
    confidence,
    flags,
  };
}

/**
 * The floor area inside the external walls of an ORTHOGONAL outline, for a wall
 * of thickness t: A − P·t + (external − internal)·t². Exact for a rectilinear
 * outline whose walls are all thicker than nothing and shorter walls than 2t are
 * absent. (The "gross internal" area — it still includes internal wall footprints.)
 */
export function insetArea(o: OutlineResult, wallM: number): number | null {
  if (!o.orthogonal || !o.closes || o.areaM2 == null || o.perimeterM == null || o.externalCorners == null || o.internalCorners == null) return null;
  if (!(wallM > 0) || o.segments.some((s) => (s.lengthM ?? 0) <= 2 * wallM)) return null;
  return r3(o.areaM2 - o.perimeterM * wallM + (o.externalCorners - o.internalCorners) * wallM * wallM);
}

const DIRS = new Set<Dir>(["E", "S", "W", "N", "NE", "SE", "SW", "NW"]);

/**
 * Parse one outline line ("DIR | LENGTHS | GRID | FEATURE | NOTE", see the plan
 * reader's schema) into a segment. Null when the direction is not recognisable.
 */
export function parseOutlineEntry(line: string, id: string): SegmentIn | null {
  const parts = line.split("|").map((p) => p.trim());
  const dir = (parts[0] ?? "").toUpperCase().replace(/[^A-Z]/g, "") as Dir;
  if (!DIRS.has(dir)) return null;
  const lengths = (parts[1] ?? "")
    .split("+")
    .map((x) => x.trim().replace(/^"|"$/g, ""))
    .filter((x) => x && !/^(none|-|n\/a|—)$/i.test(x));
  const grid = parts[2] ?? "-";
  const g = /^\s*([A-Z]{0,2}\d{0,2})\s*(?:->|→|–|to)\s*([A-Z]{0,2}\d{0,2})\s*$/i.exec(grid);
  const feature = (parts[3] ?? "WALL").toUpperCase();
  const note = parts.slice(4).join(" | ").trim();
  return {
    id,
    direction: dir,
    lengthStrings: lengths,
    fromGrid: g && g[1] ? g[1].toUpperCase() : null,
    toGrid: g && g[2] ? g[2].toUpperCase() : null,
    feature: ["WALL", "PORCH", "BAY", "CANOPY", "OTHER"].includes(feature) ? feature : "WALL",
    confidence: "medium",
    note: note && note !== "-" ? note : null,
  };
}

/** Parse a plan read's outline lines; unparseable lines are reported, not guessed. */
export function parseOutline(lines: string[]): { segments: SegmentIn[]; rejected: string[] } {
  const segments: SegmentIn[] = [];
  const rejected: string[] = [];
  for (const l of lines) {
    const seg = parseOutlineEntry(l, `S${segments.length + 1}`);
    if (seg) segments.push(seg);
    else rejected.push(l);
  }
  return { segments, rejected };
}
