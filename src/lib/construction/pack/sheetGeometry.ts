/**
 * Construction pack reading (docs/23 §6) — the DETERMINISTIC text-layer
 * extraction. PURE: given one page's positioned text items, pull out everything
 * the drawing already prints — scale, levels, printed heights, pitch, dimension
 * strings and chains, grid lines, room areas, feature labels, spot levels, the
 * wall legend and datum notes. No AI, no arithmetic beyond unit conversion and
 * reporting where a printed number sits.
 *
 * The model is later given this as the sheet's candidate list, and the engine uses
 * it to VERIFY every string the model cites (docs/23 §14 V1–V2).
 *
 * Real-pack quirks handled here (all seen in the fixtures):
 *   - "m²" arrives as two items ("50.467 m" + "2")                         (KE)
 *   - "77800 (-350)" is printed without its decimal point                  (KE)
 *   - "6560WALLPLATE" / "3300DPC TO UNDERSIDE OF SOFFIT" glue number + word (CBAND)
 *   - thousands commas "28,903" vs plain "20793"                           (KE / CBAND)
 */

/** One text item from the text layer. PDF coordinates: points, origin bottom-left. */
export interface TextItem {
  s: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the text runs vertically (a vertical dimension). */
  vertical: boolean;
}

export interface LevelMarker {
  /** Metres relative to the project datum (e.g. +9.725). */
  valueM: number;
  name: string;
  /** Absolute level (AOD) when printed in brackets. */
  aodM: number | null;
  raw: string;
}

export type HeightFrom = "DPC" | "FFL" | "GROUND";
export type HeightTo = "SOFFIT" | "WALLPLATE" | "TRUSS" | "CEILING" | "RIDGE" | "EAVES" | "PARAPET" | "OTHER";

export interface PrintedHeight {
  mm: number;
  from: HeightFrom;
  to: HeightTo;
  raw: string;
  x: number;
  y: number;
}

export interface DimensionString {
  mm: number;
  raw: string;
  x: number;
  y: number;
  vertical: boolean;
}

export interface DimensionChain {
  vertical: boolean;
  /** Horizontal chain: its y; vertical chain: its x. */
  at: number;
  items: DimensionString[];
  sumMm: number;
}

export interface GridLine {
  label: string;
  /** x of a vertical grid line (letters, usually) or y of a horizontal one. */
  posPt: number;
}

export interface GridSpacing {
  from: string;
  to: string;
  /** Measured from the bubble positions at the printed scale. */
  measuredMm: number;
  /** Sum of the printed dimensions found between the two lines, when they agree. */
  printedMm: number | null;
}

export interface GridSystem {
  vertical: GridLine[]; // ordered by x
  horizontal: GridLine[]; // ordered top → bottom
  spacings: GridSpacing[];
}

export interface RoomArea {
  label: string;
  areaM2: number;
  raw: string;
}

export interface LabelHit {
  label: string;
  count: number;
}

export interface SpotLevel {
  aodM: number;
  /** Relative to FFL in mm, when printed in brackets. */
  relMm: number | null;
  raw: string;
  x: number;
  y: number;
}

export interface SheetGeometry {
  scale: string | null;
  /** Millimetres on site per PDF point at the printed scale (1:50 → 17.64). */
  mmPerPt: number | null;
  levels: LevelMarker[];
  heights: PrintedHeight[];
  /** "6560WALLPLATE", "O/A WALLPLATE 8560" — lengths along the wall plate. */
  wallplates: { mm: number; raw: string }[];
  pitchesDeg: number[];
  dimensions: DimensionString[];
  chains: DimensionChain[];
  grid: GridSystem;
  rooms: RoomArea[];
  labels: LabelHit[];
  spotLevels: SpotLevel[];
  /** Wall thicknesses printed in a wall legend (finished face), mm. */
  wallLegendMm: number[];
  datumNotes: string[];
  doNotScale: boolean;
}

const MM_PER_PT = 25.4 / 72;

export function mmPerPtFor(scale: string | null): number | null {
  const m = scale ? /^1:(\d{1,4})$/.exec(scale) : null;
  return m ? MM_PER_PT * Number(m[1]) : null;
}

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Joined text with an item separator, for patterns that span items. */
export function joinItems(items: TextItem[]): string {
  return items.map((i) => i.s.trim()).filter(Boolean).join(" | ");
}

// --- Levels --------------------------------------------------------------------------

const LEVEL_RX =
  /([+±±-]?\d{1,3}\.\d{3})\s*\|\s*(-?\d{1,2})\s+([A-Za-z0-9][A-Za-z0-9 .\-]{1,40}?)\s*(?:\((\d{1,4}\.\d{3})\))?\s*(?=\||$)/g;

export function extractLevels(joined: string): LevelMarker[] {
  const out = new Map<string, LevelMarker>();
  for (const m of joined.matchAll(LEVEL_RX)) {
    const v = Number(m[1].replace(/[±±+]/g, ""));
    if (!Number.isFinite(v)) continue;
    const name = m[3].trim();
    // A level marker's name reads like a level ("RF-Roof", "02 - Second Floor",
    // "Parapet") — not a room or a note.
    if (!/floor|roof|parapet|found|level|ground|basement|mezz|eaves|ridge|plant|deck|\b(GF|FF|SF|RF|L\d)\b/i.test(name)) continue;
    const key = `${v}|${name.toUpperCase()}`;
    if (!out.has(key)) out.set(key, { valueM: v, name, aodM: m[4] ? Number(m[4]) : null, raw: m[0].trim() });
  }
  return [...out.values()].sort((a, b) => a.valueM - b.valueM);
}

// --- Printed heights (house-builder style) ----------------------------------------------

function heightTo(text: string): HeightTo {
  const t = text.toLowerCase();
  if (/soffit/.test(t)) return "SOFFIT";
  if (/wall\s*plate/.test(t)) return "WALLPLATE";
  if (/truss/.test(t)) return "TRUSS";
  if (/ceiling|\bfcl\b/.test(t)) return "CEILING";
  if (/ridge/.test(t)) return "RIDGE";
  if (/eaves/.test(t)) return "EAVES";
  if (/parapet|coping/.test(t)) return "PARAPET";
  return "OTHER";
}

export function extractHeights(items: TextItem[]): PrintedHeight[] {
  const out: PrintedHeight[] = [];
  for (const it of items) {
    const s = it.s.trim();
    // "3300 DPC TO U/S SOFFIT", "3300DPC TO UNDERSIDE OF SOFFIT", "4882 FFL - FCL", "3750 DPC - TOP OF WALLPLATE"
    let m = /^(\d{3,5})\s*(DPC|FFL|FGL|GL)\b\s*(?:TO\b|-|–)?\s*(.+)$/i.exec(s);
    if (m) {
      const to = heightTo(m[3]);
      if (to === "OTHER") continue;
      const from: HeightFrom = /dpc/i.test(m[2]) ? "DPC" : /ffl/i.test(m[2]) ? "FFL" : "GROUND";
      out.push({ mm: Number(m[1]), from, to, raw: s, x: it.x, y: it.y });
      continue;
    }
    // "2990 Floor to ceiling"
    m = /^(\d{3,5})\s*floor\s*to\s*(ceiling|soffit)/i.exec(s);
    if (m) out.push({ mm: Number(m[1]), from: "FFL", to: heightTo(m[2]), raw: s, x: it.x, y: it.y });
  }
  return out;
}

export function extractWallplates(items: TextItem[]): { mm: number; raw: string }[] {
  const out: { mm: number; raw: string }[] = [];
  for (const it of items) {
    const s = it.s.trim();
    const m = /^(\d{3,5})\s*WALL\s*PLATE$/i.exec(s) ?? /^O\/A\s*WALL\s*PLATE\s*(\d{3,5})$/i.exec(s);
    if (m) out.push({ mm: Number(m[1]), raw: s });
  }
  return out;
}

export function extractPitches(items: TextItem[]): number[] {
  const out = new Set<number>();
  for (const it of items) {
    const m = /^(\d{1,2}(?:\.\d{1,2})?)\s*°$/.exec(it.s.trim());
    if (m) {
      const v = Number(m[1]);
      if (v > 0 && v < 90) out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}

// --- Dimensions + chains -----------------------------------------------------------------

/** A printed millimetre dimension: "303", "20793", "28,903", "1,500". */
export function parseDimension(raw: string): number | null {
  const s = raw.trim();
  if (!/^(\d{1,3}(?:,\d{3})+|\d{2,6})$/.test(s)) return null;
  const v = Number(s.replace(/,/g, ""));
  return Number.isFinite(v) && v >= 10 ? v : null;
}

export function extractDimensions(items: TextItem[]): DimensionString[] {
  const out: DimensionString[] = [];
  for (const it of items) {
    const mm = parseDimension(it.s);
    if (mm != null) out.push({ mm, raw: it.s.trim(), x: it.x, y: it.y, vertical: it.vertical });
  }
  return out;
}

/** Group dimension strings that sit on one line into ordered chains. */
export function buildChains(dims: DimensionString[], tolPt = 1.5): DimensionChain[] {
  const chains: DimensionChain[] = [];
  for (const vertical of [false, true]) {
    const pool = dims.filter((d) => d.vertical === vertical);
    const coord = (d: DimensionString) => (vertical ? d.x : d.y);
    const along = (d: DimensionString) => (vertical ? d.y : d.x);
    const sorted = [...pool].sort((a, b) => coord(a) - coord(b));
    let cur: DimensionString[] = [];
    const flush = () => {
      if (cur.length === 0) return;
      const items = [...cur].sort((a, b) => (vertical ? along(b) - along(a) : along(a) - along(b)));
      chains.push({
        vertical,
        at: round(cur.reduce((s, d) => s + coord(d), 0) / cur.length, 1),
        items,
        sumMm: items.reduce((s, d) => s + d.mm, 0),
      });
      cur = [];
    };
    for (const d of sorted) {
      if (cur.length && Math.abs(coord(d) - coord(cur[cur.length - 1])) > tolPt) flush();
      cur.push(d);
    }
    flush();
  }
  return chains;
}

// --- Grid ---------------------------------------------------------------------------------

/**
 * Grid bubbles: large single letters / small numbers printed at the sheet edges,
 * each label appearing at both ends of its line. A vertical line's bubbles share
 * an x; a horizontal line's share a y. A system needs ≥ 3 lines on an axis.
 */
export function extractGrid(items: TextItem[], mmPerPt: number | null, dims: DimensionString[]): GridSystem {
  const heights = items.map((i) => i.h).filter((h) => h > 0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const minH = Math.max(6, median * 1.4); // KE: body text ~7.8 pt, grid bubbles ~13–16 pt
  const cands = items.filter((i) => /^([A-Z]{1,2}|\d{1,2})$/.test(i.s.trim()) && i.h >= minH && !i.vertical);

  const byLabel = new Map<string, TextItem[]>();
  for (const c of cands) byLabel.set(c.s.trim(), [...(byLabel.get(c.s.trim()) ?? []), c]);

  const vertical: GridLine[] = [];
  const horizontal: GridLine[] = [];
  for (const [label, occ] of byLabel) {
    if (occ.length < 2) continue;
    // Pairs aligned on x (a vertical line) or on y (a horizontal line).
    const xs = occ.map((o) => o.x);
    const ys = occ.map((o) => o.y);
    const spreadX = Math.max(...xs) - Math.min(...xs);
    const spreadY = Math.max(...ys) - Math.min(...ys);
    if (spreadX < 3 && spreadY > 50) vertical.push({ label, posPt: xs.reduce((a, b) => a + b, 0) / xs.length });
    else if (spreadY < 3 && spreadX > 50) horizontal.push({ label, posPt: ys.reduce((a, b) => a + b, 0) / ys.length });
  }
  vertical.sort((a, b) => a.posPt - b.posPt);
  horizontal.sort((a, b) => b.posPt - a.posPt); // top of the sheet first

  const keepAxis = (lines: GridLine[]) => (lines.length >= 3 ? lines : []);
  const v = keepAxis(vertical);
  const h = keepAxis(horizontal);

  const spacings: GridSpacing[] = [];
  if (mmPerPt) {
    const addAxis = (lines: GridLine[], isVertical: boolean) => {
      for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i];
        const b = lines[i + 1];
        const measuredMm = Math.abs(b.posPt - a.posPt) * mmPerPt;
        // A printed dimension placed between the two lines, running along the axis,
        // within 2% of the measured spacing, confirms it.
        const lo = Math.min(a.posPt, b.posPt);
        const hi = Math.max(a.posPt, b.posPt);
        const printed = dims.find(
          (d) =>
            d.vertical === !isVertical &&
            (isVertical ? d.x > lo && d.x < hi : d.y > lo && d.y < hi) &&
            Math.abs(d.mm - measuredMm) <= Math.max(50, measuredMm * 0.02),
        );
        spacings.push({ from: a.label, to: b.label, measuredMm: round(measuredMm, 0), printedMm: printed?.mm ?? null });
      }
    };
    addAxis(v, true);
    addAxis(h, false);
  }
  return {
    vertical: v.map((l) => ({ ...l, posPt: round(l.posPt, 1) })),
    horizontal: h.map((l) => ({ ...l, posPt: round(l.posPt, 1) })),
    spacings,
  };
}

// --- Rooms, labels, spot levels, legend, datum ---------------------------------------------

const ROOM_RX = /([A-Za-z][A-Za-z0-9 /&'().-]{1,40}?)\s*\|\s*(?:CA|GIA|NIA|Area)\s*:?\s*\|?\s*(\d{1,4}\.\d{1,3})\s*m(?:²|2)?(?:\s*\|\s*2)?(?=\s*\||\s*$)/g;

export function extractRooms(joined: string): RoomArea[] {
  const out: RoomArea[] = [];
  const seen = new Set<string>();
  for (const m of joined.matchAll(ROOM_RX)) {
    const label = m[1].replace(/^.*\|\s*/, "").trim();
    const area = Number(m[2]);
    if (!label || !Number.isFinite(area) || area <= 0) continue;
    const key = `${label}|${area}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, areaM2: area, raw: m[0].trim() });
  }
  return out;
}

const LABELS: [string, RegExp][] = [
  ["Lift shaft", /^lift\s*shaft$/i],
  ["Lift", /^lift\s*0?\d{1,2}$/i],
  ["Stair core", /^stair\s*core(\s*\d+)?$/i],
  ["Escape stair", /^escape\s*stair$/i],
  ["Stair", /^stair\s*0?\d{1,2}$/i],
  ["Riser", /^(shaft\s*\d+\s*)?riser(\s*\d+)?$|^(elec|comms|mech)\s*riser$/i],
  ["LV", /^lv(\s*pit)?$/i],
  ["Loading bay", /^loading\s*bay$/i],
  ["Access hatch", /^access(\s*hatch)?$|^hatch$/i],
  ["Rooflight", /^roof\s*light$|^rooflight$|^sky\s*light$/i],
  ["Fire exit", /^fire\s*exit$/i],
  ["Parapet", /parapet/i],
  ["Gutter", /^gutter$/i],
  ["Plant", /^plant(\s*room)?$/i],
  ["Refuge", /^refuge$/i],
];

export function extractLabels(items: TextItem[]): LabelHit[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const s = it.s.trim();
    if (s.length > 40) continue;
    for (const [label, re] of LABELS)
      if (re.test(s)) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
        break;
      }
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Spot levels: "78.850 (+700)", "79.000 (+850)", "78000(-150)" and the decimal-less
 * "77800 (-350)" (read as 77.800). Survey points "S002 78.838" arrive as a bare
 * AOD number, taken only when `bareAod` is set (a survey sheet).
 */
export function extractSpotLevels(items: TextItem[], opts: { bareAod: boolean }): SpotLevel[] {
  const out: SpotLevel[] = [];
  for (const it of items) {
    const s = it.s.trim();
    let m = /^(\d{2,3}\.\d{2,3})\s*\(\s*([+-]?\d{1,4})\s*\)$/.exec(s);
    if (m) {
      out.push({ aodM: Number(m[1]), relMm: Number(m[2]), raw: s, x: it.x, y: it.y });
      continue;
    }
    m = /^(\d{5})\s*\(\s*([+-]?\d{1,4})\s*\)$/.exec(s);
    if (m) {
      out.push({ aodM: Number(m[1]) / 1000, relMm: Number(m[2]), raw: s, x: it.x, y: it.y });
      continue;
    }
    if (opts.bareAod) {
      m = /^(\d{1,3}\.\d{2,3})$/.exec(s);
      if (m) out.push({ aodM: Number(m[1]), relMm: null, raw: s, x: it.x, y: it.y });
    }
  }
  return out;
}

export function extractWallLegend(joined: string): number[] {
  const out = new Set<number>();
  for (const m of joined.matchAll(/(\d{2,4}(?:\.\d)?)\s*MM\s*THICK\s*(?:CAVITY\s*)?WALL/gi)) out.add(Number(m[1]));
  return [...out];
}

export function extractDatumNotes(joined: string): { notes: string[]; doNotScale: boolean } {
  const notes: string[] = [];
  const m = /ALL DIMENSIONS[^|]*(?:\|[^|]*){0,2}/i.exec(joined);
  if (m) notes.push(m[0].replace(/\s*\|\s*/g, " ").trim());
  const doNotScale = /do not scale/i.test(joined);
  return { notes, doNotScale };
}

// --- The whole sheet ------------------------------------------------------------------------

export function sheetGeometry(
  items: TextItem[],
  opts: { scale: string | null; kind: string },
): SheetGeometry {
  const joined = joinItems(items);
  const mmPerPt = mmPerPtFor(opts.scale);
  const dimensions = extractDimensions(items);
  const chains = buildChains(dimensions);
  const { notes, doNotScale } = extractDatumNotes(joined);
  return {
    scale: opts.scale,
    mmPerPt: mmPerPt != null ? round(mmPerPt, 4) : null,
    levels: extractLevels(joined),
    heights: extractHeights(items),
    wallplates: extractWallplates(items),
    pitchesDeg: extractPitches(items),
    // Capped so the stored JSON stays small on a busy A1 sheet.
    dimensions: dimensions.slice(0, 600),
    chains: chains.filter((c) => c.items.length >= 1).slice(0, 200),
    grid: extractGrid(items, mmPerPt, dimensions),
    rooms: extractRooms(joined),
    labels: extractLabels(items),
    spotLevels: extractSpotLevels(items, { bareAod: opts.kind === "SURVEY" }),
    wallLegendMm: extractWallLegend(joined),
    datumNotes: notes,
    doNotScale,
  };
}
