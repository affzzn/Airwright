import { buildTakeoff, type Configuration } from "@/lib/takeoff/engine";
import { takeoffInputFromStored } from "@/lib/takeoff/fromStored";
import type { TakeoffSnapshot } from "./snapshot";

/**
 * A bank version in Colin's words — the take-off line the engine builds from the
 * stored numbers ("20.56 × 4 lifts / 35.6 m² × 2 floors …"). Shown next to each
 * version so a person can tell v1 from v2 at a glance before picking. Pure.
 */
export interface SnapshotSummary {
  text: string;
  perLiftM: number;
  lifts: number | null;
  storeys: number | null;
  birdcageM2: number;
  birdcageFloors: number;
  /** Apexes on the drawing (GABLE_QTY — the same count the version diff compares). */
  apexes: number;
  configuration: string;
}

export function summarizeSnapshot(snapshot: TakeoffSnapshot): SnapshotSummary {
  const measurements = Object.entries(snapshot.measurements).map(([key, valueNumber]) => ({ key, valueNumber }));
  const input = takeoffInputFromStored(
    measurements,
    snapshot.walls,
    snapshot.warnings as Parameters<typeof takeoffInputFromStored>[2],
    snapshot.configuration as Configuration,
    snapshot.buildType,
  );
  input.includePartyWall = snapshot.includePartyWall;
  const line = buildTakeoff(input);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    text: line.text,
    perLiftM: r2(line.perimeter.perLiftM),
    lifts: line.lifts.lifts,
    storeys: snapshot.measurements.STOREYS ?? null,
    birdcageM2: r2(line.birdcage.totalM2),
    birdcageFloors: line.birdcage.floorCount,
    apexes: snapshot.measurements.GABLE_QTY ?? 0,
    configuration: snapshot.configuration,
  };
}
