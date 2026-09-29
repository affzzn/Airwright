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

import { normalizeWallRoles, readPartyGables } from "@/lib/structure";

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
  /** Is this a PARTY / separating wall (shared, so NOT scaffolded)? `null`/undefined =
   *  the drawing did not say — the engine then falls back to the old size heuristic
   *  and flags it, so "unknown" is never silently treated as "no" (docs/21 §B2). */
  isPartyWall?: boolean | null;
}

/** Which gable end is the party wall, read off the drawing. `null` = not stated. */
export interface PartyGables {
  left: boolean | null;
  right: boolean | null;
  /** Gable ends positively KNOWN to be party walls — 0 / 1 / 2. */
  count: number;
  /** True when at least one gable's party status is unknown. */
  unknown: boolean;
}

/**
 * Read the party-wall status of the two gable ends off the wall segments. A gable is
 * a party wall when ANY segment on that side says so; it is external when at least one
 * says so and none says party; otherwise unknown.
 *
 * This replaces guessing the exposed gable by LENGTH (the old `Math.max`), which is
 * wrong whenever the party wall happens to be the longer side — the drawing states the
 * structure, so use the structure (docs/21 §B3).
 */
export function partyGables(walls: WallSeg[]): PartyGables {
  // The reduction itself lives in structure.ts, shared with the extractor, so the
  // engine and the extractor can never read the same drawing differently.
  const { left, right } = readPartyGables(walls);
  return {
    left,
    right,
    count: (left === true ? 1 : 0) + (right === true ? 1 : 0),
    unknown: left === null || right === null,
  };
}

/**
 * The configuration the DRAWING implies, from the number of party gable ends.
 * 0 → detached · 1 → semi/end · 2 → mid-terrace. Returns null when either gable's
 * status is unknown — never a guess. Semi and end-terrace are indistinguishable from
 * the party-wall count alone (they take off identically), so 1 returns SEMI_DETACHED.
 */
export function configFromPartyGables(pg: PartyGables): Configuration | null {
  if (pg.unknown) return null;
  if (pg.count >= 2) return "MID_TERRACE";
  if (pg.count === 1) return "SEMI_DETACHED";
  return "DETACHED";
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
  /** How many dwellings the REPORTED front/rear length spans: 1 when the read is one
   *  house (a single-house drawing, or one house's slice), N when it is the full printed
   *  frontage of a pair/block. NOT the building type — a semi drawn as one house is 1.
   *  Checked against physics by `resolveFrontage` before the engine divides by it. */
  dwellingsWide: number;
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
  /** One house's INTERNAL width off the ground-floor birdcage (the widest rectangle),
   *  used only to CROSS-CHECK the frontage frame (`resolveFrontage`). Absent on legacy
   *  take-offs — the physical minimum still applies. */
  houseInternalWidthM?: number | null;
  /** The ground floor is a single rectangle, so its width is the whole house's inside
   *  width and an upper bound applies too (a stepped floor's widest tile is only a
   *  lower bound). */
  houseInternalWidthSingleRect?: boolean;
  /** The structural wall (m) the birdcage read on that floor — lets a mirrored PAIR's
   *  inside width be derived independently from its frontage (resolveFrontage). */
  houseWallThicknessM?: number | null;
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

/** Timber-frame storey → ADAPTION lifts (docs/18, Laura's revised email). Differs
 * from the total lifts ONLY on a 2.5-storey: its short 1 m lift comes off before
 * any adaptions, so 2.5 gets 3 adaption lifts (not 4). The engine derives this as
 * totalLifts − (2.5-storey ? 1 : 0); this table is the reference. */
export const TIMBER_FRAME_ADAPTION_LIFTS: Record<string, number> = {
  "2": 3,
  "2.5": 3,
  "3": 4,
};

/** The fixed step off the roof/apex onto the scaffold — the top (highest) lift. */
export const TF_TOP_STEP_M = 0.45;
/** Timber-frame boarded lifts come down in 2 m increments below the top step. */
export const TF_LIFT_HEIGHT_M = 2.0;

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
  return computeTimberFrameLifts(
    input.storeys,
    input.roomInRoof,
    input.heightToSoffitM,
    params.timberFrameStoreyLifts ?? TIMBER_FRAME_STOREY_LIFTS,
  );
}

/** The timber-frame lift result from the scalar inputs (so the provenance/UI can
 *  explain it without building a full TakeoffInput). Storey template is primary;
 *  the 450 mm + 2 m height method is the cross-check that flags a divergence. */
export function computeTimberFrameLifts(
  storeys: number | null,
  roomInRoof: boolean,
  heightToSoffitM: number | null,
  template: Record<string, number> = TIMBER_FRAME_STOREY_LIFTS,
): LiftResult {
  const eff = tfEffectiveStorey(storeys, roomInRoof);
  const is2p5 = eff === "2.5";
  const sLifts = eff !== null ? (template[eff] ?? null) : null;
  const hLifts = tfHeightLifts(heightToSoffitM, is2p5);
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

/**
 * The narrowest external frontage ONE house can have. A physical sanity bound, not a
 * business rule: no UK new-build house is under 3 m wide (the narrowest types in
 * Colin's bank are ~4 m). A per-house frontage below it means the read was divided by
 * the wrong dwelling count.
 */
export const MIN_HOUSE_FRONTAGE_M = 3.0;
/** External frontage minus internal width for one house = its walls: an outer wall
 *  plus half a party wall, or two external walls (~0.3-0.8 m). Above this the two reads
 *  describe different buildings. Generous on purpose — it only raises a flag. */
export const MAX_FRONTAGE_OVER_INTERNAL_M = 1.2;
/** …and at least this much: even the thinnest external wall plus half a party wall is
 *  ~0.25 m. A frontage within this of the internal width is an INTERNAL dimension read
 *  as the wall (TW Avonsford: the 3610 "finished dim" reported as the front). */
export const MIN_FRONTAGE_OVER_INTERNAL_M = 0.15;
/** A mirrored pair's per-house inside width, derived from its frontage, must match the
 *  birdcage's read within this (Dekker, Sinclair, Sorley: exact; Byron's depth-chain
 *  segment read as the width: 8% off). */
export const PAIR_WIDTH_XCHECK_TOLERANCE = 0.03;

export interface FrontageResult {
  /** `dwellingsWide` as read (or edited). */
  declared: number;
  /** The divisor actually applied to the front/rear lengths. */
  divisor: number;
  /** One house's front length after the division (0 if no front was read). */
  perHouseFrontM: number;
  /** "declared" = used as read; "physical-minimum" = the declared count gave an
   *  impossibly narrow house, so the length was taken as ONE house. */
  basis: "declared" | "physical-minimum";
  /** True when the reported frontage spans the whole pair/block (divisor > 1): the
   *  gables are then the block's OUTER ends and the party walls sit inside it. */
  blockDrawn: boolean;
  /** Why the divisor differs from the read, or why the frame is doubtful. */
  note: string | null;
  /** The frame could not be reconciled with the house's own birdcage width — the
   *  frontage or the birdcage is the wrong scope. Flagged, never auto-corrected. */
  birdcageMismatch: boolean;
}

/**
 * How many dwellings the reported front/rear length spans — the divisor for the
 * frontage. The model reports it (`dwellingsWide`), but that read has two known
 * failure modes (docs/21 §B6): it conflated "the building is a pair" with "the length
 * I reported spans the pair", halving a one-house frontage (TW Avonsford 4.265 m → 2.13 m;
 * Vistry Jackdaw, TW Eynsford, Harrton, Curlew — five bank types, ~25% under-measured).
 *
 * ONE auto-correction, and only on physics: a per-house frontage under
 * MIN_HOUSE_FRONTAGE_M is impossible, so when the undivided length is a plausible house
 * the length was ONE house. Everything subtler is FLAGGED, never guessed — in particular
 * the house's own birdcage width is NOT used to re-frame: a whole-pair birdcage read (Tilia
 * SM1, docs/doubts §1) is numerically indistinguishable from a correct one-house frontage,
 * so trusting it would reproduce that bug. It only raises `birdcageMismatch`.
 */
export function resolveFrontage(input: {
  wallSegments: { position: string; lengthM: number }[];
  dwellingsWide: number;
  isApartmentBlock: boolean;
  houseInternalWidthM?: number | null;
  houseInternalWidthSingleRect?: boolean;
  houseWallThicknessM?: number | null;
}): FrontageResult {
  const len = (pos: string) =>
    input.wallSegments.filter((w) => w.position === pos).reduce((a, w) => a + w.lengthM, 0);
  const front = len("front") || len("rear");
  const declared = input.isApartmentBlock
    ? 1
    : input.dwellingsWide >= 1
      ? Math.round(input.dwellingsWide)
      : 1;
  const result = (divisor: number, basis: FrontageResult["basis"], note: string | null) => {
    const perHouseFrontM = front > 0 ? round3(front / divisor) : 0;
    const w = input.houseInternalWidthM ?? null;
    let birdcageMismatch = false;
    let why: string | null = null;
    if (!input.isApartmentBlock && w !== null && w > 0 && perHouseFrontM > 0) {
      if (perHouseFrontM < w - 0.02) {
        birdcageMismatch = true;
        why = `one house's frontage (${perHouseFrontM} m) is NARROWER than its own internal birdcage width (${w} m)`;
      } else if (perHouseFrontM - w < MIN_FRONTAGE_OVER_INTERNAL_M) {
        birdcageMismatch = true;
        why = `one house's frontage (${perHouseFrontM} m) is no wider than its internal birdcage width (${w} m) — there is no room for its walls, so an INTERNAL dimension was probably read as the front wall`;
      } else if (input.houseInternalWidthSingleRect && perHouseFrontM - w > MAX_FRONTAGE_OVER_INTERNAL_M) {
        birdcageMismatch = true;
        why = `one house's frontage (${perHouseFrontM} m) is ${round3(perHouseFrontM - w)} m wider than its internal birdcage width (${w} m) — more than its walls`;
      } else if (divisor === 2 && input.houseInternalWidthSingleRect) {
        // A mirrored PAIR drawn whole: one house's inside width is fixed by the frontage,
        // (frontage − outer wall × 2 − party wall) ÷ 2 — an independent derivation of
        // the birdcage width, like the internal-vs-overall check (C11).
        const t = input.houseWallThicknessM ?? null;
        if (t !== null && t > 0) {
          const expected = round3((front - 3 * t) / 2);
          if (expected > 0 && Math.abs(w - expected) / expected > PAIR_WIDTH_XCHECK_TOLERANCE) {
            birdcageMismatch = true;
            why = `the pair's frontage gives one house an inside width of (${round3(front)} − 3 × ${t}) ÷ 2 = ${expected} m, but the birdcage read ${w} m (${Math.round((Math.abs(w - expected) / expected) * 1000) / 10}% off) — the birdcage width may be a segment of the wrong dimension chain`;
          }
        }
      }
    }
    const mismatchNote = why
      ? `${why}. Either the frontage covers a different number of houses than ${divisor}, or the birdcage was read for a different number of houses — check both against the plan.`
      : null;
    return {
      declared,
      divisor,
      perHouseFrontM,
      basis,
      blockDrawn: divisor > 1,
      note: [note, mismatchNote].filter(Boolean).join(" ") || null,
      birdcageMismatch,
    };
  };
  if (front <= 0 || declared <= 1 || input.isApartmentBlock) return result(declared, "declared", null);
  const perHouse = front / declared;
  if (perHouse < MIN_HOUSE_FRONTAGE_M && front >= MIN_HOUSE_FRONTAGE_M)
    return result(
      1,
      "physical-minimum",
      `The front was read as ${round3(front)} m across ${declared} houses, which would make each house ${round3(perHouse)} m wide — narrower than any house (${MIN_HOUSE_FRONTAGE_M} m minimum). So ${round3(front)} m is ONE house's frontage and it is not divided.`,
    );
  return result(declared, "declared", null);
}

export interface PerimeterResult {
  perLiftM: number;
  totalM: number | null; // per-lift × lifts (what Strike is keyed with)
  corners: number;
  wallsM: number; // before the corner allowance
  irregular: boolean; // "other" walls present on a non-detached config
  /** How the exposed gable was chosen on a semi/end: "party" = the drawing said which
   *  gable is the party wall; "block-end" = the drawing shows the whole pair/block, so
   *  its gables are the block's outer ends (either is the end house's exposed gable);
   *  "size" = the drawing did not say, so the longer gable was kept (a fallback,
   *  flagged); "n/a" = the config does not choose a gable. */
  gableBasis: "party" | "block-end" | "size" | "n/a";
  /** The side walls the configuration SCAFFOLDS (semi/end: the exposed one; detached:
   *  both; mid: neither) — so the review screen greys exactly what the engine drops. */
  scaffoldedGables: ("gable_left" | "gable_right")[];
  /** The perimeter's own working, in order: each scaffolded wall (per house) — so the
   *  review screen can print the exact sum the engine used, never a different one. */
  parts: PerimeterPart[];
  /** Corner allowance per corner (m) used in `perLiftM`. */
  cornerAllowanceM: number;
  /** How the front/rear frontage was divided down to one house. */
  frontage: FrontageResult;
}

export interface PerimeterPart {
  label: "front" | "rear" | "gable L" | "gable R" | "other";
  lengthM: number;
  /** Set when the read length was divided to one house, e.g. "10.66 ÷ 2". */
  dividedFrom?: string;
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
  // The front/rear frontage may span every dwelling drawn (semi pair, terrace block),
  // so divide it to one dwelling — by the count resolveFrontage checked against
  // physics. An apartment block is scaffolded whole, so no division. Gable-end walls
  // are the full depth — never divided.
  const frontage = resolveFrontage(input);
  const dwellings = frontage.divisor;
  const front = sum(["front"]) / dwellings;
  const rear = sum(["rear"]) / dwellings;
  const gableLeft = sum(["gable_left"]);
  const gableRight = sum(["gable_right"]);
  const other = sum(["other"]);

  let walls: number;
  let corners: number;
  let irregular = false;
  let exposedGable = 0;
  let scaffoldedGables: PerimeterResult["scaffoldedGables"] = ["gable_left", "gable_right"];
  let gableBasis: PerimeterResult["gableBasis"] = "n/a";
  const pg = partyGables(input.wallSegments);
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
      case "END_TERRACE": {
        // 3 sides: front + rear + the one EXPOSED gable end (the other is the party
        // wall). Which one is exposed comes from the drawing's party-wall flag; only
        // when the drawing does not say do we fall back to "keep the longer gable"
        // (recorded in gableBasis so the caller can flag it) — docs/21 §B3.
        // A drawing of the WHOLE pair/block: its two gables are the block's outer ends,
        // both external — the end house's exposed gable is one of them (equal on a
        // mirrored pair; the longer is kept and flagged if they differ). docs/21 §B6.
        const keep = (side: "gable_left" | "gable_right") => {
          exposedGable = side === "gable_left" ? gableLeft : gableRight;
          scaffoldedGables = [side];
        };
        const longer = gableLeft >= gableRight ? "gable_left" : "gable_right";
        if (frontage.blockDrawn) {
          keep(longer);
          gableBasis = "block-end";
        } else if (pg.left === true && pg.right !== true) {
          keep("gable_right");
          gableBasis = "party";
        } else if (pg.right === true && pg.left !== true) {
          keep("gable_left");
          gableBasis = "party";
        } else {
          keep(longer);
          gableBasis = "size";
        }
        walls = front + rear + exposedGable + other;
        corners = input.cornerCount != null ? Math.max(2, input.cornerCount - 2) : 2;
        irregular = other > 0;
        break;
      }
      case "MID_TERRACE":
        scaffoldedGables = [];
        // 2 sides: front + rear (both gable ends are party walls). Any 'other' external
        // wall is still scaffolded — it is not a party gable — so it is INCLUDED, the
        // same as on a semi/end, and flagged as irregular for a human check.
        // (Before 2026-09-23 'other' was silently dropped here, which under-measured an
        // irregular mid-terrace while the semi branch counted the same wall — docs/21 §B3.)
        walls = front + rear + other;
        corners = input.cornerCount != null ? Math.max(0, input.cornerCount - 4) : 0;
        irregular = other > 0;
        break;
    }
  }
  const perLiftM = round3(walls + corners * params.cornerAllowanceM);
  const totalM = lifts !== null ? round3(perLiftM * lifts) : null;
  const div = dwellings > 1 ? (raw: number) => `${round3(raw)} ÷ ${dwellings}` : null;
  const parts: PerimeterPart[] = [];
  if (front > 0) parts.push({ label: "front", lengthM: round3(front), ...(div ? { dividedFrom: div(sum(["front"])) } : {}) });
  if (rear > 0) parts.push({ label: "rear", lengthM: round3(rear), ...(div ? { dividedFrom: div(sum(["rear"])) } : {}) });
  const sides =
    input.isApartmentBlock || input.config === "DETACHED"
      ? (["gable_left", "gable_right"] as const)
      : scaffoldedGables;
  for (const g of sides) {
    const len = g === "gable_left" ? gableLeft : gableRight;
    if (len > 0) parts.push({ label: g === "gable_left" ? "gable L" : "gable R", lengthM: round3(len) });
  }
  if (other > 0) parts.push({ label: "other", lengthM: round3(other) });
  return {
    perLiftM,
    totalM,
    corners,
    wallsM: round3(walls),
    irregular,
    gableBasis,
    scaffoldedGables,
    parts,
    cornerAllowanceM: params.cornerAllowanceM,
    frontage,
  };
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
  /** Lifts that get adaptions — the total lifts minus the 2.5-storey's short 1 m
   *  lift (which comes off before any adaptions). 2→3, 2.5→3, 3→4 (docs/18). */
  adaptionLifts: number;
  /** Inside-board adaption LM — perimeter × every adaption lift. */
  insideBoardLM: number;
  /** Hop-up adaption LM — perimeter × every adaption lift EXCEPT the 1st (kicker). */
  hopUpLM: number;
  /** Apex inside-board adaption — a UNIT per apex (not converted to LM). */
  apexInsideBoardUnits: number;
  /** Apex hop-up adaption — a UNIT per apex (not converted to LM). */
  apexHopUpUnits: number;
}

/**
 * Timber-frame adaptions (docs/18, Laura's revised email). Priced on an LM rate per
 * adaption lift, and the apex as its own UNIT (NOT converted to LM). `perLiftM` is
 * the per-lift perimeter (already includes the corner allowance). `adaptionLifts` is
 * the take-off's adaption-lift count (2→3, 2.5→3, 3→4). Validated:
 * `computeAdaptions(20.83, 3, 1)` → { insideBoardLM 62.49, hopUpLM 41.66,
 * apexInsideBoardUnits 1, apexHopUpUnits 1 }.
 */
export function computeAdaptions(
  perLiftM: number,
  adaptionLifts: number,
  apexCount: number,
): AdaptionResult {
  const n = Math.max(0, adaptionLifts);
  const apex = Math.max(0, Math.round(apexCount));
  return {
    adaptionLifts: n,
    insideBoardLM: round3(perLiftM * n),
    hopUpLM: round3(perLiftM * Math.max(0, n - 1)),
    apexInsideBoardUnits: apex,
    apexHopUpUnits: apex,
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
  /** How the exposed gable's apex was chosen on a semi/end — see PerimeterResult. */
  gableBasis: "party" | "block-end" | "size" | "n/a";
  /** The count's own working, per elevation face: apexes READ off the drawing vs
   *  PRICED, and a plain reason when some are dropped — so the review screen shows
   *  exactly why the priced number differs from the drawing's. */
  faces: ApexFace[];
}

export interface ApexFace {
  face: "front" | "rear" | "gable L" | "gable R" | "other";
  read: number;
  priced: number;
  /** Why read ≠ priced (e.g. "party wall — not scaffolded"). */
  why?: string;
}

/**
 * Apex = table lift + apex handrail per apex. Hipped roof → none. Reduced by
 * configuration: a semi/end drops the party-wall gable apex; a mid-terrace drops
 * both gable apexes (front/rear apexes, e.g. a projecting gable, always count).
 */
export function computeApex(input: TakeoffInput): ApexResult {
  const a = input.apexByFace;
  const faces = (keepLeft: number, keepRight: number, why: { left?: string; right?: string; all?: string }) => {
    const r = (n: number) => Math.max(0, Math.round(n));
    const row = (face: ApexFace["face"], read: number, priced: number, reason?: string): ApexFace => ({
      face,
      read: r(read),
      priced: r(priced),
      ...(r(read) !== r(priced) && reason ? { why: reason } : {}),
    });
    return [
      row("front", a.front, why.all ? 0 : a.front, why.all),
      row("rear", a.rear, why.all ? 0 : a.rear, why.all),
      row("gable L", a.left, keepLeft, why.all ?? why.left),
      row("gable R", a.right, keepRight, why.all ?? why.right),
      row("other", a.other, why.all ? 0 : a.other, why.all),
    ].filter((f) => f.read > 0 || f.priced > 0);
  };
  if (input.roofType === "HIPPED")
    return {
      count: 0,
      tableLifts: 0,
      handrails: 0,
      gableBasis: "n/a",
      faces: faces(0, 0, { all: "hipped roof — no brickwork above the eaves" }),
    };
  // A whole block keeps every apex — no party-wall reduction.
  if (input.isApartmentBlock) {
    const count = Math.max(0, Math.round(totalApex(a)));
    return { count, tableLifts: count, handrails: count, gableBasis: "n/a", faces: faces(a.left, a.right, {}) };
  }
  // 'other' faces (a projecting wing at an angle) are NOT gable ends, so their apexes
  // count on EVERY configuration — they sit on a scaffolded wall. Before 2026-09-23
  // they were added only for DETACHED and silently dropped everywhere else (docs/21 §B3).
  const frontRear = a.front + a.rear + a.other;
  const pg = partyGables(input.wallSegments);
  let keepL = 0;
  let keepR = 0;
  let why: { left?: string; right?: string } = {};
  let basis: ApexResult["gableBasis"] = "n/a";
  const PARTY = "party wall — not scaffolded";
  switch (input.config) {
    case "DETACHED":
      keepL = a.left;
      keepR = a.right;
      break;
    case "SEMI_DETACHED":
    case "END_TERRACE":
      // Keep the apex on the EXPOSED gable — the one the drawing says is not the party
      // wall. Choosing by apex COUNT (the old `Math.max`) is wrong whenever the exposed
      // end is hipped (0 apexes) and the party end is gabled (1): that scored 1 and
      // priced a table lift + handrail for an apex we never scaffold.
      // A whole-pair/block drawing: the gables are the block's outer ends, so the end
      // house keeps ONE end's apex (equal on a mirrored pair) — docs/21 §B6.
      if (resolveFrontage(input).blockDrawn) {
        const OTHER_END = "the other end of the pair/block — the neighbour's, not this house";
        if (a.left >= a.right) {
          keepL = a.left;
          why = { right: OTHER_END };
        } else {
          keepR = a.right;
          why = { left: OTHER_END };
        }
        basis = "block-end";
      } else if (pg.left === true && pg.right !== true) {
        keepR = a.right;
        why = { left: PARTY };
        basis = "party";
      } else if (pg.right === true && pg.left !== true) {
        keepL = a.left;
        why = { right: PARTY };
        basis = "party";
      } else {
        // The drawing does not say which side is the party wall (flagged elsewhere).
        const GUESS = "assumed the party wall — the drawing does not say which side is (flagged)";
        if (a.left >= a.right) {
          keepL = a.left;
          why = { right: GUESS };
        } else {
          keepR = a.right;
          why = { left: GUESS };
        }
        basis = "size";
      }
      break;
    case "MID_TERRACE":
      why = { left: PARTY, right: PARTY }; // both gable ends are party walls
      break;
  }
  const count = Math.max(0, Math.round(frontRear + keepL + keepR));
  return { count, tableLifts: count, handrails: count, gableBasis: basis, faces: faces(keepL, keepR, why) };
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
  /** The party-wall status of the two gable ends, as read off the drawing. */
  partyGables: PartyGables;
  /** The configuration the DRAWING implies (null when it does not say). */
  drawingConfig: Configuration | null;
  partyWalls: number;
  lowLevel: number;
  chimney: boolean;
  flags: string[]; // cross-checks that need a human eye
  profilePending: string[]; // items that need the builder profile / spec (not computable yet)
  text: string; // Colin-style one-liner
}

/** Build the full deterministic take-off line for one house-type × configuration. */
export function buildTakeoff(
  rawInput: TakeoffInput,
  params: EngineParams = DEFAULT_PARAMS,
): TakeoffLine {
  // Wall roles follow the party wall (structure.ts): a front/rear read as the party wall
  // means the plan's axes were named the wrong way round. Everything below — the
  // perimeter, the party gables, the swap guard — works on the corrected roles.
  const roles = normalizeWallRoles(rawInput.wallSegments);
  const input: TakeoffInput = roles.swapped
    ? { ...rawInput, wallSegments: roles.walls }
    : rawInput;
  const isTF = input.buildSystem === "TIMBER_FRAME";
  const lifts = isTF ? computeLiftsTimberFrame(input, params) : computeLifts(input, params);
  const perimeter = computePerimeter(input, lifts.lifts, params);
  // Timber frame has no internal decks (docs/18 §1.2).
  const birdcage = isTF ? NO_BIRDCAGE : computeBirdcage(input);
  const render = computeRender(input);
  const apex = computeApex(input);
  // What the DRAWING itself implies, from the party-wall flags on the gable ends. Not
  // on a whole-pair/block drawing: its gables are the block's OUTER ends (external by
  // definition), so they say nothing about one plot's position (docs/21 §B6).
  const pgBlock = partyGables(input.wallSegments);
  const drawingConfig =
    input.isApartmentBlock || perimeter.frontage.blockDrawn ? null : configFromPartyGables(pgBlock);
  // Party wall: traditional prices the inside-apex spec item on a non-detached
  // house; timber frame does NOT (Laura's semi line has none — docs/18 §7, ⚠ confirm).
  const pw =
    isTF || input.isApartmentBlock || input.includePartyWall === false
      ? 0
      : partyWalls(input.config);
  // Timber-frame adaptions (LM per adaption lift + apex units). Traditional → null.
  // Adaption lifts = total lifts minus the 2.5-storey's short 1 m lift, which comes
  // off before any adaptions take place (docs/18): 2→3, 2.5→3, 3→4.
  const is2p5 = tfEffectiveStorey(input.storeys, input.roomInRoof) === "2.5";
  const adaptionLifts = Math.max(0, (lifts.lifts ?? 0) - (is2p5 ? 1 : 0));
  const adaptions = isTF
    ? computeAdaptions(perimeter.perLiftM, adaptionLifts, apex.count)
    : null;

  const flags: string[] = [];
  if (roles.swapped && roles.reason) flags.push(roles.reason);
  if (perimeter.frontage.note) flags.push(`Frontage: ${perimeter.frontage.note}`);
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
  // The drawing states which gable is the party wall. Flag when we had to fall back to
  // the length heuristic, and when what the drawing says disagrees with the chosen
  // configuration — never silently override the estimator's choice (docs/21 §B3).
  // Wall-role swap guard. An ATTACHED house type is USUALLY narrow and deep — the party
  // wall is a side wall, so the side (depth) normally exceeds the frontage. Colin's bank:
  // Delmont 4.567 × 9.44, Millfield 5.957 × 11.138. When the read says otherwise the
  // roles may be swapped, which DOUBLES a mid-terrace perimeter. It is a FLAG, not a
  // correction: 4 of the 73 attached types in the bank really are wider than deep
  // (Vistry Birchden, Selwood, Sherwood; Bellway Parkmen). The evidence-based swap is
  // normalizeWallRoles (a front/rear read as the party wall).
  if (!input.isApartmentBlock && input.config !== "DETACHED") {
    const segSum = (ps: WallPosition[]) =>
      input.wallSegments.filter((w) => ps.includes(w.position)).reduce((a, w) => a + w.lengthM, 0);
    const frontage = perimeter.frontage.perHouseFrontM;
    const depth = Math.max(segSum(["gable_left"]), segSum(["gable_right"]));
    if (frontage > 0 && depth > 0 && frontage > depth)
      flags.push(
        `Front/rear (${round3(frontage)} m per house) is WIDER than the side wall (${round3(depth)} m) on an attached house — the wall roles may be swapped (most attached types are narrow and deep, not all). Check the FRONT elevation's width matches the front.`,
      );
  }
  // A whole-block drawing whose two ends differ: which end this plot is decides the
  // exposed gable, and the drawing alone does not say.
  if (perimeter.gableBasis === "block-end") {
    const segSum = (p: WallPosition) =>
      input.wallSegments.filter((w) => w.position === p).reduce((a, w) => a + w.lengthM, 0);
    const gl = segSum("gable_left");
    const gr = segSum("gable_right");
    if (gl > 0 && gr > 0 && Math.abs(gl - gr) / Math.max(gl, gr) > 0.02)
      flags.push(
        `The block's two ends differ (${round3(gl)} m vs ${round3(gr)} m) — the longer was kept as this plot's exposed side wall. Confirm which end this plot is.`,
      );
  }
  if (perimeter.gableBasis === "size" || apex.gableBasis === "size")
    flags.push(
      "The drawing does not say which gable is the party wall — the LONGER gable was kept. Confirm the exposed side.",
    );
  if (drawingConfig !== null && drawingConfig !== input.config) {
    const same =
      drawingConfig === "SEMI_DETACHED" && input.config === "END_TERRACE";
    if (!same)
      flags.push(
        `The drawing shows ${pgBlock.count} party gable wall(s) → ${drawingConfig}, but this take-off is set to ${input.config}. Check.`,
      );
  }
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
    partyGables: pgBlock,
    drawingConfig,
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
    if (x.adaptions) {
      const a = x.adaptions;
      const apexNote = a.apexInsideBoardUnits > 0 ? ` + ${a.apexInsideBoardUnits} apex` : "";
      parts.push(
        `adaptions ${a.insideBoardLM} / ${a.hopUpLM} LM (inside-board / hop-up${apexNote})`,
      );
    }
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
