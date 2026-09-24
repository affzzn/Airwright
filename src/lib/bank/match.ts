/**
 * The House-Type Bank matcher (docs/20 §4) — pure, unit-tested, IO-free.
 *
 * Two signals: a cheap NAME/CODE signal generates candidates; the authoritative
 * GEOMETRY signal arbitrates whether they are the same type, changed, or different.
 * It NEVER decides — it proposes candidates with a field-by-field diff for a human
 * to confirm (the app is human-in-the-loop throughout).
 */

import {
  perimeterTotal,
  wallSums,
  type BankBuildType,
  type BankWallPosition,
  type TakeoffSnapshot,
} from "./snapshot";
import { nameSimilarity, normalizeCode, normalizeName } from "./normalize";

// ── Tolerances ───────────────────────────────────────────────────────────────
// PROVISIONAL — the real sign-off tolerance is an open Colin question (docs/11 §8
// #11 / docs/20 §9). Kept in one place, flagged, never silently authoritative.
export const BANK_TOLERANCE = {
  /** Absolute metre tolerance for a wall length / height read (drawing precision). */
  lengthAbsM: 0.2,
  /** Relative tolerance for a birdcage floor area. */
  areaRelPct: 0.03,
  /** Absolute metre tolerance for a rendered length. */
  renderAbsM: 0.3,
  /** Max relative perimeter drift before two types are "different", not "changed". */
  perimeterRelMax: 0.15,
  /** Max apex-count delta before "different", not "changed". */
  apexDeltaMax: 1,
} as const;

export type GeometryVerdict = "IDENTICAL" | "CHANGED" | "DIFFERENT";

export interface FieldDiff {
  field: string;
  label: string;
  from: number | string | null;
  to: number | string | null;
}

export interface GeometryComparison {
  verdict: GeometryVerdict;
  /** Fields that differ beyond tolerance (empty ⇒ IDENTICAL). */
  diffs: FieldDiff[];
  /** The identity-defining fields that broke (⇒ DIFFERENT). */
  breakers: string[];
}

const WALL_LABEL: Record<BankWallPosition, string> = {
  FRONT: "Front wall",
  REAR: "Rear wall",
  GABLE_LEFT: "Gable left",
  GABLE_RIGHT: "Gable right",
  OTHER: "Other wall",
};

function num(snapshot: TakeoffSnapshot, key: keyof TakeoffSnapshot["measurements"]): number | null {
  const v = snapshot.measurements[key];
  return v === undefined ? null : v;
}

/**
 * Compare a fresh take-off snapshot against a stored bank version snapshot.
 * `a` = the stored (bank) side, `b` = the new (incoming) side.
 */
export function compareGeometry(a: TakeoffSnapshot, b: TakeoffSnapshot): GeometryComparison {
  const diffs: FieldDiff[] = [];
  const breakers: string[] = [];
  const T = BANK_TOLERANCE;

  const pushDiff = (field: string, label: string, from: number | string | null, to: number | string | null) =>
    diffs.push({ field, label, from, to });

  // Exact-match fields.
  const aStoreys = num(a, "STOREYS");
  const bStoreys = num(b, "STOREYS");
  if (aStoreys !== bStoreys) {
    pushDiff("storeys", "Storeys", aStoreys, bStoreys);
    breakers.push("storeys");
  }

  const aStruct = a.warnings.structure ?? null;
  const bStruct = b.warnings.structure ?? null;
  if (aStruct !== bStruct) {
    pushDiff("structure", "Structure", aStruct, bStruct);
    breakers.push("structure");
  }

  const aRoof = a.warnings.roofType ?? null;
  const bRoof = b.warnings.roofType ?? null;
  if (aRoof !== bRoof) pushDiff("roofType", "Roof type", aRoof, bRoof);

  const aDw = a.warnings.dwellingsWide ?? null;
  const bDw = b.warnings.dwellingsWide ?? null;
  if (aDw !== bDw) pushDiff("dwellingsWide", "Dwellings wide", aDw, bDw);

  // Counts (exact, but apex within a small delta can still be "changed").
  const aApex = num(a, "GABLE_QTY");
  const bApex = num(b, "GABLE_QTY");
  if (aApex !== bApex) {
    pushDiff("apex", "Apex count", aApex, bApex);
    if (aApex !== null && bApex !== null && Math.abs(aApex - bApex) > T.apexDeltaMax) {
      breakers.push("apex");
    }
  }
  const aCorner = num(a, "CORNER_COUNT");
  const bCorner = num(b, "CORNER_COUNT");
  if (aCorner !== bCorner) pushDiff("corners", "Corner count", aCorner, bCorner);
  const aLow = num(a, "LOW_LEVEL_QTY");
  const bLow = num(b, "LOW_LEVEL_QTY");
  if (aLow !== bLow) pushDiff("lowLevel", "Low levels", aLow, bLow);

  // Tolerant numeric fields.
  const absOff = (x: number | null, y: number | null, tol: number): boolean =>
    x !== null && y !== null && Math.abs(x - y) > tol;
  const relOff = (x: number | null, y: number | null, pct: number): boolean =>
    x !== null && y !== null && Math.max(x, y) > 0 && Math.abs(x - y) / Math.max(x, y) > pct;
  const presenceMismatch = (x: number | null, y: number | null): boolean =>
    (x === null) !== (y === null);

  const aH = num(a, "HEIGHT_TO_SOFFIT");
  const bH = num(b, "HEIGHT_TO_SOFFIT");
  if (absOff(aH, bH, T.lengthAbsM) || presenceMismatch(aH, bH)) pushDiff("height", "Height to soffit", aH, bH);

  const aR = num(a, "RENDER_LENGTH");
  const bR = num(b, "RENDER_LENGTH");
  if (absOff(aR, bR, T.renderAbsM) || presenceMismatch(aR, bR)) pushDiff("render", "Render length", aR, bR);

  for (const key of ["BIRDCAGE_GF_M2", "BIRDCAGE_FF_M2", "BIRDCAGE_SF_M2"] as const) {
    const av = num(a, key);
    const bv = num(b, key);
    if (relOff(av, bv, T.areaRelPct) || presenceMismatch(av, bv)) {
      pushDiff(key.toLowerCase(), `Birdcage ${key.replace("BIRDCAGE_", "").replace("_M2", "")}`, av, bv);
    }
  }

  // Per-wall lengths.
  const aWalls = wallSums(a.walls);
  const bWalls = wallSums(b.walls);
  for (const pos of ["FRONT", "REAR", "GABLE_LEFT", "GABLE_RIGHT", "OTHER"] as BankWallPosition[]) {
    if (Math.abs(aWalls[pos] - bWalls[pos]) > T.lengthAbsM) {
      pushDiff(`wall_${pos.toLowerCase()}`, WALL_LABEL[pos], aWalls[pos], bWalls[pos]);
    }
  }

  // Perimeter gate: a large total drift means a different house, not a revision.
  const aPerim = perimeterTotal(a.walls);
  const bPerim = perimeterTotal(b.walls);
  if (relOff(aPerim, bPerim, T.perimeterRelMax)) breakers.push("perimeter");

  const verdict: GeometryVerdict =
    breakers.length > 0 ? "DIFFERENT" : diffs.length === 0 ? "IDENTICAL" : "CHANGED";
  return { verdict, diffs, breakers };
}

// ── Candidate matching ───────────────────────────────────────────────────────

/** A stored bank entry, reduced to what the matcher needs (IO happens in the caller). */
export interface BankCandidateInput {
  entryId: string;
  buildType: BankBuildType;
  canonicalName: string;
  canonicalCode: string | null;
  aliases: string[];
  /** The current version's snapshot, for the geometry compare. */
  snapshot: TakeoffSnapshot | null;
}

export interface IncomingType {
  buildType: BankBuildType;
  name: string;
  code: string | null;
  snapshot: TakeoffSnapshot;
}

export type ProposalKind = "REUSE" | "CHANGED" | "AMBIGUOUS" | "WEAK";

export interface Candidate {
  entryId: string;
  kind: ProposalKind;
  /** How the name/code matched. */
  nameScore: number;
  strong: boolean;
  aliasHit: boolean;
  codeEqual: boolean;
  geometry: GeometryComparison | null;
  /** Overall rank score (higher = better) for ordering the candidate list. */
  rank: number;
}

export interface MatchResult {
  /** Ranked candidates, best first. Empty ⇒ treat the incoming type as NEW. */
  candidates: Candidate[];
  best: Candidate | null;
  /** The proposed decision-table state for the whole match (docs/20 §4). */
  state: "REUSE" | "CHANGED" | "AMBIGUOUS" | "CHOOSE" | "NEW";
}

const NAME_CANDIDATE_MIN = 0.6;
const NAME_STRONG_MIN = 0.85;

/**
 * Upload-time (pre-read) match on NAME/CODE only — there is no geometry yet, so
 * this is a weaker signal used to SUGGEST a bank repeat before the drawing is read
 * (docs/20 §6c). Returns strong candidates (alias/code/prefix/high-name), best first.
 * A human still confirms — the geometry check happens if/when the drawing is read.
 */
export function nameCodeMatch(
  incoming: { buildType: BankBuildType; name: string; code: string | null },
  entries: BankCandidateInput[],
): { entryId: string; strong: boolean; nameScore: number; aliasHit: boolean; codeEqual: boolean }[] {
  const inName = normalizeName(incoming.name);
  const inCode = normalizeCode(incoming.code);
  const out: { entryId: string; strong: boolean; nameScore: number; aliasHit: boolean; codeEqual: boolean }[] = [];
  for (const e of entries) {
    if (e.buildType !== incoming.buildType) continue;
    const aliasNorms = e.aliases.map((a) => normalizeName(a));
    const aliasCodeNorms = e.aliases.map((a) => normalizeCode(a)).filter((c): c is string => !!c);
    const entryName = normalizeName(e.canonicalName);
    const entryCode = normalizeCode(e.canonicalCode);
    const aliasHit =
      (inName.length > 0 && aliasNorms.includes(inName)) ||
      (inCode !== null && aliasCodeNorms.includes(inCode));
    const codeEqual = inCode !== null && entryCode !== null && inCode === entryCode;
    const sim = nameSimilarity(inName, entryName);
    const strong = aliasHit || codeEqual || sim.exact || sim.prefix || sim.score >= NAME_STRONG_MIN;
    if (!strong) continue; // suggestions are strong-only (name alone is a weak signal)
    out.push({ entryId: e.entryId, strong, nameScore: sim.score, aliasHit, codeEqual });
  }
  const score = (c: { aliasHit: boolean; codeEqual: boolean; nameScore: number }) =>
    (c.aliasHit ? 3 : 0) + (c.codeEqual ? 2 : 0) + c.nameScore;
  out.sort((a, b) => score(b) - score(a));
  return out;
}

/**
 * Match an incoming house type against the client's bank entries (already scoped
 * to the same client + buildType by the caller). Returns ranked proposals.
 */
export function matchAgainstBank(incoming: IncomingType, entries: BankCandidateInput[]): MatchResult {
  const inName = normalizeName(incoming.name);
  const inCode = normalizeCode(incoming.code);
  const candidates: Candidate[] = [];

  for (const e of entries) {
    if (e.buildType !== incoming.buildType) continue;

    const aliasNorms = e.aliases.map((a) => normalizeName(a));
    const aliasCodeNorms = e.aliases.map((a) => normalizeCode(a)).filter((c): c is string => !!c);
    const entryName = normalizeName(e.canonicalName);
    const entryCode = normalizeCode(e.canonicalCode);

    const aliasHit =
      (inName.length > 0 && aliasNorms.includes(inName)) ||
      (inCode !== null && aliasCodeNorms.includes(inCode));
    const codeEqual = inCode !== null && entryCode !== null && inCode === entryCode;
    const sim = nameSimilarity(inName, entryName);

    const isCandidate = aliasHit || codeEqual || sim.score >= NAME_CANDIDATE_MIN;
    if (!isCandidate) continue;

    const strong = aliasHit || codeEqual || sim.exact || sim.prefix || sim.score >= NAME_STRONG_MIN;
    const geometry = e.snapshot ? compareGeometry(e.snapshot, incoming.snapshot) : null;

    // Map (name strength × geometry verdict) → the proposal kind (decision table).
    let kind: ProposalKind;
    if (!geometry) {
      kind = strong ? "REUSE" : "WEAK";
    } else if (strong) {
      kind =
        geometry.verdict === "IDENTICAL"
          ? "REUSE"
          : geometry.verdict === "CHANGED"
            ? "CHANGED"
            : "AMBIGUOUS";
    } else {
      kind = geometry.verdict === "DIFFERENT" ? "WEAK" : "CHANGED";
    }

    // Rank: prefer strong, then closer geometry, then higher name score.
    const geomBonus =
      geometry?.verdict === "IDENTICAL" ? 1 : geometry?.verdict === "CHANGED" ? 0.5 : 0;
    const rank =
      (aliasHit ? 3 : 0) + (codeEqual ? 2 : 0) + (strong ? 1 : 0) + geomBonus + sim.score;

    candidates.push({ entryId: e.entryId, kind, nameScore: sim.score, strong, aliasHit, codeEqual, geometry, rank });
  }

  candidates.sort((a, b) => b.rank - a.rank);
  const best = candidates[0] ?? null;

  let state: MatchResult["state"];
  if (!best) state = "NEW";
  else if (candidates.length > 1 && candidates[1].rank >= best.rank - 0.05) state = "CHOOSE";
  else if (best.kind === "REUSE") state = "REUSE";
  else if (best.kind === "CHANGED") state = "CHANGED";
  else if (best.kind === "AMBIGUOUS") state = "AMBIGUOUS";
  else state = "CHOOSE";

  return { candidates, best, state };
}
