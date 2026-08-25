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

/** Tunable rules. Defaults are the confirmed values; ⚠️ ones await Colin (docs/11 §8). */
export interface EngineParams {
  liftHeightM: number; // ✅ 1.5 (called an "average" — ⚠️ constancy open)
  cornerAllowanceM: number; // ✅ CONFIRMED 1 m per external corner
  storeyLiftTemplate: Record<string, number>; // per-builder; default STANDARD
  // render lift basis is the storey table below (⚠️ full table owed by Colin)
}
export const DEFAULT_PARAMS: EngineParams = {
  liftHeightM: 1.5,
  cornerAllowanceM: 1.0,
  storeyLiftTemplate: STANDARD_STOREY_LIFTS,
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

/** Render lifts by storey (2 m boarded lifts). From Colin's sheets; full table owed. */
function renderLiftsForStoreys(storeys: number | null): number | null {
  if (storeys === null) return null;
  const map: Record<string, number> = { "1": 1, "2": 2, "2.5": 3, "3": 4 };
  return map[String(storeys)] ?? null;
}

/** Expected birdcage floor count for a storey height. 2.5-storey = 3 (room in roof). */
function expectedFloors(storeys: number | null): number | null {
  if (storeys === null) return null;
  const map: Record<string, number> = { "1": 1, "2": 2, "2.5": 3, "3": 3, "4": 4 };
  return map[String(storeys)] ?? null;
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

/** Party-wall scaffold count by config. */
export function partyWalls(config: Configuration): number {
  switch (config) {
    case "DETACHED":
      return 0;
    case "SEMI_DETACHED":
    case "END_TERRACE":
      return 1;
    case "MID_TERRACE":
      return 2;
  }
}

export interface TakeoffLine {
  config: Configuration;
  lifts: LiftResult;
  perimeter: PerimeterResult;
  birdcage: BirdcageResult;
  render: RenderResult | null;
  apex: ApexResult;
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
  const lifts = computeLifts(input, params);
  const perimeter = computePerimeter(input, lifts.lifts, params);
  const birdcage = computeBirdcage(input);
  const render = computeRender(input);
  const apex = computeApex(input);
  const pw = input.isApartmentBlock ? 0 : partyWalls(input.config);

  const flags: string[] = [];
  if (lifts.lifts === null) flags.push("No height or storeys read — cannot derive lifts.");
  if (lifts.flag)
    flags.push(
      `Lift mismatch: height gives ${lifts.heightLifts}, storey template gives ${lifts.storeyLifts}.`,
    );
  const expFloors = expectedFloors(input.storeys);
  if (expFloors !== null && birdcage.floorCount > 0 && birdcage.floorCount !== expFloors)
    flags.push(
      `Birdcage floors (${birdcage.floorCount}) don't match ${input.storeys}-storey (expected ${expFloors}).`,
    );
  if (birdcage.floorCount === 0) flags.push("No internal floor dimensions — birdcage not computed.");
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
    : [
        "Loading bay (count + apportionment)",
        "Rubbish chute / skip bay",
        "Access: Haki stair or ladder tower",
        "Propping / joist support variant",
      ];

  return {
    config: input.config,
    lifts,
    perimeter,
    birdcage,
    render,
    apex,
    partyWalls: pw,
    lowLevel: input.lowLevelCount,
    chimney: input.chimney,
    flags,
    profilePending,
    text: formatTakeoffText({
      perimeter,
      lifts: lifts.lifts,
      birdcage,
      render,
      apex,
      partyWalls: pw,
      lowLevel: input.lowLevelCount,
      chimney: input.chimney,
    }),
  };
}

function formatTakeoffText(x: {
  perimeter: PerimeterResult;
  lifts: number | null;
  birdcage: BirdcageResult;
  render: RenderResult | null;
  apex: ApexResult;
  partyWalls: number;
  lowLevel: number;
  chimney: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`${x.perimeter.perLiftM} × ${x.lifts ?? "?"} lifts`);
  if (x.birdcage.floorCount > 0)
    parts.push(`${x.birdcage.totalM2} m² × ${x.birdcage.floorCount} floors`);
  if (x.render) parts.push(`render ${x.render.lengthM} × ${x.render.lifts ?? "?"} lifts`);
  if (x.apex.count > 0) parts.push(`${x.apex.count} apex (table + H/R)`);
  if (x.lowLevel > 0) parts.push(`${x.lowLevel} low level`);
  if (x.partyWalls > 0) parts.push(`${x.partyWalls} party wall${x.partyWalls > 1 ? "s" : ""}`);
  if (x.chimney) parts.push(`chimney scaffold`);
  return parts.join(" / ");
}
