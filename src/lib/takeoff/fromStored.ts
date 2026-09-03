import type {
  ApexByFace,
  BuildSystem,
  Configuration,
  FloorArea,
  RoofType,
  TakeoffInput,
  WallPosition,
} from "./engine";
import { STRUCTURE_DWELLINGS, normalizeStructureForm } from "@/lib/structure";

type Measurement = { key: string; valueNumber: unknown };
type Wall = { position: string; lengthM: unknown };
type Warnings = {
  roofType?: unknown;
  roomInRoof?: unknown;
  rendered?: unknown;
  chimney?: unknown;
  elevations?: unknown;
  dwellingsWide?: unknown;
  structure?: unknown;
};

/**
 * Assemble the engine input from a persisted take-off (measurement rows + wall
 * segments + the warnings JSON). Pure — the review screen calls it per config.
 */
export function takeoffInputFromStored(
  measurements: Measurement[],
  walls: Wall[],
  warnings: Warnings,
  config: Configuration,
  buildSystem: BuildSystem = "TRADITIONAL",
): TakeoffInput {
  const num = (key: string): number | null => {
    const m = measurements.find((x) => x.key === key);
    if (!m || m.valueNumber == null) return null;
    const n = Number(m.valueNumber);
    return Number.isFinite(n) ? n : null;
  };

  const floors: FloorArea[] = [];
  for (const [key, level] of [
    ["BIRDCAGE_GF_M2", "GF"],
    ["BIRDCAGE_FF_M2", "FF"],
    ["BIRDCAGE_SF_M2", "SF"],
  ] as const) {
    const v = num(key);
    if (v !== null) floors.push({ level, m2: v });
  }

  // Per-elevation breakdown → render segments + apexes per face.
  const els = Array.isArray(warnings.elevations) ? warnings.elevations : [];
  let renderSegmentsM: number[] = [];
  const apexByFace: ApexByFace = { front: 0, rear: 0, left: 0, right: 0, other: 0 };
  for (const raw of els) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as { face?: unknown; rendered?: unknown; renderLengthM?: unknown; apexCount?: unknown };
    if (e.rendered === true && typeof e.renderLengthM === "number") {
      renderSegmentsM.push(e.renderLengthM);
    }
    const face = e.face;
    const apex = typeof e.apexCount === "number" ? e.apexCount : 0;
    if (face === "front" || face === "rear" || face === "left" || face === "right") {
      apexByFace[face] += apex;
    } else {
      apexByFace.other += apex;
    }
  }
  // Apex total (GABLE_QTY) is the single editable source of truth. Keep the
  // per-face distribution the model read from the elevations, but honour an
  // edited total by scaling the faces to it (config-aware reduction still
  // applies). With no per-face data, split the total across the two gable ends.
  const gableTotal = num("GABLE_QTY");
  const elevApex =
    apexByFace.front + apexByFace.rear + apexByFace.left + apexByFace.right + apexByFace.other;
  if (gableTotal !== null) {
    if (elevApex > 0 && gableTotal !== elevApex) {
      const k = gableTotal / elevApex;
      apexByFace.front *= k;
      apexByFace.rear *= k;
      apexByFace.left *= k;
      apexByFace.right *= k;
      apexByFace.other *= k;
    } else if (elevApex === 0 && gableTotal > 0) {
      apexByFace.left = Math.ceil(gableTotal / 2);
      apexByFace.right = Math.floor(gableTotal / 2);
    }
  }

  // Render: prefer the (editable) RENDER_LENGTH total; else the per-face render
  // segments. An explicit "rendered = false" clears render entirely.
  const renderLen = num("RENDER_LENGTH");
  if (renderLen !== null) renderSegmentsM = renderLen > 0 ? [renderLen] : [];
  if (warnings.rendered === false) renderSegmentsM = [];

  return {
    storeys: num("STOREYS"),
    roomInRoof: warnings.roomInRoof === true,
    heightToSoffitM: num("HEIGHT_TO_SOFFIT"),
    roofType:
      typeof warnings.roofType === "string" ? (warnings.roofType as RoofType) : null,
    wallSegments: walls
      .map((w) => ({
        position: String(w.position).toLowerCase() as WallPosition,
        lengthM: Number(w.lengthM),
      }))
      .filter((w) => Number.isFinite(w.lengthM)),
    dwellingsWide:
      typeof warnings.dwellingsWide === "number" && warnings.dwellingsWide >= 1
        ? warnings.dwellingsWide
        : // Fall back to the count implied by the structure form (pair=2,
          // three-block=3) when dwellingsWide wasn't captured; terrace is 4+ so
          // it still needs the explicit count → defaults to 1 (flagged upstream).
          (STRUCTURE_DWELLINGS[
            normalizeStructureForm(warnings.structure, null) ?? "DETACHED"
          ] ?? 1),
    isApartmentBlock: warnings.structure === "APARTMENT_BLOCK",
    cornerCount: num("CORNER_COUNT"),
    apexByFace,
    renderSegmentsM,
    floors,
    lowLevelCount: num("LOW_LEVEL_QTY") ?? 0,
    chimney: warnings.chimney === true,
    config,
    buildSystem,
  };
}
