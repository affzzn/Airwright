/**
 * Shared string-literal types for the construction estimator (docs/19). These
 * MIRROR the Prisma enums but are plain unions, so the pure engine (`price.ts`,
 * `rules.ts`) and its unit tests never import the Prisma client. Keep in sync with
 * `prisma/schema.prisma`.
 */

export type ConstructionUnit =
  | "LM_PER_LIFT"
  | "M2_PER_LIFT"
  | "NR_PER_LIFT"
  | "NR"
  | "LM"
  | "M2"
  | "PER_WEEK"
  | "FIXED";

export type HeightBracket =
  | "UP_TO_6M"
  | "H6_12M"
  | "H12_18M"
  | "H18_24M"
  | "H24_30M"
  | "ANY";

export type RateBand =
  | "SUPER_COMPETITIVE"
  | "COMPETITIVE"
  | "MEDIUM"
  | "HIGH"
  | "CUSTOM";

export type SiteType =
  | "SCHOOL"
  | "PUBLIC_STREET"
  | "CONSTRUCTION_SITE"
  | "COMMERCIAL"
  | "OTHER";

/** The units whose quantity is multiplied by the number of lifts. */
export const PER_LIFT_UNITS: ReadonlySet<ConstructionUnit> = new Set<ConstructionUnit>([
  "LM_PER_LIFT",
  "M2_PER_LIFT",
  "NR_PER_LIFT",
]);

export const UNIT_LABEL: Record<ConstructionUnit, string> = {
  LM_PER_LIFT: "m / lift",
  M2_PER_LIFT: "m² / lift",
  NR_PER_LIFT: "nr / lift",
  NR: "nr",
  LM: "m",
  M2: "m²",
  PER_WEEK: "week",
  FIXED: "item",
};

export const BRACKET_LABEL: Record<HeightBracket, string> = {
  UP_TO_6M: "up to 6 m",
  H6_12M: "6–12 m",
  H12_18M: "12–18 m",
  H18_24M: "18–24 m",
  H24_30M: "24–30 m",
  ANY: "any height",
};

export const BAND_LABEL: Record<RateBand, string> = {
  SUPER_COMPETITIVE: "Super competitive",
  COMPETITIVE: "Competitive",
  MEDIUM: "Medium",
  HIGH: "High",
  CUSTOM: "Custom",
};

export const SITE_TYPE_LABEL: Record<SiteType, string> = {
  SCHOOL: "School",
  PUBLIC_STREET: "Public street",
  CONSTRUCTION_SITE: "Construction site",
  COMMERCIAL: "Commercial",
  OTHER: "Other",
};
