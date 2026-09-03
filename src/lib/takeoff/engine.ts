/**
 * The deterministic take-off engine (Layer 2). Pure, unit-tested. It turns the
 * OBSERVABLES the model extracted (Layer 1) into Colin's take-off line, applying
 * only rules confirmed on the 13 Aug call + his handwritten sheets (docs/11).
 *
 * Nothing here is a guess: every ⚠️ open value (lift height, render lift basis)
 * is a parameter with a documented default, and every
 * cross-check that can't be resolved raises a flag rather than a silent number.
 *
 * It NEVER calls a model and touches no I/O — feed it facts, get a take-off.
 */

export type RoofType = "PITCHED" | "HIPPED" | "MIXED";
export type Configuration =
  | "DETACHED"
  | "SEMI_DETACHED"
  | "END_TERRACE"
  | "MID_TERRACE";

/**
 * The build system — a PROJECT-level choice (docs/18). Timber frame changes three
 * things vs traditional: the lift rule (450 mm top step + 2 m lifts → fewer lifts),
 * NO birdcage, and LM-priced adaptions. Everything else (perimeter, corners, apex,
 * render, config split) is identical. Defaults to TRADITIONAL when unset.
 */
export type BuildSystem = "TRADITIONAL" | "TIMBER_FRAME";

export type WallPosition =
  | "front"
  | "rear"
  | "gable_left"
  | "gable_right"
  | "other";

export interface WallSeg {
  position: WallPosition;
  lengthM: number;
}
export interface FloorArea {
  level: "GF" | "FF" | "SF" | "TF";
  m2: number;
}
/** Apexes counted per elevation face — so the take-off can drop the party-wall side by config. */
export interface ApexByFace {
  front: number;
  rear: number;
  left: number;
  right: number;
  other: number;
}
export const NO_APEX: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
function totalApex(a: ApexByFace): number {
  return a.front + a.rear + a.left + a.right + a.other;
}

export interface TakeoffInput {
  storeys: number | null;
  roomInRoof: boolean;
  heightToSoffitM: number | null;
  roofType: RoofType | null;
  wallSegments: WallSeg[];
  dwellingsWide: number; // how many dwellings share the front/rear frontage (1 single, 2 semi pair)
  isApartmentBlock: boolean; // a block of flats — scaffolded as ONE whole building (no per-house split)
  cornerCount: number | null; // external corners read off the (detached) footprint
  apexByFace: ApexByFace; // apexes per elevation face (reduced by config downstream)
  renderSegmentsM: number[]; // rendered section lengths (LM)
  floors: FloorArea[]; // birdcage m² per floor
  lowLevelCount: number;
  chimney: boolean;
  config: Configuration;
  /** Include the party-wall spec item (default true). A customer opt-out at spec
   *  stage sets this false → no party-wall unit is priced (detached is 0 anyway). */
  includePartyWall?: boolean;
  /** Build system (project-level). Undefined → TRADITIONAL. */
  buildSystem?: BuildSystem;
}

/**
 * The default (Miller/"Standard") storey → lifts template. ⚠️ BUILDER-SPECIFIC:
 * docs/08 records e.g. Barratt 2-storey = 3 lifts, not 4 — so the real template
 * comes from the builder profile (params.storeyLiftTemplate); this is the fallback.
 */
export const STANDARD_STOREY_LIFTS: Record<string, number> = {
  "1": 2,
  "2": 4,
  "2.5": 5,
  "3": 6,
  "4": 8,
};

/**
 * Timber-frame storey → lifts (Laura's email, docs/18 §1.2). FEWER lifts than
 * traditional: 2 m boarded lifts + a fixed 450 mm top step. 2.5 and 3 both = 4
 * (they differ only in the internal breakdown, and every lift prices the same).
 */
export const TIMBER_FRAME_STOREY_LIFTS: Record<string, number> = {
  "2": 3,
  "2.5": 4,
  "3": 4,
};

/** The fixed step off the roof/apex onto the scaffold — the top (highest) lift. */
export const TF_TOP_STEP_M = 0.45;
/** Timber-frame boarded lifts come down in 2 m increments below the top step. */
export const TF_LIFT_HEIGHT_M = 2.0;
/** Each apex converts to this many LM when folded into the adaption totals (docs/18 §1.2). */
export const APEX_LM_PER = 4;

/** Tunable rules. Defaults are the confirmed values; ⚠️ ones await Colin (docs/11 §8). */
export interface EngineParams {
  liftHeightM: number; // ✅ 1.5 (called an "average" — ⚠️ constancy open)
  cornerAllowanceM: number; // ✅ CONFIRMED 1 m per external corner
  storeyLiftTemplate: Record<string, number>; // per-builder; default STANDARD
  timberFrameStoreyLifts: Record<string, number>; // timber-frame storey→lifts (docs/18)
  // render lift basis is the storey table below (⚠️ full table owed by Colin)
}
export const DEFAULT_PARAMS: EngineParams = {
  liftHeightM: 1.5,
  cornerAllowanceM: 1.0,
  storeyLiftTemplate: STANDARD_STOREY_LIFTS,
  timberFrameStoreyLifts: TIMBER_FRAME_STOREY_LIFTS,
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Storey → lifts template (cross-check). Builder-specific; defaults to Standard. */
export function storeyLifts(
  storeys: number | null,
  template: Record<string, number> = STANDARD_STOREY_LIFTS,
): number | null {
  if (storeys === null) return null;
  return template[String(storeys)] ?? null;
}

/** Render lifts by storey (2 m boarded lifts). From Colin's sheets; ⚠️ full table owed. */
export const RENDER_LIFTS_BY_STOREY: Record<string, number> = {
  "1": 1,
  "2": 2,
  "2.5": 3,
  "3": 4,
};

/** Expected birdcage floor count for a storey height. 2.5-storey = 3 (room in roof). */
export const EXPECTED_FLOORS_BY_STOREY: Record<string, number> = {
  "1": 1,
  "2": 2,
  "2.5": 3,
  "3": 3,
  "4": 4,
};

function renderLiftsForStoreys(storeys: number | null): number | null {
  if (storeys === null) return null;
  return RENDER_LIFTS_BY_STOREY[String(storeys)] ?? null;
}

function expectedFloors(storeys: number | null): number | null {
  if (storeys === null) return null;
  return EXPECTED_FLOORS_BY_STOREY[String(storeys)] ?? null;
}

export interface LiftResult {
  lifts: number | null;
  basis: "height" | "storey" | "none";
  heightLifts: number | null;
  storeyLifts: number | null;
  flag: boolean; // height and storey rules disagree
}

/**
 * lifts = ceil(height / 1.5) + (1 if room in roof), with the storey template as
 * a cross-check. Precedence when the two disagree (⚠️ Innate's proposed rule,
 * for Ben to confirm — docs/11 §8): the storey template wins for WHOLE storeys
 * (reliable: 1→2, 2→4, 3→6, where the height rule can round wrong at a boundary),
 * and the height rule wins for HALF storeys (2.5, where height + room-in-roof is
 * the intended path). Either way the disagreement is flagged.
 */
export function computeLifts(
  input: TakeoffInput,
  params: EngineParams = DEFAULT_PARAMS,
): LiftResult {
  const hasRoom =
    input.roomInRoof ||
    (input.storeys !== null && !Number.isInteger(input.storeys));
  const heightLifts =
    input.heightToSoffitM !== null && input.heightToSoffitM > 0
      ? Math.ceil(input.heightToSoffitM / params.liftHeightM) + (hasRoom ? 1 : 0)
      : null;
  const sLifts = storeyLifts(input.storeys, params.storeyLiftTemplate);
  const disagree = heightLifts !== null && sLifts !== null && heightLifts !== sLifts;

  let lifts: number | null;
  let basis: LiftResult["basis"];
  if (heightLifts !== null && sLifts !== null) {
    if (!disagree) {
      lifts = heightLifts;
      basis = "height";
    } else if (input.storeys !== null && Number.isInteger(input.storeys)) {
      lifts = sLifts; // whole-storey building — template is authoritative
      basis = "storey";
    } else {
      lifts = heightLifts; // half-storey — height + room-in-roof
      basis = "height";
    }
  } else {
    lifts = heightLifts ?? sLifts;
    basis = heightLifts !== null ? "height" : sLifts !== null ? "storey" : "none";
  }
  return { lifts, basis, heightLifts, storeyLifts: sLifts, flag: disagree };
}

/** Effective storey for timber frame: a 2-storey WITH a room-in-roof reads as 2.5
 *  (the only case with the extra 1 m lift). Everything else is the storey count. */
function tfEffectiveStorey(storeys: number | null, roomInRoof: boolean): string | null {
  if (storeys === null) return null;
  if (storeys === 2 && roomInRoof) return "2.5";
  return String(storeys);
}

/**
 * Timber-frame lift count from the height method (docs/18 §1.2): 450 mm off the
 * soffit is the top lift; a 2.5-storey adds a 1 m lift; then 2 m lifts come down
 * with the bottom "kicker" absorbing the remainder. Reproduces Laura's table
 * (4.8 m → 3, 6.5 m → 4, 5.5 m/2.5 → 4). Used as a cross-check on the storey rule.
 */
function tfHeightLifts(heightToSoffitM: number | null, is2p5: boolean): number | null {
  if (heightToSoffitM === null || heightToSoffitM <= 0) return null;
  let rem = heightToSoffitM - TF_TOP_STEP_M; // remove the top step (that's 1 lift)
  const extra = is2p5 ? 1 : 0;
  if (is2p5) rem -= 1.0; // the 1 m lift on a 2.5-storey
  const liftsBelow = Math.max(1, Math.round(rem / TF_LIFT_HEIGHT_M));
  return 1 + extra + liftsBelow;
}

/**
 * Timber-frame lifts. The storey template (2→3, 2.5→4, 3→4) is authoritative — it's
 * exact for the documented cases; the height method is an independent cross-check
 * and FLAGS a divergence (an unusually tall/short house worth a human eye). Same
 * `LiftResult` shape + precedence doctrine as the traditional `computeLifts`.
 */
export function computeLiftsTimberFrame(
  input: TakeoffInput,
  params: EngineParams = DEFAULT_PARAMS,
): LiftResult {
  const eff = tfEffectiveStorey(input.storeys, input.roomInRoof);
  const is2p5 = eff === "2.5";
  const template = params.timberFrameStoreyLifts ?? TIMBER_FRAME_STOREY_LIFTS;
  const sLifts = eff !== null ? (template[eff] ?? null) : null;
  const hLifts = tfHeightLifts(input.heightToSoffitM, is2p5);
  const disagree = hLifts !== null && sLifts !== null && hLifts !== sLifts;

  let lifts: number | null;
  let basis: LiftResult["basis"];
  if (sLifts !== null) {
    lifts = sLifts; // storey template is authoritative for timber frame
    basis = "storey";
  } else if (hLifts !== null) {
    lifts = hLifts; // no template entry (e.g. bungalow/4-storey) → fall to height
    basis = "height";
  } else {
    lifts = null;
    basis = "none";
  }
  return { lifts, basis, heightLifts: hLifts, storeyLifts: sLifts, flag: disagree };
}

export interface PerimeterResult {
  perLiftM: number;
  totalM: number | null; // per-lift × lifts (what Strike is keyed with)
  corners: number;
  wallsM: number; // before the corner allowance
  irregular: boolean; // "other" walls present on a non-detached config
}

/** Perimeter along the building line, by config, + the corner allowance. */
export function computePerimeter(
  input: TakeoffInput,
  lifts: number | null,
  params: EngineParams = DEFAULT_PARAMS,
): PerimeterResult {
  const sum = (ps: WallPosition[]) =>
    input.wallSegments
      .filter((w) => ps.includes(w.position))
      .reduce((a, w) => a + w.lengthM, 0);
  // The front/rear frontage spans every dwelling drawn (semi pair, terrace block),
  // so divide it to one dwelling. An apartment block is scaffolded whole, so no
  // division. Gable-end walls are the full depth — never divided.
  const dwellings = input.isApartmentBlock
    ? 1
    : input.dwellingsWide >= 1
      ? input.dwellingsWide
      : 1;
  const front = sum(["front"]) / dwellings;
  const rear = sum(["rear"]) / dwellings;
  const gableLeft = sum(["gable_left"]);
  const gableRight = sum(["gable_right"]);
  const other = sum(["other"]);

  let walls: number;
  let corners: number;
  let irregular = false;
  if (input.isApartmentBlock) {
    // Whole block: scaffold every external wall, configuration does not apply.
    walls = front + rear + gableLeft + gableRight + other;
    corners = input.cornerCount ?? 4;
  } else {
    switch (input.config) {
      case "DETACHED":
        walls = front + rear + gableLeft + gableRight + other;
        corners = input.cornerCount ?? 4;
        break;
      case "SEMI_DETACHED":
      case "END_TERRACE":
        // 3 sides: front + rear + the one exposed gable end (the other is the party wall).
        // A plain rectangle wraps 2 corners; an L-shape drops the ~2 party-side
        // corners from the read count (derive from cornerCount, not a flat 2).
        walls = front + rear + Math.max(gableLeft, gableRight) + other;
        corners = input.cornerCount != null ? Math.max(2, input.cornerCount - 2) : 2;
        irregular = other > 0;
        break;
      case "MID_TERRACE":
        // 2 sides: front + rear only (both gables are party walls). Rectangle wraps
        // 0 corners; an L-shape keeps its step corners (read count minus the 4 gable-side).
        walls = front + rear;
        corners = input.cornerCount != null ? Math.max(0, input.cornerCount - 4) : 0;
        irregular = other > 0;
        break;
    }
  }
  const perLiftM = round3(walls + corners * params.cornerAllowanceM);
  const totalM = lifts !== null ? round3(perLiftM * lifts) : null;
  return { perLiftM, totalM, corners, wallsM: round3(walls), irregular };
}

export interface BirdcageResult {
  floors: FloorArea[];
  totalM2: number;
  floorCount: number;
}

/** Birdcage = internal m² per floor, one lift each, summed for the Strike total. */
export function computeBirdcage(input: TakeoffInput): BirdcageResult {
  const floors = input.floors.filter((f) => f.m2 > 0);
  return {
    floors,
    totalM2: round3(floors.reduce((a, f) => a + f.m2, 0)),
    floorCount: floors.length,
  };
}

/** No birdcage on timber frame (docs/18 §1.2) — an empty birdcage result. */
const NO_BIRDCAGE: BirdcageResult = { floors: [], totalM2: 0, floorCount: 0 };

export interface AdaptionResult {
  /** Inside-board adaption — ALL lifts + each apex as 4 LM. */
  insideBoardLM: number;
  /** Hop-up adaption — every lift EXCEPT the 1st (kicker) + each apex as 4 LM. */
  hopUpLM: number;
  /** The apex contribution (apexCount × 4 LM), folded into both totals above. */
  apexLM: number;
}

/**
 * Timber-frame adaptions (docs/18 §1.2, Laura's Aspen-semi worked example). Priced
 * on an LM rate, NOT units. `perLiftM` is the per-lift perimeter (already includes
 * the corner allowance). Each apex converts to 4 LM. Validated:
 * `computeAdaptions(20.83, 3, 1)` → { insideBoardLM 66.49, hopUpLM 45.66, apexLM 4 }.
 */
export function computeAdaptions(
  perLiftM: number,
  lifts: number,
  apexCount: number,
): AdaptionResult {
  const apexLM = round3(Math.max(0, apexCount) * APEX_LM_PER);
  const n = Math.max(0, lifts);
  return {
    insideBoardLM: round3(perLiftM * n + apexLM),
    hopUpLM: round3(perLiftM * Math.max(0, n - 1) + apexLM),
    apexLM,
  };
}

export interface RenderResult {
  lengthM: number;
  lifts: number | null;
}

/** Render adaption: rendered LM × render lifts (2 m lifts). Null if not rendered. */
export function computeRender(input: TakeoffInput): RenderResult | null {
  const lengthM = round3(input.renderSegmentsM.reduce((a, l) => a + l, 0));
  if (input.renderSegmentsM.length === 0 || lengthM <= 0) return null;
  return { lengthM, lifts: renderLiftsForStoreys(input.storeys) };
}

export interface ApexResult {
  count: number;
  tableLifts: number;
  handrails: number;
}

/**
 * Apex = table lift + apex handrail per apex. Hipped roof → none. Reduced by
 * configuration: a semi/end drops the party-wall gable apex; a mid-terrace drops
 * both gable apexes (front/rear apexes, e.g. a projecting gable, always count).
 */
export function computeApex(input: TakeoffInput): ApexResult {
  if (input.roofType === "HIPPED") return { count: 0, tableLifts: 0, handrails: 0 };
  const a = input.apexByFace;
  // A whole block keeps every apex — no party-wall reduction.
  if (input.isApartmentBlock) {
    const count = Math.max(0, Math.round(totalApex(a)));
    return { count, tableLifts: count, handrails: count };
  }
  const frontRear = a.front + a.rear;
  let gable: number;
  switch (input.config) {
    case "DETACHED":
      gable = a.left + a.right + a.other;
      break;
    case "SEMI_DETACHED":
    case "END_TERRACE":
      gable = Math.max(a.left, a.right); // one exposed gable end
      break;
    case "MID_TERRACE":
      gable = 0; // both gables are party walls
      break;
  }
  const count = Math.max(0, Math.round(frontRear + gable));
  return { count, tableLifts: count, handrails: count };
}

/**
 * Party-wall scaffold count by config. The party wall is the INSIDE apex (apex
 * shape, NO rails) on a shared wall — priced as a separate spec item. Colin's
 * rule (2026-09-01 call): ONE unit for every non-detached house type, detached
 * excluded — deliberately simple (a mid-terrace is still ONE, not two). A
 * customer can opt out at spec stage (handled by `includePartyWall` upstream).
 */
export function partyWalls(config: Configuration): number {
  switch (config) {
    case "DETACHED":
      return 0;
    case "SEMI_DETACHED":
    case "END_TERRACE":
    case "MID_TERRACE":
      return 1;
  }
}

export interface TakeoffLine {
  config: Configuration;
  buildSystem: BuildSystem;
  lifts: LiftResult;
  perimeter: PerimeterResult;
  birdcage: BirdcageResult;
  render: RenderResult | null;
  apex: ApexResult;
  /** Timber-frame LM adaptions (inside-board + hop-up); null for traditional. */
  adaptions: AdaptionResult | null;
  partyWalls: number;
  lowLevel: number;
  chimney: boolean;
  flags: string[]; // cross-checks that need a human eye
  profilePending: string[]; // items that need the builder profile / spec (not computable yet)
  text: string; // Colin-style one-liner
}

/** Build the full deterministic take-off line for one house-type × configuration. */
export function buildTakeoff(
  input: TakeoffInput,
  params: EngineParams = DEFAULT_PARAMS,
): TakeoffLine {
  const isTF = input.buildSystem === "TIMBER_FRAME";
  const lifts = isTF ? computeLiftsTimberFrame(input, params) : computeLifts(input, params);
  const perimeter = computePerimeter(input, lifts.lifts, params);
  // Timber frame has no internal decks (docs/18 §1.2).
  const birdcage = isTF ? NO_BIRDCAGE : computeBirdcage(input);
  const render = computeRender(input);
  const apex = computeApex(input);
  // Party wall: traditional prices the inside-apex spec item on a non-detached
  // house; timber frame does NOT (Laura's semi line has none — docs/18 §7, ⚠ confirm).
  const pw =
    isTF || input.isApartmentBlock || input.includePartyWall === false
      ? 0
      : partyWalls(input.config);
  // Timber-frame adaptions (LM). Traditional → null.
  const adaptions = isTF
    ? computeAdaptions(perimeter.perLiftM, lifts.lifts ?? 0, apex.count)
    : null;

  const flags: string[] = [];
  if (lifts.lifts === null) flags.push("No height or storeys read — cannot derive lifts.");
  if (lifts.flag)
    flags.push(
      `Lift mismatch: height gives ${lifts.heightLifts}, storey template gives ${lifts.storeyLifts}.`,
    );
  // Birdcage cross-checks apply to traditional only (timber frame has no birdcage).
  if (!isTF) {
    const expFloors = expectedFloors(input.storeys);
    if (expFloors !== null && birdcage.floorCount > 0 && birdcage.floorCount !== expFloors)
      flags.push(
        `Birdcage floors (${birdcage.floorCount}) don't match ${input.storeys}-storey (expected ${expFloors}).`,
      );
    if (birdcage.floorCount === 0)
      flags.push("No internal floor dimensions — birdcage not computed.");
  }
  if (input.roofType !== "HIPPED" && totalApex(input.apexByFace) === 0)
    flags.push("Pitched/mixed roof but no apex counted — check the elevations.");
  if (input.roofType === "HIPPED" && totalApex(input.apexByFace) > 0)
    flags.push("Hipped roof but apexes were reported — forced to 0.");
  if (perimeter.irregular)
    flags.push("Irregular ('other') walls on a non-detached config — check the perimeter.");
  if (
    !input.isApartmentBlock &&
    input.config !== "DETACHED" &&
    (input.cornerCount ?? 4) > 4
  )
    flags.push(
      `L-shaped/stepped footprint on a ${input.config} (${input.cornerCount} corners) — corner reduction assumes the step is on the scaffolded side; check.`,
    );
  if (render && render.lifts === null)
    flags.push("Rendered, but no render-lift rule for this storey count.");

  if (input.isApartmentBlock)
    flags.push("Apartment block — whole-building scaffold; birdcage should be the whole floor plate.");

  const profilePending = input.isApartmentBlock
    ? [
        "Loading bays (multiple, apportioned)",
        "Rubbish chutes (multiple)",
        "Access: Haki stair or ladder tower",
        "Progressive dismantle",
        "Communal/stair handrails",
      ]
    : isTF
      ? [
          "Loading bay (count + apportionment)",
          "Rubbish chute / skip bay",
          "Access: Haki stair (always Haki on timber frame)",
        ]
      : [
          "Loading bay (count + apportionment)",
          "Rubbish chute / skip bay",
          "Access: Haki stair or ladder tower",
          "Propping / joist support variant",
        ];

  return {
    config: input.config,
    buildSystem: isTF ? "TIMBER_FRAME" : "TRADITIONAL",
    lifts,
    perimeter,
    birdcage,
    render,
    apex,
    adaptions,
    partyWalls: pw,
    lowLevel: input.lowLevelCount,
    chimney: input.chimney,
    flags,
    profilePending,
    text: formatTakeoffText({
      buildSystem: isTF ? "TIMBER_FRAME" : "TRADITIONAL",
      perimeter,
      lifts: lifts.lifts,
      birdcage,
      render,
      apex,
      adaptions,
      partyWalls: pw,
      lowLevel: input.lowLevelCount,
      chimney: input.chimney,
    }),
  };
}

function formatTakeoffText(x: {
  buildSystem: BuildSystem;
  perimeter: PerimeterResult;
  lifts: number | null;
  birdcage: BirdcageResult;
  render: RenderResult | null;
  apex: ApexResult;
  adaptions: AdaptionResult | null;
  partyWalls: number;
  lowLevel: number;
  chimney: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`${x.perimeter.perLiftM} × ${x.lifts ?? "?"} lifts`);
  if (x.buildSystem === "TIMBER_FRAME") {
    // Timber frame: no birdcage; show the two LM adaptions instead.
    if (x.apex.count > 0) parts.push(`${x.apex.count} apex (scaffold + rails)`);
    if (x.render) parts.push(`render ${x.render.lengthM} × ${x.render.lifts ?? "?"} lifts`);
    if (x.adaptions)
      parts.push(
        `adaptions ${x.adaptions.insideBoardLM} / ${x.adaptions.hopUpLM} LM (inside-board / hop-up)`,
      );
    if (x.lowLevel > 0) parts.push(`${x.lowLevel} low level`);
    if (x.chimney) parts.push(`chimney scaffold`);
    return parts.join(" / ");
  }
  if (x.birdcage.floorCount > 0)
    parts.push(`${x.birdcage.totalM2} m² × ${x.birdcage.floorCount} floors`);
  if (x.render) parts.push(`render ${x.render.lengthM} × ${x.render.lifts ?? "?"} lifts`);
  if (x.apex.count > 0) parts.push(`${x.apex.count} apex (table + H/R)`);
  if (x.lowLevel > 0) parts.push(`${x.lowLevel} low level`);
  if (x.partyWalls > 0) parts.push(`${x.partyWalls} party wall${x.partyWalls > 1 ? "s" : ""}`);
  if (x.chimney) parts.push(`chimney scaffold`);
  return parts.join(" / ");
}
