# Airwright — Extraction Engine: complete handoff for the prompt playground

**Purpose of this document.** Everything the extraction/take-off pipeline does, so a
colleague can build a **prompt-playground / testing tool** around it. It separates the two
halves cleanly:

- **The MODEL layer** (what we send Claude, the JSON contract, the model settings) — this is
  what the playground *changes and experiments with*.
- **The DETERMINISTIC layer** (pre-processing hints + the post-processing take-off engine) —
  this stays **as-is**. The playground should treat it as a fixed function that takes the
  model's JSON and produces the final take-off, so a prompt change can be judged on the
  numbers Colin actually cares about.

**Scope of this doc (as requested):** the **house-building take-off** only, for both
**Traditional** and **Timber-Frame** build systems. It **excludes**:
- the smart-upload / cross-file **grouping** layer (how loose PDFs are bundled into a house
  type) — `docs/17`, `src/lib/ingest/*`;
- the **construction / commercial enquiry** reading (scope-of-works and enquiry drawings) —
  `docs/19`, `docs/20`.
Everything below is the code that is **live on `main` and deployed on Render**.

> Terminology note: "leaf / traditional timber frame" in the brief = the two `BuildSystem`
> values the engine supports: `TRADITIONAL` (brick-and-block with internal birdcage decks)
> and `TIMBER_FRAME` (no birdcage, LM-priced adaptions). Both are covered here.

---

## 0. The two-layer mental model (read this first)

The whole design rests on one principle (from Colin's 13 Aug 2026 call and his handwritten
sheets):

> **The model EXTRACTS observables. The engine COMPUTES the take-off.**
> The model reads printed numbers off the drawing (wall lengths, soffit height, apex counts,
> internal footprint dimensions…) with per-field confidence + provenance. It **never**
> computes lifts, perimeter totals, birdcage areas, render lifts, stage splits or any pricing.
> Those are deterministic rules applied downstream.

```
                          ┌─────────────────────── MODEL LAYER (playground changes this) ──────────────────────┐
  house-type PDF ──►  [ deterministic     ]  ──►  [  Claude / Gemini / GPT   ]  ──►  [ Zod-validated  ]
   (1..N pages)       [ pre-processing:   ]       [  tool-use / JSON mode:    ]       [ ExtractionResult ]
                      [ • page classify   ]       [  system + user + hints +  ]       [ (observables)   ]
                      [ • dimension hint  ]       [  PDF, forced tool call    ]       └────────┬────────┘
                      [ • wall-legend hint]       └───────────────────────────┘                │
                      └───────────────────┘                                                    ▼
                          └──────────────────── DETERMINISTIC LAYER (stays as-is) ─────────────────────────────┐
                                                                                                               │
   persist.ts  ◄── verify dims / reconcile roles / birdcage geometry / height triangulation / config resolve  │
       │           + ~13 cross-check flags   ──►  Measurements + WallSegments + warnings JSON (the review data)│
       ▼                                                                                                       │
   takeoff engine (engine.ts)  ──►  lifts • perimeter • birdcage • render • apex • party walls • adaptions     │
       │           (per house-type × configuration; TRADITIONAL or TIMBER_FRAME)                               │
       ▼                                                                                                       │
   TakeoffLine  ──►  (human confirms in review UI)  ──►  pricing engine  ──►  immutable quote  ◄───────────────┘
```

**Why this matters for the playground.** A good prompt is not one whose *JSON looks nice* —
it is one whose JSON, when fed through the **unchanged** deterministic engine, reproduces
Colin's handwritten take-off numbers (see §11, the validation set). So the playground must
run the same `birdcage.ts` / `height.ts` / `engine.ts` / `structure.ts` code the production
worker runs, and score against the golden numbers.

---

## 1. The end-to-end flow (worker orchestration)

Production entry point: `src/worker/index.ts` → `handleExtract()`. Per house type:

1. Load the `Extraction` row (has the source document + which model the project uses).
2. **Reuse guard** — if a prior attempt already got valid JSON out of the model but died
   persisting, reuse the stored `rawOutput` (no second model bill). Old-schema JSON fails the
   Zod parse and falls through to a fresh call.
3. Download the full PDF from storage; **slice** to the pages segmentation chose for this
   house type (`pageRange`, may be non-contiguous) → `pdf`. The **whole** PDF is also kept
   (`fullPdf`) because the wall legend often lives on a foundation sheet outside the slice.
4. `extractDrawing(pdf, modelKey, fullPdf)` — the model call (see §3–§5).
5. Persist model telemetry (tokens, cost, latency, model id, prompt version) on the
   `Extraction`.
6. `persistExtraction(...)` — the deterministic post-processing (§6): write Measurements,
   WallSegments, warnings.
7. Mark `COMPLETED` (or `FAILED` with the error).

Concurrency: `batchSize: 1` per queue — one model call + DB transaction at a time, so we
never fan out dozens of concurrent calls and exhaust the DB pool.

`extractDrawing` itself (`src/lib/extract/extractDrawing.ts`):

```ts
export async function extractDrawing(pdf: Buffer, modelKey?: string | null, fullPdf?: Buffer)
  : Promise<ExtractDrawingResult> {
  // 1. text-layer dimension tokens per page (deterministic hint) — [] for a scanned PDF
  const dimensions = await extractDimensionsByPage(pdf).catch(() => [] as PageDims[]);
  // 2. wall legend (party vs cavity) read off the WHOLE document
  const legend = await extractWallLegend(fullPdf ?? pdf).catch(() => []);
  // 3. user text = fixed instruction + dimension hint + wall-legend hint
  const userText = USER_INSTRUCTION + buildDimensionHint(dimensions) + buildWallLegendHint(legend);

  const res = await runExtraction(modelKey, {
    pdf, system: SYSTEM_PROMPT, userText,
    toolName: "record_takeoff",
    toolDescription: "Record the extracted scaffold take-off measurements.",
    inputSchema: toolInputSchema,       // generated from the Zod schema (never drifts)
    maxTokens: EXTRACTION_MAX_TOKENS,   // 16384
  });

  const data = extractionResultSchema.parse(res.input);  // Zod validation
  return { data, dimensions, meta: { model, promptVersion, latencyMs, inputTokens, outputTokens, costUsd, raw } };
}
```

The tool's `input_schema` is generated from the Zod schema with `zod-to-json-schema`
(`target: "openApi3"`, `$refStrategy: "none"`) so the contract and the validator can never
drift.

---

## 2. Deterministic PRE-processing (runs before the model, feeds it hints)

Three cheap, AI-free passes read the PDF's **text layer** and either narrow the page set or
inject hints into the user message. **All of this is deterministic — the playground keeps it.**

### 2.1 Page classification — `src/lib/extract/classify-rules.ts` (pure) + `classify.ts` (pdfjs)

Tender packs are mostly irrelevant to a scaffold take-off. Each page's title block + text is
classified to a `PageKind`, and only take-off-relevant pages are sliced into the PDF the model
sees.

- Relevant kinds (`TAKEOFF_KINDS`): `ELEVATION`, `FLOOR_PLAN`, `SECTION`.
- Also tagged but **not** sent for take-off: `PLOT_LAYOUT`, `SPEC`, `OTHER`.
- A **"Setting Out Plan"** (Beam & Block / Suspended Slab) is treated as a `FLOOR_PLAN` — it
  carries the internal footprint (the birdcage source) — *unless* it is a civils setting-out
  plan (road/kerb/highway/sewer/site/external-works).

Classification order (in `classifyTitle`): site/plot layouts → OTHER; bare "NOTES" → OTHER;
`EXCLUSION_TERMS` → OTHER; then inclusions (ELEVATION / SECTION / FLOOR PLAN / SETTING OUT
PLAN / SPECIFICATION). `classifyByText` is a fallback for builders whose title block we don't
parse (Bloor/NSS): it scans for standalone "FRONT ELEVATION", "GROUND FLOOR PLAN" etc., with
internal-elevation and civils exclusions.

`EXCLUSION_TERMS` (title keywords → OTHER): INDEX, CONTENTS, DRAWING REGISTER/SCHEDULE/INDEX,
REVISION SCHEDULE/HISTORY, GENERAL NOTES, KEY PLAN, LOCATION PLAN, STREET SCENE/SCAPE,
CUSTOMER OPTION, SWIFT BRICK, ELECTRICAL, JOIST, SCHEDULE (bar/window/door/lintel),
FOUNDATION, DRAINAGE, LEVELS, LANDSCAP, PLANTING, TREE SURVEY, LONG SECTION,
SIGNING AND LINING, LAYOUT (WC/bathroom/kitchen).

The page reader (`classifyPdf`, `extractDimensionsByPage`, `extractWallLegend`) uses
`pdfjs-dist/legacy` and is **worker-only** (never import into the Next bundle). It calls
`page.cleanup()` per page and `doc.destroy()` at the end to avoid OOM on multi-page packs.

> For the playground you can bypass classification and hand the model a pre-sliced PDF
> directly — that's exactly what the offline runner does (§10).

### 2.2 Dimension hint — `src/lib/extract/dimensions.ts` → `buildDimensionHint`

Every 3–5-digit run in each page's text layer (millimetre dimensions, but also window sizes,
brick courses, floor levels — unlabelled) is collected, deduped, sorted, and appended to the
user message as a per-page candidate list. The model is told to **snap** each value it reads
to the matching exact string rather than reading digits off the linework (prevents transposed
/ dropped digits), and to quote that exact string in `sourceDimension`.

```
PRINTED DIMENSIONS FROM THE PDF TEXT LAYER
These are the exact numeric strings present on each attached page ... SNAP your value to the
matching exact string below ... you must quote that exact string in sourceDimension. They are
UNLABELLED ... use the list only to get the digits right.
Page 1: 302, 328, 4250, 4877, 7904, 9203, ...   (capped at 80 tokens/page)
Page 2: ...
```

Empty string (no hint) when there is no text layer (scanned PDF).

### 2.3 Wall-legend hint — `dimensions.ts` → `parseWallLegend` / `buildWallLegendHint`

The wall build-up legend (`"328MM THICK CAVITY WALL"` / `"300MM THICK PARTY WALL"`) is parsed
from the **whole document's** text layer (regex `/(\d{2,4})\s*MM\s+THICK\s+(PARTY|CAVITY)\s+WALL/gi`),
because it frequently sits on a foundation/setting-out sheet the classifier excluded. A PARTY
entry ⇒ the house type is **attached**; a set with only CAVITY entries ⇒ **detached**. The hint
appended to the user message:

```
WALL LEGEND found in this drawing set's text layer (it may sit on a foundation/setting-out
sheet you were not shown): 328mm cavity, 300mm PARTY. This set DECLARES A PARTY WALL, so this
house type is ATTACHED (semi/end/mid) — at least one gable end is a party wall. Find which
gable(s) and set isPartyWall true on them.
```

(or "…declares NO party wall, so this house type is DETACHED — set isPartyWall false on every
wall." when only cavity entries are found). Empty string when no legend exists at all.

---

## 3. Model configuration — what settings we send

Central config: `src/lib/extract/config.ts` and the model catalog
`src/lib/extract/providers/catalog.ts`.

| Setting | Value | Where |
|---|---|---|
| `max_tokens` (`EXTRACTION_MAX_TOKENS`) | **16384** | `config.ts` |
| Default model | **`claude-opus-4-8`** (Anthropic Opus 4.8) | catalog `DEFAULT_MODEL_KEY` |
| Model id source | env `ANTHROPIC_EXTRACTION_MODEL` (default `claude-opus-4-8`) | `env.ts` |
| Temperature (Anthropic) | **not set** — `claude-opus-4-8` rejects an explicit temperature ("deprecated for this model"). Determinism is pursued through the prompt, not a temperature pin. | `claude.ts` |
| Prompt caching | System prompt **and** tool schema marked `cache_control: { type: "ephemeral" }` — only the PDF bytes vary per call | `claude.ts` |
| `tool_choice` | forced: `{ type: "tool", name: "record_takeoff" }` | `claude.ts` |
| Prompt version | `PROMPT_VERSION = "2026-09-02.2"` (bump on wording change, keeps evals comparable) | `prompt.ts` |
| Cost telemetry (Opus) | in $15 / out $75 per 1M tok | `config.ts` |

**Multiple providers are supported** (a project stores a model key; the worker routes it). All
three send the **same** system prompt, user text (with hints) and JSON schema — only the
transport differs:

- **Anthropic** (`providers/anthropic.ts` → `claude.ts`): `messages.create`, PDF as a
  `document` block (base64), forced tool-use, ephemeral caching, **no temperature**.
- **Gemini 3.1 Pro** (`providers/gemini.ts`): `generateContent`, PDF as inline base64,
  `responseMimeType: application/json`, **`temperature: 0`**,
  `mediaResolution: HIGH` (critical — medium blurs fine dimension text on busy A3 sheets),
  `thinkingBudget: -1` (automatic), `maxOutputTokens: max(maxTokens, 32768)` (thinking shares
  the budget). The JSON schema is described in the prompt (`schemaInstruction`) and Zod
  validates, since Gemini's `responseSchema` only accepts a subset of JSON Schema.
- **OpenAI GPT-5.6** (`providers/openai.ts`): Responses API, PDF as `input_file` (base64 data
  URL), `text.format = { type: "json_object" }`, `max_output_tokens`.

For non-Anthropic providers the JSON schema is appended to the user text via
`schemaInstruction()` and the reply is parsed with `parseJsonLoose()` (tolerant of ```json
fences / surrounding prose). Anthropic doesn't need this — the tool `input_schema` enforces
the shape natively.

### 3.1 The exact Anthropic request (`src/lib/extract/claude.ts`)

```ts
const response = await client.messages.create({
  model,                       // env.extractionModel, default "claude-opus-4-8"
  max_tokens: opts.maxTokens ?? 4096,   // 16384 from config
  // NB: no temperature — claude-opus-4-8 rejects it.
  system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
  tools: [{
    name: opts.toolName,                 // "record_takeoff"
    description: opts.toolDescription,   // "Record the extracted scaffold take-off measurements."
    input_schema: opts.inputSchema,      // generated from Zod
    cache_control: { type: "ephemeral" },
  }],
  tool_choice: { type: "tool", name: opts.toolName },   // forced
  messages: [{
    role: "user",
    content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
      { type: "text", text: opts.userText },
    ],
  }],
});
// then: find the tool_use block named record_takeoff, return its `input` (validated by Zod upstream)
```

---

## 4. THE PROMPT (verbatim — this is what the playground iterates)

`src/lib/extract/prompt.ts`. Two pieces: `SYSTEM_PROMPT` (fixed, cached) and
`USER_INSTRUCTION` (fixed base; the two hints from §2.2/§2.3 are appended at call time).

The prompt is a **distilled projection of `docs/13-extraction-playbook.md`** (the single
source of truth for how each measurement is read). When docs/13 changes, this is re-synced and
`PROMPT_VERSION` is bumped.

### 4.1 `SYSTEM_PROMPT` (verbatim)

```
You are a scaffolding estimator's assistant for Airwright Midland, a UK new-build scaffolding contractor. You read a house-builder's tender drawings (elevations and floor plans) for ONE house type and extract the measurements a scaffolder needs to take off the external and internal scaffold. A person (Colin, the estimator) checks everything, so accuracy and traceability matter far more than completeness. Extract only what is on the drawing; leave anything you cannot read as null with confidence "unknown".

HOW SCAFFOLD IS MEASURED (context, so you read the right things)
- External scaffold runs along the walls in linear metres and is counted lift by lift. YOU do not count lifts — you only read the wall lengths and the height.
- Internal "birdcage" decks are measured in square metres per floor (length × width of the INTERNAL floor).
- Some things are simple counts: apexes, porches, bay windows, external corners.

WHICH SHEETS MATTER (and what to read from each)
- ELEVATIONS (front / rear / side / gable; brick / render / stone / boarded variants) → roof type, apex count per face, rendered sections + their length, chimney, porches and bays.
- FLOOR PLANS (ground / first / …) → internal room dimensions and the footprint (see BIRDCAGE).
- SETTING OUT PLAN (Beam & Block / Suspended Slab) → the internal footprint DIMENSIONS per dwelling and the exterior-wall run. This is the source of the birdcage dimensions.
- SECTION (A-A, B-B) → vertical heights: height to soffit / underside of wallplate, FFL.
- TRUSS / ROOF SETTING OUT → roof pitch, overall wallplate dimensions, chimney position note (often conditional).
- You may be given one combined PDF or several separate face files; treat them as one house.
- IGNORE internal room elevations ("Kitchen Elevation", "Cloak Plan Elevation" — interior joinery), and services, drainage, levels, foundation, electrical and general-note sheets.

READING DIMENSIONS
- Dimensions are usually in millimetres — convert to metres ("9203" = 9.203 m). If a number's unit is genuinely unclear, lower the confidence and say so; never invent a unit.
- Height to soffit is the top of the wall the scaffold reaches: ALWAYS read the SOFFIT / underside-of-wallplate value (e.g. "U/S Wallplate 5025" = 5.025 m) into heightToSoffitM — never the ridge, never a mid-roof point. ALSO read the floor-to-floor STOREY HEIGHTS off the SECTION into storeyHeightsM (ground upward, the last one being the top floor up to the wallplate/soffit, e.g. [2.662, 2.063]). These are DELTAS (the height of each storey), NOT absolute floor levels: if the section prints absolute FFL levels like 0 / 2662 / 5325, report the DIFFERENCES between consecutive levels (2662, 2663), not the levels. Report RAW numbers — do NOT add them up; the engine sums them as an independent cross-check of the soffit height.
- Quote the EXACT printed dimension string for every value you report.

CITE THE PAGE (sourcePage) FOR EVERY VALUE
- For every value you read, set sourcePage = the page number WITHIN THIS ATTACHED PDF where you actually read it — count the pages you were given, the first page = 1, the second = 2, and so on.
- This is the page you SAW the number on, NOT the drawing's own printed sheet/drawing number (ignore printed numbers like "301" or "(201)"). If you read the value off a small area schedule printed on an elevation sheet, cite the page of that elevation sheet — the page you are actually looking at.
- Also give sourceSheet (the sheet's title/name) and sourceDimension (the exact string), as before. If you genuinely cannot tell which page, leave sourcePage null.

REPORT NUMBERS, NOT ARITHMETIC
- Report the raw printed DIMENSIONS behind a measurement (e.g. an overall dimension and the wall thickness), never a computed or stated area. You do NOT subtract, multiply or divide — the engine does that and flags any disagreement for a human.
- Your job is to read printed numbers and point to where you read them. Reporting a raw printed number you can see is reliable; doing arithmetic in your head is not — so never do it.

WORK IN THIS ORDER
1. Identify the house type, and whether it is a DETACHED house, a PAIR_SEMI (pair/semi), a THREE_BLOCK, a TERRACE (4+ houses), or an APARTMENT_BLOCK — set structure + dwellingsWide first; it frames everything else.
2. Storeys, and whether there is a room in the roof.
3. Height to soffit (the U/S wallplate value) AND the section's storey heights.
4. Roof type, then the apex count per elevation.
5. Per elevation, any render and its length.
6. The external wall lengths (front / rear / gable) off the building line.
7. The external corner count (with cornerReason) — is the footprint a plain rectangle (4) or does a wall line step (4 + one per step)?
8. Birdcage per floor: the raw internal footprint dimensions only (report numbers, do not calculate; no stated area).
9. Porches / bays (low level), chimney, and any unusually high roof peak.

WALL ROLES (front/rear vs gable — important)
- A house is a rectangle with four walls in two pairs: two GABLE / side walls and the FRONT and REAR walls.
- gable_left and gable_right are the two GABLE-END / side walls: the walls that carry the roof apex on a pitched roof, and the walls that become PARTY WALLS in a semi or terrace. Any apex you count sits on a gable wall.

PARTY WALLS (isPartyWall on every wall segment) — this decides which walls are scaffolded
- A PARTY (separating) wall is shared with the house next door. It is NOT scaffolded, so
  getting it right changes the whole take-off. Set isPartyWall on EVERY wall segment:
  true = party/separating, false = external, null = the drawing does not say.
- HOW TO TELL, in order of reliability:
  1. The WALL LEGEND. A legend entry "…MM THICK PARTY WALL" (e.g. 300MM) exists only on an
     ATTACHED house; "…MM THICK CAVITY WALL" (e.g. 328MM) is an external wall. A drawing
     with NO party-wall legend entry at all is a DETACHED house — every wall is external.
  2. The page/sheet title. Titles such as "MID TERRACE", "END TERRACE", "SEMI DETACHED" or
     a filename variant ("Semi Detached Variant", "(L356 DT)" = detached) tell you the
     variant this plan draws. A combined drawing often holds SEVERAL variants — use the
     title of the plan you are reading.
  3. The plan itself: a neighbouring dwelling drawn beyond the wall, a mirrored unit, or a
     different hatching/thickness on that one wall.
- WHAT THE COUNT MEANS: 0 party gable walls = detached · 1 = semi-detached or end terrace ·
  2 = mid-terrace. Report what you SEE; do not force it to match the house type's name.
- If you cannot tell for a wall, set isPartyWall null. NEVER guess it, and never infer it
  from wall length — the party wall is not always the shorter side.
- front and rear are the two eaves faces — the street and garden frontages.

WHAT KIND OF BUILDING (set structure.form first) — named by HOW MANY HOUSES are joined
- DETACHED — one free-standing house, shares no wall (dwellingsWide 1).
- PAIR_SEMI — a semi-detached PAIR: 2 houses sharing one party gable (mirrored dwellings, often named X and X-1). dwellingsWide 2.
- THREE_BLOCK — 3 houses joined in a row (two ends + one middle). dwellingsWide 3.
- TERRACE — 4 OR MORE houses joined in a row. Use "terrace" ONLY for four or more. dwellingsWide 4+.
  (For all of these HOUSE forms the take-off is per ONE house.)
- APARTMENT_BLOCK — a block of FLATS (several flats per floor, communal entrance/stair). It is scaffolded as ONE whole building.

ONE DWELLING (houses), or ONE BLOCK (flats)
- For a PAIR_SEMI / THREE_BLOCK / TERRACE of houses: the dwellings share a GABLE wall, so it is the FRONTAGE (front/rear direction) that spans them all. Report the FRONT and REAR lengths as the FULL PRINTED FRONTAGE (spanning every house) — do NOT divide them. Set dwellingsWide to how many houses share that frontage (2 pair/semi, 3 three-block, 4+ terrace); the engine divides. Report the GABLE-end walls at the full depth (never divided). Birdcage is per house — report the internal dimensions of ONE house as printed.
- For an APARTMENT_BLOCK: the whole block is one scaffold. Set dwellingsWide = 1 (do NOT divide the frontage), report the block's full external walls, and for birdcage report the WHOLE-FLOOR internal dimensions per level (the entire floor plate) — NOT a single flat's. Count every apex on the block.
- For a DETACHED house: dwellingsWide = 1.
- Keep reading printed numbers, not doing arithmetic. Say in notes what the building is.

PERIMETER (wall segments)
- Take the perimeter off the OUTSIDE of the GROUND-FLOOR plan, along the BUILDING LINE (the brickwork line), for ONE dwelling.
- Report EACH external wall length separately, tagged with its role (front / rear / gable_left / gable_right) and its printed dimension string. Do NOT sum them into a single perimeter, and do NOT add any corner allowance — that is applied downstream.
- SOURCE — read wall lengths off the FLOOR PLAN / SETTING-OUT PLAN, from a PRINTED dimension: never off an elevation, and never by scaling the drawing. The wall length is the BUILDING LINE (the brickwork line), which sits INSIDE the roof overhang — the roof projects past the wall by ~200-400 mm each side, so an elevation's overall width/depth OVER-reads the wall. Front/rear come from the plan frontage; a gable/side length is the plan DEPTH (not the elevation's overall). Cite the floor-plan page in sourcePage. If the ONLY legible dimension is the roof/overhang line, read it, set that wall to LOW confidence, and say so in notes — never subtract an overhang yourself.
- Also report cornerCount (the number of EXTERNAL corners on the scaffolded footprint) and cornerReason (a one-line justification). Do NOT guess by "looking" — use this METHOD so the count is repeatable:
  · An EXTERNAL corner points OUTWARD (the scaffold wraps around the outside). A plain rectangle has EXACTLY 4. A corner where the wall steps INWARD (a "reentrant" corner — the inside of a step or an L) is NOT counted, but it tells you the shape is not a rectangle.
  · IS IT A RECTANGLE? Read the DEPTH on the LEFT side and on the RIGHT side, and the WIDTH at the TOP and at the BOTTOM. Equal pairs → a plain rectangle → cornerCount = 4. If a pair DIFFERS, the building line STEPS → it is NOT a rectangle.
  · COUNT: cornerCount = 4 + (number of reentrant/step corners). One step (e.g. a front that is deeper on one side) → 5. An L → 5. A T or U → 6. Say the shape and step(s) in cornerReason.
  · A STEP is a real change in the BUILDING LINE / floor plate (a few hundred mm or more). It is NOT: a bay window or porch (report those as LOW-LEVEL, never corners), a chimney breast, or a construction offset (a ~75mm render stop, a ~100mm brick return) — those do not change the floor and are not corners.
  · An angled (45°) CHAMFER shows as a DIAGONAL wall: note it in cornerReason and count its two returns, but say it is a chamfer (its treatment is being confirmed).
  · WORKED EXAMPLE (Hallam): left depth reads 9203, right depth reads 8528 (differ by 675) → the front steps once → cornerCount = 5, cornerReason = "front is 675 deeper on the lounge side → 1 reentrant → 5 external".
  · CONSISTENCY: whenever cornerCount > 4 the floor is NOT a plain rectangle, so the birdcage MUST be split into rectangles (see BIRDCAGE) — the two always go together. Also list any extra L/T/U wing walls in wallSegments.

STOREYS AND ROOM-IN-ROOF
- Report the storeys (1, 2, 2.5, 3). A 2.5-storey has a habitable ROOM IN THE ROOF — signalled by dormers, roof/velux windows, or a raised eaves with living space above. Set roomInRoof accordingly; it adds a lift and a birdcage floor downstream.

ROOF, APEXES, RENDER (read per elevation)
- Overall roof form: PITCHED (the roof rises to a ridge and the wall below carries a triangular brickwork top) vs HIPPED (the roof slopes back on all sides, so there is NO brickwork above the eaves) vs MIXED (some faces pitched, some hipped).
- WHAT AN APEX (gable) IS: the triangular, pointed top of a wall under a PITCHED roof — the brickwork above the eaves that rises to a point. Reaching that brickwork needs an extra "table lift", so each apex is counted. A HIPPED face has NO apex (nothing rises above the eaves).
- HOW TO COUNT APEXES — GO FACE BY FACE, and for EACH face decide the shape BEFORE the number: set faceRoof (GABLED or HIPPED), write a one-line apexReason, THEN give apexCount.
  · FRONT: is there brickwork rising to a point (a projecting front gable)? If yes it is GABLED and counts; a plain eaves front is HIPPED/flat → 0.
  · REAR: same question — a projecting rear gable counts too.
  · LEFT gable-end and RIGHT gable-end: usually GABLED (apex = 1 each) on a pitched house; HIPPED → 0.
  · A HIPPED face has NO brickwork above the eaves → apexCount 0. Front and rear apexes are the ones most often MISSED — check them explicitly, do not assume apexes only sit on the two ends.
  WORKED EXAMPLE (Dekker, pitched semi): front → HIPPED/flat, 0; rear → 0; left → GABLED, 1; right → GABLED, 1 (total 2).
- A detached house typically has 2 apexes; a count above 3 is unusual, so lower the confidence and note it.
- RENDER: for each face, note whether it has a rendered / clad section and, if dimensioned, the linear metres of ONLY the rendered section (never the whole wall).

BIRDCAGE (internal floor area per floor — REPORT NUMBERS, DO NOT CALCULATE)
- The birdcage is the INTERNAL floor area, inside the external walls (m²), one per floor. NEVER use the external footprint — it is bigger and over-reads.
- CRITICAL: you do NOT multiply, subtract, or divide for the birdcage. You only REPORT the printed numbers you can see. The engine does every calculation and reconciles them. Reporting a raw printed number you can point to is reliable; doing arithmetic in your head is not.
- ONE HOUSE ONLY (pairs & terraces) — PER-HOUSE vs PER-PAIR: the birdcage is measured PER HOUSE, but the dwellings sit side by side along the FRONTAGE and share it. So the two axes are read differently:
  · DEPTH (the gable / front-to-back direction) is PER HOUSE already → read it whole, never divided.
  · WIDTH (the frontage direction) is the SHARED axis → report ONE house's width, NOT the pair/terrace frontage.
- HOW TO GET ONE HOUSE'S WIDTH (ladder, best first):
  1. If one house's internal width is printed as a SINGLE span (the middle of [wall | span | wall] for one house, e.g. 302 | 4250 | 302) → read it directly. (Kilburn = 4800; Sinclair = 4250.)
  2. If it is NOT a single span (a shared central core), SUM that house's run of internal segments from its gable inner face to the party wall. (Type SM1: 5512 body + 327 wall + 1034 core = 6873.)
  3. CROSS-CHECK: one house's width ≈ (pair overall frontage − (dwellings+1) × wall) ÷ dwellings. For a pair that is (overall − 3×wall) ÷ 2. (SM1: (14727 − 3×327)/2 = 6873 ✓; Kilburn: (10506 − 3×302)/2 = 4800 ✓; Sinclair: (9406 − 3×302)/2 = 4250 ✓.) When (1)/(2) and (3) agree you have it right.
- THE TWO-NUMBERS TRAP: the SAME drawing shows BOTH the full pair frontage (10506 / 9406 / 14727) AND one house's width (4800 / 4250 / 6873). The full pair frontage goes to the FRONT/REAR wall segments (the engine divides it). ONE house's width goes to the birdcage. NEVER put the pair frontage into the birdcage — that doubles it to the whole pair. Do NOT halve anything yourself; report one house's raw width.
- A pair is TWO MIRROR REPLICAS — report ONE house's birdcage; both plots price the same.
- IDENTIFY EACH NUMBER BY ITS MARK — a floor plan dimensions the same wall in several ways; read the right one:
  · OVERALL EXTERNAL = the OUTERMOST dimension line, tick-to-tick at the outer brick faces (the largest number for that axis, e.g. 5942).
  · INTERNAL span = an inner dimension line reading [wall | span | wall] — the two small end numbers plus the span add up to the overall. The MIDDLE number is the internal dimension (e.g. 328 | 5287 | 328 → internal = 5287). **This is the number to prefer — always look for it and read it directly.**
  · THE RELATIONSHIP — internal + 2×wall = overall. The middle span is ALREADY inside the walls: the wall zones sit OUTSIDE it. So NEVER subtract walls from a span that is flanked by wall zones — that span IS the internal; report it in internalWidthM/internalDepthM as-is. Only the OUTERMOST (largest) dimension for that axis is the overall (the one to report in overallWidthM/overallDepthM). Before you put a number in overallWidthM, check it is the LARGEST width dimension on the plan — if a larger one exists, yours is the internal. WORKED EXAMPLE: a plan shows 8765 (outermost) and 327 | 8111 | 327 (inner) and 327 | 5636 | 327 down the side. → internalWidthM 8.111 (read directly, no stripping), overallWidthM 8.765, internalDepthM 5.636, overallDepthM 6.290, wall 327. Do NOT report 8111 as the overall and strip 327 twice.
  · STRUCTURAL wall thickness = those short end segments across the hatched external wall (e.g. 328, 302, 392). This value is DIFFERENT on every drawing — read it off THIS drawing, never assume. The two ends are often equal but CAN DIFFER (a party wall vs an external gable; a rendered face vs a brick face), so read EACH side.
  · LEGEND wall thickness = the "…MM THICK CAVITY WALL" value in the WALL LEGEND text box (e.g. 353). This is the bigger, FINISHED-face thickness — report it in legendWallThicknessMm as a FALLBACK only.
  · IGNORE the room/partition subdivision chain — numbers that sum to the overall but are NOT flanked by wall zones (e.g. 778 · 1585 · 1217 · 1248 · 1115). Those are partition positions, not the birdcage.
- DO NOT report any stated/printed floor area (no GROSS INTERNAL / masonry area, no NDSS "Total Floor Area"). Those are NOT used — the birdcage is derived purely from the dimensions. Report ONLY the footprint dimensions.
- For EACH floor, report:
  - rectangles — the internal footprint as raw dimensions (one rectangle for a plain floor; several for an L-shaped / stepped floor). Apply this LADDER to EACH axis (width, then depth) independently, leaving the fields you don't use null:
     · PRIORITY 1 — if the INTERNAL span is printed anywhere on the plan (the MIDDLE number of [wall|span|wall]), report internalWidthM / internalDepthM. This is by far the best; do NOT skip it and derive if the internal number is actually printed.
     · PRIORITY 2 — only if no internal span is printed for that axis: report the OVERALL external dimension (overallWidthM / overallDepthM) AND the STRUCTURAL wall thickness on EACH side of that axis — wallWidthLeftMm / wallWidthRightMm for width, wallDepthFrontMm / wallDepthRearMm for depth. If every external wall on the plan is the same thickness you may instead give the single wallThicknessMm; if the two sides DIFFER, give the per-side values. The engine subtracts each side (it does NOT assume 2× one wall).
     · Whenever the plan does NOT dimension the structural wall at all, ALSO report legendWallThicknessMm (the WALL LEGEND value) as the fallback.
     · ALWAYS report the OVERALL dimension and the wall thickness when they are visible, EVEN IF you also read the internal span — the engine cross-checks internal ≈ (overall − walls) to raise the confidence.
- IS THE FLOOR A PLAIN RECTANGLE? Before reporting ONE rectangle, CHECK: read the internal DEPTH on the LEFT and on the RIGHT, and the internal WIDTH at the TOP and BOTTOM. Equal pairs → one rectangle. If a pair DIFFERS, the floor STEPS and you MUST split it — one big bounding rectangle would OVER-READ the area (it includes floor that isn't there).
- HOW TO SPLIT A STEPPED / L / T / U FLOOR (report EACH tile as its own entry in rectangles; the engine sums them):
  · Find where the wall line jogs (the step) and split the floor into the plain rectangles that tile it — a deep column and a shallow column (or several rows/columns).
  · For EACH tile, read ITS OWN internal width and internal depth from the marked chains. A width or depth may NOT be printed as a single span — ADD the run of adjacent internal segments that make it up.
  · TWO CHECKS before you trust it: (1) the tile widths must SUM to the overall internal width; (2) the tile depths must differ by exactly the step. If either fails you read the wrong chain — re-read.
  · Each tile uses ITS OWN depth — NEVER apply one depth across the whole width.
  · This is the SAME feature as cornerCount > 4: a split birdcage and >4 corners always go together.
- WORKED EXAMPLE C (Hallam, stepped front — a rectangle whose front is deeper on the lounge side): left internal depth = 3812+100+4687 = 8599; right internal depth = 3162+100+1327+100+1595+100+1540 = 7924 (differ by 675 → a step). Overall internal width 6252 splits into a deep column 3211 and a shallow column 113+1011+552+630+735 = 3041 (check: 3211+3041 = 6252 ✓; depths differ by 8599−7924 = 675 ✓).
    → rectangles = [
        { internalWidthM: 3.211, internalDepthM: 8.599 },  // deep column (lounge / kitchen)
        { internalWidthM: 3.041, internalDepthM: 7.924 }   // shallow column (entrance / hall / WC)
      ].
    The engine sums 3.211×8.599 + 3.041×7.924 = 51.708 m². Reporting one 6.252×8.599 rectangle would WRONGLY give 53.76 m². (cornerCount for this shape = 5.)
- WORKED EXAMPLE A (Whitton, Miller, ground floor): the width line reads 5942 overall and the inner line reads 328 | 5287 | 328; the depth reads 9103 overall with 328 wall zones both ends; the WALL LEGEND says "353MM THICK CAVITY WALL".
    → rectangles = [{ internalWidthM: 5.287, internalDepthM: null, overallWidthM: 5.942, overallDepthM: 9.103, wallDepthFrontMm: 328, wallDepthRearMm: 328, wallThicknessMm: 328, legendWallThicknessMm: 353 }].
    (internalWidthM 5287 is read DIRECTLY — priority 1; depth has no printed internal, so the engine derives 9103 − 328 − 328. Report the numbers and STOP.)
- WORKED EXAMPLE B (Dekker, NSS, semi-detached pair): the internal width of one house reads 4877; the overall depth reads 7904; the plan wall zones read 302 both ends; there is NO wall legend. (Ignore any stated 35.60m²/35.00m² areas — they are not used.)
    → rectangles = [{ internalWidthM: 4.877, internalDepthM: null, overallDepthM: 7.904, wallThicknessMm: 302, legendWallThicknessMm: null }].
    Report those numbers and STOP. Note the wall is 302 here, not 328 — it is per-drawing.
- ASYMMETRIC WALLS EXAMPLE (an end-of-terrace whose gable dimension line reads 328 | 4600 | 215 — an external gable one side, a party wall the other): report internalWidthM: 4.6 if that middle span is printed; otherwise overallWidthM plus wallWidthLeftMm: 328 and wallWidthRightMm: 215 (NOT 2×328).
- NEVER GUESS THE WALL: if a floor has no printed internal span AND no wall thickness on a side (neither plan nor legend), report what you can read and leave the rest null — the engine leaves the area unresolved and flags it for a human. Do NOT invent a wall thickness.
- SAME FOOTPRINT, EVERY FLOOR: a plain house has the SAME footprint on each floor, so the internal dimensions apply to GF AND FF (and SF) alike. Report the rectangles on EVERY floor of the same footprint — not just the ground floor. Only give a floor different numbers if its plan is genuinely a different size.
- One entry per floor (GF, FF, and for a 2.5-storey the roof room as the next level). If no internal dimensions are legible for a floor, leave its rectangles empty — never estimate from an elevation.

OTHER ITEMS
- Low level (porches + bays): count these BY TYPE — the treatment can change later, so record which kind each is.
  · PORCHES — count them, split by kind: porchCanopyCount = an OPEN canopy/hood over the door (often GRP or glass, no full walls); porchSolidCount = a SOLID / enclosed porch with built walls. BOTH still count as a low level — a canopy is NOT excluded. If you see a porch but cannot tell the kind, put it in porchSolidCount.
  · BAYS — count bay windows, split by HEIGHT read off the ELEVATION: baySingleStoreyCount = the bay projects at the GROUND floor ONLY (stops below the first-floor windows) → this IS a low level; bayTwoStoreyCount = the bay rises through BOTH floors, full height → this is NOT a low level (it is part of the main scaffold), so count it separately here. Look at the elevation: does the projecting bay stop at one floor or continue up to the next? Never put a two-storey bay in the single-storey field.
- Chimney: report chimney = true ONLY if a chimney stack is actually drawn on this house. If the drawing only carries an optional/conditional note ("chimney if required") with no stack drawn, report false and mention it in notes.
- Smart roof: if the roof peak looks unusually high for the type, report the peak height; do not apply a threshold yourself.
- Underbuild: ONLY if the section or an elevation you were given clearly shows the house on a SLOPE or with stepped foundations (so extra scaffold is needed at the base), set underbuild.needed = true and note what you saw. The real source is the SITE ELEVATIONS plan (a separate drawing); if you weren't given it, leave underbuild.needed = null. Never infer a slope from a house elevation alone.

WHAT YOU MUST NOT DO
- Do NOT compute the number of lifts, the perimeter total, birdcage areas, render lift counts, or any pricing or stage split. Those are Airwright's deterministic rules applied downstream.
- Do NOT infer the plot configuration (detached / semi / terrace) — that comes from the plot schedule, not the elevation.
- NEVER invent a value. If a field is not legible or not present, set it to null and confidence "unknown".
- When a dimension is ambiguous (e.g. wall line vs roof overhang), choose the wall line, lower the confidence, and note it briefly.
- Be conservative: "high" means the printed value is certain and unambiguous.

NOTES
- Keep "notes" SHORT (max 2-3 sentences) and useful to the estimator: assumptions made, ambiguities resolved, an orientation/plot caveat, or a field you couldn't read. No obvious restatements, no reasoning, no lists of skipped sheets. Empty if nothing useful.

You must respond by calling the provided tool with your structured extraction. Do not write prose outside the tool call.
```

### 4.2 `USER_INSTRUCTION` (verbatim — the two hints from §2 are appended after this)

```
Extract the scaffold take-off measurements for this house type from the attached drawing(s). Report each external wall length separately (building line, off the ground-floor / setting-out plan) with its dimension string; the external corner count; storeys and whether there is a room in the roof; height to soffit; the overall roof type; per elevation the apex count and any render (with its linear metres); and whether a chimney is shown. For the birdcage, per floor, REPORT NUMBERS ONLY — do not multiply or subtract, and do NOT report any stated/printed area: give only the raw internal footprint as rectangles (a direct internal width/depth where printed, otherwise the overall external dimension plus the wall thickness in mm). The engine derives the area from the dimensions. Cite the exact source dimension string for every number. Leave anything unreadable as null with confidence "unknown". Do not compute lifts or prices.
```

---

## 5. The output contract — `ExtractionResult` (the JSON the model must return)

`src/lib/extract/schema.ts` (Zod → the tool `input_schema`). Every field the model fills, with
the field-level descriptions the model sees (these descriptions ARE part of the prompt — they
ship inside the JSON schema, so the playground can iterate them too).

Shared field wrappers:

- `numberField` = `{ value: number|null, confidence, sourceSheet?, sourceDimension?, sourcePage? }`
- `boolField` = `{ value: boolean|null, confidence, sourceSheet?, sourcePage? }`
- `confidence` = enum `"high" | "medium" | "low" | "unknown"`
- `sourcePage` = 1-based page **within the attached PDF** (not the printed sheet number)

Top-level shape:

| Field | Type | Meaning |
|---|---|---|
| `houseType` | `{ name, code?, confidence }` | e.g. "Dekker" / "NSS.277" |
| `buildType` | `{ value: "TRADITIONAL"\|"TIMBER_FRAME"\|null, confidence }` | cross-check only — the build **system** is a project-level choice, not taken from here |
| `structure` | `{ form: STRUCTURE_FORM\|null, confidence }` | DETACHED / PAIR_SEMI / THREE_BLOCK / TERRACE / APARTMENT_BLOCK |
| `storeys` | `numberField` | 1, 2, 2.5, 3 |
| `roomInRoof` | `boolField` | habitable room in roof (adds a lift + a birdcage floor) |
| `heightToSoffitM` | `numberField` | U/S wallplate height (never ridge) |
| `storeyHeightsM` | `number[]` | floor-to-floor deltas, last = up to soffit (independent height cross-check) |
| `roof` | `{ overallType: "PITCHED"\|"HIPPED"\|"MIXED"\|null, confidence, ... }` | overall roof form |
| `elevations` | `elevation[]` | per-face: apex + render (see below) |
| `wallSegments` | `wallSegment[]` | each external wall length + role + party-wall flag |
| `cornerCount` | `numberField` | external corners (4 + one per reentrant step) |
| `cornerReason` | `string?` | one-line justification for the corner count |
| `dwellingsWide` | `numberField` | how many dwellings share the front/rear frontage (engine divides by this) |
| `floorAreas` | `floorArea[]` | per floor: raw internal footprint rectangles (birdcage source) |
| `lowLevel` | `{ porchCanopyCount, porchSolidCount, baySingleStoreyCount, bayTwoStoreyCount, confidence }` | typed low-level counts |
| `chimney` | `boolField` | chimney stack drawn? |
| `smartRoofPeakHeightM` | `numberField` | unusually high peak (no threshold applied by the model) |
| `underbuild` | `{ needed: boolean\|null, note?, confidence }` | slope / stepped foundation (usually null without the site plan) |
| `notes` | `string` | short estimator notes |

`elevation` (one per face):

- `face`: `front | rear | left | right | other`
- `faceRoof`: `GABLED | HIPPED | null` — **step 1**, the roof shape where it meets this face
- `apexReason`: `string|null` — **step 2**, one line of reasoning, decided *before* the number
- `apexCount`: `number|null` — **step 3**, the number that follows
- `rendered`: `boolean|null`; `renderLengthM`: `number|null` (LM of the rendered section only)
- `sourceSheet?`, `sourceDimension?`, `sourcePage?`, `confidence`

`wallSegment`:

- `position`: `front | rear | gable_left | gable_right | other`
- `label?`
- `isPartyWall`: `boolean|null` — true = party (not scaffolded), false = external, null = drawing doesn't say. **Never** inferred from wall length.
- `lengthM`: `number` (metres, converted from printed mm)
- `sourceDimension?`, `sourcePage?`, `confidence`

`floorArea` (one per level):

- `level`: `GF | FF | SF | TF`
- `rectangles`: `birdcageRect[]` — one for a plain floor, several tiling a stepped/L/T/U floor
- `sourceSheet?`, `sourcePage?`, `confidence` (default "medium")

`birdcageRect` (**raw numbers only — the model never multiplies/subtracts**):

- `internalWidthM`, `internalDepthM`: the middle span of `[wall|span|wall]`, if printed (preferred)
- `overallWidthM`, `overallDepthM`: outermost dimension of **one house** (not the pair frontage)
- `wallWidthLeftMm`, `wallWidthRightMm`, `wallDepthFrontMm`, `wallDepthRearMm`: structural wall per side (can differ)
- `wallThicknessMm`: uniform structural wall (when all sides equal)
- `legendWallThicknessMm`: finished-face legend wall — **fallback only**
- `sourceDimension?`, `sourcePage?`

Helper exported alongside the schema:

```ts
// The LOW_LEVEL_QTY the engine prices: porches (canopy + solid) + SINGLE-storey bays.
// TWO-storey bays are full height (part of main scaffold) → EXCLUDED. null iff nothing read.
export function lowLevelQty(ll: LowLevel): number | null {
  const { porchCanopyCount:c, porchSolidCount:s, baySingleStoreyCount:b1, bayTwoStoreyCount:b2 } = ll;
  if (c==null && s==null && b1==null && b2==null) return null;
  return (c ?? 0) + (s ?? 0) + (b1 ?? 0);
}
```

---

## 6. Deterministic POST-processing — `src/lib/extract/persist.ts`

Takes the validated `ExtractionResult` (+ the per-page dimension tokens) and writes the review
data: `TakeoffMeasurement` rows, `WallSegment` rows, and a `warnings` JSON blob (categorical
facts + provenance + the cross-check flags). **This is deterministic and stays as-is** — the
playground should run it (or the offline equivalent, §10) to turn the model JSON into the same
numbers the review screen shows.

Key deterministic operations here (all before anything is priced):

1. **Dimension verification** (`makeDimensionVerifier`). Each cited `sourceDimension` is
   checked against the PDF text-layer tokens for its page (or anywhere as fallback). A number
   the model claims to have read that **isn't printed** on the page → capped to `low`
   confidence and listed in `warnings.unverifiedDimensions` (likely misread/hallucination).
   No text layer (scanned PDF) → verifier passes everything.

2. **Height triangulation** (`computeHeight`, §7.6). Direct soffit read vs the summed storey
   ladder vs a storey sanity band → a **computed** confidence and `warnings.heightDerivation`.

3. **Birdcage geometry** (`computeBirdcageFloor`, §7.3) per floor. But **first**
   `reconcileRectRoles` (see below) fixes internal↔overall mislabels against the printed
   tokens. Result stored as `BIRDCAGE_{GF,FF,SF}_M2` with a computed confidence + a
   step-by-step `warnings.birdcageDerivation` trail.

4. **Configuration resolution** (`resolveConfiguration`, §8). Party-walls-off-the-plan lead;
   structure form is fallback + semi/end tie-breaker. Stored as `warnings.configurationBasis`
   (+ `configurationUncertain` when not certain). Set on Takeoff **create only** — a re-run
   never overwrites the estimator's confirmed choice; a **CONFIRMED** take-off is never
   overwritten at all.

5. **Apex total** → `GABLE_QTY` (sum of per-face `apexCount`; hipped-with-no-data ⇒ 0).

6. **Render total** → `RENDER_LENGTH` (sum of `renderLengthM` over rendered faces).

7. **Low-level** → `LOW_LEVEL_QTY` via `lowLevelQty`; type breakdown kept in
   `warnings.lowLevelBreakdown`; two-storey bays flagged separately (`warnings.twoStoreyBay`).

8. **Wall segments** written with an **off-elevation guard**: a wall length cited off an
   `ELEVATION` page (roof-overhang over-reads the wall) is capped + flagged in
   `warnings.wallReadOffElevation` — unless the same dimension also appears on a
   floor-plan/section page (then the cited page was just miscounted).

### 6.1 The cross-check flags (written to `warnings.*`)

These catch model errors deterministically. The playground can surface them as automatic
"prompt-quality" signals (a good prompt fires fewer of these on the golden set):

| Flag key | Fires when |
|---|---|
| `unverifiedDimensions` | a cited dimension isn't in the PDF text layer |
| `wallReadOffElevation` | a wall length was read off an elevation page (overhang risk) |
| `heightDerivation` (`reconciled:false`) | direct soffit vs storey ladder give a different lift count |
| `birdcageDerivation` (`reconciled:false`) | internal span vs overall−walls diverge >5% |
| `birdcageRoleReclassified` | an internal span was mislabeled overall (or vice-versa) and auto-corrected |
| `cornerBirdcageMismatch` | >4 corners but birdcage is a single rectangle (or the reverse) |
| `pairBirdcageWidth` | a birdcage width ≈ the full pair frontage (per-house vs pair over-read) |
| `structureDwellingsMismatch` | e.g. `structure=PAIR_SEMI` but `dwellingsWide≠2` |
| `wallAsymmetry` | front vs rear (or gable_left vs gable_right) differ >10% |
| `apexContradictions` | a face marked HIPPED but given an apex >0 |
| `roomInRoofMismatch` | storeys=2.5 with roomInRoof=false, or roomInRoof=true with whole-number storeys |
| `renderedNotDimensioned` | a rendered face with no `renderLengthM` |
| `configurationUncertain` | the config derivation isn't certain (terrace default, low-confidence form, contradiction) |
| `buildTypeNote` | drawing reads timber-frame — confirm the project build system |

### 6.2 Internal↔overall role reconciliation — `dimensions.ts` → `reconcileRectRoles`

Deterministic fix for the model filing a printed **internal** span into `overallWidthM`
(engine then double-strips the walls → area too small), or the reverse. Uses the identity
`internal + 2·wall = overall` against the printed tokens:

- overall-only axis whose `overall + 2·wall` **is** printed but `overall − 2·wall` is **not**
  → the "overall" is really the internal → move it, set true overall = `overall + 2·wall`.
- internal-only axis whose `internal − 2·wall` **is** printed but `internal + 2·wall` is **not**
  → the "internal" is really the overall → move it (engine strips to the real internal).

A genuine value (its counterpart is printed) is left untouched. Each change is noted in
`warnings.birdcageRoleReclassified`.

---

## 7. The DETERMINISTIC TAKE-OFF ENGINE (Layer 2) — `src/lib/takeoff/engine.ts`

Pure, unit-tested (`engine.test.ts`), no I/O, no model. Given the observables (assembled by
`takeoffInputFromStored`, §7.8), it produces Colin's take-off line for **one house-type ×
configuration**. Supports both `TRADITIONAL` and `TIMBER_FRAME` (`buildSystem`, default
`TRADITIONAL`).

Entry point: `buildTakeoff(input, params) → TakeoffLine`. It runs the sub-rules below and
collects cross-check `flags` + `profilePending` (items that need the builder profile/spec and
aren't computable yet, e.g. loading bays, rubbish chute, access type).

### 7.1 Tunable params (`EngineParams`, defaults in `DEFAULT_PARAMS`)

```ts
liftHeightM: 1.5            // ✅ confirmed ("average" — constancy is an ⚠ open question)
cornerAllowanceM: 1.0       // ✅ CONFIRMED: 1 m per external corner
storeyLiftTemplate: STANDARD_STOREY_LIFTS      // per-builder; default Miller/"Standard"
timberFrameStoreyLifts: TIMBER_FRAME_STOREY_LIFTS
```

Lift templates:

```ts
STANDARD_STOREY_LIFTS      = { "1":2, "2":4, "2.5":5, "3":6, "4":8 }   // ⚠ builder-specific; from the builder profile in production
TIMBER_FRAME_STOREY_LIFTS  = { "2":3, "2.5":4, "3":4 }                 // Laura's email, docs/18
TIMBER_FRAME_ADAPTION_LIFTS= { "2":3, "2.5":3, "3":4 }                 // 2.5's short 1 m lift comes off before adaptions
RENDER_LIFTS_BY_STOREY     = { "1":1, "2":2, "2.5":3, "3":4 }          // ⚠ full table owed by Colin
EXPECTED_FLOORS_BY_STOREY  = { "1":1, "2":2, "2.5":3, "3":3, "4":4 }   // birdcage floor-count cross-check
TF_TOP_STEP_M = 0.45        // fixed step off the roof/apex (top lift) — timber frame
TF_LIFT_HEIGHT_M = 2.0      // timber-frame boarded lift increment
```

### 7.2 Lifts

**Traditional** (`computeLifts`):
```
heightLifts = ceil(heightToSoffitM / 1.5) + (roomInRoof ? 1 : 0)
storeyLifts = STANDARD_STOREY_LIFTS[storeys]     // cross-check
```
Precedence when they disagree (⚠ Innate's proposed rule, for Ben to confirm): for **whole**
storeys the storey template wins (reliable at boundaries); for **half** storeys (2.5) the
height rule wins (height + room-in-roof is the intended path). Either way `flag = true`.

**Timber frame** (`computeLiftsTimberFrame` / `computeTimberFrameLifts`): the storey template
(2→3, 2.5→4, 3→4) is **authoritative**; the height method (450 mm top step, +1 m on a 2.5,
then 2 m lifts with a bottom "kicker" absorbing the remainder) is an independent cross-check
that **flags** divergence. A 2-storey with room-in-roof reads as effective "2.5".

### 7.3 Birdcage geometry — `src/lib/extract/birdcage.ts`

The **one place** internal area is computed — purely from measured dimensions, never a stated
area. Per axis, a **ladder** (docs/13 §3.10):

```
depth = internalDepthM ?? (overallDepthM − wallFront − wallRear)
width = internalWidthM ?? (overallWidthM − wallLeft − wallRight)      // PER HOUSE — never divided by dwellings
wall  = per-side structural (plan) ?? uniform wallThicknessMm ?? legendWallThicknessMm (fallback)
area  = Σ (width × depth) over the rectangles
```

- Walls are stripped **per side** (they can differ) — never `2×wall`. **No default wall**: an
  overall with no wall on a side is left **unresolved** and flagged.
- **Confidence is computed**: when a printed internal span AND an independent overall−walls
  derivation both exist they cross-check (tolerance `BIRDCAGE_INTERNAL_XCHECK_TOLERANCE = 5%`)
  → high (medium if a wall side was assumed symmetric); diverge >5% → low but keep the internal
  value + flag. A bare footprint → medium (structural wall) or low (legend/one-sided wall).
- `computeBirdcage` (in engine.ts) then just sums the per-floor m² for the Strike total; TF has
  **no birdcage** (`NO_BIRDCAGE`).

Two shape sanity helpers (used by persist for flags): `pairBirdcageWidthWarning` (a rectangle
>0.7× the full frontage on a pair ⇒ the pair was reported, not one house) and
`cornerBirdcageWarning` (>4 corners must pair with a split birdcage).

### 7.4 Perimeter + configuration split — `computePerimeter`

```
front = Σ front  / dwellings      // frontage spans all dwellings → divide
rear  = Σ rear   / dwellings      // apartment block: dwellings = 1 (scaffolded whole)
gableLeft / gableRight / other = summed (NEVER divided)
```

By configuration:

- **DETACHED**: walls = front+rear+gableLeft+gableRight+other; corners = cornerCount ?? 4.
- **SEMI_DETACHED / END_TERRACE**: 3 sides = front+rear+**exposed gable**+other. The exposed
  gable is the one the drawing says is **not** the party wall (`gableBasis="party"`); if the
  drawing doesn't say, keep the **longer** gable (`gableBasis="size"`, flagged). corners =
  max(2, cornerCount−2).
- **MID_TERRACE**: 2 sides = front+rear (both gables are party); any `other` external wall is
  still included (flagged irregular). corners = max(0, cornerCount−4).

```
perLiftM = round3(walls + corners × cornerAllowanceM)      // cornerAllowanceM = 1.0
totalM   = perLiftM × lifts        // what Strike is keyed with
```

### 7.5 Apex — `computeApex`

Hipped roof → none. Otherwise each apex = 1 table lift + 1 apex handrail. **Config-aware
reduction**: front/rear/`other` apexes always count; the gable apex is reduced like the
perimeter gable (semi/end keeps the exposed gable's apex by party-wall flag, else the larger;
mid-terrace drops both gable apexes). An apartment block keeps every apex.

### 7.6 Height triangulation — `src/lib/extract/height.ts`

Reconciles the direct soffit read against the summed storey ladder. **H3 (confirmed)**: a
disagreement is flagged only when the two give a **different lift count**
(`ceil(h / liftHeight)`) — not on a fixed mm gap (a note is added if the raw gap >0.15 m but
the lift count still agrees). Confidence: both present & same lift count → high; different →
low; direct only → medium (low if outside the ~2.2–3.0 m/storey band); ladder only → medium.

### 7.7 Render, party walls, timber-frame adaptions, garage

- **Render** (`computeRender`): rendered LM (Σ segments) × `RENDER_LIFTS_BY_STOREY[storeys]`
  (2 m lifts). Null if not rendered.
- **Party walls** (`partyWalls`): Colin's simple rule — **1 unit** for every non-detached
  house type (mid-terrace is still 1, not 2), detached = 0. Priced as the inside-apex spec
  item; **traditional only** (TF has none — ⚠ confirm). A customer opt-out (`includePartyWall
  = false`) zeroes it.
- **Timber-frame adaptions** (`computeAdaptions`): LM per adaption lift + apex as its own unit.
  `adaptionLifts = totalLifts − (2.5-storey ? 1 : 0)`. `insideBoardLM = perLiftM × n`;
  `hopUpLM = perLiftM × (n−1)` (first lift is the kicker); `apexInsideBoardUnits =
  apexHopUpUnits = apexCount`. Traditional → `adaptions = null`.
- **Garage** (`src/lib/takeoff/garage.ts`): separate priced section; **no extracted geometry**
  — quantities come from a per-type template (`GARAGE_TEMPLATES` for SINGLE/TWIN/CAR_PORT) with
  ⚠ **placeholder** defaults, always flagged. Not part of the drawing extraction.

### 7.8 Assembling engine input from stored data — `src/lib/takeoff/fromStored.ts`

`takeoffInputFromStored(measurements, walls, warnings, config, buildSystem)` maps the persisted
review data back into a `TakeoffInput`: birdcage floors from `BIRDCAGE_*_M2`; apex per face from
`warnings.elevations` (scaled to the editable `GABLE_QTY` total when a human edited it); render
from `RENDER_LENGTH` (or per-face, cleared if `rendered=false`); `dwellingsWide` from warnings
(falling back to the count implied by the structure form); `isApartmentBlock` from the
structure form; etc. This is what lets the review screen re-price live per configuration.

---

## 8. How house TYPE and CONFIGURATION are decided (detached / semi / terrace…)

Two distinct concepts:

- **Structure form** (`structure.form` on the extraction) — what the *drawing* shows, named by
  how many houses are joined: `DETACHED | PAIR_SEMI | THREE_BLOCK | TERRACE | APARTMENT_BLOCK`.
  Single source: `src/lib/structure.ts` (`STRUCTURE_FORMS`, labels, dwelling counts).
- **Configuration** (`DETACHED | SEMI_DETACHED | END_TERRACE | MID_TERRACE`) — a *plot's
  position in its block*, which is what the engine actually splits on.

The decision (`resolveConfiguration` in `structure.ts`, called by `persist.ts`):

1. Read the two gable ends' party status off the wall segments (`readPartyGables`): a gable is
   party if **any** segment on that side says so; external if one says external and none party;
   else unknown.
2. **Party walls lead** (the direct structural reading): 2 party gables → MID_TERRACE, 1 →
   SEMI/END, 0 → DETACHED.
3. **Asymmetric trust**: marking a gable party is a positive sighting; marking it `false` is
   weak ("I didn't see one"). So the party read may **add** attachment but never **remove** it —
   if it reports no party gable yet the form says attached, the form wins (flagged). (Regression
   guard from Bloor Sorley, 2026-09-23.)
4. The party count can't separate a **semi** from an **end terrace** (both have 1 party gable,
   take off identically), so the **structure form** picks the label: terrace/three-block → END,
   else SEMI.
5. Only DETACHED and PAIR_SEMI are `certain: true`. A three-block/terrace defaults to
   END_TERRACE with `certain: false` (a human must set the middle plots to mid). An unreadable
   or low-confidence form → `certain: false`. Nothing is ever a silent guess.

The engine also independently derives `drawingConfig` from the party gables and **flags** when
it disagrees with the configuration the take-off is set to.

---

## 9. The playground boundary — what to change vs what to keep

**CHANGE (the model layer):**
- `SYSTEM_PROMPT`, `USER_INSTRUCTION` (`prompt.ts`) — the main lever.
- The Zod field **descriptions** in `schema.ts` (they ship inside the tool schema, so they're
  prompt too) — but keep the **shape** stable, or the deterministic layer can't consume it.
- Model choice + settings: model id, `max_tokens`, temperature (non-Anthropic), Gemini
  `mediaResolution`/thinking, caching. Bump `PROMPT_VERSION` on any wording change so runs stay
  comparable.
- Whether/how the two hints are built (`buildDimensionHint`, `buildWallLegendHint`) — these are
  deterministic *inputs to the prompt*, fair game to experiment with.

**KEEP AS-IS (the deterministic layer) — run it unchanged to score a prompt:**
- Post-processing: `persist.ts` logic (or the offline equivalent), `dimensions.ts`
  verify/reconcile, `houseTypeIdentity.ts`.
- Geometry + rules: `birdcage.ts`, `height.ts`, `engine.ts`, `structure.ts`, `fromStored.ts`,
  `garage.ts`.
- The Zod schema **shape** and the enums.

**How to score a prompt.** Feed the model JSON through `birdcage.ts` + `height.ts` + `engine.ts`
(via `buildTakeoff`) and compare the resulting take-off line to Colin's handwritten numbers
(§11). Secondary signal: how many §6.1 cross-check flags fire.

---

## 10. Offline runner (the ready-made reference harness for the playground)

`scripts/offline-extract.mts` already does exactly what the playground needs, on the command
line, using the **same production modules**:

```bash
npx tsx scripts/offline-extract.mts <NAME>     # <NAME> resolves to a PDF in the gitignored data set
```

It calls `extractDrawing(pdf)`, then runs `computeBirdcageFloor`, `computeHeight`,
`resolveConfiguration`, `buildTakeoff`, `makeDimensionVerifier` — the identical deterministic
stack — and prints the take-off line. There is a timber-frame variant `scripts/tf-extract.mts`.
This is the cleanest starting point: wrap it so it accepts an arbitrary PDF + a swappable prompt
string and prints (a) the raw JSON, (b) the derived take-off, (c) the fired flags.

`toEngineInput(result, config)` in that script shows the exact mapping from `ExtractionResult`
→ `TakeoffInput` (mirrors `fromStored.ts`).

---

## 11. Validation data (score prompts against these)

Colin's handwritten take-off sheets + matched drawings live in `colin-data/` and the Oadby/Bloor
golden set in `data/` — **both gitignored (client PII), never commit/publish**. Confirmed
targets the engine already reproduces:

- **Dekker** semi 20.56 / mid 10.66 (Colin's sheet: 20.5 / 10.6)
- **Rosewood** 48.5 exact
- Timber-frame lift table (Laura): 4.8 m → 3, 6.5 m → 4, 5.5 m (2.5-storey) → 4
- Timber-frame adaptions: `computeAdaptions(20.83, 3, 1)` → inside-board 62.49 LM, hop-up 41.66 LM, +1 apex unit

Wall-thickness is **per-drawing** (Miller 328, NSS 302, Augusta 392) — a good prompt must read
it, never assume. Per-house-vs-pair birdcage widths validated: SM1 6873, Kilburn 4800,
Sinclair 4250 (see the worked examples baked into the prompt, §4.1).

---

## 12. File map (everything in scope)

**Model layer (playground changes):**
| File | Role |
|---|---|
| `src/lib/extract/prompt.ts` | `SYSTEM_PROMPT`, `USER_INSTRUCTION`, `PROMPT_VERSION` |
| `src/lib/extract/schema.ts` | Zod `ExtractionResult` = the JSON contract + `lowLevelQty` |
| `src/lib/extract/extractDrawing.ts` | assembles the call (hints + PDF), validates output |
| `src/lib/extract/config.ts` | `EXTRACTION_MAX_TOKENS`, pricing |
| `src/lib/extract/claude.ts` | the Anthropic tool-use request (caching, forced tool) |
| `src/lib/extract/providers/{index,catalog,types,anthropic,gemini,openai}.ts` | multi-provider routing + adapters |

**Deterministic pre-processing (keep):**
| `src/lib/extract/classify.ts` | pdfjs page reader + dimension/legend text extraction (worker-only) |
| `src/lib/extract/classify-rules.ts` | pure page-classification keyword logic |
| `src/lib/extract/dimensions.ts` | dimension hint, verifier, role reconciliation, wall-legend parse/hint |

**Deterministic post-processing + engine (keep):**
| `src/lib/extract/persist.ts` | model JSON → measurements + walls + warnings/flags |
| `src/lib/extract/birdcage.ts` | internal-area geometry + confidence |
| `src/lib/extract/height.ts` | soffit-height triangulation |
| `src/lib/extract/houseTypeIdentity.ts` | house-type name/code resolution |
| `src/lib/structure.ts` | structure forms + configuration resolution (detached/semi/terrace) |
| `src/lib/takeoff/engine.ts` | the take-off rules (lifts/perimeter/apex/render/party/adaptions) |
| `src/lib/takeoff/fromStored.ts` | stored data → `TakeoffInput` |
| `src/lib/takeoff/garage.ts` | garage template take-off (placeholder quantities) |

**Orchestration / harness:**
| `src/worker/index.ts` | `handleExtract` — the production per-house flow |
| `scripts/offline-extract.mts`, `scripts/tf-extract.mts` | CLI harness using the same modules |

**Deeper reference docs (in repo):** `docs/13-extraction-playbook.md` (single source the prompt
is generated from), `docs/11-takeoff-engine-spec.md` (confirmed rules + open questions),
`docs/12-extraction-prompt-reference.md`, `docs/18-timber-frame-implementation-plan.md`,
`docs/21-plot-list-and-configuration.md`, `docs/EXTRACTOR-COMPLETE-REFERENCE.md`.

**Env vars:** `ANTHROPIC_API_KEY`, `ANTHROPIC_EXTRACTION_MODEL` (default `claude-opus-4-8`),
`OPENAI_API_KEY` + `OPENAI_EXTRACTION_MODEL` (default `gpt-5.6`), `GEMINI_API_KEY` +
`GEMINI_EXTRACTION_MODEL` (default `gemini-3.1-pro-preview`). The worker reads env at startup —
restart after changing.

---

## 13. Open questions that must come from Colin (do NOT let the prompt guess these)

From `docs/11 §8`. Build hooks and flag; never assume:
- `liftHeightM = 1.5` is called an "average" — is it constant? (⚠ open)
- Full render-lift-by-storey table (only partial is confirmed).
- The real per-builder storey→lifts template (the `STANDARD` table is a Miller fallback).
- Birdcage internal-vs-derived sign-off tolerance (currently 5%).
- Apartment birdcage basis, 4-plot apportionment, garage standard quantities.

**Resolved (already in the engine):** corner allowance = **1 m per external corner**; height
datum = **soffit / U/S wallplate**; birdcage wall read **per-drawing** (structural face, legend
as flagged fallback, never a default); stage splits 50/25/25 (bungalow 65/10/25).
```
