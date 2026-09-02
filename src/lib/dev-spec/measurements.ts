import type { Measurement } from "./types";

/**
 * The measurement catalogue — one entry per observable the extractor reads and
 * the engine derives. Ported from docs/EXTRACTOR-COMPLETE-REFERENCE.md Part 5.
 */
export const MEASUREMENTS: Measurement[] = [
  {
    id: "identity",
    name: "House-type identity (name + code)",
    plain: "The house type's name and code, e.g. Dekker / NSS.277.",
    whereRead: ["Title / drawing-reference sheet", "Title-block portfolio line"],
    layer: "both",
    howRead:
      "Read the printed name/code. A mirrored pair may read 'NSS.277 / NSS.277-1' — that is ONE house type (a pair).",
    derivation:
      "The engine resolves the canonical identity: prefer the confident AI-read name over the file-derived name; clean the code of date / bed-person / area noise; never steal a code another house type in the project already holds.",
    confidenceRule: "The model's own confidence in the read name/code.",
    status: "confirmed",
    codeRefs: ["src/lib/extract/houseTypeIdentity.ts", "src/lib/extract/persist.ts"],
    relatedTerms: [],
  },
  {
    id: "buildType",
    name: "Build type (Traditional vs Timber-Frame)",
    plain: "Whether the house is traditional masonry or timber-frame.",
    whereRead: ["Spec notes / construction type on the drawing"],
    layer: "llm",
    howRead: "Read TRADITIONAL or TIMBER_FRAME if stated.",
    derivation:
      "Downstream (pricing) it SELECTS the matrix (Traditional 27-col / Timber-Frame 17-col, different stage splits). Timber-frame also changes the scaffold sequence/ties — not the LM/lift maths — so a note is surfaced for the estimator to confirm.",
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["build-type"],
  },
  {
    id: "structure",
    name: "Structure & dwellings-wide",
    plain:
      "Is it one detached house, a semi/terrace of houses, or a block of flats — and how many houses share the frontage?",
    whereRead: ["Floor plans", "Title sheet"],
    layer: "both",
    howRead:
      "Two mirrored dwellings sharing a party gable → PAIR_SEMI, dwellingsWide=2; three joined → THREE_BLOCK, dwellingsWide=3; four or more → TERRACE, dwellingsWide=4+ ('terrace' is reserved for 4+); flats with a communal entrance → APARTMENT_BLOCK, dwellingsWide=1; a free-standing house → DETACHED, dwellingsWide=1. Report front/rear as the FULL printed frontage spanning all dwellings — do NOT pre-divide. Gable-end walls are per-house depth, never divided. PER-HOUSE vs PER-PAIR: the frontage is shared (engine ÷ dwellings) but the BIRDCAGE width is ONE house's internal width (a single [wall|span|wall] span, else the summed run to the party wall, cross-checked by (frontage − (n+1)×wall)÷n) — never the full pair frontage.",
    derivation: "The engine divides the front/rear frontage by dwellingsWide to get one house; the birdcage is per house (not divided).",
    confidenceRule: "The model's read confidence.",
    crossChecks: ["c3", "c13"],
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/takeoff/engine.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["structure", "dwellings-wide", "party-wall"],
  },
  {
    id: "storeys",
    name: "Storeys & room-in-roof",
    plain: "How many storeys (1 / 2 / 2.5 / 3), and whether there's a habitable room in the roof.",
    whereRead: ["Elevations", "Section"],
    layer: "llm",
    howRead:
      "Count the storeys off the elevation. Set roomInRoof=true for a 2.5-storey (dormers, velux, raised eaves with living space).",
    derivation:
      "Storeys cross-checks the height-based lift count (never used to count lifts directly). A room-in-roof adds a lift AND a birdcage floor downstream.",
    crossChecks: ["roomInRoofMismatch"],
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/takeoff/engine.ts"],
    relatedTerms: ["storeys", "room-in-roof"],
  },
  {
    id: "height",
    name: "Height to soffit (triangulated)",
    plain:
      "The vertical height to the soffit (underside of wallplate) — the top of the wall the scaffold reaches. This is the number the lift count divides.",
    whereRead: ["Section (best)", "Elevation"],
    layer: "both",
    howRead:
      "Read TWO independent things: (1) the direct soffit dimension (e.g. 'U/S Wallplate 4725'); (2) the floor-to-floor storey heights as DELTAS (e.g. [2.662, 2.063], last up to the soffit). Report raw numbers — do NOT sum them.",
    derivation:
      "height.ts triangulates: sums the storey ladder as a second estimate, compares it to the direct read plus a storey sanity band (≈2.2–3.0 m/storey), and computes the confidence. Datum is fixed to the soffit / underside of wallplate.",
    formula: "soffit = directRead (else Σ storeyHeights); flag if the two give a different ceil(h ÷ 1.5)",
    confidenceRule:
      "H3: both present & same lift count → HIGH (note if the raw gap > 0.15 m); different lift count → LOW + flag. Direct only, outside the storey band → LOW. Ladder only → medium.",
    crossChecks: ["h3", "c5"],
    workedExample:
      "Dekker: direct 4725; ladder 2.662 + 2.063 = 4.725; ceil(4.725 ÷ 1.5) = 4 from both → 4 lifts, high.",
    status: "confirmed",
    owner: "colin",
    codeRefs: ["src/lib/extract/height.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["height-to-soffit", "lift", "storey-template"],
  },
  {
    id: "roof",
    name: "Roof type",
    plain: "Pitched (brickwork rises to an apex), hipped (slopes back, no apex), or mixed.",
    whereRead: ["Elevations", "Roof / truss sheet"],
    layer: "llm",
    howRead:
      "Brickwork rising to an apex point = pitched (needs table lifts); slopes back on all sides, no brickwork above the eaves = hipped (no apex); some faces each = mixed.",
    derivation: "Drives the apex / table-lift computation. A hipped roof forces apex 0.",
    crossChecks: ["apexContradiction"],
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/takeoff/engine.ts"],
    relatedTerms: ["pitched", "hipped", "apex"],
  },
  {
    id: "apex",
    name: "Apexes (per elevation face)",
    plain: "The count of gable apexes (triangular brickwork tops) per elevation — each needs a table lift.",
    whereRead: ["Each elevation face"],
    layer: "both",
    howRead:
      "Face by face, shape BEFORE number: set faceRoof (GABLED/HIPPED) → write a one-line apexReason → then apexCount. Front and rear apexes (a projecting gable) are the ones most often MISSED — check them explicitly. Hipped face = 0.",
    derivation:
      "persist sums the per-face apexCount into GABLE_QTY (= table-lift qty = apex-handrail qty). The engine reduces the total by configuration: front/rear apexes always count; detached keeps both gables; semi/end keeps one exposed gable; mid-terrace keeps none. Each apex → one table lift + one handrail.",
    confidenceRule:
      "Worst of the per-face read confidences. A face marked HIPPED but reporting an apex is flagged; a hipped overall roof forces GABLE_QTY = 0.",
    tables: [
      {
        caption: "Per face: does it carry an apex?",
        head: ["Face", "Apex?"],
        rows: [
          ["Gabled face (brickwork rises to a point)", "1"],
          ["Hipped face (slopes back, no brickwork above eaves)", "0"],
          ["Projecting front / rear gable", "1 (often missed — check)"],
        ],
      },
      {
        caption: "Engine reduction by configuration (gable apexes; front/rear always count)",
        head: ["Config", "Gable apexes kept"],
        rows: [
          ["Detached / apartment block", "both gables"],
          ["Semi / end-terrace", "one exposed gable (party side dropped)"],
          ["Mid-terrace", "none (both gables are party walls)"],
        ],
      },
    ],
    crossChecks: ["c7", "apexContradiction", "a2"],
    workedExample: "Dekker (pitched semi): front HIPPED 0, rear 0, left GABLED 1, right GABLED 1 → total 2.",
    status: "confirmed",
    owner: "colin",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/takeoff/engine.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["apex", "table-lift", "apex-handrail", "hipped"],
  },
  {
    id: "render",
    name: "Render (per elevation)",
    plain: "Which elevations have a rendered/clad section, and its linear metres — a separate work type.",
    whereRead: ["Elevations", "Rendered-variant sheet"],
    layer: "both",
    howRead:
      "Per face, set rendered and, if dimensioned, renderLengthM — only the RENDERED section, never the whole wall.",
    derivation:
      "persist sums the rendered faces' renderLengthM into RENDER_LENGTH. The engine computes render LM × render lifts, in 2 m boarded lifts.",
    formula: "render = Σ renderLengthM × renderLifts[storeys]  (1:1, 2:2, 2.5:3, 3:4)",
    crossChecks: ["c8"],
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/takeoff/engine.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["render", "render-lifts"],
  },
  {
    id: "walls",
    name: "Wall segments (front / rear / gable_left / gable_right)",
    plain: "Each external wall length along the building line (brickwork line), for one dwelling.",
    whereRead: ["Ground-floor plan", "Setting-out plan"],
    layer: "both",
    howRead:
      "Read each wall separately with its dimension string. Front/rear = eaves faces (frontage); gable_left/right = the two side/end walls. For a pair, front/rear = the FULL frontage spanning both houses (engine divides); gables = full depth.",
    derivation:
      "The engine sums the config walls, divides the frontage by dwellings, and adds the corner allowance → perimeter.",
    fallbacks: [
      "THE CLASSIC ERROR — wall line vs roof overhang: read the length off the FLOOR PLAN, never off an elevation and never by scaling. The roof overhangs the wall by ~200–400 mm each side, so an elevation over-reads.",
      "If only the overhang line is legible: read it, set the wall LOW, note it — never subtract an overhang yourself (W2).",
    ],
    confidenceRule:
      "Three auto-checks: the dimension is verified against the text layer; a wall cited off an ELEVATION page is capped + flagged (roof overhang), unless the same number also appears on a plan; front≈rear and gable_left≈gable_right symmetry (>10% mismatch flagged).",
    crossChecks: ["c9", "dimVerify", "wallOffElevation", "w2"],
    status: "confirmed",
    owner: "colin",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/extract/persist.ts", "src/lib/takeoff/engine.ts"],
    relatedTerms: ["wall-segment", "building-line", "perimeter"],
  },
  {
    id: "corners",
    name: "Corners",
    plain: "The number of external corners/returns on the scaffolded footprint (a rectangle = 4).",
    whereRead: ["Ground-floor / setting-out plan"],
    layer: "both",
    howRead:
      "External (outward) corners = 4 + (number of reentrant/step corners). A plain rectangle = 4; a single wall-line step (or an L) → 5; a T/U → 6. Identify a step by comparing the depth left-vs-right and the width top-vs-bottom: equal → rectangle, differ → a step. Count outward corners only (not reentrant ones). Exclude bays, porches (low-level), chimney breasts, and construction offsets (~75mm render stops, ~100mm brick returns). The model also writes cornerReason. Chamfers (45° diagonal walls) are flagged.",
    derivation:
      "The engine adds the corner allowance = 1 m per external corner, and reduces the count by config on non-detached shapes (semi/end: max(2, corners−2); mid: max(0, corners−4)).",
    steps: [
      {
        title: "Is it a rectangle?",
        detail:
          "Compare the depth left-vs-right and the width top-vs-bottom. Equal on both → a plain rectangle → 4 corners.",
      },
      {
        title: "Count = 4 + steps",
        detail:
          "Each place the wall line steps IN (a reentrant corner) adds one external corner. One step or an L → 5; a T/U → 6.",
      },
      {
        title: "Exclude non-corners",
        detail:
          "Bays, porches (low-level items), chimney breasts, and construction offsets (~75mm render stop, ~100mm brick return) are not corners. A 45° chamfer is flagged.",
      },
      {
        title: "Engine applies + reduces",
        detail:
          "+1 m per external corner, then drops the party-side corners by config (semi/end −2, mid −4).",
      },
    ],
    tables: [
      {
        caption: "Footprint → external corners",
        head: ["Footprint", "External corners"],
        rows: [
          ["Plain rectangle", "4"],
          ["One step / an L", "5"],
          ["T or U", "6"],
          ["Hallam (front step)", "5"],
        ],
      },
      {
        caption: "Engine reduction by configuration (from the reported count)",
        head: ["Config", "Corners used"],
        rows: [
          ["Detached / apartment block", "cornerCount (as read)"],
          ["Semi / end-terrace", "max(2, cornerCount − 2)"],
          ["Mid-terrace", "max(0, cornerCount − 4)"],
        ],
      },
    ],
    status: "confirmed",
    crossChecks: ["c12"],
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/takeoff/engine.ts"],
    relatedTerms: ["corner", "perimeter"],
  },
  {
    id: "birdcage",
    name: "Birdcage (internal floor area per floor)",
    plain:
      "The m² of internal floor deck, per floor. One per floor; a 2.5-storey has 3. Measured to the internal (structural) face, never the external footprint.",
    whereRead: ["Setting-out plan (preferred)", "Floor plans"],
    layer: "both",
    howRead:
      "REPORT NUMBERS ONLY — no arithmetic, and NO stated/printed floor area (it is not used). Per floor report the raw internal footprint as rectangles — a directly-printed internal span (preferred), else the overall external dimension + the STRUCTURAL wall thickness per side. Per HOUSE — do NOT divide by dwellings. On a PAIR/TERRACE the width is ONE house (single span, else the summed run to the party wall — SM1: 5512+327+1034=6873; cross-check (frontage−(n+1)×wall)÷n), NEVER the full pair frontage. STEPPED / L / T / U floor (depth differs left-vs-right, or width top-vs-bottom): SPLIT into several rectangles that tile the floor, each with its OWN internal width & depth; check the widths sum to the overall internal width and the depths differ by the step. A single bounding rectangle over-reads.",
    derivation:
      "birdcage.ts does all geometry purely from the dimensions: per axis, width = internalWidthM ?? (overallWidthM − wallLeft − wallRight); depth likewise; each side subtracted SEPARATELY (never 2×wall); area = Σ(width × depth) over ALL the floor's rectangles (so a stepped floor's tiles sum). There is NO default wall — an overall with no wall (plan or legend) leaves the axis UNRESOLVED and flagged.",
    formula:
      "width = internalWidthM ?? (overallWidthM − wallLeft − wallRight)   [per house]\ndepth = internalDepthM ?? (overallDepthM − wallFront − wallRear)\narea  = Σ(width × depth)",
    steps: [
      {
        title: "Per house, not per pair",
        detail:
          "On a pair/terrace report ONE house. The frontage (front/rear) is shared — the engine divides it by dwellingsWide — but the birdcage width and depth are one house's, never divided.",
      },
      {
        title: "Get one house's width",
        detail:
          "Read a single printed internal span if there is one; else sum that house's run of internal segments up to the party wall; then cross-check with (overall frontage − (dwellings+1)×wall) ÷ dwellings.",
      },
      {
        title: "Is the floor a plain rectangle?",
        detail:
          "Compare the internal depth left-vs-right and the width top-vs-bottom. Equal → one rectangle. A difference means the wall line STEPS.",
      },
      {
        title: "Split a stepped / L / T / U floor",
        detail:
          "Tile it into rectangles, each with its OWN internal width and depth. Two checks: the tile widths sum to the overall internal width; the depths differ by exactly the step.",
      },
      {
        title: "Report dimensions only",
        detail:
          "Internal span preferred, else the overall external dimension + the STRUCTURAL wall thickness per side. No stated/printed area is used; the model does no arithmetic.",
      },
      {
        title: "Engine computes + scores",
        detail:
          "birdcage.ts strips each wall side separately (never 2×wall), multiplies width×depth, sums the tiles, and sets a computed confidence.",
      },
    ],
    tables: [
      {
        caption: "Reading ONE house's WIDTH on a pair/terrace (best method first)",
        head: ["Method", "When", "Example"],
        rows: [
          ["Single internal span", "one house's width printed as [wall | span | wall]", "Kilburn 4800; Sinclair 4250"],
          ["Sum the run", "shared central core — no single span", "SM1: 5512 + 327 + 1034 = 6873"],
          ["Strip & divide (cross-check)", "always, to confirm the read", "(overall − (n+1)×wall) ÷ n — SM1 (14727 − 3×327)/2 = 6873"],
        ],
      },
      {
        caption: "Per-house vs per-pair — which number goes where",
        head: ["Field", "Number to use", "Divided?"],
        rows: [
          ["Front / rear walls", "full pair frontage (10506 / 9406 / 14727)", "engine ÷ dwellings"],
          ["Gable walls (depth)", "one house's depth", "no"],
          ["Birdcage width", "one house (≈ frontage ÷ dwellings)", "no"],
          ["Birdcage depth", "one house (gable − 2 walls)", "no"],
        ],
      },
      {
        caption: "Confidence (computed by the engine)",
        head: ["Situation", "Stored area", "Confidence"],
        rows: [
          ["Internal span + overall−walls agree (≤5%)", "internal footprint", "high"],
          ["…agree, but a wall was assumed symmetric", "internal footprint", "medium"],
          ["…disagree (>5%)", "internal (kept)", "low + flag"],
          ["Bare footprint, structural wall, no cross-check", "derived", "medium"],
          ["Bare footprint, legend wall / assumed-symmetric", "derived", "low"],
          ["An overall with no wall to strip", "— (unresolved)", "unknown + flag"],
        ],
      },
      {
        caption: "Worked examples (birdcage per house, per floor)",
        head: ["House", "Footprint", "Calculation", "Tiles"],
        rows: [
          ["Hallam", "detached, stepped front", "3.211×8.599 + 3.041×7.924 = 51.71 m²", "2 (split)"],
          ["Kilburn", "semi, plain", "4.800 × (9.144 − walls) = 40.99 m²", "1"],
          ["Sinclair", "semi, plain", "4.250 × 8.153 = 34.65 m²", "1"],
          ["SM1", "semi, shared core", "6.873 × (8.428 − walls) = 53.4 m²", "1"],
        ],
      },
    ],
    fallbacks: [
      "The stored value is always the derived footprint — internal span preferred, else overall − walls. No stated area or NDSS is used.",
      "Wall per axis: two printed per-side values → else one side (assume symmetric + flag) → else uniform wallThicknessMm → else the finished-face WALL LEGEND value (flagged) → else UNRESOLVED. No hard-coded default.",
    ],
    confidenceRule:
      "COMPUTED. When a printed internal span AND an overall−walls derivation both exist: agree within 5% → high (medium if a wall was assumed symmetric); diverge → low + flag. Otherwise (bare footprint): structural wall → medium; legend / assumed-symmetric → low. No wall to resolve → unknown, flagged for a human.",
    crossChecks: ["c11", "c12", "c13", "dimVerify"],
    workedExample:
      "Hallam GF (stepped front): deep column 3.211 × 8.599 + shallow column 3.041 × 7.924 = 51.708 m² (checks: 3211+3041 = 6252 internal width; 8599−7924 = 675 step). One bounding 6.252 × 8.599 rectangle would wrongly give 53.76.",
    status: "confirmed",
    owner: "colin",
    codeRefs: ["src/lib/extract/birdcage.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["birdcage", "wall-thickness"],
  },
  {
    id: "lowLevel",
    name: "Low level (porches + single-storey bays)",
    plain: "Porches and single-storey bays — each is one low-level scaffold tower, recorded by type.",
    whereRead: ["Elevations", "Plan"],
    layer: "both",
    howRead:
      "Count and classify: porchCanopyCount (open GRP/glass canopy) vs porchSolidCount (enclosed; the default when unsure); baySingleStoreyCount (ground-floor only) vs bayTwoStoreyCount (rises through both floors).",
    derivation:
      "LOW_LEVEL_QTY = porchCanopy + porchSolid + baySingleStorey. A TWO-storey bay is NOT a low level (full height, part of the main scaffold) — captured but EXCLUDED from the count. The type split is kept for a future treatment change; pricing is unchanged today.",
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["low-level", "beam-over"],
  },
  {
    id: "chimney",
    name: "Chimney",
    plain: "Whether a chimney stack is actually drawn on this house.",
    whereRead: ["Elevations", "Roof / truss sheet"],
    layer: "llm",
    howRead:
      "chimney=true ONLY if a stack is drawn. A conditional note ('chimney if required') with no stack drawn → false, and say so in notes.",
    derivation:
      "The engine adds a fixed chimney scaffold when true; a spec demanding one with none drawn is flagged, never silently priced.",
    status: "confirmed",
    codeRefs: ["src/lib/extract/schema.ts"],
    relatedTerms: ["chimney"],
  },
  {
    id: "smartRoof",
    name: "Smart-roof peak",
    plain: "An unusually high roof peak (a 'smart roof' → double table lift).",
    whereRead: ["Roof / section"],
    layer: "llm",
    howRead:
      "If the peak looks unusually high for the type, report the peak height. Do NOT apply a threshold — report it and let a human judge.",
    derivation: "Stored on warnings.smartRoofPeakM for review.",
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["smart-roof"],
  },
  {
    id: "underbuild",
    name: "Underbuild",
    plain:
      "Whether the plot needs underbuild / a foot scaffold at the base because it sits on a slope or stepped foundations.",
    whereRead: ["Site elevations plan (the real source — not yet sent)", "Section / elevation"],
    layer: "llm",
    howRead:
      "Set underbuild.needed=true ONLY if a slope/stepped foundation is clearly visible on a section/elevation given. Never infer a slope from a house elevation alone.",
    derivation:
      "Stored on warnings.underbuild. The authoritative site-elevations plan is NOT yet classified/sent — the main remaining missing observable.",
    status: "open",
    owner: "colin",
    codeRefs: ["src/lib/extract/schema.ts", "src/lib/extract/persist.ts"],
    relatedTerms: ["underbuild", "foot-scaffold", "site-elevations-plan"],
  },
];
