/**
 * Scope mode, binding (docs/23 §11.2–§11.3, docs/22 §4.7–§4.8) — PURE, unit-tested.
 *
 * The SCOPE decides WHAT is priced; the DRAWINGS decide HOW MUCH (D5). Each scope
 * line the reader mapped to a picking-list item is bound to the building model's
 * measurements by a small, readable rule per item ROLE, and comes out as a draft
 * line carrying its quantity, lifts and band, the visible FORMULA, the provenance
 * chain, a confidence, the ⚠ params it used and its flags. Then:
 *
 *   - a client number and a drawing number → cross-checked, the drawing kept (D6);
 *   - a blank scope line → the drawing value ("blank means we measure");
 *   - nothing READ RELIABLY → blank for the estimator (never dropped, never guessed).
 *     Since 2026-10-02 only the reliable values fill a line: the external run (a
 *     confirmed rectangle, or the estimator's own measure), lifts from the printed
 *     height, gables, a birdcage area the estimator set, counts the scope states;
 *     everything else (slab / void / leading edges, risers, cores, blockwork …) is blank;
 *   - main gables the scope did not ask for → the INFORMATION list, never a line;
 *   - a section listed with nothing under it → "confirm none required".
 *
 * No pricing here (the server resolves rates on apply) and no AI.
 */

import type { ClientRef, DrawingDraftLine, LineStatus } from "./assemble";
import type { DrawingConfidence } from "./drawingSchema";
import type { BuildingModel } from "./model/buildingModel";
import { readBuildingCard, type BuildingCard, type MeasureRow } from "./cards";
import { paramFlags, paramNumber, paramString, type ParamKey, type ResolvedParams } from "./params";
import type { ReconciledDraftLine } from "./scopeDraft";
import type { ConstructionUnit, HeightBracket } from "./types";

export interface BindLibEl {
  id: string;
  name: string;
  aliases: string[];
  unit: ConstructionUnit;
  usesLifts: boolean;
  usesHeightBracket?: boolean;
  category?: string | null;
}

export interface BindBuilding {
  key: string;
  name: string;
  model: BuildingModel;
  /** The estimator's own measurements for this building (they beat the automatic ones). */
  manual?: MeasureRow[];
}

/** A drawing feature the scope did not ask for — shown, never priced (D5). */
export interface InfoItem {
  buildingKey: string | null;
  buildingName: string | null;
  label: string;
  value: string;
  note: string;
}

export interface ScopeAccount {
  /** Scope lines read (one per client line). */
  scopeLines: number;
  measured: number;
  stated: number;
  agrees: number;
  differs: number;
  measureByHand: number;
  unknownBasis: number;
  needsItem: number;
}

export interface BindResult {
  lines: DrawingDraftLine[];
  info: InfoItem[];
  emptySections: string[];
  account: ScopeAccount;
  flags: string[];
}

export type ItemRole =
  | "TEMP_STAIRS"
  | "TABLE_LIFT"
  | "APEX"
  | "A_FRAME"
  | "BRICK_GUARDS"
  | "BEAMS"
  | "RAKERS"
  | "CARRY"
  | "RAISED_FIRST_LIFT"
  | "INDEPENDENT"
  | "BOARDED_LIFT"
  | "TRIPLE"
  | "DOUBLE"
  | "SINGLE"
  | "TOE_BOARD"
  | "LADDER_BAY"
  | "LADDER_TOWER"
  | "HAKI"
  | "TOWER"
  | "LB_GATE"
  | "LB_PLATFORM"
  | "LOADING_BAY"
  | "CHUTE"
  | "ROOF_ACCESS"
  | "SLAB_EDGE"
  | "LEADING_EDGE"
  | "VOID_EDGE"
  | "ROOF_EDGE"
  | "TEMP_HANDRAIL"
  | "LIFT_GATE"
  | "FOAM"
  | "HOARDING"
  | "NETTING"
  | "BIRDCAGE"
  | "INTERNAL_ACCESS"
  | "LIFT_SHAFT"
  | "STAIR_CORE"
  | "RISER"
  | "MAT"
  | "INSPECTION"
  | "ADAPTION"
  | "DESIGN"
  | "DAYWORK"
  | "OTHER";

const ROLE_RULES: [RegExp, ItemRole][] = [
  [/temporary stair|stair set/, "TEMP_STAIRS"],
  [/table lift/, "TABLE_LIFT"],
  [/apex/, "APEX"],
  [/a-frame|a frame/, "A_FRAME"],
  [/brick guard/, "BRICK_GUARDS"],
  [/beams? over|\bbeams?\b/, "BEAMS"],
  [/raker/, "RAKERS"],
  [/carry time|\bcarry\b/, "CARRY"],
  [/raised first lift|first lift/, "RAISED_FIRST_LIFT"],
  [/loading bay gate|up and over gate/, "LB_GATE"],
  [/loading bay platform|offset loading|cantilever/, "LB_PLATFORM"],
  [/loading bay/, "LOADING_BAY"],
  [/haki|stair tower/, "HAKI"],
  [/ladder access bay|ladder bay/, "LADDER_BAY"],
  [/ladder tower/, "LADDER_TOWER"],
  [/additional boarded lift|boarded lift/, "BOARDED_LIFT"],
  [/independent scaffold|perimeter scaffold|working platform/, "INDEPENDENT"],
  [/scaffold tower|^tower/, "TOWER"],
  [/chute|skip bay/, "CHUTE"],
  [/roof access/, "ROOF_ACCESS"],
  [/slab edge/, "SLAB_EDGE"],
  [/leading edge/, "LEADING_EDGE"],
  [/opening|void edge|void protection/, "VOID_EDGE"],
  [/roof edge/, "ROOF_EDGE"],
  [/temporary handrail/, "TEMP_HANDRAIL"],
  [/triple (handrail|guardrail)/, "TRIPLE"],
  [/double handrail/, "DOUBLE"],
  [/single.*handrail|additional handrail/, "SINGLE"],
  [/toe board/, "TOE_BOARD"],
  [/lift gate|safegate/, "LIFT_GATE"],
  [/foam/, "FOAM"],
  [/hoarding|protection fan/, "HOARDING"],
  [/netting|sheeting|monarflex/, "NETTING"],
  [/birdcage|crash deck/, "BIRDCAGE"],
  [/internal access scaffold|blockwork/, "INTERNAL_ACCESS"],
  [/lift shaft/, "LIFT_SHAFT"],
  [/stair core|stairwell/, "STAIR_CORE"],
  [/riser/, "RISER"],
  [/scaffold mat|dummy lift/, "MAT"],
  [/inspection/, "INSPECTION"],
  [/adaption/, "ADAPTION"],
  [/design|tg20/, "DESIGN"],
  [/daywork|attendance/, "DAYWORK"],
];

/** The role a picking-list item plays, from its canonical name (works for the dev list and the real sheet). */
export function elementRole(name: string): ItemRole {
  const n = name.toLowerCase().replace(/^\(a\)\s*(con|trad|tf)\s*/, "");
  for (const [re, role] of ROLE_RULES) if (re.test(n)) return role;
  return "OTHER";
}

/** The area a line falls in when the client gave no section (P17): Airwright's quote sections. */
export function areaSection(role: ItemRole): string {
  switch (role) {
    case "BIRDCAGE":
      return "Internal Birdcage";
    case "INTERNAL_ACCESS":
    case "LIFT_SHAFT":
    case "STAIR_CORE":
    case "RISER":
      return "Internal";
    case "INSPECTION":
      return "Inspections";
    case "ADAPTION":
    case "DESIGN":
    case "DAYWORK":
      return "Extras";
    default:
      return "External";
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (n: number) => String(r3(n));
const CONF_RANK: Record<DrawingConfidence, number> = { high: 3, medium: 2, low: 1, unknown: 0 };
const minConf = (...cs: DrawingConfidence[]): DrawingConfidence =>
  cs.reduce((a, b) => (CONF_RANK[b] < CONF_RANK[a] ? b : a), "high" as DrawingConfidence);
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

interface Derived {
  quantity: number | null;
  lifts: number | null;
  bracket: HeightBracket | null;
  formula: string | null;
  provenance: string[];
  confidence: DrawingConfidence;
  params: ParamKey[];
  flags: string[];
  /** MEASURED by default; MEASURE_BY_HAND / UNKNOWN_BASIS when nothing could be derived. */
  status: LineStatus;
  used: string[]; // measurement keys consumed (for the information list)
}

const blank = (status: LineStatus, flag: string, params: ParamKey[] = []): Derived => ({
  quantity: null,
  lifts: null,
  bracket: null,
  formula: null,
  provenance: [],
  confidence: "unknown",
  params,
  flags: [flag],
  status,
  used: [],
});

/** A printed level name → the plan code ("01-First Floor" → 1F, "RF-Roof" → RF), else the name. */
export function levelCode(name: string): string {
  const n = name.toUpperCase();
  if (/\bGF\b|GROUND/.test(n)) return "GF";
  if (/\bRF\b|ROOF/.test(n)) return "RF";
  const ord: [RegExp, string][] = [
    [/FIRST|\b0?1\b|\b1(ST|F)\b/, "1F"],
    [/SECOND|\b0?2\b|\b2(ND|F)\b/, "2F"],
    [/THIRD|\b0?3\b|\b3(RD|F)\b/, "3F"],
    [/FOURTH|\b0?4\b|\b4(TH|F)\b/, "4F"],
  ];
  for (const [re, code] of ord) if (re.test(n)) return code;
  return name;
}

/** Floor levels above the ground (suspended slabs + roof), from the printed level table, as plan codes. */
export function levelsAboveGround(levels: { name: string; valueM: number }[]): string[] {
  return [
    ...new Set(
      levels
        .filter((l) => l.valueM > 0.5 && !/parapet|top|ridge|eaves|soffit|wallplate|copin|u\/s|datum|foundation/i.test(l.name))
        .sort((a, b) => a.valueM - b.valueM)
        .map((l) => levelCode(l.name)),
    ),
  ];
}

/** "Ground floor …" / "First floor …" / "Roof" in the client's wording → the level code. */
export function levelInWording(text: string): string | null {
  const t = text.toLowerCase();
  if (/\bground\b|\bgf\b/.test(t)) return "GF";
  if (/\bfirst\b|\b1st\b|\b1f\b/.test(t)) return "1F";
  if (/\bsecond\b|\b2nd\b|\b2f\b/.test(t)) return "2F";
  if (/\bthird\b|\b3rd\b|\b3f\b/.test(t)) return "3F";
  if (/\broof\b/.test(t)) return "RF";
  return null;
}

/** Is a stated number within the cross-check tolerance of the drawing's? (P15) */
export function withinTolerance(stated: number, drawing: number, p: ResolvedParams, count = false): boolean {
  if (count) return Math.round(stated) === Math.round(drawing);
  const tol = Math.max(paramNumber(p, "P15_toleranceM"), (paramNumber(p, "P15_tolerancePct") / 100) * Math.max(stated, drawing));
  return Math.abs(stated - drawing) <= tol + 1e-9;
}

// --- The rules -----------------------------------------------------------------------------

interface RuleCtx {
  item: ReconciledDraftLine;
  role: ItemRole;
  el: BindLibEl;
  b: BindBuilding;
  card: BuildingCard;
  p: ResolvedParams;
  longestHire: number | null;
}

/** The building's card: the reliable values, with the estimator's own beating the automatic. */
function cardOf(b: BindBuilding, p: ResolvedParams): BuildingCard {
  const auto: MeasureRow[] = b.model.measurements.map((m) => ({
    key: m.key,
    label: m.label,
    valueNumber: m.valueNumber,
    unit: m.unit,
    lifts: m.lifts,
    confidence: m.confidence,
    source: "DRAWING",
    provenance: m.provenance,
    note: m.note,
    buildingId: b.key,
    runId: "auto",
  }));
  return readBuildingCard([...auto, ...(b.manual ?? [])], b.key, p, b.model.hints);
}

const trustConf = (t: string): DrawingConfidence => (t === "printed" || t === "client" ? "medium" : t === "none" ? "unknown" : "high");

/** External lifts + band for a building, with the working. */
function externalLifts(card: BuildingCard): { lifts: number | null; bracket: HeightBracket | null; text: string | null } {
  const e = card.external;
  if (e.lifts.value == null) return { lifts: null, bracket: e.bracket, text: null };
  return { lifts: e.lifts.value, bracket: e.bracket, text: `${e.lifts.value} lifts${e.height.value != null ? ` (${e.height.value} m high)` : ""}` };
}

/** The scaffold run: the external perimeter + corner allowance — only when it was read reliably or measured. */
function scaffoldRun(ctx: RuleCtx): Derived {
  const { b, card } = ctx;
  const e = card.external;
  const ext = externalLifts(card);
  if (e.run.value == null)
    return {
      ...blank("MEASURE_BY_HAND", `${b.name}: the perimeter is not read automatically (not a plain rectangle that two drawings confirm) — measure it on the plan.`),
      lifts: ext.lifts,
      bracket: ext.bracket,
    };
  return {
    quantity: e.run.value,
    lifts: ext.lifts,
    bracket: ext.bracket,
    formula: ext.text ? `${e.run.why} · ${ext.text}` : e.run.why,
    provenance: [...(e.perimeter.row?.provenance ?? []), ...(e.height.row?.provenance ?? [])],
    confidence: e.perimeter.trust === "printed" ? "medium" : "high",
    params: ["P4_cornerAllowanceM", "P1_liftHeightM", "P3_bandFrom"],
    flags: [],
    status: "MEASURED",
    used: ["ext-perimeter"],
  };
}

function countFromScope(ctx: RuleCtx, what: string, lifts: { lifts: number | null; bracket: HeightBracket | null; text: string | null } | null, params: ParamKey[]): Derived {
  const n = ctx.item.statedCount ?? (ctx.item.quantity != null && Number.isInteger(ctx.item.quantity) ? ctx.item.quantity : null);
  if (n == null) {
    const d = blank("MEASURE_BY_HAND", `${what}: how many is your call — the scope gives no number.`, params);
    d.lifts = lifts?.lifts ?? null;
    d.bracket = lifts?.bracket ?? null;
    d.formula = lifts?.text ? `count to set · ${lifts.text}` : null;
    return d;
  }
  return {
    quantity: n,
    lifts: lifts?.lifts ?? null,
    bracket: lifts?.bracket ?? null,
    formula: `${n} (the scope's number)${lifts?.text ? ` · ${lifts.text}` : ""}`,
    provenance: [`scope: "${ctx.item.clientText}"`],
    confidence: "high",
    params,
    flags: [],
    status: "STATED",
    used: [],
  };
}

const fromCard = (value: number | null, formula: string, trust: string, provenance: string[], used: string[]): Derived | null =>
  value == null || value <= 0
    ? null
    : { quantity: value, lifts: null, bracket: null, formula, provenance, confidence: trustConf(trust), params: [], flags: [], status: "MEASURED", used };

export function deriveForItem(ctx: RuleCtx): Derived {
  const { item, role, b, p, card } = ctx;
  const words = norm(`${item.clientText} ${item.section ?? ""}`);
  const ext = externalLifts(card);
  const e = card.external;
  const byHand = (what: string): Derived =>
    item.quantity != null
      ? { quantity: item.quantity, lifts: null, bracket: null, formula: `${item.quantity} (the scope's figure)`, provenance: [`scope: "${item.clientText}"`], confidence: "medium", params: [], flags: [], status: "STATED", used: [] }
      : blank("MEASURE_BY_HAND", `${what}: not read automatically — enter it, or measure it on the drawing.`);
  switch (role) {
    case "INDEPENDENT":
      return scaffoldRun(ctx);
    case "BOARDED_LIFT": {
      const run = scaffoldRun(ctx);
      const basis = paramString(p, "P19_boardedLiftsAtEachLevel");
      const above = levelsAboveGround(b.model.levels);
      const lifts = basis === "EVERY_LIFT" ? ext.lifts : above.length || null;
      if (run.quantity == null) return { ...run, lifts, params: ["P19_boardedLiftsAtEachLevel"] };
      return {
        ...run,
        lifts,
        formula: `${fmt(run.quantity)} m scaffold run · ${lifts ?? "?"} boarded lift${lifts === 1 ? "" : "s"} (${basis === "EVERY_LIFT" ? "every lift" : `one per floor level above ground: ${above.join(", ") || "none printed"}`})`,
        params: [...run.params, "P19_boardedLiftsAtEachLevel"],
        flags: lifts == null ? [...run.flags, "No floor levels above ground are printed — set the boarded lifts by hand."] : run.flags,
      };
    }
    case "TRIPLE":
    case "DOUBLE":
    case "SINGLE":
    case "TOE_BOARD": {
      if (/\broof\b/.test(words)) return byHand(ctx.el.name);
      const run = scaffoldRun(ctx);
      return { ...run, lifts: null, formula: run.quantity != null ? `${fmt(run.quantity)} m — along the scaffold run, at the top lift` : null };
    }
    case "LADDER_BAY":
    case "LADDER_TOWER":
    case "TOWER":
    case "CHUTE":
      return countFromScope(ctx, ctx.el.name, ext, ["P1_liftHeightM"]);
    case "HAKI":
      return countFromScope(ctx, ctx.el.name, ext, ["P7_hakiLifts", "P1_liftHeightM"]);
    case "LOADING_BAY":
    case "LB_PLATFORM":
      return countFromScope(ctx, ctx.el.name, ext, ["P8_loadingBayLifts", "P1_liftHeightM"]);
    case "TEMP_STAIRS":
    case "LB_GATE":
    case "MAT":
    case "FOAM":
    case "RAKERS":
    case "LIFT_GATE":
    case "RISER":
    case "ROOF_ACCESS":
      return countFromScope(ctx, ctx.el.name, null, []);
    case "LIFT_SHAFT":
    case "STAIR_CORE": {
      // "Stair core 2 access scaffold" names ONE core: that is the scope's own count.
      const named = /\b(core|shaft|lift|stair)\s*\d+\b|\b\d+\s*(core|shaft)\b/i.test(item.clientText);
      if (named && item.statedCount == null)
        return { ...countFromScope({ ...ctx, item: { ...item, statedCount: 1 } }, ctx.el.name, ext, ["P1_liftHeightM"]), formula: `1 — the scope names one ${role === "LIFT_SHAFT" ? "shaft" : "core"}${ext.text ? ` · ${ext.text}, a guide` : ""}` };
      return countFromScope(ctx, ctx.el.name, ext, ["P1_liftHeightM"]);
    }
    case "TABLE_LIFT":
    case "APEX":
      return (
        fromCard(e.gables.value, `${e.gables.value} — one per main gable`, e.gables.trust, e.gables.row?.provenance ?? [], ["gables"]) ??
        byHand(ctx.el.name)
      );
    case "NETTING":
      return (
        fromCard(
          e.run.value != null && e.height.value != null ? Math.round(e.run.value * e.height.value * 100) / 100 : null,
          `${e.run.value} m run × ${e.height.value} m high`,
          e.perimeter.trust,
          e.perimeter.row?.provenance ?? [],
          ["ext-perimeter"],
        ) ?? byHand(ctx.el.name)
      );
    case "BRICK_GUARDS":
    case "RAISED_FIRST_LIFT":
      return fromCard(e.run.value, `${e.run.value} m — along the scaffold run`, e.perimeter.trust, e.perimeter.row?.provenance ?? [], ["ext-perimeter"]) ?? byHand(ctx.el.name);
    case "BIRDCAGE": {
      const a = card.birdcage.area;
      const d = fromCard(a.value, `${a.value} m² (${a.why})`, a.trust, a.row?.provenance ?? [], ["bc-area"]);
      return d ? { ...d, lifts: card.birdcage.lifts.value } : byHand("Birdcage area");
    }
    case "INSPECTION": {
      // The row's own hire (Wren: "1 nr × 7 weeks"), else the longest hire on the scope (P16).
      const weeks = item.hireWeeks ?? ctx.longestHire;
      if (weeks == null) return blank("MEASURE_BY_HAND", "Inspections: no hire weeks in the scope — set the number of weeks.", ["P16_inspectionWeeks"]);
      return {
        quantity: weeks,
        lifts: null,
        bracket: null,
        formula: item.hireWeeks != null ? `${weeks} weekly inspections (the row's hire)` : `${weeks} weekly inspections (the longest hire on the scope)`,
        provenance: [],
        confidence: "medium",
        params: item.hireWeeks != null ? [] : ["P16_inspectionWeeks"],
        flags: [],
        status: "MEASURED",
        used: [],
      };
    }
    case "ADAPTION":
    case "DESIGN":
    case "CARRY":
      return { quantity: item.quantity ?? 1, lifts: null, bracket: null, formula: "1 item — rate set by hand", provenance: [`scope: "${item.clientText}"`], confidence: "medium", params: [], flags: ["Price this item by hand."], status: "STATED", used: [] };
    default:
      // Slab / void / leading edges, roof edges, blockwork, temporary handrails…: not read
      // reliably from drawings, so they are the estimator's to measure.
      return byHand(ctx.el.name);
  }
}

// --- Binding --------------------------------------------------------------------------------

/** Which building(s) a scope line belongs to: named in its wording / location, else all of them. */
export function buildingsFor(item: ReconciledDraftLine, buildings: BindBuilding[]): BindBuilding[] {
  if (buildings.length <= 1) return buildings;
  const hay = norm(`${item.clientText} ${item.location ?? ""} ${item.section ?? ""}`);
  const hit = buildings.filter((b) =>
    norm(b.name)
      .split(" ")
      .filter((w) => w.length > 3)
      .some((w) => hay.includes(w)),
  );
  return hit.length ? hit : buildings;
}

/** Roles that are measured per building; the rest are one line for the job. */
const PER_BUILDING = new Set<ItemRole>([
  "INDEPENDENT",
  "BOARDED_LIFT",
  "TRIPLE",
  "DOUBLE",
  "SINGLE",
  "TOE_BOARD",
  "SLAB_EDGE",
  "VOID_EDGE",
  "ROOF_EDGE",
  "LIFT_GATE",
  "BIRDCAGE",
  "RISER",
  "LIFT_SHAFT",
  "STAIR_CORE",
  "ROOF_ACCESS",
  "FOAM",
]);

const COUNT_UNITS = new Set<ConstructionUnit>(["NR", "NR_PER_LIFT"]);

/** Sections the client listed with nothing under them ("confirm none required"). */
export function emptySectionsOf(items: ReconciledDraftLine[], sections: string[], emptyTableSections: string[] = []): string[] {
  const withLines = new Set(items.map((i) => norm(i.section ?? "")).filter(Boolean));
  return [...new Set([...emptyTableSections, ...sections].map((s) => s.trim()).filter(Boolean))].filter((s) => !withLines.has(norm(s)));
}

export interface BindInput {
  items: ReconciledDraftLine[];
  buildings: BindBuilding[];
  library: BindLibEl[];
  params: ResolvedParams;
  /** Every section heading of the scope (the reader's list + the tables'). */
  sections: string[];
  /** Section headings a schedule table shows with nothing under them. */
  emptyTableSections?: string[];
  /** Lines already drafted from a numbered mark-up (Wren): their items are not re-derived. */
  markupLines?: DrawingDraftLine[];
}

export function bindScope(input: BindInput): BindResult {
  const { items, buildings, library, params: p } = input;
  const byId = new Map(library.map((e) => [e.id, e]));
  const lines: DrawingDraftLine[] = [];
  const flags: string[] = [];
  const usedKeys = new Map<string, Set<string>>(); // building → measurement keys used
  const rolesAsked = new Set<ItemRole>();
  const hires = items.map((i) => i.hireWeeks).filter((w): w is number => w != null && w > 0);
  const longestHire = hires.length ? Math.max(...hires) : null;
  const account: ScopeAccount = { scopeLines: items.length, measured: 0, stated: 0, agrees: 0, differs: 0, measureByHand: 0, unknownBasis: 0, needsItem: 0 };

  // A numbered mark-up (Wren) already measured some items: give those lines the
  // client's row (hire, section) instead of deriving them again.
  const markup = (input.markupLines ?? []).map((l) => ({ ...l }));
  const markupTaken = new Set<number>();

  const clientRefOf = (i: ReconciledDraftLine): ClientRef => ({
    text: i.clientText,
    rowRef: i.rowRef,
    sheet: i.sheet,
    section: i.section,
    itemRef: i.itemRef,
    location: i.location,
    statedQuantity: i.quantity,
    statedLifts: i.lifts,
    statedCount: i.statedCount,
    hireWeeks: i.hireWeeks,
  });

  for (const item of items) {
    const el = item.elementId ? byId.get(item.elementId) : undefined;
    if (!el) {
      account.needsItem++;
      lines.push({
        elementId: null,
        description: item.clientText || "Unmatched scope line",
        unit: "NR",
        quantity: item.quantity,
        lifts: item.lifts,
        heightBracket: null,
        confidence: "low",
        note: item.note,
        needsItem: true,
        hireWeeks: item.hireWeeks,
        section: item.section,
        buildingId: buildings.length === 1 ? buildings[0].key : null,
        formula: null,
        provenance: [`scope: "${item.clientText}"`],
        paramsUsed: [],
        flags: [...(item.flags ?? []), item.invented ? "The reader proposed an item that is not on the picking list — choose one." : "No picking-list item matched — choose one, or add it as a one-off."],
        clientRef: clientRefOf(item),
        status: "NEEDS_ITEM",
        suggestedElementId: null,
      });
      continue;
    }
    const role = elementRole(el.name);
    rolesAsked.add(role);

    // A numbered mark-up (Wren) already measured this item: pair the scope row with ONE
    // of its lines — same lifts first, then the nearest quantity — and cross-check it.
    // Once every mark-up line of the item is paired, a further mention is covered.
    const ofItem = markup.map((l, i) => ({ l, i })).filter((x) => x.l.elementId === el.id);
    if (ofItem.length) {
      const free = ofItem.filter((x) => !markupTaken.has(x.i));
      const stated = item.quantity ?? item.statedCount;
      const score = (x: { l: DrawingDraftLine }) =>
        (item.lifts != null && x.l.lifts === item.lifts ? 0 : 1e6) + (stated != null && x.l.quantity != null ? Math.abs(x.l.quantity - stated) : 0);
      const pick = free.sort((a, b) => score(a) - score(b))[0];
      if (pick) {
        markupTaken.add(pick.i);
        const l = pick.l;
        l.hireWeeks = item.hireWeeks ?? l.hireWeeks ?? null;
        l.section = item.section ?? areaSection(role);
        l.clientRef = clientRefOf(item);
        l.suggestedElementId = el.id;
        if (item.flags?.length) l.flags = [...(l.flags ?? []), ...item.flags];
        l.buildingId = l.buildingId ?? (buildings.length === 1 ? buildings[0].key : null);
        l.formula = l.formula ?? `${l.quantity ?? "?"}${l.lifts != null ? ` × ${l.lifts} lifts` : ""} — written on the mark-up`;
        const isCount = COUNT_UNITS.has(el.unit);
        if (stated != null && l.quantity != null && role !== "INSPECTION") {
          if (withinTolerance(stated, l.quantity, p, isCount)) l.status = "AGREES";
          else {
            l.status = "DIFFERS";
            l.flags = [...(l.flags ?? []), `The client says ${stated}, the mark-up gives ${fmt(l.quantity)} — the mark-up value is used; check.`];
          }
        } else l.status = "MEASURED";
        if (l.status === "AGREES") account.agrees++;
        else if (l.status === "DIFFERS") account.differs++;
        else account.measured++;
      } else account.measured++; // covered by a mark-up line another row already paired
      continue;
    }

    const targets = PER_BUILDING.has(role) ? buildingsFor(item, buildings) : buildings.slice(0, 1);
    if (targets.length === 0) {
      // No drawings at all: the client's figure (Stanmore), or measure by hand.
      const stated = item.quantity ?? item.statedCount;
      const status: LineStatus = stated != null ? "STATED" : "MEASURE_BY_HAND";
      if (status === "STATED") account.stated++;
      else account.measureByHand++;
      lines.push({
        elementId: el.id,
        description: el.name,
        unit: el.unit,
        quantity: stated,
        lifts: el.usesLifts ? item.lifts : null,
        heightBracket: null,
        confidence: stated != null ? item.confidence : "unknown",
        note: [item.quantityBasis, item.note].filter(Boolean).join(" · ") || null,
        needsItem: false,
        hireWeeks: item.hireWeeks,
        section: item.section ?? areaSection(role),
        buildingId: null,
        formula: stated != null ? `${stated} (the scope's figure${item.quantityBasis ? `: ${item.quantityBasis}` : ""})` : null,
        provenance: [`scope: "${item.clientText}"`],
        paramsUsed: [],
        flags: [...(item.flags ?? []), ...(stated != null ? ["From the scope only — no drawing to check it against."] : ["Nothing to measure from — measure by hand."])],
        clientRef: clientRefOf(item),
        status,
        suggestedElementId: el.id,
      });
      continue;
    }

    let lineStatus: LineStatus | null = null;
    for (const b of targets) {
      const d = deriveForItem({ item, role, el, b, card: cardOf(b, p), p, longestHire });
      const used = usedKeys.get(b.key) ?? new Set<string>();
      d.used.forEach((k) => used.add(k));
      usedKeys.set(b.key, used);

      let quantity = d.quantity;
      let status = d.status;
      const lineFlags = [...d.flags];
      const stated = item.quantity ?? item.statedCount;
      const isCount = COUNT_UNITS.has(el.unit);
      // D6: the client's number is a double-check; the drawing value is kept. (An
      // inspection row's "1" is one a week, not a total — nothing to compare.)
      if (role === "INSPECTION") {
        /* weeks come from the hire */
      } else if (stated != null && quantity != null && d.status === "MEASURED") {
        if (withinTolerance(stated, quantity, p, isCount)) status = "AGREES";
        else {
          status = "DIFFERS";
          lineFlags.push(`The client says ${stated}, the drawings give ${fmt(quantity)} — the drawing value is used; check.`);
        }
      } else if (stated != null && quantity == null && d.status !== "UNKNOWN_BASIS") {
        quantity = stated;
        status = "STATED";
        lineFlags.push("The client's figure — not measured from the drawings.");
      }
      let lifts = el.usesLifts ? d.lifts : null;
      if (el.usesLifts && item.lifts != null) {
        if (lifts != null && item.lifts !== lifts) lineFlags.push(`The client says ${item.lifts} lift${item.lifts === 1 ? "" : "s"}, the drawings suggest ${lifts} — check.`);
        lifts = lifts ?? item.lifts;
      }
      const wholeJob = !PER_BUILDING.has(role) && buildings.length > 1;
      if (wholeJob) lineFlags.push(`Applies to the whole job${lifts != null ? ` — lifts suggested from ${b.name}` : ""}.`);
      lines.push({
        elementId: el.id,
        description: el.name,
        unit: el.unit,
        quantity: quantity != null ? r3(quantity) : null,
        lifts,
        heightBracket: el.usesHeightBracket === false ? null : (d.bracket ?? b.model.suggestedBracket),
        confidence: status === "STATED" ? item.confidence : d.confidence,
        note: item.note,
        needsItem: false,
        hireWeeks: item.hireWeeks,
        section: item.section ?? areaSection(role),
        buildingId: wholeJob ? null : b.key,
        formula: d.formula,
        provenance: [`scope: "${item.clientText}"${item.rowRef ? ` (${item.sheet ?? "sheet"} row ${item.rowRef.replace(/^S\d+/, "").slice(1)})` : ""}`, ...d.provenance],
        paramsUsed: d.params,
        flags: [...(item.flags ?? []), ...lineFlags, ...paramFlags(p, d.params)],
        clientRef: clientRefOf(item),
        status,
        suggestedElementId: el.id,
      });
      lineStatus = lineStatus ?? status;
    }
    switch (lineStatus) {
      case "AGREES":
        account.agrees++;
        break;
      case "DIFFERS":
        account.differs++;
        break;
      case "STATED":
        account.stated++;
        break;
      case "MEASURE_BY_HAND":
        account.measureByHand++;
        break;
      case "UNKNOWN_BASIS":
        account.unknownBasis++;
        break;
      default:
        account.measured++;
    }
  }

  // --- The information list: what the drawings show that the scope did not ask for.
  const info: InfoItem[] = [];
  // Main gables mean table lifts + apex handrails: if the scope asks for neither, say so.
  const asksGables = rolesAsked.has("TABLE_LIFT") || rolesAsked.has("APEX") || items.some((i) => /gable|apex|table lift/i.test(i.clientText));
  if (!asksGables)
    for (const b of buildings) {
      const g = cardOf(b, p).external.gables;
      if (g.value != null && g.value > 0)
        info.push({ buildingKey: b.key, buildingName: b.name, label: "Main gables", value: `${g.value} nr`, note: "On the drawings, but table lifts / apex handrails are not in the scope — not priced." });
    }

  const emptySections = emptySectionsOf(items, input.sections, input.emptyTableSections);

  if (account.differs) flags.push(`${account.differs} scope line${account.differs === 1 ? "" : "s"} differ from the drawings — the drawing value is used; check them.`);
  if (account.measureByHand) flags.push(`${account.measureByHand} scope line${account.measureByHand === 1 ? "" : "s"} are yours to measure or count (left blank).`);
  if (emptySections.length) flags.push(`Listed with nothing under them: ${emptySections.join(", ")} — confirm none required.`);

  // Mark-up lines the scope did not name stay (the client drew them), in their area section.
  markup.forEach((l, i) => {
    if (markupTaken.has(i)) return;
    const el = l.elementId ? byId.get(l.elementId) : undefined;
    l.section = l.section ?? areaSection(el ? elementRole(el.name) : "OTHER");
    l.buildingId = l.buildingId ?? (buildings.length === 1 ? buildings[0].key : null);
    l.hireWeeks = l.hireWeeks ?? items.find((it) => it.elementId === l.elementId && it.hireWeeks != null)?.hireWeeks ?? null;
    l.status = l.status ?? (l.elementId ? "MEASURED" : "NEEDS_ITEM");
    l.suggestedElementId = l.elementId;
  });

  return { lines: [...markup, ...lines], info, emptySections, account, flags };
}
