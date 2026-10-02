/**
 * The building model (docs/23 §9–§10, simplified 2026-10-02) — PURE, unit-tested.
 *
 * ONLY what we can get reliably is filled in automatically. The rule: a value is
 * filled when it is PRINTED on the drawings and read by code — and, for the
 * shape-dependent ones, when TWO independent sources agree:
 *
 *   - heights of each part (printed soffit / parapet / level heights) → lifts + band;
 *   - the external perimeter + corners, ONLY for a plain rectangle whose printed size
 *     the roof plan (or another floor) confirms;
 *   - the number of main gables, ONLY when the roof plan and the elevations agree;
 *   - printed clear heights and printed room areas — sources the estimator picks from.
 *
 * Anything weaker is never filled: it becomes a HINT (a suggestion the estimator can
 * use with one click) or nothing at all, and the estimator measures it on the drawing.
 * Every value carries its sources, a plain-words explanation and the ⚠ params it used.
 */

import type { SheetGeometry, PrintedHeight } from "../pack/sheetGeometry";
import type { ElevationRead, MarkupRead, PlanRead, RoofRead, SectionRead } from "../readers/schemas";
import { heightBracketFor, suggestedLiftsFor } from "../rules";
import { paramFlags, paramNumber, type ParamKey, type ResolvedParams } from "../params";
import { lengthStringToM, parseOutline, resolveOutline, type OutlineResult } from "./outline";
import type { HeightBracket } from "../types";

export type ReadKind = "PLAN" | "ELEVATION" | "SECTION" | "ROOF" | "MARKUP";

export interface SheetForModel {
  sheetId: string;
  title: string; // drawing number + title, for provenance
  kind: ReadKind;
  level: string | null;
  geometry: SheetGeometry | null;
  rawText: string;
  plan?: PlanRead;
  elevation?: ElevationRead;
  section?: SectionRead;
  roof?: RoofRead;
  markup?: MarkupRead;
}

export interface MeasurementDraft {
  key: string;
  label: string;
  /** PERIMETER_LM | COUNT | HEIGHT_M | AREA_M2 */
  kind: string;
  valueNumber: number;
  unit: "m" | "m²" | "nr" | "°";
  lifts: number | null;
  heightBracket: HeightBracket | null;
  /** high = two sources agree · medium = printed once. Nothing lower is ever filled. */
  confidence: "high" | "medium" | "low" | "unknown";
  /** The sources: each starts with the sheet title it came from. */
  provenance: string[];
  paramsUsed: ParamKey[];
  /** How we got it, in plain words. */
  note: string | null;
}

/** A suggestion that is NOT filled in — the estimator decides (one click to use it). */
export interface Hint {
  /** Which field it is for: ext-perimeter · gables. */
  target: string;
  /** The suggested value, or null when there is only an explanation. */
  value: number | null;
  /** For a perimeter suggestion: its corners. */
  corners?: number;
  text: string;
  sources: string[];
}

export interface BuildingModel {
  measurements: MeasurementDraft[];
  hints: Hint[];
  flags: string[];
  outline: OutlineResult | null;
  maxScaffoldHeightM: number | null;
  suggestedBracket: HeightBracket | null;
  /** Suggested external lifts at the highest scaffold (P1). */
  externalLifts: number | null;
  /** The printed level table (name → metres above the datum). */
  levels: { name: string; valueM: number }[];
}

export interface ModelContext {
  params: ResolvedParams;
  /** Proposed ground levels relative to FFL (mm) from the job's site plan, if any. */
  groundRelMm: number[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Is a string really printed on the sheet? (V1: whitespace-insensitive substring.) */
export function printedOn(sheet: SheetForModel, s: string | null | undefined): boolean {
  if (!s) return false;
  const norm = (x: string) => x.replace(/\s+/g, "").toLowerCase();
  return norm(sheet.rawText).includes(norm(s));
}

/** A height string like "3300 DPC TO U/S SOFFIT" or "+11.575" → metres. */
export function heightStringToM(s: string): number | null {
  const lvl = /^([+±±-]?\d{1,3}\.\d{3})\b/.exec(s.trim());
  if (lvl) return Number(lvl[1].replace(/[±±+]/g, ""));
  const mm = /^(\d{3,5})\b/.exec(s.trim());
  if (mm) return Number(mm[1]) / 1000;
  return lengthStringToM(s);
}

interface WallTop {
  valueM: number; // above its datum
  from: "DPC" | "FFL" | "DATUM";
  what: string; // soffit / parapet
  part: string;
  raw: string;
  sources: Set<string>;
}

export function buildBuildingModel(name: string, sheets: SheetForModel[], ctx: ModelContext): BuildingModel {
  const p = ctx.params;
  const out: MeasurementDraft[] = [];
  const hints: Hint[] = [];
  const flags: string[] = [];
  const push = (m: MeasurementDraft) => out.push(m);
  const liftH = paramNumber(p, "P1_liftHeightM");

  // ---------------- 1 · Heights of each part (printed, read by code) -----------------------
  const levels = new Map<string, { valueM: number; sheets: Set<string> }>();
  for (const s of sheets)
    for (const l of s.geometry?.levels ?? []) {
      const key = l.name.toUpperCase();
      const prev = levels.get(key);
      if (prev && Math.abs(prev.valueM - l.valueM) > 0.001)
        flags.push(`Level "${l.name}" is printed as ${prev.valueM} and ${l.valueM} on different sheets — check which is right`);
      if (!prev) levels.set(key, { valueM: l.valueM, sheets: new Set([s.title]) });
      else prev.sheets.add(s.title);
    }

  const wallTops: WallTop[] = [];
  const addTop = (t: Omit<WallTop, "sources">, source: string) => {
    const same = wallTops.find((w) => Math.abs(w.valueM - t.valueM) < 0.001 && w.from === t.from && w.what === t.what);
    if (same) {
      same.sources.add(source);
      if (same.part === "whole building" && t.part !== "whole building") same.part = t.part;
    } else wallTops.push({ ...t, sources: new Set([source]) });
  };
  // Pitched roof: printed soffit / eaves heights. The NUMBER is read by code; only the
  // name of the part it belongs to comes from the reader (the estimator can change it).
  for (const s of sheets) {
    if (s.kind !== "ELEVATION" && s.kind !== "SECTION") continue;
    const printed: PrintedHeight[] = s.geometry?.heights ?? [];
    const reads = s.elevation?.heights ?? s.section?.heights ?? [];
    for (const h of printed) {
      if (h.to !== "SOFFIT" && h.to !== "EAVES") continue;
      const read = reads.find((r) => r.string.replace(/\s+/g, "").toUpperCase() === h.raw.replace(/\s+/g, "").toUpperCase() || heightStringToM(r.string) === h.mm / 1000);
      addTop({ valueM: h.mm / 1000, from: h.from === "FFL" ? "FFL" : "DPC", what: "soffit", part: read?.appliesTo?.trim() || "whole building", raw: h.raw }, s.title);
    }
  }
  // Flat roof with a parapet: the parapet level (above the FFL datum).
  const parapet = [...levels.entries()].find(([k]) => /PARAPET/.test(k));
  if (parapet && wallTops.length === 0)
    for (const src of parapet[1].sheets)
      addTop({ valueM: parapet[1].valueM, from: "DATUM", what: "top of parapet", part: "whole building", raw: `${parapet[0]} +${parapet[1].valueM.toFixed(3)}` }, src);

  const dpc = paramNumber(p, "P2b_dpcAboveGroundM");
  const lowestGroundRel = ctx.groundRelMm.length ? Math.min(...ctx.groundRelMm) / 1000 : null;
  let maxH: number | null = null;
  for (const t of wallTops.sort((a, b) => b.valueM - a.valueM)) {
    let h: number;
    const used: ParamKey[] = ["P1_liftHeightM", "P2_wallTopDatum", "P3_bandFrom"];
    let basis: string;
    if (t.from === "DPC") {
      h = t.valueM + dpc;
      used.push("P2b_dpcAboveGroundM");
      basis = `The drawings print "${t.raw}" (${t.valueM.toFixed(3)} m above the damp-proof course). Add ${dpc} m from the ground up to the DPC = ${r3(h)} m.`;
    } else if (lowestGroundRel != null) {
      h = t.valueM - lowestGroundRel;
      used.push("P2c_groundSource");
      basis = `The ${t.what} is printed at +${t.valueM.toFixed(3)} m above the floor. The lowest ground level printed on the site plan is ${lowestGroundRel >= 0 ? "+" : ""}${lowestGroundRel.toFixed(3)} m, so the scaffold is ${r3(h)} m high.`;
    } else {
      h = t.valueM + dpc;
      used.push("P2b_dpcAboveGroundM", "P2c_groundSource");
      basis = `The ${t.what} is printed at +${t.valueM.toFixed(3)} m above the floor. No ground levels are printed, so ${dpc} m is added for the step down to the ground = ${r3(h)} m.`;
    }
    h = r3(h);
    maxH = maxH == null ? h : Math.max(maxH, h);
    const lifts = suggestedLiftsFor(h, liftH);
    push({
      key: `height:${t.what}:${t.valueM}`,
      label: `Height — ${t.part}`,
      kind: "HEIGHT_M",
      valueNumber: h,
      unit: "m",
      lifts,
      heightBracket: heightBracketFor(h),
      confidence: t.sources.size >= 2 ? "high" : "medium",
      provenance: [...t.sources].map((src) => `${src}: "${t.raw}"`),
      paramsUsed: used,
      note: `${basis} ${r3(h)} m ÷ ${liftH} m per lift, rounded up = ${lifts} lift${lifts === 1 ? "" : "s"}.${t.sources.size >= 2 ? ` Printed the same on ${t.sources.size} sheets.` : " Printed on one sheet."}`,
    });
  }
  if (wallTops.length === 0) flags.push(`${name}: no printed wall-top height (soffit / parapet) — enter the height by hand`);
  const suggestedBracket = heightBracketFor(maxH);

  // ---------------- 2 · External perimeter: plain rectangles that a second source confirms ---
  const LEVEL_RANK = (l: string | null) => (l === "GF" ? 0 : l && /^(\d+)F$/.test(l) ? Number(l.slice(0, -1)) : 50);
  const plans = sheets.filter((s) => s.kind === "PLAN" && s.plan && s.plan.outline.length).sort((a, b) => LEVEL_RANK(a.level) - LEVEL_RANK(b.level));
  const tol = { tolAbsM: paramNumber(p, "P15_toleranceM"), tolRel: paramNumber(p, "P15_tolerancePct") / 100 };
  const resolvePlan = (s: SheetForModel) => {
    const { segments } = parseOutline(s.plan!.outline);
    const chains = (s.geometry?.chains ?? []).filter((c) => c.sumMm >= 1000);
    const overallMm = [false, true].flatMap((vertical) => {
      const cs = chains.filter((c) => c.vertical === vertical);
      if (!cs.length) return [];
      const lo = Math.min(...cs.map((c) => c.at));
      const hi = Math.max(...cs.map((c) => c.at));
      return cs.filter((c) => c.at === lo || c.at === hi).map((c) => c.sumMm);
    });
    return resolveOutline(segments, { printedMm: (s.geometry?.dimensions ?? []).map((d) => d.mm), grid: s.geometry?.grid ?? null, overallMm, ...tol });
  };
  const outlines = new Map<SheetForModel, OutlineResult>();
  for (const s of plans) outlines.set(s, resolvePlan(s));
  const roofSheet = sheets.find((s) => s.kind === "ROOF" && s.geometry);
  const roofOverall = roofSheet?.geometry
    ? {
        w: Math.max(0, ...roofSheet.geometry.chains.filter((c) => !c.vertical).map((c) => c.sumMm)) / 1000,
        d: Math.max(0, ...roofSheet.geometry.chains.filter((c) => c.vertical).map((c) => c.sumMm)) / 1000,
      }
    : null;
  const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.3, 0.02 * Math.max(a, b));
  const sameBox = (a: { w: number; d: number }, b: { w: number; d: number }) => (near(a.w, b.w) && near(a.d, b.d)) || (near(a.w, b.d) && near(a.d, b.w));
  const isRectangle = (o: OutlineResult) =>
    o.closes && o.orthogonal && o.segments.length === 4 && o.segments.every((sg) => sg.source === "PRINTED" || sg.source === "GRID_PRINTED") && o.boundingM != null;

  const base = plans[0];
  const outline = base ? outlines.get(base)! : null;
  if (base && outline && isRectangle(outline)) {
    const box = { w: outline.boundingM!.width, d: outline.boundingM!.depth };
    const confirms: string[] = [];
    if (roofOverall && roofOverall.w > 1 && roofOverall.d > 1 && sameBox(box, roofOverall))
      confirms.push(`${roofSheet!.title}: overall ${r3(roofOverall.w)} × ${r3(roofOverall.d)} m`);
    for (const [s, o] of outlines)
      if (s !== base && isRectangle(o) && sameBox(box, { w: o.boundingM!.width, d: o.boundingM!.depth }))
        confirms.push(`${s.title}: ${o.boundingM!.width} × ${o.boundingM!.depth} m`);
    const printed = outline.segments.slice(0, 2).map((sg) => `"${sg.provenance.split(" (")[0]}"`).join(" × ");
    const sources = [`${base.title}: ${printed}`, ...confirms];
    if (confirms.length) {
      push({
        key: "ext-perimeter",
        label: "External wall perimeter",
        kind: "PERIMETER_LM",
        valueNumber: outline.perimeterM!,
        unit: "m",
        lifts: null,
        heightBracket: null,
        confidence: "high",
        provenance: sources,
        paramsUsed: [],
        note: `A plain rectangle. The plan prints ${box.w} m by ${box.d} m, and ${confirms.length === 1 ? "another drawing agrees" : `${confirms.length} other drawings agree`}. 2 × (${box.w} + ${box.d}) = ${outline.perimeterM} m.`,
      });
      push({
        key: "ext-corners",
        label: "External corners",
        kind: "COUNT",
        valueNumber: 4,
        unit: "nr",
        lifts: null,
        heightBracket: null,
        confidence: "high",
        provenance: sources,
        paramsUsed: [],
        note: "A rectangle has 4 external corners.",
      });
    } else
      hints.push({
        target: "ext-perimeter",
        value: outline.perimeterM!,
        corners: 4,
        text: `The plan prints ${box.w} × ${box.d} m — a rectangle of ${outline.perimeterM} m. No other drawing confirms it, so it is only a suggestion.`,
        sources,
      });
  } else if (plans.length || roofOverall) {
    const box = roofOverall && roofOverall.w > 1 && roofOverall.d > 1 ? `The roof plan's overall size is ${r3(roofOverall.w)} × ${r3(roofOverall.d)} m — the box around the building, not its perimeter. ` : "";
    hints.push({
      target: "ext-perimeter",
      value: null,
      text: `${box}The building is not a plain rectangle, so the perimeter is not read automatically — measure it on the plan.`,
      sources: roofOverall ? [`${roofSheet!.title}: overall ${r3(roofOverall.w)} × ${r3(roofOverall.d)} m`] : [],
    });
  }

  // ---------------- 3 · Gables: filled only when the roof plan and the elevations agree -----
  const roofSheetRead = sheets.find((s) => s.kind === "ROOF" && s.roof);
  const roofRead = roofSheetRead?.roof;
  const elevs = sheets.filter((s) => s.kind === "ELEVATION" && s.elevation);
  const fromRoof = roofRead && roofRead.roofForm !== "UNKNOWN" ? roofRead.gables.filter((g) => g.kind === "MAIN").length : null;
  const fromElevs = elevs.length ? elevs.reduce((a, s) => a + s.elevation!.roof.apexes.filter((x) => x.kind === "MAIN").length, 0) : null;
  const gableSources = [
    ...(fromRoof != null ? [`${roofSheetRead!.title}: ${fromRoof} main gable${fromRoof === 1 ? "" : "s"} — ${roofRead!.gablesReason}`] : []),
    ...elevs.filter((s) => s.elevation!.roof.apexes.some((x) => x.kind === "MAIN")).map((s) => `${s.title}: ${s.elevation!.roof.apexes.filter((x) => x.kind === "MAIN").length} gable apex`),
  ];
  if (fromRoof != null && fromElevs != null && fromRoof === fromElevs) {
    push({
      key: "gables",
      label: "Main gables",
      kind: "COUNT",
      valueNumber: fromRoof,
      unit: "nr",
      lifts: null,
      heightBracket: null,
      confidence: "high",
      provenance: gableSources,
      paramsUsed: ["P9_gablesCounted"],
      note: `The roof plan and the elevations both show ${fromRoof} main gable${fromRoof === 1 ? "" : "s"} (porch / dormer gables are not counted).`,
    });
  } else if (fromRoof != null || fromElevs != null) {
    const one = fromRoof ?? fromElevs;
    hints.push({
      target: "gables",
      value: fromRoof != null && fromElevs != null ? null : one,
      text:
        fromRoof != null && fromElevs != null
          ? `The roof plan shows ${fromRoof} main gables but the elevations show ${fromElevs} — look at the drawings and enter the right number.`
          : `${fromRoof != null ? "The roof plan" : "The elevations"} show${fromRoof != null ? "s" : ""} ${one} main gable${one === 1 ? "" : "s"}, but nothing else confirms it.`,
      sources: gableSources,
    });
  }

  // ---------------- 4 · Sources the estimator picks from: clear heights, room areas ----------
  const seenClear = new Map<number, MeasurementDraft>();
  for (const s of sheets.filter((x) => x.kind === "SECTION")) {
    for (const h of s.section?.internalClearHeights ?? []) {
      if (!printedOn(s, h.string)) continue; // a number the reader saw must really be printed
      if (/\bDPC\b/i.test(h.string)) continue; // "3005 DPC to u/s truss" is not a clear height
      if (h.measures === "OTHER") continue; // only a height labelled as reaching a ceiling / truss / vault
      const m = heightStringToM(h.string);
      if (m == null || m < 1.5 || m > 30) continue;
      const prev = seenClear.get(m);
      if (prev) {
        if (!prev.provenance.some((x) => x.startsWith(s.title))) {
          prev.provenance.push(`${s.title}: ${h.room} "${h.string}"`);
          prev.confidence = "high";
        }
        continue;
      }
      const reach = paramNumber(p, "P6_internalReachM");
      const sugg = suggestedLiftsFor(Math.max(0.01, m - reach), liftH);
      const row: MeasurementDraft = {
        key: `clear:${m}`,
        label: `Clear height — ${h.room}`,
        kind: "HEIGHT_M",
        valueNumber: r3(m),
        unit: "m",
        lifts: null,
        heightBracket: null,
        confidence: "medium",
        provenance: [`${s.title}: ${h.room} "${h.string}"`],
        paramsUsed: [],
        note: `Printed on the section as "${h.string}" (floor to ${h.measures === "VAULT" ? "the vault" : h.measures === "UNDERSIDE_TRUSS" ? "the underside of the truss" : "the ceiling"}). As a rough guide it needs about ${sugg} lift${sugg === 1 ? "" : "s"} inside — you decide.`,
      };
      seenClear.set(m, row);
      push(row);
    }
  }
  for (const s of sheets.filter((x) => x.kind === "PLAN")) {
    (s.geometry?.rooms ?? []).forEach((room, i) =>
      push({
        key: `room:${s.level ?? s.sheetId}:${i}`,
        label: `${room.label}${s.level ? ` (${s.level})` : ""}`,
        kind: "AREA_M2",
        valueNumber: r2(room.areaM2),
        unit: "m²",
        lifts: null,
        heightBracket: null,
        confidence: "high",
        provenance: [`${s.title}: ${room.label} ${room.areaM2} m²`],
        paramsUsed: [],
        note: "The room's area is printed on the floor plan.",
      }),
    );
  }

  const used = [...new Set(out.flatMap((m) => m.paramsUsed))];
  return {
    measurements: out,
    hints,
    flags: [...flags, ...paramFlags(p, used)],
    outline,
    maxScaffoldHeightM: maxH,
    suggestedBracket,
    externalLifts: maxH != null ? suggestedLiftsFor(maxH, liftH) : null,
    levels: [...levels.entries()].map(([n, l]) => ({ name: n, valueM: l.valueM })),
  };
}
