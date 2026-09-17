/**
 * The seed definition for the construction scaffold-element library (the "picking
 * list", docs/19 §5). PURE data — imported by `prisma/seed.ts` to populate the
 * global `ConstructionElement` + `ConstructionRate` rows, and re-usable by any
 * reset script. Rates are ⚠ PLACEHOLDERS (a few real ones seen on Colin's screen
 * recording are flagged inline); swap in his real construction rate sheet later.
 *
 * Everything is editable in the app on the Rates → Construction tab.
 */

import type { ConstructionUnit, HeightBracket, RateBand } from "@prisma/client";

export interface SeedRate {
  band: RateBand;
  bracket: HeightBracket;
  rate: number;
}

export interface SeedElement {
  id: string; // deterministic, so re-seeding is idempotent
  name: string;
  aliases: string[];
  category: string; // Access | Protection | Internal | Extras
  unit: ConstructionUnit;
  usesLifts: boolean;
  usesHeightBracket: boolean;
  defaultRuleNote?: string;
  sortOrder: number;
  rates: SeedRate[];
}

const BAND: RateBand = "COMPETITIVE"; // the default quote band; others added in-app

/** Per-height-bracket rates for a bracketed item (≤6 / 6–12 / 12–18 m). */
function bracketed(upTo6: number, h6_12: number, h12_18: number): SeedRate[] {
  return [
    { band: BAND, bracket: "UP_TO_6M", rate: upTo6 },
    { band: BAND, bracket: "H6_12M", rate: h6_12 },
    { band: BAND, bracket: "H12_18M", rate: h12_18 },
  ];
}

/** A single flat (bracket-agnostic) rate. */
function flat(rate: number): SeedRate[] {
  return [{ band: BAND, bracket: "ANY", rate }];
}

/**
 * The initial library (docs/19 §5). Units + lift/bracket behaviour are ✅ from the
 * calls; £ values are ⚠ placeholders (25.61 / 7.75 / 33 seen on the recording).
 */
export const CONSTRUCTION_ELEMENT_SEED: SeedElement[] = [
  {
    id: "ce-independent-scaffold",
    name: "Independent Scaffold",
    aliases: ["working platform", "ConInscaff", "access scaffold"],
    category: "Access",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: "The boarded working platform. = 'working platform'. Priced per metre, per lift.",
    sortOrder: 10,
    rates: bracketed(11.5, 13.0, 15.5),
  },
  {
    id: "ce-double-handrail",
    name: "Double Handrail (+ toe board)",
    aliases: ["edge protection", "scaffold handrail"],
    category: "Protection",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: "The standard scaffold handrail (double + toe board).",
    sortOrder: 20,
    rates: bracketed(25.61, 25.61, 25.61), // £25.61/m seen on the recording
  },
  {
    id: "ce-single-handrail",
    name: "Single / Additional Handrail",
    aliases: ["additional handrail"],
    category: "Protection",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: "Only where a steel/obstruction prevents a double. Also the '+1' that makes a triple.",
    sortOrder: 30,
    rates: bracketed(7.75, 7.75, 7.75), // £7.75/m seen on the recording
  },
  {
    id: "ce-triple-handrail",
    name: "Triple Handrail (roof / edge)",
    aliases: ["roof edge protection", "edge protection to roof"],
    category: "Protection",
    unit: "LM",
    usesLifts: false,
    usesHeightBracket: true,
    defaultRuleNote: "Roof / building-edge protection default (double + single). Perimeter in metres.",
    sortOrder: 40,
    rates: bracketed(33.36, 33.36, 33.36), // 25.61 + 7.75 placeholder
  },
  {
    id: "ce-toe-board",
    name: "Toe Board",
    aliases: [],
    category: "Protection",
    unit: "LM_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: "Usually part of a double handrail; separate line only when itemised.",
    sortOrder: 50,
    rates: flat(3.0),
  },
  {
    id: "ce-haki-stair",
    name: "Haki Stair Tower",
    aliases: ["hacky stairs", "staircase", "stair tower"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: "Priced PER LIFT. A Haki normally counts as 3 lifts (kicker + to-1st + to-2nd).",
    sortOrder: 60,
    rates: bracketed(95.0, 110.0, 130.0),
  },
  {
    id: "ce-loading-bay",
    name: "Loading Bay",
    aliases: ["external loading bay", "LB"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: true,
    defaultRuleNote: "3.6 × 2.4 grid. Priced PER LIFT (loading bay — Lift 1, Lift 2 …).",
    sortOrder: 70,
    rates: bracketed(120.0, 150.0, 180.0),
  },
  {
    id: "ce-rubbish-chute",
    name: "Rubbish Chute / Skip Bay",
    aliases: ["rubbish shoot", "chute", "skip bay"],
    category: "Access",
    unit: "NR_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: "Priced PER LIFT. (A skip itself is client-supplied.)",
    sortOrder: 80,
    rates: flat(45.0),
  },
  {
    id: "ce-birdcage",
    name: "Internal Birdcage (crash deck)",
    aliases: ["crash deck", "birdcage", "internal birdcage"],
    category: "Internal",
    unit: "M2_PER_LIFT",
    usesLifts: true,
    usesHeightBracket: false,
    defaultRuleNote: "Internal deck, m² per lift (progressive dismantle).",
    sortOrder: 90,
    rates: flat(8.5),
  },
  {
    id: "ce-lift-gate",
    name: "Lift Gate (Safegate)",
    aliases: ["safegate", "lift door protection"],
    category: "Protection",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: "One per lift entrance, per floor.",
    sortOrder: 100,
    rates: flat(65.0),
  },
  {
    id: "ce-scaffold-mat",
    name: "Scaffold Mat / Dummy Lift",
    aliases: ["dummy lift"],
    category: "Extras",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: "For a 2.7 m first 'walking lift' — schools, public streets, 3 m lifts. First lift only.",
    sortOrder: 110,
    rates: flat(33.0), // £33 seen on the recording
  },
  {
    id: "ce-foam",
    name: "Foam Protection",
    aliases: [],
    category: "Protection",
    unit: "NR",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: "On uprights at doorways, fire exits and pedestrian walk-unders.",
    sortOrder: 120,
    rates: flat(12.0),
  },
  {
    id: "ce-inspection",
    name: "Weekly Inspection",
    aliases: ["inspections"],
    category: "Extras",
    unit: "PER_WEEK",
    usesLifts: false,
    usesHeightBracket: false,
    defaultRuleNote: "One per hire week (auto-added from the quote duration).",
    sortOrder: 130,
    rates: flat(35.0),
  },
];
