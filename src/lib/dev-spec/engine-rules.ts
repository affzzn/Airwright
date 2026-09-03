import type { EngineRule } from "./types";

/**
 * The deterministic take-off engine's rules. Ported from
 * docs/EXTRACTOR-COMPLETE-REFERENCE.md Part 6. The tunable numeric constants
 * (lift height, storey templates, render lifts, tolerances) are shown LIVE from
 * the code in the "Constants & tolerances" section; the config/logic tables here
 * are fixed rules, not tunable numbers.
 */
export const ENGINE_RULES: EngineRule[] = [
  {
    id: "lifts",
    name: "Lifts",
    plain: "How many stacked platform levels the external scaffold has.",
    formula:
      "hasRoom = roomInRoof OR storeys is a half-storey (2.5)\nheightLifts = ceil(heightToSoffitM ÷ 1.5) + (hasRoom ? 1 : 0)\nstoreyLifts = storeyLiftTemplate[storeys]   (cross-check)",
    plainExtra:
      "Precedence when they disagree: agree → use the height value; whole-storey disagreement → the storey template wins; half-storey (2.5) → the height rule wins. Either way it's flagged. (This is the TRADITIONAL rule — timber-frame tenders use a different lift rule; see Timber frame below.)",
    status: "confirmed",
    owner: "ben",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "perimeter",
    name: "Perimeter",
    plain: "The run of external scaffold per lift, from the config's walls + the corner allowance.",
    formula:
      "front/rear = Σ(front|rear walls) ÷ dwellings   [1 for single/apartment]\nperLiftM = wallsForConfig + corners × 1.0 m\ntotalM   = perLiftM × lifts",
    table: {
      caption: "Which walls a configuration scaffolds (gables never divided)",
      head: ["Config", "Walls scaffolded", "Corners used"],
      rows: [
        ["Apartment block", "front + rear + both gables + other (whole block)", "cornerCount ?? 4"],
        ["Detached", "front + rear + both gables + other (4 sides)", "cornerCount ?? 4"],
        ["Semi / End-terrace", "front + rear + max(gable_left, gable_right) (3 sides)", "max(2, corners − 2)"],
        ["Mid-terrace", "front + rear only (both gables are party walls)", "max(0, corners − 4)"],
      ],
    },
    status: "confirmed",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "birdcage-total",
    name: "Birdcage totals",
    plain: "Sum of the per-floor internal areas; each floor is one lift.",
    formula: "totalM2 = Σ floor m²   (floors with m² > 0)",
    plainExtra:
      "The per-floor area itself is computed in birdcage.ts (see the Birdcage measurement). A floor count that doesn't match the storeys is flagged.",
    status: "confirmed",
    codeRefs: ["src/lib/takeoff/engine.ts", "src/lib/extract/birdcage.ts"],
  },
  {
    id: "render-rule",
    name: "Render adaption",
    plain: "The rendered length × the render lifts, in 2 m boarded lifts.",
    formula: "render = Σ renderSegmentsM × renderLifts[storeys]",
    plainExtra: "Render lifts by storey are shown live in Constants. ⚠️ the full table is still owed by Colin.",
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "apex-rule",
    name: "Apex → table lifts + handrails",
    plain: "Each apex becomes one table lift + one handrail; the total is reduced by configuration.",
    formula: "count = frontRear + gable(config);  tableLifts = handrails = count;  hipped → 0",
    table: {
      caption: "Apex reduction by configuration (front/rear apexes always count)",
      head: ["Config", "Gable apexes counted"],
      rows: [
        ["Detached", "left + right + other"],
        ["Semi / End-terrace", "max(left, right)  (one exposed gable end)"],
        ["Mid-terrace", "0  (both gables are party walls)"],
        ["Apartment block", "all faces (no reduction)"],
      ],
    },
    status: "confirmed",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "party-walls",
    name: "Party walls",
    plain: "The count of shared walls (not scaffolded), by configuration.",
    table: {
      head: ["Config", "Party walls"],
      rows: [
        ["Detached", "0"],
        ["Semi / End-terrace", "1"],
        ["Mid-terrace", "2"],
        ["Apartment block", "0"],
      ],
    },
    status: "confirmed",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "timber-frame",
    name: "Timber frame (build type)",
    plain:
      "If the tender's Build type is Timber frame (chosen when the tender is created), three things change from the rules above. Everything else — perimeter, corners, apex, render — stays exactly the same.",
    plainExtra:
      "① Fewer lifts. Worked top-down: 450 mm off the soffit is the top lift, then 2 m boarded lifts come down, and the bottom “kicker” lift takes up whatever's left. Every lift is priced the same. ② No birdcage — there is no internal deck work. ③ Two “adaptions” are added (priced by the metre): boards are pulled out and put back as the trades work. Each apex counts as 4 m in these totals. ⚠️ Still with Colin: whether timber frame has a party-wall item, the 80/20 stage split, and the real rates.",
    formula:
      "lifts:  2-storey → 3,   2.5-storey → 4,   3-storey → 4\ninside-board adaption = perimeter × all lifts     + apex × 4 m\nhop-up adaption       = perimeter × (lifts − 1)   + apex × 4 m   (skips the bottom kicker lift)\n\nExample — Aspen semi, perimeter 20.83 m, 3 lifts, 1 apex:\ninside-board = 20.83×3 + 4 = 66.49 m ;   hop-up = 20.83×2 + 4 = 45.66 m",
    table: {
      caption: "Timber-frame lifts by storey (vs the traditional count)",
      head: ["Storeys", "Timber frame", "Traditional"],
      rows: [
        ["2", "3", "4"],
        ["2.5", "4", "5"],
        ["3", "4", "6"],
      ],
    },
    status: "confirmed",
    codeRefs: ["src/lib/takeoff/engine.ts", "docs/18-timber-frame-implementation-plan.md"],
  },
  {
    id: "apartment",
    name: "Apartment whole-block mode",
    plain: "A block of flats is scaffolded as one whole building.",
    plainExtra:
      "The frontage is NOT divided (dwellings=1), every external wall is scaffolded, every apex counts (no reduction), there are no party walls, and the birdcage should be the whole floor plate. Extras (multiple loading bays/chutes, progressive dismantle, communal handrails) are listed as profile-pending. ⚠️ the apartment birdcage basis and perimeter are Colin questions.",
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/takeoff/engine.ts"],
  },
  {
    id: "garages",
    name: "Garages",
    plain: "Priced as a separate section, but the garage geometry is NOT extracted.",
    plainExtra:
      "Quantities come from a flagged placeholder template per type (Single / Twin / Car Port), never a silent guess. Every garage line carries a flag to confirm the real take-off with Colin.",
    table: {
      caption: "⚠️ PLACEHOLDER garage template quantities (confirm with Colin)",
      head: ["Type", "Lifts", "Perimeter/lift (m)", "Gables", "GF birdcage (m²)", "Birdcage?"],
      rows: [
        ["Single", "2", "15", "1", "18", "yes"],
        ["Twin", "2", "22", "1", "32", "yes"],
        ["Car port", "2", "15", "1", "0", "no"],
      ],
    },
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/takeoff/garage.ts"],
  },
];
