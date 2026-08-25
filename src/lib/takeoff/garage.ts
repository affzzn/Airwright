/**
 * Garage take-off (Layer 2). Garages are a separate priced section in Colin's
 * matrix — own columns (1st/2nd lift, gable lift & rails, GF birdcage, dismantle),
 * own stage split (docs/15 §6). But garages have **no extracted geometry** (the
 * drawing extractor doesn't read garages), so — exactly like the rate sheet — the
 * quantities come from a configurable per-type template with flagged placeholder
 * defaults, never a silent guess. Swap `GARAGE_TEMPLATES` for Colin's real
 * standard garage quantities when they land (docs/15 §11.6).
 */

export type GarageType = "SINGLE" | "TWIN" | "CAR_PORT";

export interface GarageLine {
  garageType: GarageType;
  lifts: number;
  perimeterPerLiftM: number; // LM of external scaffold per lift
  gableCount: number; // "Gable Lift & Rails" units
  gfBirdcageM2: number; // GF birdcage area (0 when the garage has no birdcage)
  hasBirdcage: boolean; // drives the 65/10/25 vs 75/0/25 split
  flags: string[];
}

/** One garage type's standard quantities. */
export interface GarageTemplate {
  lifts: number;
  perimeterPerLiftM: number;
  gableCount: number;
  gfBirdcageM2: number;
  hasBirdcage: boolean;
}

/**
 * ⚠️ PLACEHOLDER standard garage quantities — structure is confirmed from Colin's
 * template (docs/15 §6), the numbers are NOT. Every garage priced off these is
 * flagged. Replace with Colin's real standard garage take-offs.
 */
export const GARAGE_TEMPLATES: Record<GarageType, GarageTemplate> = {
  SINGLE: { lifts: 2, perimeterPerLiftM: 15, gableCount: 1, gfBirdcageM2: 18, hasBirdcage: true },
  TWIN: { lifts: 2, perimeterPerLiftM: 22, gableCount: 1, gfBirdcageM2: 32, hasBirdcage: true },
  CAR_PORT: { lifts: 2, perimeterPerLiftM: 15, gableCount: 1, gfBirdcageM2: 0, hasBirdcage: false },
};

/** Build one garage's take-off line from its type template. */
export function buildGarageTakeoff(
  garageType: GarageType,
  templates: Record<GarageType, GarageTemplate> = GARAGE_TEMPLATES,
): GarageLine {
  const t = templates[garageType];
  return {
    garageType,
    lifts: t.lifts,
    perimeterPerLiftM: t.perimeterPerLiftM,
    gableCount: t.gableCount,
    gfBirdcageM2: t.gfBirdcageM2,
    hasBirdcage: t.hasBirdcage,
    flags: [
      "Garage priced on PLACEHOLDER standard quantities (⚠️ confirm the real garage take-off with Colin — docs/15 §11.6).",
    ],
  };
}
