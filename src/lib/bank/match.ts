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

// ── Finding repeats (docs/20 v2) ─────────────────────────────────────────────

/** A bank entry, reduced to what the repeat finder needs (IO happens in the caller). */
export interface BankEntryRef {
  entryId: string;
  buildType: BankBuildType;
  canonicalName: string;
  canonicalCode: string | null;
  aliases: string[];
  /** Who the entry came from — a label + ranking hint, never a filter. */
  builderKey: string;
}

export interface IncomingName {
  buildType: BankBuildType;
  name: string;
  code: string | null;
  builderKey: string;
}

export type RepeatStrength = "STRONG" | "POSSIBLE";
export type RepeatReason = "code" | "alias" | "name" | "similar name";

export interface Repeat {
  entryId: string;
  /** STRONG = the same name/code/alias; POSSIBLE = a similar name a person should check. */
  strength: RepeatStrength;
  reason: RepeatReason;
  sameBuilder: boolean;
  nameScore: number;
}

/** Below this a name is not even offered; at/above STRONG it is "the same name". */
export const NAME_POSSIBLE_MIN = 0.6;
export const NAME_STRONG_MIN = 0.85;

/** Normalise a builder (client) name so "Bloor", "bloor " and "BLOOR" are one builder. */
export function builderKey(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Which bank entries could this house type be? Searches the WHOLE bank — every
 * builder — and only ever keeps the same build type (a timber-frame Denton is priced
 * differently from a traditional one). It does not decide: a person picks the
 * version. Deliberately not strict, so a repeat is not missed:
 *  - a learned alias, or the same name after normalising ("Denton", "DENTON",
 *    "Denton-XYZ", "The Denton (Semi)", "Denton 2B") → STRONG;
 *  - the same code from the SAME builder → STRONG; the same code from another
 *    builder with an unrelated name → POSSIBLE (short codes like "B5" are reused
 *    across builders);
 *  - a similar name (a typo, "Milfield") → STRONG at ≥ 0.85, POSSIBLE at ≥ 0.6.
 * Ranked: STRONG first, then the same builder, then the closer name.
 */
export function findRepeats(incoming: IncomingName, entries: BankEntryRef[]): Repeat[] {
  const inName = normalizeName(incoming.name);
  const inCode = normalizeCode(incoming.code);
  const out: Repeat[] = [];
  for (const e of entries) {
    if (e.buildType !== incoming.buildType) continue;
    const sameBuilder = e.builderKey.length > 0 && e.builderKey === incoming.builderKey;
    const aliasNames = e.aliases.map((a) => normalizeName(a)).filter((a) => a.length > 0);
    const aliasCodes = e.aliases.map((a) => normalizeCode(a)).filter((c): c is string => !!c);
    const entryCode = normalizeCode(e.canonicalCode);
    const sim = [normalizeName(e.canonicalName), ...aliasNames]
      .map((n) => nameSimilarity(inName, n))
      .reduce((best, s) => (s.score > best.score || (s.prefix && !best.prefix) ? s : best), {
        score: 0,
        prefix: false,
        exact: false,
      });

    const aliasHit =
      (inName.length > 0 && aliasNames.includes(inName)) || (inCode !== null && aliasCodes.includes(inCode));
    const codeEqual = inCode !== null && entryCode !== null && inCode === entryCode;
    const sameName = sim.exact || sim.prefix || sim.score >= NAME_STRONG_MIN;

    let strength: RepeatStrength | null = null;
    let reason: RepeatReason = "name";
    if (aliasHit) {
      strength = "STRONG";
      reason = "alias";
    } else if (codeEqual && (sameBuilder || sim.score >= NAME_POSSIBLE_MIN || sameName)) {
      strength = "STRONG";
      reason = "code";
    } else if (sameName) {
      strength = "STRONG";
      reason = "name";
    } else if (codeEqual) {
      strength = "POSSIBLE";
      reason = "code";
    } else if (sim.score >= NAME_POSSIBLE_MIN) {
      strength = "POSSIBLE";
      reason = "similar name";
    }
    if (!strength) continue;
    out.push({ entryId: e.entryId, strength, reason, sameBuilder, nameScore: sim.score });
  }
  const rank = (r: Repeat) => (r.strength === "STRONG" ? 10 : 0) + (r.sameBuilder ? 2 : 0) + r.nameScore;
  return out.sort((a, b) => rank(b) - rank(a));
}

// ── Saving: how a take-off compares with an entry's versions ─────────────────

export interface VersionRef {
  versionId: string;
  version: number;
  snapshot: TakeoffSnapshot | null;
}

export interface EntryComparison {
  /** A stored version whose numbers match this take-off (within tolerance), if any. */
  identicalTo: { versionId: string; version: number } | null;
  /** The newest version and how this take-off differs from it. */
  latest: { versionId: string; version: number; comparison: GeometryComparison | null } | null;
  /** The number the next saved version would get. */
  nextVersion: number;
}

/**
 * Compare a confirmed take-off with every stored version of one entry. Used by
 * "Save to house bank": an identical version means there is nothing new to save;
 * otherwise the person chooses "new version" or "a different house type".
 */
export function compareWithEntry(snapshot: TakeoffSnapshot, versions: VersionRef[]): EntryComparison {
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  let identicalTo: EntryComparison["identicalTo"] = null;
  for (const v of sorted) {
    if (v.snapshot && compareGeometry(v.snapshot, snapshot).verdict === "IDENTICAL") {
      identicalTo = { versionId: v.versionId, version: v.version };
      break;
    }
  }
  const newest = sorted[0] ?? null;
  return {
    identicalTo,
    latest: newest
      ? {
          versionId: newest.versionId,
          version: newest.version,
          comparison: newest.snapshot ? compareGeometry(newest.snapshot, snapshot) : null,
        }
      : null,
    nextVersion: (newest?.version ?? 0) + 1,
  };
}
