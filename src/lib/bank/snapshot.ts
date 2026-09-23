/**
 * The frozen take-off payload stored in a House-Type Bank version (docs/20 §3.1).
 *
 * A snapshot holds OBSERVABLES only — the same values `takeoffInputFromStored`
 * reads (measurements + wall segments + categoricals/elevations + configuration +
 * buildType). Never a price. Pure + unit-tested: serialise from a stored take-off,
 * deserialise back into project take-off rows, and derive a stable geometry
 * fingerprint for cheap change-detection.
 */

import { createHash } from "node:crypto";

export type BankBuildType = "TRADITIONAL" | "TIMBER_FRAME";
export type BankConfiguration =
  | "DETACHED"
  | "SEMI_DETACHED"
  | "END_TERRACE"
  | "MID_TERRACE";
export type BankWallPosition =
  | "FRONT"
  | "REAR"
  | "GABLE_LEFT"
  | "GABLE_RIGHT"
  | "OTHER";

/** The numeric measurement keys a take-off snapshot freezes (the editable set). */
export const BANK_MEASUREMENT_KEYS = [
  "STOREYS",
  "HEIGHT_TO_SOFFIT",
  "GABLE_QTY",
  "RENDER_LENGTH",
  "BIRDCAGE_GF_M2",
  "BIRDCAGE_FF_M2",
  "BIRDCAGE_SF_M2",
  "LOW_LEVEL_QTY",
  "CORNER_COUNT",
] as const;
export type BankMeasurementKey = (typeof BANK_MEASUREMENT_KEYS)[number];
const MEASUREMENT_KEY_SET = new Set<string>(BANK_MEASUREMENT_KEYS);

/** The warnings subset that drives the take-off engine (read by fromStored). */
export interface BankWarnings {
  roofType?: string | null;
  roomInRoof?: boolean | null;
  rendered?: boolean | null;
  chimney?: boolean | null;
  structure?: string | null;
  dwellingsWide?: number | null;
  /** Per-elevation apex/render breakdown — preserved verbatim for fromStored. */
  elevations?: unknown[];
}

export interface TakeoffSnapshot {
  /** Snapshot schema version — bump if the shape changes so old rows stay readable. */
  snapshotVersion: 1;
  buildType: BankBuildType;
  configuration: BankConfiguration;
  includePartyWall: boolean;
  measurements: Partial<Record<BankMeasurementKey, number>>;
  walls: { position: BankWallPosition; lengthM: number }[];
  warnings: BankWarnings;
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

type StoredMeasurement = { key: string; valueNumber: unknown };
type StoredWall = { position: string; lengthM: unknown };

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Freeze a persisted take-off into a snapshot. Takes the raw measurement rows,
 * wall segments and warnings JSON (Prisma Decimals accepted — coerced to number).
 */
export function serializeSnapshot(input: {
  buildType: BankBuildType;
  configuration: BankConfiguration;
  includePartyWall: boolean;
  measurements: StoredMeasurement[];
  walls: StoredWall[];
  warnings: unknown;
}): TakeoffSnapshot {
  const measurements: Partial<Record<BankMeasurementKey, number>> = {};
  for (const m of input.measurements) {
    if (!MEASUREMENT_KEY_SET.has(m.key)) continue;
    const n = toNum(m.valueNumber);
    if (n !== null) measurements[m.key as BankMeasurementKey] = round3(n);
  }

  const walls = input.walls
    .map((w) => ({
      position: String(w.position).toUpperCase() as BankWallPosition,
      lengthM: toNum(w.lengthM),
    }))
    .filter((w): w is { position: BankWallPosition; lengthM: number } => w.lengthM !== null)
    .map((w) => ({ position: w.position, lengthM: round3(w.lengthM) }));

  const w =
    input.warnings && typeof input.warnings === "object" && !Array.isArray(input.warnings)
      ? (input.warnings as Record<string, unknown>)
      : {};
  const warnings: BankWarnings = {};
  if (typeof w.roofType === "string") warnings.roofType = w.roofType;
  if (typeof w.roomInRoof === "boolean") warnings.roomInRoof = w.roomInRoof;
  if (typeof w.rendered === "boolean") warnings.rendered = w.rendered;
  if (typeof w.chimney === "boolean") warnings.chimney = w.chimney;
  if (typeof w.structure === "string") warnings.structure = w.structure;
  if (typeof w.dwellingsWide === "number") warnings.dwellingsWide = w.dwellingsWide;
  if (Array.isArray(w.elevations)) warnings.elevations = w.elevations;

  return {
    snapshotVersion: 1,
    buildType: input.buildType,
    configuration: input.configuration,
    includePartyWall: input.includePartyWall,
    measurements,
    walls,
    warnings,
  };
}

/** Parse an unknown JSON blob back into a TakeoffSnapshot (defensive). Returns null if unusable. */
export function parseSnapshot(raw: unknown): TakeoffSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const buildType = o.buildType === "TIMBER_FRAME" ? "TIMBER_FRAME" : "TRADITIONAL";
  const configuration =
    typeof o.configuration === "string" &&
    ["DETACHED", "SEMI_DETACHED", "END_TERRACE", "MID_TERRACE"].includes(o.configuration)
      ? (o.configuration as BankConfiguration)
      : "DETACHED";
  const measurements: Partial<Record<BankMeasurementKey, number>> = {};
  const mIn = o.measurements && typeof o.measurements === "object" ? (o.measurements as Record<string, unknown>) : {};
  for (const key of BANK_MEASUREMENT_KEYS) {
    const n = toNum(mIn[key]);
    if (n !== null) measurements[key] = n;
  }
  const walls = Array.isArray(o.walls)
    ? (o.walls as unknown[])
        .map((x) => {
          const wo = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
          const pos = String(wo.position ?? "OTHER").toUpperCase();
          const len = toNum(wo.lengthM);
          return len !== null && ["FRONT", "REAR", "GABLE_LEFT", "GABLE_RIGHT", "OTHER"].includes(pos)
            ? { position: pos as BankWallPosition, lengthM: len }
            : null;
        })
        .filter((x): x is { position: BankWallPosition; lengthM: number } => x !== null)
    : [];
  const wIn = o.warnings && typeof o.warnings === "object" ? (o.warnings as Record<string, unknown>) : {};
  const warnings: BankWarnings = {};
  if (typeof wIn.roofType === "string") warnings.roofType = wIn.roofType;
  if (typeof wIn.roomInRoof === "boolean") warnings.roomInRoof = wIn.roomInRoof;
  if (typeof wIn.rendered === "boolean") warnings.rendered = wIn.rendered;
  if (typeof wIn.chimney === "boolean") warnings.chimney = wIn.chimney;
  if (typeof wIn.structure === "string") warnings.structure = wIn.structure;
  if (typeof wIn.dwellingsWide === "number") warnings.dwellingsWide = wIn.dwellingsWide;
  if (Array.isArray(wIn.elevations)) warnings.elevations = wIn.elevations;

  return {
    snapshotVersion: 1,
    buildType,
    configuration,
    includePartyWall: o.includePartyWall !== false,
    measurements,
    walls,
    warnings,
  };
}

/** A wall position summed to a single length (front/rear/gables/other) — for compare. */
export function wallSums(walls: { position: BankWallPosition; lengthM: number }[]): Record<BankWallPosition, number> {
  const sums: Record<BankWallPosition, number> = {
    FRONT: 0,
    REAR: 0,
    GABLE_LEFT: 0,
    GABLE_RIGHT: 0,
    OTHER: 0,
  };
  for (const w of walls) sums[w.position] = round3(sums[w.position] + w.lengthM);
  return sums;
}

/** Total run of external scaffold walls (all positions), for the perimeter gate. */
export function perimeterTotal(walls: { position: BankWallPosition; lengthM: number }[]): number {
  return round3(walls.reduce((a, w) => a + w.lengthM, 0));
}

/**
 * A stable content hash of the rounded observables. Equal fingerprints ⇒ no
 * meaningful geometry change — used to avoid writing a duplicate bank version.
 * Rounded (cm for lengths, 0.1 m² for areas) so sub-tolerance jitter is ignored.
 */
export function geometryFingerprint(snapshot: TakeoffSnapshot): string {
  const m = snapshot.measurements;
  const r2 = (v: number | undefined): number | null => (v === undefined ? null : Math.round(v * 100) / 100);
  const r1 = (v: number | undefined): number | null => (v === undefined ? null : Math.round(v * 10) / 10);
  const canonical = {
    buildType: snapshot.buildType,
    storeys: m.STOREYS ?? null,
    height: r2(m.HEIGHT_TO_SOFFIT),
    apex: m.GABLE_QTY ?? null,
    render: r2(m.RENDER_LENGTH),
    bcGf: r1(m.BIRDCAGE_GF_M2),
    bcFf: r1(m.BIRDCAGE_FF_M2),
    bcSf: r1(m.BIRDCAGE_SF_M2),
    lowLevel: m.LOW_LEVEL_QTY ?? null,
    corners: m.CORNER_COUNT ?? null,
    walls: Object.entries(wallSums(snapshot.walls))
      .map(([p, v]) => [p, Math.round(v * 100) / 100] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1)),
    roofType: snapshot.warnings.roofType ?? null,
    structure: snapshot.warnings.structure ?? null,
    dwellingsWide: snapshot.warnings.dwellingsWide ?? null,
  };
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex");
}
