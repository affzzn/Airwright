/**
 * The DEVELOPMENT picking list for construction (docs/22 §4.0) — PURE data,
 * imported by `prisma/seed.ts` and `scripts/restore-seed-library.mts`.
 *
 * ⚠ Every rate here is a DEV PLACEHOLDER. Airwright's final construction list has
 * not been confirmed, so this list exists to give the pack reader real targets to
 * map a scope to (ladder access, towers, slab-edge / leading-edge / void
 * protection, shaft and core scaffolds, riser platforms…). The SHAPE follows
 * Airwright's own sheet (`cons-data/picking list.xlsm`): a price per commercial
 * band and per height bracket, a 4-week base hire period, an E/H value per unit
 * per week and a band percentage of it charged beyond the base. Where the real
 * sheet prices the same family, its Competitive ladder is used as the magnitude
 * (e.g. Independent Scaffold 35.78 / 42.02 / 45.14 / 51.38); everything else is a
 * sensible guess. When the real list lands, re-run `scripts/import-rate-sheet.mts`.
 *
 * Existing ids are KEPT (quote lines point at them); new ids are added. Every
 * item's `defaultRuleNote` starts with `DEV_PLACEHOLDER_NOTE` so the Rates tab can
 * badge it and nobody mistakes it for a confirmed rate.
 */

import type { BusinessLine, ConstructionUnit, HeightBracket, RateBand } from "@prisma/client";
import { DEV_PLACEHOLDER_NOTE } from "./devPlaceholder";

export { DEV_PLACEHOLDER_NOTE, isDevPlaceholder } from "./devPlaceholder";

export interface SeedRate {
  band: RateBand;
  bracket: HeightBracket;
  rate: number;
  baseHireWeeks: number;
  extraHirePerWeek: number;
  extraHireChargePct: number;
}

export interface SeedElement {
  id: string; // deterministic, so re-seeding is idempotent
  line: BusinessLine;
  name: string;
  aliases: string[];
  category: string; // Access | Protection | Internal | Extras
  unit: ConstructionUnit;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote: string;
  sortOrder: number;
  rates: SeedRate[];
}


/** Rates include this many weeks of hire (construction, per Airwright's sheet). */
const BASE_HIRE_WEEKS = 4;

/**
 * Band multipliers against the Competitive price, and the percentage of the E/H
 * value charged per extra week. Taken from the real sheet's Independent Scaffold
 * (C 35.78 · M 42.11 · H 55.84 → ×1.18 / ×1.56) and Scaffold Tower (SC ≈ ×0.87);
 * charge % H 100 · M 75 · C 50 as the sheet mostly has it (SC 50 on its towers).
 */
const BANDS: { band: RateBand; factor: number; chargePct: number }[] = [
  { band: "SUPER_COMPETITIVE", factor: 0.87, chargePct: 50 },
  { band: "COMPETITIVE", factor: 1, chargePct: 50 },
  { band: "MEDIUM", factor: 1.18, chargePct: 75 },
  { band: "HIGH", factor: 1.56, chargePct: 100 },
];

const BRACKETS: HeightBracket[] = ["UP_TO_6M", "H6_12M", "H12_18M", "H18_24M", "H24_30M"];

const r2 = (n: number) => Math.round(n * 100) / 100;

/** A bracketed item: the Competitive price per height bracket (≤6 … 24–30 m). */
function ladder(competitive: [number, number, number, number, number], eh: number): SeedRate[] {
  return BANDS.flatMap(({ band, factor, chargePct }) =>
    BRACKETS.map((bracket, i) => ({
      band,
      bracket,
      rate: r2(competitive[i] * factor),
      baseHireWeeks: BASE_HIRE_WEEKS,
      extraHirePerWeek: eh,
      extraHireChargePct: chargePct,
    })),
  );
}

/** A flat (height-agnostic) item: one Competitive price, banded. */
function flat(competitive: number, eh: number, baseHireWeeks = BASE_HIRE_WEEKS): SeedRate[] {
  return BANDS.map(({ band, factor, chargePct }) => ({
    band,
    bracket: "ANY" as HeightBracket,
    rate: r2(competitive * factor),
    baseHireWeeks,
    extraHirePerWeek: eh,
    extraHireChargePct: chargePct,
  }));
}

const note = (rule: string) => `${DEV_PLACEHOLDER_NOTE}. ${rule}`;

export const CONSTRUCTION_ELEMENT_SEED: SeedElement[] = [
  // --- Access -----------------------------------------------------------------
  {
    id: "ce-independent-scaffold",
    line: "CONSTRUCTION",
    name: "Independent Scaffold",
    aliases: [
      "working platform",
      "independent tied scaffold",
      "independent scaffold",
      "ConInscaff",
      "perimeter scaffold",
      "wrap scaffold",
      "access scaffold",
    ],
    category: "Access",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("The boarded working platform beside the building. Metres per lift."),
    sortOrder: 10,
    rates: ladder([35.78, 42.02, 45.14, 51.38, 57.2], 1.2),
  },
  {
    id: "ce-boarded-lift",
    line: "CONSTRUCTION",
    name: "Additional Boarded Lift",
    aliases: ["lifts at each level", "boarded lift", "additional lift", "working lift"],
    category: "Access",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("Boarding more lifts than the working one. Metres per lift."),
    sortOrder: 15,
    rates: ladder([6.5, 7.6, 8.2, 9.3, 10.4], 0.5),
  },
  {
    id: "ce-ladder-access-bay",
    line: "CONSTRUCTION",
    name: "Ladder Access Bay (gate + door)",
    aliases: ["ladder access bays", "ladder access bay", "ladder bay", "ladder access"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("A bay with ladders between lifts. Priced per lift."),
    sortOrder: 20,
    rates: ladder([65.4, 72.0, 78.0, 85.0, 92.0], 1.2),
  },
  {
    id: "ce-ladder-tower",
    line: "CONSTRUCTION",
    name: "Ladder Tower",
    aliases: ["ladder tower", "ladder towers", "emergency exit ladder tower"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("A free-standing ladder tower (access or emergency exit). Priced per lift."),
    sortOrder: 25,
    rates: ladder([170, 187, 204, 221, 238], 4.8),
  },
  {
    id: "ce-haki-stair",
    line: "CONSTRUCTION",
    name: "Haki Stair Tower",
    aliases: [
      "haki",
      "hacky stairs",
      "haki staircase",
      "staircase access tower",
      "staircase access towers",
      "stair tower",
    ],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note(
      "Proprietary stair tower, priced per lift. Lifts follow the scaffold it serves (suggested from the height).",
    ),
    sortOrder: 30,
    rates: ladder([300, 325, 350, 375, 400], 10),
  },
  {
    id: "ce-scaffold-tower",
    line: "CONSTRUCTION",
    name: "Scaffold Tower",
    aliases: ["tower", "access tower", "independent tower"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("An independent tower (under 8 m run). Priced per lift."),
    sortOrder: 35,
    rates: ladder([515, 560, 610, 665, 725], 9.6),
  },
  {
    id: "ce-loading-bay",
    line: "CONSTRUCTION",
    name: "Loading Bay",
    aliases: ["loading bay", "loading bays", "external loading bay", "LB"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("3.6 × 2.4 grid. Priced PER LIFT (loading bay on lift 1, lift 2 …)."),
    sortOrder: 40,
    rates: ladder([400, 450, 500, 600, 700], 6),
  },
  {
    id: "ce-loading-bay-platform",
    line: "CONSTRUCTION",
    name: "Loading Bay Platform (offset / cantilever)",
    aliases: ["loading bay platforms", "loading bay platform", "offset loading bay", "side on loading bay"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: note("An offset or cantilevered landing platform. Priced per lift."),
    sortOrder: 45,
    rates: ladder([450, 500, 560, 660, 760], 6),
  },
  {
    id: "ce-loading-bay-gate",
    line: "CONSTRUCTION",
    name: "Loading Bay Gate",
    aliases: ["gates", "loading bay gate", "up and over gate", "swing gate"],
    category: "Access",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("The gate at a loading bay edge. Number."),
    sortOrder: 50,
    rates: flat(95, 1.2),
  },
  {
    id: "ce-rubbish-chute",
    line: "CONSTRUCTION",
    name: "Rubbish Chute / Skip Bay",
    aliases: ["rubbish shoot", "rubbish chute", "chute", "skip bay"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: note("Priced PER LIFT. (A skip itself is client-supplied.)"),
    sortOrder: 55,
    rates: flat(45, 2.4),
  },
  {
    id: "ce-roof-access",
    line: "CONSTRUCTION",
    name: "Roof Access (ladder / tower)",
    aliases: ["roof access", "access to roof", "access"],
    category: "Access",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Access onto the roof. One per access point."),
    sortOrder: 60,
    rates: flat(180, 4.8),
  },

  // --- Protection ---------------------------------------------------------------
  {
    id: "ce-double-handrail",
    line: "CONSTRUCTION",
    name: "Double Handrail (+ toe board)",
    aliases: ["handrail", "guardrail", "edge protection", "scaffold handrail", "double handrail"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("The standard handrail (double + toe board). Metres."),
    sortOrder: 100,
    rates: ladder([25.61, 25.61, 27.0, 28.5, 30.0], 0.5),
  },
  {
    id: "ce-single-handrail",
    line: "CONSTRUCTION",
    name: "Single / Additional Handrail",
    aliases: ["additional handrail", "single rail", "single handrail"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("Only where an obstruction blocks a double; also the '+1' of a triple. Metres."),
    sortOrder: 105,
    rates: ladder([7.75, 7.75, 8.2, 8.7, 9.2], 0.5),
  },
  {
    id: "ce-triple-handrail",
    line: "CONSTRUCTION",
    name: "Triple Handrail",
    aliases: ["triple guardrails", "triple guardrails & toe boards", "triple handrail", "triple guardrail"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("Double + single. The roof / building-edge default. Metres."),
    sortOrder: 110,
    rates: ladder([33.36, 33.36, 35.2, 37.2, 39.2], 0.5),
  },
  {
    id: "ce-toe-board",
    line: "CONSTRUCTION",
    name: "Toe Board",
    aliases: ["toe boards", "toe board"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Usually part of a double handrail; a separate line only when itemised."),
    sortOrder: 115,
    rates: flat(3, 0.5),
  },
  {
    id: "ce-slab-edge",
    line: "CONSTRUCTION",
    name: "Slab Edge Protection",
    aliases: ["slab edge protection", "slab edge", "floor edge protection"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("Edge protection around each suspended floor slab. Metres."),
    sortOrder: 120,
    rates: ladder([22, 24, 26, 29, 32], 0.5),
  },
  {
    id: "ce-leading-edge",
    line: "CONSTRUCTION",
    name: "Leading Edge Protection",
    aliases: ["leading edge protection", "leading edge", "precast install edge protection"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("The moving edge while precast planks are laid. Basis unconfirmed. Metres."),
    sortOrder: 125,
    rates: ladder([28, 30, 32, 35, 38], 0.5),
  },
  {
    id: "ce-void-edge",
    line: "CONSTRUCTION",
    name: "Opening / Void Edge Protection",
    aliases: [
      "edge protection (lift, stairs, risers)",
      "void protection",
      "opening protection",
      "lv pit edge protection",
      "riser edge protection",
    ],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Around slab openings (lift, stair, riser voids) and pits. Metres."),
    sortOrder: 130,
    rates: flat(30, 0.5),
  },
  {
    id: "ce-roof-edge",
    line: "CONSTRUCTION",
    name: "Roof Edge Protection",
    aliases: ["roof edge protection", "edge protection to roof", "roof edge", "roof handrail", "parapet edge protection"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("Handrail around a roof edge — triple by default. Metres."),
    sortOrder: 135,
    rates: ladder([33.36, 33.36, 35.2, 37.2, 39.2], 0.5),
  },
  {
    id: "ce-temp-handrail",
    line: "CONSTRUCTION",
    name: "Temporary Handrail",
    aliases: ["temporary handrails", "temporary handrail", "precast stair handrail", "stair handrail"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("A temporary rail until the permanent balustrade goes in. Metres."),
    sortOrder: 140,
    rates: flat(18, 0.5),
  },
  {
    id: "ce-lift-gate",
    line: "CONSTRUCTION",
    name: "Lift Gate (Safegate)",
    aliases: ["safegate", "lift gate", "lift door protection"],
    category: "Protection",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("One per lift entrance, per floor."),
    sortOrder: 145,
    rates: flat(65, 1.2),
  },
  {
    id: "ce-foam",
    line: "CONSTRUCTION",
    name: "Foam Protection",
    aliases: ["foam", "upright padding", "foam protection"],
    category: "Protection",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("On uprights at doorways, fire exits and walk-unders — only when the scope asks."),
    sortOrder: 150,
    rates: flat(12, 0.5),
  },
  {
    id: "ce-pedestrian-hoarding",
    line: "GENERAL",
    name: "Pedestrian Hoarding / Protection Fan",
    aliases: ["hoarding", "protection fan", "pedestrian protection", "fan"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Public protection beside a road or walkway. Metres."),
    sortOrder: 155,
    rates: flat(55, 2.4),
  },
  {
    id: "ce-debris-netting",
    line: "GENERAL",
    name: "Debris Netting / Sheeting",
    aliases: ["monarflex", "sheeting", "debris netting", "netting"],
    category: "Protection",
    unit: "M2",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Netting or sheeting on the scaffold face. Square metres."),
    sortOrder: 160,
    rates: flat(3.2, 0.5),
  },

  // Items from Airwright's real quotes' "Includes for" lists (Quote-1350 / 1375) — the
  // add-ons the section cards offer (2026-10-02). DEV placeholder rates like the rest.
  {
    id: "ce-table-lift",
    line: "CONSTRUCTION",
    name: "Table Lift (gable end)",
    aliases: ["table lift", "table lifts"],
    category: "Access",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: note("One per main gable, to reach the apex."),
    sortOrder: 62,
    rates: ladder([180, 210, 240, 270, 300], 4.8),
  },
  {
    id: "ce-apex-handrail",
    line: "CONSTRUCTION",
    name: "Apex Handrail",
    aliases: ["apex handrail", "apex handrails"],
    category: "Protection",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Handrail around a gable apex. One per main gable."),
    sortOrder: 112,
    rates: flat(45, 1.2),
  },
  {
    id: "ce-a-frame-handrail",
    line: "CONSTRUCTION",
    name: "A-Frame Handrail",
    aliases: ["a-frame handrail", "a frame handrail"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Free-standing A-frame edge handrail. Metres."),
    sortOrder: 113,
    rates: flat(14, 0.5),
  },
  {
    id: "ce-brick-guards",
    line: "CONSTRUCTION",
    name: "Brick Guards",
    aliases: ["brick guards", "brick guard"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Along the scaffold run. Metres."),
    sortOrder: 162,
    rates: flat(2.5, 0.2),
  },
  {
    id: "ce-raised-first-lift",
    line: "CONSTRUCTION",
    name: "Raised First Lift (public clearance)",
    aliases: ["raised first lift", "first lift 2.7m"],
    category: "Access",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("First lift high enough for the public to pass under (e.g. 2.7 m). Metres of run."),
    sortOrder: 64,
    rates: flat(6, 0.5),
  },
  {
    id: "ce-beams-obstruction",
    line: "CONSTRUCTION",
    name: "Beams over Obstruction (canopy)",
    aliases: ["beams", "beams to clear lower canopy roof", "bridging beams"],
    category: "Access",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Beams to span a canopy or lower roof. Metres."),
    sortOrder: 66,
    rates: flat(38, 1.2),
  },
  {
    id: "ce-rakers",
    line: "CONSTRUCTION",
    name: "Rakers",
    aliases: ["rakers", "raking shores"],
    category: "Access",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Raking supports where the scaffold cannot be tied in."),
    sortOrder: 68,
    rates: flat(55, 1.2),
  },
  {
    id: "ce-carry-time",
    line: "GENERAL",
    name: "Carry Time (over 10 m)",
    aliases: ["carry time", "carry distance"],
    category: "Extras",
    unit: "FIXED",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Extra labour where materials are carried more than 10 m from the wagon."),
    sortOrder: 325,
    rates: flat(250, 0),
  },

  {
    id: "ce-temp-stair-set",
    line: "CONSTRUCTION",
    name: "Temporary Stair Set (treads + handrails)",
    aliases: ["stair set", "stair sets", "straight stair sets", "up and over stair sets", "up & over stair sets", "temporary steps"],
    category: "Access",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Temporary steps with handrails between two floor levels or over an upstand — NOT a Haki stair tower (Ben, 9 Sep 2026)."),
    sortOrder: 33,
    rates: flat(320, 6),
  },

  // --- Internal -------------------------------------------------------------------
  {
    id: "ce-birdcage",
    line: "CONSTRUCTION",
    name: "Internal Birdcage (crash deck)",
    aliases: ["crash deck", "crash decks", "birdcage", "birdcages", "internal birdcage", "birdcage scaffold"],
    category: "Internal",
    unit: "M2_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: note("Internal deck filling a room. Square metres per lift."),
    sortOrder: 200,
    rates: flat(8.5, 0.5),
  },
  {
    id: "ce-internal-access",
    line: "CONSTRUCTION",
    name: "Internal Access Scaffold",
    aliases: [
      "internal scaffold",
      "internal independent",
      "internal independent scaffold",
      "blockwork walls",
      "internal blockwork scaffold",
    ],
    category: "Internal",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: note("An independent inside a room, along its walls. Metres per lift."),
    sortOrder: 205,
    rates: flat(14, 0.5),
  },
  {
    id: "ce-lift-shaft",
    line: "CONSTRUCTION",
    name: "Lift Shaft Scaffold",
    aliases: ["lift shaft internal scaffold", "lift shaft scaffold", "shaft scaffold"],
    category: "Internal",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: note("A scaffold inside a lift shaft, pit to overrun. Priced per lift."),
    sortOrder: 210,
    rates: flat(180, 4.8),
  },
  {
    id: "ce-stair-core",
    line: "CONSTRUCTION",
    name: "Stair Core Scaffold",
    aliases: ["stair core access scaffold", "stair core scaffold", "stairwell scaffold"],
    category: "Internal",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: note("Access scaffold inside a stair core. Priced per lift."),
    sortOrder: 215,
    rates: flat(220, 4.8),
  },
  {
    id: "ce-riser-platform",
    line: "CONSTRUCTION",
    name: "Riser Access Platform",
    aliases: ["riser access platform", "riser platform", "riser access"],
    category: "Internal",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("A platform over a service riser. Number (basis unconfirmed)."),
    sortOrder: 220,
    rates: flat(150, 2.4),
  },

  // --- Extras -----------------------------------------------------------------------
  {
    id: "ce-scaffold-mat",
    line: "CONSTRUCTION",
    name: "Scaffold Mat / Dummy Lift",
    aliases: ["dummy lift", "scaffold mat"],
    category: "Extras",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("For a 2.7 m first 'walking lift' — schools, public streets, 3 m lifts. First lift only."),
    sortOrder: 300,
    rates: flat(33, 0.5),
  },
  {
    id: "ce-inspection",
    line: "GENERAL",
    name: "Weekly Inspection",
    aliases: ["inspections", "weekly inspections", "scaffold inspections", "weekly scaffold inspections"],
    category: "Extras",
    unit: "PER_WEEK",
    usesLifts: false,
    usesHeightBracket: false,
    // £150 a week is what Airwright quoted on the CBAND job (Quote-1350).
    defaultRuleNote: note("One per hire week."),
    sortOrder: 305,
    rates: flat(150, 0, 0),
  },
  {
    id: "ce-adaption",
    line: "CONSTRUCTION",
    name: "Adaption (general)",
    aliases: ["adaptions", "adaption", "generally"],
    category: "Extras",
    unit: "FIXED",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("A one-off adaption; set the rate by hand."),
    sortOrder: 310,
    rates: flat(250, 0),
  },
  {
    id: "ce-design",
    line: "GENERAL",
    name: "Design / TG20 Compliance",
    aliases: ["design", "tg20", "tg20 compliance sheet", "scaffold design"],
    category: "Extras",
    unit: "FIXED",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Scaffold design or a TG20 compliance sheet."),
    sortOrder: 315,
    rates: flat(150, 0, 0),
  },
  {
    id: "ce-daywork",
    line: "GENERAL",
    name: "Daywork (per man, per hour)",
    aliases: ["daywork", "attendance", "scaffolder attendance", "labour"],
    category: "Extras",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: note("Scaffolder hours. Number of man-hours."),
    sortOrder: 320,
    rates: flat(38, 0, 0),
  },
];
