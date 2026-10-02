# 23 · Construction Extraction Playbook — how the model (and the code) read a construction pack

**What this is.** The construction twin of `docs/13` (the house-build extraction playbook):
the single, authoritative guide to reading a construction tender pack. For every
measurement it says **what it is → why we need it (which picking-list items it feeds) →
which sheet it lives on → what code reads deterministically → what the vision model reads →
the exact arithmetic the engine does → the cross-checks → the edge cases → the confidence**.
It also covers the upstream stages the reading depends on — **upload, junk removal, the
sheet register, grouping by building, relevance** — and the downstream split between the two
job modes (**with a scope** / **without a scope**).

**Who reads it.** The team, *and* the model. The construction prompts and tool schemas
(`src/lib/construction/*Prompt.ts`, `*Schema.ts`) must be **distilled projections of this
document**, exactly as `src/lib/extract/prompt.ts` is of docs/13. When this doc changes, the
prompts are re-synced and their `PROMPT_VERSION` bumped (§19).

> **2026-10-02 b — scenarios now come from three upload boxes** (Scope · Drawings · Email; docs/22
> "As built 2026-10-02 b"). In **Scenario 1** (a scope was uploaded) the drawings are NOT read:
> the client's numbers are used as given, so this playbook's drawing reading applies to
> **Scenario 2** (drawings, no scope) only. "Mode A / B / C" below = Scenario 1 / 2 / 3.

**Status (2026-09-30): readers + engine BUILT for Milestones 1–2** (see §20 for what the real
packs showed). Originally written as a spec; It supersedes the single Wren-shaped reader
contract of `docs/20 §5` (which stays as the MARKED-UP sheet reader, §12.6). The pipeline
plan and build order are `docs/22`. Every value that must come from Colin is marked
**⚠ PARAM** with the placeholder we use until he answers (§16) — a placeholder is always
**flagged in the review**, never silently applied.

**Evidence base (all gitignored client data; every number quoted below was checked against
the files on 2026-09-30):**

| Fixture | Folder | What it is |
|---|---|---|
| **Wren Park** | `data/construction/eg-01/` | detailed enquiry: email + A1 vector drawings + a **marked-up measure sheet with the numbers written on** + the client's schedule (quantities given) |
| **Murray Park** | `data/construction/eg-02/` | vague: email + raster (no text layer) plans + a .pptx logistics plan + **our quote** `Quote-1375-1-1.pdf` |
| **King Edward VI College (CN215)** | `data/construction/BSN Group/…` | full architect's set (55 files incl. 2 `.DS_Store`; 36 drawing sheets, A1 vector 1:50) + a client schedule with **item names + hire weeks but every quantity blank** |
| **CBAND Banbury** | `data/construction/CBAND Banbury/` | Bovis Homes drawings (A2/A3 vector 1:50) for **two buildings** + the **client's colour mark-up** (.pptx + raster PDF, no numbers) + **our quote** `Quote-1350-1-2.pdf` (£37,407.05) |
| Stanmore scope | `cons-data/50172_Scaffold Scope_Rev.1.xlsx` | a real 37-row scope of works (columns incl. dimensions, height, hire duration) |
| Picking list | `cons-data/picking list.xlsm` | Airwright's master item list (imported, currently retired in favour of the dev seed) |

---

> **2026-10-02 — simplified (supersedes the measurement list below where they differ).**
> Only RELIABLE values are filled automatically: printed + read by code, and for shape-dependent
> values two drawings must agree — heights of each part → lifts / band; a plain rectangle's
> perimeter + 4 corners when the roof plan (or another floor) confirms the plan's printed size;
> main gables when the roof plan and the elevations agree; printed clear heights and room areas as
> sources to pick from; numbers written on a mark-up. Anything weaker is a HINT, never filled.
> The rest (§9 B3–B4, C1/C3, D2, E, roof edges, non-rectangular outlines) is measured by the
> estimator with the measuring tool on the section cards. Trust levels: Checked · Printed ·
> Measured by you · Entered by you · Client's figure · Not set. P5, P5b, P10–P14 are retired.

## 0. The doctrines (every prompt and every engine function obeys these)

**D1 · Observe, don't price.** The model reports *facts on the drawing* — printed numbers,
labels, counts, and *shapes* (which walls, which rooms, which gables) — each with
**confidence + provenance**. It never outputs a lift count, a total, a band, a rate, a price.

**D2 · Report the printed value AND the raw parts behind it; the engine derives.** If a
drawing prints both a total and the pieces (an overall dimension and a wall-thickness chain),
the model reports **both** and stops. The engine subtracts, multiplies, sums and reconciles.
**The model does no arithmetic — not even a subtraction.** The only conversion it may do is
units (mm → m, ÷1000), and it keeps the exact printed string beside the converted number.

**D3 · The model names the shape; code measures it.** The model's strength is spatial
reading ("the outline steps in between these two walls", "the blue band covers the north and
east walls"). Its weakness is adding thirty small numbers. So the model returns **topology**
(an ordered list of wall segments, each tied to the printed dimension that gives its length,
or to grid lines) and **the engine** computes lengths, perimeters, areas and corner counts —
and checks the shape **closes** (§9.B1).

**D4 · Printed beats measured beats estimated.** Order of trust for any length:
1. **printed** on the drawing (text layer, verified post-hoc) → high;
2. **computed by code** from printed dimensions (chains, grid spacings) → high/medium;
3. **measured by code** from positions at the printed scale → medium, **cross-check only**
   where a printed value exists — both KE ("Do not scale from documents") and Bovis ("Do not
   scale from this drawing. Use written dimensions only.") say not to scale;
4. **estimated by the model** from the image → low, always flagged;
5. **blank + "measure by hand"** — never a silent default.

**D5 · The scope decides WHAT; the drawings decide HOW MUCH.** (Ben: price exactly what is
asked — no more, no less.) With a scope, only scope lines are priced; anything the drawings
show that the scope did not ask for is **information**, never a line. Without a scope, the
model produces **measurements only** — no lines, no items chosen (§3).

**D6 · The drawing is the source of truth for quantities; the client's number is a
double-check.** When a scope states a quantity (a QS "call-off"), the engine compares it to
the drawing-derived value and **flags** a difference beyond tolerance, keeping the drawing
value (Colin: "find Lift 02, count the entrances, confirm it's 3 not 4").

**D7 · Account for everything.** Every file, every sheet, every scope line and every
requested measurement ends with a status: *read · derived · context · not relevant · junk ·
duplicate · failed · needs a human*. Nothing is dropped silently. Relevance filtering may only
**rescue**, never quietly remove.

**D8 · Never invent.** No invented picking-list item, no invented feature, no invented
dimension. Absent → absent (empty array / null + `unknown`).

**D9 · Open values are parameters, not guesses.** Everything Colin hasn't confirmed is a
named ⚠ PARAM with a placeholder (§16), editable per job, and every line that used a
placeholder carries a visible flag.

---

## 1. Glossary — every word the model and the engine use

The model is given the relevant part of this glossary in its system prompt. Definitions are
plain-English and exact; where a term differs between drawing-land and scaffold-land, both
are stated.

### 1.1 Drawing vocabulary
| Term | Meaning (what to look for) |
|---|---|
| **Sheet / drawing** | one page of a drawing set, identified by its **title block** (bottom-right box): drawing number, title, revision, scale, status, project. |
| **Drawing number** | the sheet's id. Architects number by series, e.g. KE `2591.1100` (plans 1100s, elevations 1200s, sections 2000s, site 1000s); Bovis `CBAND-BOV-CCH01-GF-D2-A-AS-0201` (fields include the project `CBAND`, the originator `BOV`, the **building code** `CCH01`/`CSH01`, the level `GF`/`RD`/`XX` and the sheet number `0201`). |
| **Revision** | the sheet's version (`T8`, `T9`, `_07`). Only the **latest** revision of each drawing number is read. |
| **Status** | "For Tender", "For Construction", "For Information" — metadata, not a reason to exclude. |
| **Scale** | "1:50 @ A1", "1:100", "NTS" (not to scale). At 1:50 on A1, 1 pt on the page = 17.64 mm on site. NTS → never measured. |
| **Text layer** | the selectable text in a vector PDF — every label and dimension, with its page position. A **raster** sheet (a scan, a "Print to PDF" image) has none. |
| **GA plan / floor plan** | a horizontal cut through one storey: walls, doors, rooms, dimensions. One per level (GF, 1F/FF, 2F/SF…). |
| **Roof plan** | the roof seen from above: outline, gables/hips, parapets, gutters, rooflights, hatches, plant. |
| **Elevation** | a face of the building seen straight on (North/East, Front/Rear/Side): heights, level markers, roof shape, openings. |
| **Section** | a vertical cut (A-A, B-B, "Long", "Through stairs"): floor-to-floor heights, ceiling heights, roof build-up, pitch. |
| **Site / location / compound / logistics plan** | the building in its surroundings: roads, pavements, site boundary, compound, deliveries, ground levels. |
| **Grid lines** | the lettered/numbered reference lines (A–F × 1–7 on KE) with bubbles at their ends; walls and columns sit on or off them. |
| **Dimension line / chain** | a line with ticks and a number between each pair of ticks. A **chain** is a row of consecutive dimensions along one line; an **overall** is the single outermost dimension spanning the whole side. |
| **Running / setting-out dimension** | dimensions measured from a fixed origin — less common; report as printed. |
| **Wall zone in a chain** | the short segment across a wall's thickness in a chain (`303 · 8360 · 303` → walls 303, internal 8360). |
| **Level marker** | a symbol + text giving a height: `+9.725 · 3 RF-Roof (87.875)` = 9.725 m above the project datum, level name "RF-Roof", absolute 87.875 m AOD. |
| **Datum / FFL / SSL / AOD** | the zero for heights. **FFL** finished floor level (KE GF ±0.000 = 78.150 AOD); **SSL** structural slab level; **AOD** height above sea level. |
| **DPC** | damp-proof course, ~150 mm above ground. Bovis heights are printed **from DPC** ("3300 DPC TO U/S SOFFIT"). |
| **Soffit / U/S soffit** | the underside of the roof overhang at the eaves. **The house-build height datum** (docs/11, confirmed). |
| **Wallplate** | the timber on top of the wall the roof trusses sit on ("3750 DPC - TOP OF WALLPLATE", "O/A WALLPLATE 8560"). |
| **Eaves** | where a pitched roof meets the wall top. **Ridge** = the roof's top line. **Pitch** = roof angle (40°, 35°). |
| **Gable** | a wall end that rises to a triangular point (the **apex**) under a pitched roof. **Hip** = a roof slope instead of a gable (no apex). |
| **Parapet / coping** | a wall rising above a flat roof's edge (KE +11.575 "Parapet"); coping = its cap. |
| **Spot level** | a height point on a site plan or survey ("S002 78.838", "78.850 (+700)" = 78.850 AOD, 700 mm above FFL). |
| **Core / shaft / riser** | vertical service zones: **stair core**, **lift shaft** (plus pit below and overrun above), **riser** (service duct through floors, "Shaft 3 Riser 2"). |
| **Void / opening** | a hole through a floor slab (stair, lift, riser) — its edges need protection during construction. |
| **Precast plank / slab edge** | precast concrete floor units; the **slab edge** is the building's outer floor edge at each suspended level; the **leading edge** is the moving edge while planks are laid. |
| **LV pit** | low-voltage electrical pit ("LV" label) — edge protection around its perimeter. |
| **Upstand** | a raised concrete edge (e.g. ~0.8 m) people must climb over — needs an up-and-over stair. |
| **Mark-up** | colours/notes added **on top of** a drawing by a person (client or estimator) to show where scaffold goes. Wren: blue/red/green with numbers; CBAND: blue band + orange fill, no numbers. |

### 1.2 Scaffold vocabulary (the picking-list side)
| Term | Meaning | Priced as |
|---|---|---|
| **Lift** | one boarded working level of scaffold; **lift height** = vertical spacing between lifts. | multiplier on per-lift items |
| **Independent scaffold / working platform** (Strike "ConInscaff") | freestanding scaffold alongside a wall, tied to the building. | m **per lift** |
| **Additional boarded lift** ("lifts at each level") | boarding more lifts than the working one. | m per lift ⚠ |
| **Table lift** | an extra partial lift built at a **gable** to reach the apex. | per gable (house-build rule) |
| **Apex handrail** | the handrail following a gable's slope at the top. | per gable |
| **Low-level independent** | a short scaffold for a lower part of the building (low eaves, porch). | m or nr ⚠ |
| **Handrail: single / double / triple** | rails along an open edge. **Double + toe board** = the standard; **triple** = roof / building edge default; **single** = only where an obstruction blocks a double. | m |
| **Toe board** | board at the platform edge (part of a standard double). | included / m |
| **Birdcage / crash deck** | internal scaffold filling a room to give a deck at ceiling height. | m² **per lift** |
| **Internal independent** | an independent scaffold inside a room, along its walls (CBAND vaulted hall). | m per lift |
| **Ladder tower / ladder access bay** | a scaffold bay with ladders between lifts (access or emergency exit). | nr per lift |
| **Haki stair tower** | a proprietary staircase access tower. | nr **per lift** |
| **Loading bay** | a strengthened bay for landing materials (3.6 × 2.4 grid). | nr **per lift** |
| **Loading bay gate** | the gate at a loading bay's edge. | nr |
| **Lift gate ("Safegate")** | a gate at a lift-shaft entrance — **one per entrance per floor**. | nr |
| **Slab edge / leading edge / void protection** | edge protection at floor edges, the moving precast edge, and slab openings. | m |
| **Roof edge protection** | handrail around a roof edge — **triple by default** (calls). | m |
| **Scaffold mat / dummy lift** | a temporary first lift enabling a 2.7 m "walking lift" (schools, public streets). | nr |
| **Foam** | padding on uprights at doorways, fire exits, walk-unders. | nr — **information only unless the scope asks** |
| **Inspection** | the statutory weekly inspection. | per week |
| **Hire period / extra hire** | the weeks included in the price / the weekly charge beyond. | per line |
| **Height band** | rate bracket by height: ≤6 · 6–12 · 12–18 · 18–24 · 24–30 m. | selects the rate |
| **Commercial band** | H / M / C / SC (high → competitive) — Colin's choice per job. | selects the rate |
| **Call-off** | the client QS's own quantity in the scope ("45 LM", "20 LM × 2 pits"). | cross-check only |

---

## 2. What a construction pack actually contains (and what the four fixtures prove)

| | Wren | Murray Park | King Edward | CBAND |
|---|---|---|---|---|
| Buildings | 1 | 1 (block F) | 1 | **2** (Community Hall, Sports Pavilion) |
| Written scope | email prose + **schedule with quantities** | thin email | **schedule, quantities blank**, hire per line | **none** |
| Mark-up | **yes, with numbers** | .pptx logistics plan | none | **yes, colours only** (by the client) |
| Drawings | A1 vector, text layer | A4 **raster**, no text | 36 sheets, vector 1:50 (35 × A1 + 1 × A3) | 16 × A2/A3 vector 1:50 |
| Grid lines | — | — | **yes** (A–F × 1–7) | **no** (house-builder style) |
| Our quote in the folder | no | yes | no | yes |
| Hard part | trusting the mark-up | nothing measurable | everything derived, multi-sheet | per-building grouping, mark-up without numbers |

**Consequences for the design:** (1) there is no single "construction drawing" style — some
packs have grids, some don't; (2) a job can hold **several buildings**; (3) the scope can be
prose, a filled schedule, a blank schedule, a coloured mark-up, or absent; (4) raster packs
exist and must degrade to "measure by hand".

---

## 3. The two modes (and how the mode is chosen)

| Mode | Trigger | Output | Who picks the items |
|---|---|---|---|
| **A · Scope** | a readable scope exists: a schedule/scope spreadsheet, a written scope in an email or document | **draft lines** (picking-list item + quantity from the drawings + lifts + band + hire weeks, each with formula + provenance) **+ the measurement sheet** | the scope (mapped by AI via aliases), confirmed by Colin |
| **B · Measure** | no written scope, vector drawings present (a colour mark-up counts as *where*, not *what*) | **the measurement sheet only** — no lines | Colin, from the picking list, using "use this measurement" |
| **C · Manual** | no scope and no measurable drawings (raster / photos only) | labels the model can read + "measure by hand" | Colin |

Mode is **detected** from the register (§5) and shown on the job ("Scope found: CN215
Scaffold Schedule.xlsx → Mode A"); Colin can switch it. **Both A and B run the same
measurement pipeline** — the building model is always built; mode A adds the mapping and
fusion on top.

---

## 4. Who does what — the ownership table

| Stage | Deterministic code | Vision / language model | Human |
|---|---|---|---|
| Upload, unzip, junk, duplicates | ✅ all | — | override |
| Title block, revision, kind, level, scale | ✅ from text layer + file name | fallback when unreadable | override |
| Grouping sheets into buildings | ✅ codes / folders / titles | ✅ text-only fallback when ambiguous | override |
| Relevance | ✅ rules | ✅ rescue-only triage (text) | override |
| Levels, dimension strings, labels, room areas, spot levels, grid positions | ✅ text layer + positions | — | — |
| Which walls form the outline; which rooms/walls a mark-up covers; gables; cores; openings; entrances | — | ✅ (with the text-layer strings as hints) | review |
| Lengths, perimeters, areas, corners, closure, heights, lifts, band | ✅ engine | — | confirm |
| Scope → picking-list mapping | — | ✅ (text) | confirm |
| Quantity per scope line, cross-checks, flags | ✅ engine | — | confirm |
| Items without a scope, judgement calls (towers, table lifts, which gables) | — | — | ✅ Colin |
| Price | ✅ `price.ts` | — | confirm |

---

## 5. Upload, sorting, grouping — and how it differs from house-build

### 5.1 What is the same as house-build (reuse, don't rebuild)
- **Folder-first resumable upload** (`src/lib/upload/plan.ts`: `isUploadableName`,
  `isArchiveName`, `normalizeRelativePath`) with signed direct-to-Storage uploads; zips unpacked.
- **Revision parsing + latest-rev selection** (`src/lib/ingest/parsePath.ts`: `parseRevision`,
  `revisionStrippedKey`).
- **Title-block reading + kind classification** (`src/lib/extract/classify-rules.ts`:
  `drawingTitle`, `classifyTitle`), extended with construction kinds (§5.4).
- **Rescue-only LLM relevance triage** (`src/lib/ingest/relevanceTriage.ts` pattern: text only,
  batches ≤ 10, account-for-every-page).
- **Canonical-role dedup** (docs/17 §5.1): one sheet per role per building; elevations never collapsed.
- **Background jobs** on the pg-boss worker, stored raw outputs reused on retry.

### 5.2 What is different
| House-build | Construction |
|---|---|
| groups files into **house types** (many plots each) | groups sheets into **buildings / areas of one job** (CBAND: Hall + Pavilion) — no plots, no bank |
| relevant = elevations, plans, sections, setting-out | relevant = plans **per level**, roof plan, elevations, sections **+ context** sheets (site, compound/logistics, survey) + **mark-ups** + **scope documents** |
| the scope is implicit (the house type) | the **scope is a document** (spreadsheet / email / mark-up) and decides the mode |
| no "answer" files | **our own quote** (`Quote-NNNN-*.pdf`) may be in the folder → held back from the AI by default (it can serve as an evaluation answer key, never as input) |
| pptx rare | **.pptx mark-ups are common** (CBAND, Murray Park) — must be read |
| emails rare | **.eml enquiry emails** carry the prose scope (Wren) |
| multi-page combined PDFs assembled per type | **no assembly**: sheets are read individually, the building model fuses them |

### 5.3 The junk & duplicate filter (deterministic, tested)
Mark and never read (shown collapsed, reversible):
- software backups: `*.~qsbak` (KE: 9 files), `*.bak`, `~$*`, `.~lock*`; OS files: `.DS_Store`, `Thumbs.db`;
- **byte-identical duplicates** (content hash): CBAND `hall side elevation.pdf` = `…0402_Side Elevation…_04.pdf`;
- stray CAD image assets: a loose raster image inside a drawings folder that has **no drawing
  number, no title block and no text** (KE: EV-charger picture, tree texture, glazing-regs
  clipping) → `JUNK`; a photo at the top level of the enquiry is **not** junk (site photo → reference).

### 5.4 The sheet register (one row per page)
`building · drawingNo · title · revision · kind · level · face · scale · paper · hasText ·
bucket · reason · source file/page`.

**Kinds:** `PLAN` (with level: GF/1F/2F…/B1) · `ROOF_PLAN` · `ELEVATION` (with face) ·
`SECTION` · `SITE_PLAN` · `LOGISTICS_PLAN` (compound, traffic, CDM) · `SURVEY` (existing
site / topographic) · `MARKUP` (a person's colours/notes over a drawing) · `SCHEDULE` (door,
window) · `DETAIL` · `FINISHES` (floor, ceiling) · `FURNITURE` · `SPEC` (NBS, specification)
· `SCOPE` (spreadsheet / document listing scaffold items) · `EMAIL` · `OUR_QUOTE` · `PHOTO` · `OTHER`.

**Where each field comes from, in order:** text layer title block → file name
(`…_Ground Floor Plan_For Construction_07.pdf`: title + revision) → folder name
(`1100 Proposed Floor Plans`, `Community Hall`) → the model (text-only, for leftovers).

**Buckets:**
| Bucket | Kinds | Sent to vision? |
|---|---|---|
| **CORE** | PLAN, ROOF_PLAN, ELEVATION, SECTION, MARKUP | ✅ |
| **CONTEXT** | SITE_PLAN, LOGISTICS_PLAN, SURVEY | text layer only (vision only if raster and nothing else describes the site) |
| **SCOPE** | SCOPE, EMAIL | text reader |
| **REFERENCE** | PHOTO, OUR_QUOTE, unreadable (pptx with no mark-up) | shown only |
| **NOT RELEVANT** | SCHEDULE, DETAIL, FINISHES, FURNITURE, SPEC, OTHER | ❌ (door schedule may be text-read for foam counts **only if the scope asks for foam**) |
| **JUNK / DUPLICATE** | §5.3 | ❌ |

KE check (by hand, 2026-09-30): 55 files → 11 CORE (GF/1F/2F/roof plans, 4 elevations, 3
sections) · 3 CONTEXT (existing site, proposed site, compound) · 1 SCOPE (CN215 schedule) ·
the issue sheet (register, text-only) · 23 NOT RELEVANT PDFs (finishes, ceilings, furniture,
door/window schedules, details, the Ibstock sheet, the NBS spec) · 16 JUNK (9 backups, 5 loose
images, 2 `.DS_Store`) — 11 + 3 + 1 + 1 + 23 + 16 = 55. CBAND: 16 CORE drawings + 2 MARKUP (+ 2 .pptx sources) · 1 DUPLICATE
· 1 OUR_QUOTE.

### 5.5 Grouping sheets into buildings (new for construction)
Deterministic signals, strongest first:
1. **A building code in the drawing number / title block** (CBAND `CCH01` = Community Hall,
   `CSH01` = Sports Pavilion; the title block's house-type field reads "Community Hall").
2. **Folder names** (`Community Hall/`, `Sports Pavillion/`).
3. **A shared grid system / drawing-number series** (all KE `2591.*` sheets share A–F × 1–7).
4. **The title's building words** ("Block F", "Sports Pavilion").

If signals disagree or are missing → a **text-only AI grouping call** (the docs/17 recipe
pattern, cheap model) proposes buildings; the estimator confirms. A single-building pack
(Wren, KE) skips grouping entirely (the docs/17 §5.2 fast path).

### 5.6 Mark-ups (.pptx and marked PDFs)
- **PDF mark-up with numbers (Wren):** CORE → the MARKUP reader (§12.6); its numbers are the
  answer and still cross-checked against the plan.
- **.pptx mark-up (CBAND, by the client):** unzip; read slide text ("Internal & external
  scaffold", "Internal Crash Deck"), the embedded plan image and the **vector shapes**
  (free-form shapes with position, size and fill colour, in EMU). v1: composite the shapes
  onto the image (`sharp`) or use the client's PDF export, and send **with the matching vector
  plan** to the model, which states which walls / rooms the colours cover in the plan's own
  terms (§9.B4, §9.D1). The lengths/areas are then measured on the **vector plan**, never on
  the raster screenshot. (v2: register the shapes to the plan and measure them directly.)
- A mark-up never chooses items; it says **where**.

### 5.7 Hold-backs
- **Our own quote** (`looksLikeOurOwnQuote`, e.g. `Quote-1350-1-2.pdf`) is never sent to a
  model; it is shown as reference and, for fixtures, used as the evaluation answer key.
- A **client's** schedule is an enquiry document and **is** read (docs/19 §2 correction).

---

## 6. Deterministic text-layer extraction (no AI) — `sheetGeometry`

Runs on every CORE and CONTEXT sheet with a text layer. pdfjs gives each text item a string,
a position (x, y in pt), a rotation and a height. From those:

| Output | How | Real examples + parsing gotchas |
|---|---|---|
| **Scale** | title block regex `1\s*:\s*(\d+)(\s*@\s*A\d)?`; `NTS`/`Varies` → no scale | KE "1:50 @ A1"; CBAND "1 : 50" |
| **Level table** | level-marker regex: signed metres + level name + optional AOD in brackets | KE `+9.725` · `3 RF-Roof (87.875)`, `±0.000` · `0 GF-Ground Floor (78.150)`, `+11.575` · `4 Parapet (89.725)`, `-0.900` · `-1 F1-Foundation` |
| **Printed heights (house-builder style)** | regex `(\d{3,5})\s*(DPC\|FFL)\s*(TO\|-)\s*(U/S\|UNDERSIDE\|TOP)…` | CBAND `3300 DPC TO U/S SOFFIT`, `3300DPC TO UNDERSIDE OF SOFFIT` (**no space**), `3750 DPC - TOP OF WALLPLATE`, `4882 FFL - FCL`, `2990 Floor to ceiling`, `O/A WALLPLATE 8560` |
| **Pitch** | `(\d{1,2}(\.\d+)?)°` near a roof | CBAND `40°`, `35.00°` |
| **Dimension strings** | integers 3–6 digits, optional thousands comma, with position + orientation (horizontal/vertical); reuse `extractDimensionsByPage`, `dimRuns`, `makeTokenMatcher` | KE `28,903` style commas; CBAND `6560WALLPLATE` (number **glued** to a word — split it) |
| **Dimension chains** | group dimension strings sharing a line (same y ± 2 pt for horizontal, same x for vertical) into ordered chains; the **outermost** chain on each side is the overall | CBAND pavilion: `20793` at the top and bottom edges (outermost), `8965` on both outer sides; inner chain `303 · 8360 · 303` |
| **Grid system** | single letters/digits in large text at the sheet edges, paired top/bottom or left/right; the line coordinate = the bubble's position; spacing checked against the printed chain between bubbles | KE: grid A→F measured **28,910 mm** from bubble positions at 1:50 vs printed chain **28,903 mm** (7 mm, 0.02%) |
| **Room labels + areas** | a room name followed by `CA:` / `Area` and a number; **the ² arrives as a separate text item** (`50.467 m` + `2`) | KE `Classroom 01 · CA: · 50.467 m · 2`; `Stair Core · CA: · 34.753 m · 2` (2F) |
| **Feature labels** | dictionary + regex: `LIFT SHAFT`, `Lift 0n`, `Stair Core`, `Escape Stair`, `Shaft n Riser n`, `Riser`, `LV`, `Loading Bay`, `ACCESS HATCH`, `ROOFLIGHT`, `FIRE EXIT`, `Parapet`, `GUTTER`, `Plant` | KE 2F `Shaft 1 Riser 3`, `Shaft 5 Riser 2`; CBAND `FIRE EXIT` ×3 (hall GF) |
| **Spot levels** | `\d{2,3}\.\d{2,3}` (AOD) optionally with `(±nnn)` relative to FFL | KE proposed site `78.850 (+700)`, `79.000 (+850)`, and **`77800 (-350)` printed without its decimal point** → parse by the bracket (−350 mm vs FFL); existing survey `S002 78.838` |
| **Wall thickness legend** | "DENOTES nnn MM THICK CAVITY WALL" | CBAND `327.5MM THICK CAVITY WALL` (legend — finished face) vs `303` in the plan chains (structural) |
| **Datum notes** | keep verbatim; they change what a dimension means | CBAND "ALL DIMENSIONS ILLUSTRATED ARE TAKEN TO BLOCKWORK FOR MASONRY WALLS…"; "Do not scale from this drawing" |

Everything here is **pure, tested and free**. It is given to the model as the sheet's
candidate list (the docs/20 §3 hint), and used by the engine to **verify** every string the
model cites (§14).

---

## 7. The reading order (per building)

1. **Identity & sheets** — which building, which sheets, which levels, scale, datum notes.
2. **Levels & heights** — the level table (sections/elevations), eaves/soffit/parapet/ridge,
   pitch, internal ceiling heights.
3. **Ground** — ground level along each face (elevations' ground line, site plan / survey).
4. **Outline (footprint)** — GF plan first; the ordered wall segments with their printed
   lengths; then each upper floor only where it differs (set-backs, overhangs).
5. **Faces** — which elevation shows which outline side (for per-face heights/lifts).
6. **Roof** — edge type per run (open / parapet / eaves), gables and their widths, access.
7. **Internal** — rooms and their areas/dimensions; which rooms the scope/mark-up points at.
8. **Cores, shafts, openings, entrances** — per level.
9. **Special features** — LV pits, precast stairs, level changes, upstands, loading-bay marks.
10. **Site context** — public road/pavement, school in operation, compound, deliveries.
11. **Mark-up** — which walls/rooms each colour covers; any numbers written on it.
12. **Confidence & notes** — unknowns as null/`unknown`; short notes only.

---

## 8. Sheet guide — which sheet carries what

| Sheet kind | Read for | Never read for |
|---|---|---|
| **GF plan** | outline + overall/chain dims, wall thickness chain, rooms + areas, cores, stairs, lift entrances, external doors / fire exits, grid | heights |
| **Upper floor plans** | per-level outline changes, slab openings (stair/lift/riser voids), lift entrances per floor, risers, rooms + areas | heights |
| **Roof plan** | roof outline, edge type (parapet / open / gutter), gables vs hips, lift overrun, hatches/ladders, plant | wall lengths when the plan prints them (the roof overhangs the wall) |
| **Elevations** | heights (level markers, DPC-to-soffit), ground line per face, roof shape, gable apex, parapet, which face is which | wall lengths (overhang over-reads) — cross-check only |
| **Sections** | floor-to-floor, internal ceiling heights (vaults), pitch, foundation, lift pit / overrun, stair flights | plan lengths |
| **Site / survey** | ground levels near each face, adjacency to public road / pavement | anything inside the building |
| **Compound / logistics** | public interface, deliveries, compound location, crane | quantities |
| **Mark-up** | where scaffold goes (walls, rooms), numbers if written | — |

---

## 9. The measurements — one entry each

Format: **What · Feeds · Where · Code reads · Model reports · Engine derives · Cross-checks ·
Edge cases · Confidence.**

### A · Heights and levels

#### A1 · Level table
- **What:** every named level with its height relative to the project datum (and AOD).
- **Feeds:** lifts, slab-edge levels, floor-to-floor, height band.
- **Where:** sections, elevations (level markers); CBAND-style packs have no level table —
  their heights are single printed dimensions (A2).
- **Code reads:** fully (§6 level regex). KE: GF ±0.000 (78.150) · 1F +3.225 (81.375) · 2F
  +6.450 (84.600) · RF +9.725 (87.875) · Parapet +11.575 (89.725) · Foundation −0.900.
- **Model reports:** nothing, unless the text layer is missing (then read the markers off the
  image, low confidence).
- **Cross-checks:** the same level must agree on every sheet (KE: identical on the North
  elevation and the Long section) → mismatch = flag.
- **Confidence:** high when text-layer read and consistent.

#### A2 · Wall-top height (eaves / soffit / wallplate / parapet top)
- **What:** the height the external scaffold must serve on each face: **pitched roof → U/S
  soffit** (the house-build datum, docs/11 confirmed); **flat roof → top of parapet** (⚠
  PARAM P2 — the parapet must be built from the scaffold).
- **Feeds:** external lifts, height band, Haki / loading-bay lifts.
- **Where:** elevations + sections. CBAND hall: `3300 DPC TO U/S SOFFIT` (main hall faces),
  `2550 DPC TO U/S SOFFIT` (a lower part — my reading: the wing); pavilion `2850`, lower parts `1650` / `1875`
  (side elevations). KE: Parapet +11.575.
- **Code reads:** the printed strings (§6), each with the sheet it came from.
- **Model reports:** **which face / part of the building each printed height belongs to**
  (e.g. "3300 → main hall, front and rear; 2550 → lower wing") — the one thing text position
  alone cannot say.
- **Engine derives:** per face (or per part), `wallTop` in metres above the heights' datum.
- **Edge cases:** Bovis heights are **from DPC**, not ground (≈ +0.15 m ⚠ PARAM P2b); several
  heights on one face (stepped eaves) → split the face into parts; never take the **ridge** as
  the scaffold height.
- **Confidence:** high (printed + face attribution corroborated by two sheets), medium (one sheet).

#### A3 · Ridge / apex height and pitch
- **What:** ridge height and roof pitch per roof part.
- **Feeds:** table lifts and apex handrails (gables), smart-roof style peaks.
- **Where:** sections, elevations (CBAND 40° hall, 35° pavilion).
- **Engine derives (if needed):** apex rise = half gable width × tan(pitch) — only as a check;
  table lifts come from the gable count (C2), not from this height.

#### A4 · Ground level per face
- **What:** the ground the scaffold stands on, along each face.
- **Feeds:** real scaffold height = wallTop − ground; the height band.
- **Where:** proposed site plan spot levels (KE proposed levels near the building range
  **−350 to +850 mm relative to FFL**), existing survey (KE existing spot levels across the
  site **77.37–79.14 AOD**, 176 spot levels), elevation ground lines. Note the two sources give
  different answers: proposed ground puts the parapet top 10.7–11.9 m above ground; the lowest
  existing spot level would give 12.36 m — the 6–12 / 12–18 band boundary.
- **Code reads:** spot levels + their positions; picks those within a few metres of each face
  (positions + scale). **Model reports:** only when levels are unlabelled on the image.
- **⚠ PARAM P2c:** which ground applies during construction (existing vs proposed), and
  whether to use the **lowest** level along a face (placeholder: lowest *proposed* level along
  the face; if none, FFL − DPC offset).
- **Confidence:** medium at best (ground varies along a face).

#### A5 · Internal clear height
- **What:** floor-to-ceiling (or to the underside of trusses / vault) per room needing internal scaffold or a birdcage.
- **Feeds:** internal independent lifts, birdcage lifts.
- **Where:** sections: CBAND hall `4882 FFL - FCL`, `4897 DPC TO U/S TRUSS`; pavilion
  `2990 Floor to ceiling`, `3005 DPC to u/s truss`; KE floor-to-floor 3.225.
- **Engine derives:** a **suggested** lift count only (⚠ PARAM P6 — no confirmed rule; see §15.2).

### B · Outline, perimeter and runs

#### B1 · The outline (footprint) — ordered wall segments
- **What:** the external wall line of each building at each level that differs, as a closed
  polygon.
- **Feeds:** independent scaffold, triple top rail, slab-edge protection, roof edge (when the
  roof outline equals the wall line), corners.
- **Where:** GF plan (outermost dimension chains); upper-floor plans only where they differ;
  roof plan as a check.
- **Model reports** (per level): a **clockwise list of segments starting at a named corner**:
  `{ direction: N|E|S|W|diagonal, length: {value, sourceDimension, sourcePage} |
  {fromGrid, toGrid}, face: "north"/"front"…, note }`. Rules the prompt states:
  - Take lengths from the **outermost** printed dimension on that side, or the chain that runs
    along that wall; for a step, the chain segment between the two corners.
  - Where the wall sits on grid lines and no printed length exists, give `fromGrid`/`toGrid`
    (KE: `C2 → D2`); the engine uses the **printed spacing chain between those bubbles**.
  - **Do not add numbers.** If a wall's length is only printed as pieces, list the pieces'
    strings in `sourceDimension` separated by `+` — the engine sums them.
  - **External face only** (the brick line), never an internal span; never off an elevation;
    never the roof overhang.
- **Engine derives:** segment lengths (m) → **closure check** (Σ east = Σ west and
  Σ north = Σ south, within P15 tolerance) → perimeter = Σ segments → external/internal
  corner counts from the turn directions → length per face.
- **Cross-checks:** closure; the outline's bounding size vs the overall chains (KE 28.903 ×
  17.990; CBAND pavilion 20.793 × 8.965); GF vs roof outline; grid-positions measurement (D4).
- **Worked shapes (my reading of the drawings — to be confirmed by the pipeline):**
  - **CBAND Sports Pavilion:** a rectangle 20.793 × 8.965 (outermost chains on all four
    sides; inner chain `303 · 8360 · 303` confirms the wall), perimeter **59.516 m**, 4
    external corners, plus a small front porch projection (its own `2775` wallplate) to
    add as extra segments.
  - **CBAND Community Hall:** NOT a plain rectangle, and a good test of the method. The GF
    plan's outermost chains: top and bottom `10463 · 6853`; right `13828`; left
    `5400 · 6965 · 1463` (which sums to 13828 — the kind of check the engine runs). The main
    hall runs the full 13.828 m on the east; the wing sits on the west, and the left-hand
    chain shows at least one step. If the outline is orthogonally convex (it looks so on the
    roof plan), its perimeter equals the bounding rectangle's, 2 × (17.316 + 13.828) =
    **62.288 m**, plus the entrance porch (`2775` wallplate); the corner count (5 or 6) depends
    on the step. **This is exactly what the traced segments + closure check must settle — I
    have not traced it.**
  - **KE:** stepped outline on grids A–F × 1–7, bounding 28.903 × 17.990 → orthogonally convex,
    so perimeter ≈ **93.79 m**; 8 external / 4 internal corners.
- **Edge cases:** curved or angled walls → `diagonal` with the printed length, or flag "measure
  by hand"; overhangs/set-backs on upper floors → a separate outline for that level; porches,
  canopies, bays → their own segments tagged `feature: porch|bay|canopy` (they may be
  low-level items, A2/C1).
- **Confidence:** high = every segment printed and the polygon closes; medium = grid-derived
  or one segment inferred; low = any segment estimated.

#### B2 · Corners
- **What:** external (outward) and internal (re-entrant) corners of the outline.
- **Engine derives:** from B1's turn sequence; **external − internal = 4** for any simple
  closed orthogonal outline (a built-in check).
- **Feeds:** the corner allowance (⚠ PARAM P4, placeholder 1.0 m per external corner, the
  confirmed house-build value).

#### B3 · Slab-edge length per suspended level
- **What:** the outer edge of each floor slab above ground (1F, 2F, roof slab) — KE's "Slab
  edge protection".
- **Engine derives:** that level's outline perimeter (B1 at that level; equals GF when the
  plans show the same outline). **⚠ PARAM P12:** every suspended level, or only the level
  under construction at a time (the hire overlaps).

#### B4 · Marked runs (from a mark-up)
- **What:** which walls the client (or estimator) marked for scaffold, and any number written.
- **Model reports:** per colour/label: the walls covered, named as outline segments from B1
  ("north wall of the main hall, full length", "west wing south wall"), plus any written
  number verbatim (Wren "42.2" / "3NR"). CBAND: blue = "Internal & external scaffold" around
  the hall and the pavilion.
- **Engine derives:** marked length = Σ the named segments' lengths (from the vector plan);
  a written number, if present, is compared (D6).

### C · Roof

#### C1 · Roof edge by type
- **What:** each roof edge run and its type: **open** (needs edge protection), **parapet**
  (with its height above the roof), **eaves/gutter** (pitched roof).
- **Feeds:** roof edge protection (triple default), temporary handrails.
- **Where:** roof plan + elevations/sections (parapet height = parapet level − roof level;
  KE: 11.575 − 9.725 = **1.850 m**, computed by the engine).
- **Model reports:** edge runs as B1-style segments with `edgeType`.
- **⚠ PARAM P10:** a parapet ≥ 0.95 m (placeholder) is treated as no permanent-edge risk →
  roof edge protection is **temporary** (priced only if the scope asks). Flag, never drop.

#### C2 · Gables (and hips)
- **What:** each gable end: which wall, its width, and whether it is a main gable or a porch/
  dormer gable; hips have none.
- **Feeds:** table lifts + apex handrails (house-build rule: one each per gable apex).
- **Where:** roof plan (roof lines), elevations (the triangle), sections (pitch).
- **Model reports:** per face: `faceRoof` (GABLED/HIPPED) → `apexReason` → `apexCount`
  (reason before number — the docs/13 §3.8 method), and `kind: main|porch|dormer` per apex.
- **Evidence:** CBAND quote lists **table lifts ×3 + apex handrails ×3** (hall) and **×2 + ×2**
  (pavilion) — consistent with one per gable apex. The pavilion also has a small **porch**
  gable that the quote does **not** count → porch gables are reported separately and **not**
  counted by default (⚠ PARAM P9).

#### C3 · Roof access, overrun, plant, rooflights
- **What:** access hatches, fixed ladders, lift overrun, plant zones, rooflights (fall risk).
- **Feeds:** roof access item (scope), information flags.
- **Where:** roof plan (KE: `ACCESS HATCH`, "Bilco … Fixed Vertical Ladder", `LIFT SHAFT`
  overrun, `ASHP 1/2`, skylights; CBAND: 8 rooflights on the hall).

### D · Internal areas and walls

#### D1 · Internal area per room / zone
- **What:** the floor area to deck for a birdcage (crash deck), per room/zone and level.
- **Feeds:** birdcage m² (per lift).
- **Where / how, in order:**
  1. **Printed room area** on the plan (KE `CA: 50.467 m²` — code reads it, §6) → high.
  2. **Printed internal dimensions** of the room (a chain `wall | span | wall`) → the model
     reports `internalWidth`, `internalDepth` strings; the engine multiplies → high/medium.
  3. **Overall − walls** (the house-build `birdcage.ts` ladder: the model reports the overall
     and each wall-thickness string; the engine subtracts **each side separately**) → medium.
     CBAND pavilion: overall 20.793 × 8.965, wall chain 303 → internal 20.187 × 8.359 ≈
     **168.7 m²** for the whole building footprint (the orange mark-up covers the whole
     interior — so the birdcage zone = the internal footprint minus nothing, pending Colin).
  4. Nothing printed → blank + "measure by hand".
- **Which rooms:** only those the **scope names** ("crash decks in each classroom") or the
  **mark-up covers** (CBAND orange); the model maps the scope's words / the colour to room
  labels; the engine sums their areas. Never "all rooms" by default.
- **Edge cases:** an L-shaped room → rectangles (docs/13 §3.10 method); corridors often
  excluded — follow the scope/mark-up; the legend wall (CBAND 327.5 mm finished) vs the chain
  wall (303 mm structural) → use the **chain** value (docs/13 structural-face rule).

#### D2 · Internal wall runs
- **What:** the perimeter of a room's internal walls — for an **internal independent**
  scaffold (CBAND "Internal independent works": the hall's vaulted main room) or an **internal
  blockwork** scaffold (KE "Ground floor blockwork walls").
- **Model reports:** the room(s) and their internal dimension strings; for "blockwork walls"
  the model lists the internal blockwork walls per level with their chain strings.
- **Engine derives:** Σ lengths. **⚠ PARAM P5b:** KE's internal blockwork scaffold basis
  (length of walls vs floor area) is unknown → blank + flag until Colin answers.

### E · Counted and located features
| # | Feature | Where | Model reports | Engine | Feeds |
|---|---|---|---|---|---|
| E1 | **Lift entrances per floor** ("Lift 01/02") | every floor plan | per lift label, per level: count of landing doors | Σ → gates | lift gates (one per entrance per floor ✅ calls) |
| E2 | **Stair cores / escape stairs** | plans (label + area), sections (height) | label, level range, internal dims or area string | height = top level − bottom level | stair-core scaffold, precast stair handrail |
| E3 | **Lift shaft** | plans (`LIFT SHAFT`, Wall Type D), sections (pit, overrun) | internal dims strings, pit/overrun levels | height = overrun − pit | lift-shaft scaffold |
| E4 | **Risers / service shafts** | upper-floor plans (`Shaft n Riser n`) | labels per level | count per level, distinct shafts | riser access platforms (⚠ P13b: per riser per level, or per shaft) |
| E5 | **Slab openings / voids** | upper-floor plans | per opening: what it serves + its dimension strings | perimeter each, Σ per level | void edge protection |
| E6 | **LV pits** | plans / site plan ("LV") | label + perimeter dims strings | perimeter each; **"20 LM × 2 pits" ambiguity flagged** | LV-pit edge protection |
| E7 | **Level changes / upstands** | plans + sections | location + height string (e.g. 0.65 m drop, 0.8 m upstand) | — | straight / up-and-over stair sets |
| E8 | **External doors, fire exits, walk-unders** | GF plan (`FIRE EXIT`), door schedule | counts by type | — | foam (**information only** unless scoped) |
| E9 | **Loading-bay / Haki / tower marks** | mark-ups only (architect drawings don't show them) | label + written lifts/height | — | count/lifts **only from the scope or the mark-up** |

Counts come from **labels on the text layer, confirmed on the image**; never from the image
alone when a text layer exists.

### F · Site context (flags — never priced by themselves)
| # | What | Where | Output |
|---|---|---|---|
| F1 | Scaffold beside a **public road / pavement** | site / compound plan (KE: Duke Street, "cross over between site activities and public interaction") | flag: 2.7 m first lift / scaffold mat, fans, hoarding, foam — **suggest only** |
| F2 | **School / occupied site** | title, site plan ("area beyond red line is in operation by college") | siteType = SCHOOL → mat/foam suggestions |
| F3 | Deliveries / compound / crane | compound plan | where a loading bay is sensible (info) |

---

## 10. Engine arithmetic (all pure, tested — the model never does any of this)

Notation: lengths in m, rounded **at emit** to 0.001 m internally and **0.1 m on the line**
(42.198 → 42.2, calls ✅); areas to 0.1 m²; money in integer pence (`price.ts`).

| Quantity | Formula | Params |
|---|---|---|
| Segment length (grid) | Σ printed spacings between the two grid bubbles; else measured bubble distance × scale (medium) | P15 |
| Perimeter | Σ outline segments (closed) | — |
| External corners | count of convex turns in the clockwise outline; check ext − int = 4 | — |
| **Scaffold run (per face or total)** | Σ face lengths + P4 × external corners on those faces | P4 |
| **External scaffold height (per face)** | wallTop(face) − ground(face) (A2, A4) | P2, P2b, P2c |
| **External lifts** | ceil(height ÷ P1) | P1 |
| **Height band** | band containing the **max** external scaffold height of the scoped runs | P3 |
| Parapet height above roof | parapet level − roof level | — |
| **Birdcage area** | Σ areas of the scoped/marked rooms (D1 ladder) | P11 |
| Birdcage / internal lifts | **suggested** ceil((clear height − P6a) ÷ P1), shown as a suggestion only | P6 |
| **Slab-edge length** | Σ perimeters of the chosen suspended levels | P12 |
| **Void edge length** | Σ opening perimeters on the chosen levels | P13 |
| **Lift gates** | Σ entrances over floors | — |
| **Table lifts / apex handrails** | count of main gable apexes on scoped faces | P9 |
| **Haki / loading-bay lifts** | = external lifts at that face (placeholder) | P7, P8 |
| **Roof edge protection** | Σ open roof-edge runs (+ parapet runs only if temporary protection is scoped) | P10 |
| Inspections | weeks of the longest-hired scoped line | P16 |
| Extra hire | per line, per `price.ts` (per unit per week × band %, beyond base) | — |
| Cross-check vs call-off | abs(drawing − callOff) ≤ max(0.2 m, 1 % of the value) → ok, else flag | P15 |

---

## 11. Mode A — reading the scope and binding it to measurements

> **Built 2026-10-01** (docs/22 "As built — M3 + M4"): `scopeTable.ts` (the schedule's
> structure, by code), the scope reader given the table row by row (`rowRef`), `attachScopeTables`
> (the row's cells win), `bindScope.ts` (the table below, one rule per item ROLE), cross-check,
> information list, empty sections, accounting. Where the build refines this section: a
> blank row's quantity comes from the rule (never invented); counts written in the wording are
> parsed by code; an outline that does not close never pre-fills a price; inspections take the
> row's own hire; a numbered mark-up line is paired with ONE schedule row (by lifts, then
> quantity) so a schedule listing an item twice never doubles it.

### 11.1 The scope reader (text; extends `scopePrompt.ts`)
For each scope line the reader copies cells **verbatim** (existing doctrine) and adds:
- `section` — the heading the line sits under (KE: Perimeter Scaffolding / Edge Protection /
  Loading Bays / Internal Scaffolding / Birdcages / Cores/Shafts / Roof / Adaptions);
- `statedQuantityText`, `dimensionText`, `heightText`, `liftsText` — the client's cells as
  printed; **blank means "we measure"** (`needsMeasurement: true`);
- `countText` inside the wording ("Staircase access towers; **2nr**");
- `location` (Stanmore "Stair 01", "North courtyard"; KE "Ground floor…");
- `hireWeeks` per line (KE 30/16/8/10; parsed by `scopeDimension.ts`);
- `elementId` from the picking list (aliases), or null + "needs an item";
- an **empty section** (KE "Birdcages") → a pseudo-line "section listed with no items —
  confirm none required".
- The client's **template columns** are recorded (KE: w · l · h · Lifts · Hire Period (weeks)
  · Weekly Rate (£) · Cost (£)) for the output (docs/22 §4.10).

### 11.2 Binding a scope line to measurements (the engine's lookup)
| Picking-list item | Measurement(s) | Quantity | Lifts | Band |
|---|---|---|---|---|
| Independent Scaffold | B1/B2 (faces in scope or marked) + A2/A4 | scaffold run (§10) | external lifts | max height |
| Additional Boarded Lift | same run | run | per the scope ("at each level" ⚠) | same |
| Triple Handrail | same run | run | — | same |
| Ladder Access Bay / Scaffold Tower | scope count | count | external lifts | same |
| Haki Stair Tower | scope/mark-up count | count | P7 | same |
| Loading Bay (+ platform, gate) | scope/mark-up count | count | P8 | same |
| Slab Edge Protection | B3 | slab-edge length | — | — |
| Opening / Void Edge Protection | E5 (+E3 shaft, E2 stairs) | void edge length | — | — |
| Leading Edge Protection | ⚠ P14 basis unknown | blank + flag | — | — |
| Internal Access Scaffold (blockwork) | D2 | ⚠ P5b | suggest | — |
| Lift Shaft / Stair Core Scaffold | E3 / E2 | count (1 each) | from height | — |
| Riser Access Platform | E4 | count ⚠ P13b | — | — |
| Birdcage | D1 (+A5) | area | suggest | — |
| Roof Edge Protection / Temporary Handrail | C1 | edge length | — | — |
| Roof Access | C3 | 1 per access point | — | — |
| Lift Gate | E1 | gates | — | — |
| LV-pit edge | E6 | perimeter Σ | — | — |
| Scaffold Mat, Foam | F1/F2, E8 | **only if scoped** | — | — |
| Inspection | scope hire weeks | weeks (P16) | — | — |
| Adaption (general) | — | 1 item, rate by hand | — | — |

### 11.3 Fusion rules
1. A scope line with a stated number → keep the drawing value, cross-check (D6).
2. A blank scope line → the drawing value, with its formula.
3. A scope line the drawings cannot measure → blank + "measure by hand" (never dropped).
4. A drawing feature not in the scope → information list only (D5).
5. Every line carries: client wording, section, hire weeks, formula text, provenance chain,
   confidence, flags, and every ⚠ PARAM it used.

---

## 12. The tool contracts (one per sheet kind) and the prompt skeletons

Common wrapper for every numeric value (same shape as today's `numberField`):
`{ value: number|null, confidence: high|medium|low|unknown, sourceDimension: string|null,
sourceSheet: string|null, sourcePage: number }`. Arrays use `.catch([])` (one bad field never
loses a read). Every tool has a final `notes` string (short) and `unreadable: string[]` (what
the model looked for and could not find — D7).

### 12.1 Shared system-prompt core (all sheet readers)
> You are reading ONE sheet of a UK construction scaffolding enquiry for Airwright Midland, a
> scaffolding contractor. You can SEE the sheet (whole sheet on page 1, magnified crops after
> it) and you are given its TEXT LAYER — every printed label and dimension with its
> approximate position. **Trust the text layer for exact words and numbers; use the image to
> understand where things are, what encloses what, and how many there are.**
> RULES: (1) Report what is on the sheet — never a price, a lift count, a total or a band.
> (2) **Never add, subtract or multiply dimensions.** When a length is made of printed pieces,
> list the pieces. The only conversion you may make is mm → m (÷1000); always keep the exact
> printed string in `sourceDimension`. (3) Every number you give must be printed on this sheet
> unless you mark it `low` and say it is an estimate. (4) Count from labels, confirm on the
> image; never count the same feature twice because it appears in two crops. (5) Never invent
> a feature; absent means absent. (6) Put what you looked for and could not find in
> `unreadable`. [+ the glossary section relevant to this sheet kind, §1]

### 12.2 PLAN reader (`record_plan`)
Fields: `level` · `outlineReason` (one line: shape and where it steps, written BEFORE the
segments) · `startCorner` · `outline[]` — **one STRING per wall**, `"DIR | LENGTHS | GRID | FEATURE
| NOTE"` (as built: a list of objects broke the tool call on dense A1 plans; `parseOutlineEntry`
parses it, unparseable lines are reported, never guessed) · `wallThicknessStrings[]` (chain wall zones, e.g. "303") · `rooms[] {label,
areaString?, internalWidthString?, internalDepthString?}` · `cores[] {kind: STAIR|LIFT|
ESCAPE_STAIR|RISER, label, dimStrings[]}` · `openings[] {serves, dimStrings[]}` ·
`liftEntrances[] {liftLabel, count}` · `externalDoors {doors, fireExits}` · `features[] {kind:
LV_PIT|LEVEL_CHANGE|UPSTAND|PORCH|BAY|CANOPY, label, dimStrings[]}` · `unreadable[]` · `notes`.
Plan-specific prompt lines:
> Find the building's EXTERNAL wall line (the outside of the brick/cladding). Trace it
> clockwise from the top-left external corner. For each straight wall give its direction and
> the printed dimension that measures it — the outermost dimension on that side, or the
> segment of a chain between its two ends. If the drawing uses grid lines and a wall lies on
> them, you may give the two grid references instead. Porches, bays and canopies are their
> own segments, tagged. Do not read a length off the roof overhang. Before listing segments,
> write `outlineReason`: e.g. "L-shape: main hall on the east, wing to the west, flush along
> the south". For rooms, copy the printed area string exactly (e.g. "CA: 50.467 m²") or the
> internal chain values; do not compute an area.

### 12.3 ELEVATION reader (`record_elevation`)
Fields: `face` (as titled: North/Front/…) · `showsOutlineSide` (which plan side, from the
location key or the plan's north arrow) · `heights[] {string, whatItMeasures:
SOFFIT|WALLPLATE|PARAPET|RIDGE|FLOOR|OTHER, appliesTo (which part of this face)}` ·
`levelMarkers[]` (as printed) · `groundLine {string?, note}` · `roof {faceRoof: GABLED|HIPPED|
FLAT_PARAPET|FLAT_OPEN, apexReason, apexCount, apexes[] {kind: MAIN|PORCH|DORMER}}` ·
`lowerParts[] {description, heightString}` (lower eaves, porch) · `unreadable[]` · `notes`.
> A height on an elevation belongs to a PART of the face — say which (e.g. "3300 DPC TO U/S
> SOFFIT applies to the main hall; 2550 to the lower part on the left"). Decide the roof shape of this
> face before counting apexes; a porch gable is reported as kind PORCH. Never read a wall
> length here.

### 12.4 SECTION reader (`record_section`)
Fields: `cut` (A-A…) · `heights[]` (as 12.3) · `internalClearHeights[] {room, string,
measures: CEILING|UNDERSIDE_TRUSS|VAULT}` · `pitch {string}` · `stairs[] {label, flights,
fromLevel, toLevel}` · `liftPitOverrun {pitString?, overrunString?}` · `unreadable[]` · `notes`.

### 12.5 ROOF_PLAN reader (`record_roof`)
Fields: `edges[] {segment (B1 style), edgeType: OPEN|PARAPET|EAVES_GUTTER, note}` ·
`gables[] {wall, kind, widthString?}` · `hips[]` · `access[] {kind: HATCH|LADDER|STAIR|
SKYLIGHT_ACCESS, label}` · `overruns[]` · `plant[]` · `rooflights {count}` · `unreadable[]` · `notes`.

### 12.6 MARKUP reader (`record_markup`) — replaces today's single contract for marked sheets
Fields: `zones[] {colour, label (verbatim slide/legend text), meaning: EXTERNAL_SCAFFOLD|
INTERNAL_SCAFFOLD|BIRDCAGE|HANDRAIL|LOADING_BAY|HAKI|OTHER, covers: {walls[] (outline
segment refs), rooms[] (room labels)}, writtenNumbers[] {string, means: LENGTH|LIFTS|AREA|
HEIGHT|COUNT}}` · `unreadable[]` · `notes`. The Wren-era fields (externalRuns, birdcages,
roofEdgePerimeterM with liftsMarked) map onto `zones` + `writtenNumbers`.
> The coloured shapes were drawn by a person on top of the drawing to show WHERE scaffold goes.
> For each colour, say which walls (use the plan's wall/room names) and which rooms it covers,
> and copy any written number exactly. Do not estimate lengths from the colours.

### 12.7 SCOPE reader — §11.1 (text only; extends `scopePrompt.ts` + `scopeSchema.ts`).

### 12.8 CONTEXT reader — text only, no vision (site/compound/survey): `publicInterfaces[]
{kind: ROAD|PAVEMENT|PUBLIC_AREA|OCCUPIED_SITE, text}`, `siteTypeHint`, `notes`.

---

## 13. Mode B — the measurement sheet (no scope)

Per building, grouped:
- **Heights:** each face/part wallTop, ground, scaffold height, **suggested lifts** and
  **suggested band** (labelled "suggestion" with the ⚠ params used).
- **Runs:** perimeter, per-face lengths, external corners; marked runs if a mark-up exists.
- **Roof:** edge runs by type; gables (main vs porch); pitch; access.
- **Internal:** rooms with areas (marked/scoped highlighted), clear heights.
- **Features:** cores, shafts, risers, openings, entrances, LV pits, level changes, doors/exits.
- **Context flags.**
Each row: value · unit · source sheet(s) + printed string · confidence dot · "use this" →
opens a line pre-filled with the quantity (Colin chooses the item, lifts, band).

**Illustration from CBAND** (values printed on the drawings; derived values computed by hand
here and to be reproduced by the engine):

| Building | Measurement | Value | Source |
|---|---|---|---|
| Sports Pavilion | outline | 20.793 × 8.965 m rectangle (+ porch) | GF plan outermost chains |
| | perimeter (before porch) | 59.516 m, 4 external corners | engine |
| | wall top (soffit above DPC) | 2.850 m main; 1.650 / 1.875 m lower parts | section A-A, side elevations |
| | suggested external lifts (P1 = 2.0 m) | 2 | engine — quote says 2 ✓ |
| | gables | 2 main + 1 porch | roof plan / elevations — quote apex ×2 ✓ (porch not counted) |
| | internal footprint | 20.187 × 8.359 ≈ 168.7 m² | overall − 2 × 303 (engine) |
| | floor to ceiling | 2.990 m | section A-A |
| Community Hall | outline | wing + main hall, bounding 17.316 × 13.828 (+ porch); left chain 5400 · 6965 · 1463 | GF plan chains |
| | perimeter (before porch) | 62.288 m **if** orthogonally convex; corners 5 or 6 — to be traced | engine |
| | wall top | 3.300 m main hall; 2.550 m lower wing | elevations, sections |
| | suggested external lifts | 2 | quote says 2 ✓ |
| | gables | 3 (quote: table lifts ×3, apex ×3) | roof plan (my reading) |
| | main hall clear height | 4.882 m FFL–FCL (vault) | section A-A |

---

## 14. Verification after every read (the engine's post-checks)

| # | Check | Action on failure |
|---|---|---|
| V1 | every `sourceDimension` exists in that sheet's text layer (token match ± rounding) | confidence → low, flag |
| V2 | every grid ref exists in the sheet's grid system | drop the ref, flag |
| V3 | outline closes (Σ E = Σ W, Σ N = Σ S) within P15 | flag "outline doesn't close" (low) |
| V4 | ext − int corners = 4 | flag |
| V5 | outline bounding size = the overall chains | flag |
| V6 | same level printed identically on every sheet | flag |
| V7 | a height attributed to a face also appears on a second sheet | medium → high when corroborated |
| V8 | `internal + 2·wall = overall` role check (`reconcileRectRoles`) | re-file internal vs overall, flag |
| V9 | a count from the image disagrees with the text-layer label count | keep the label count, flag |
| V10 | a scope call-off vs the drawing value beyond P15 | keep drawing, flag (D6) |
| V11 | a feature reported twice across crops/sheets (same label, same position) | de-duplicate |
| V12 | a raster sheet (no text) reported high-confidence numbers | cap to low |

---

## 15. Evidence from the real quotes (what the lift and item rules must reproduce)

### 15.1 External lifts vs height — four data points
| Job | Height the scaffold serves | Quoted external lifts | ceil(h ÷ 1.5) | ceil(h ÷ 2.0) |
|---|---|---|---|---|
| Murray Park (quote 1375) | "4m" (quote text: "66m x 1.2m x 4m", 1st lift 2.7 m) | 2 | 3 ✗ | **2 ✓** |
| Wren | 4.955 m (building height read) | 3 (main run) | 4 ✗ | **3 ✓** |
| CBAND Hall | 3.300 m (DPC to soffit) | 2 | 3 ✗ | **2 ✓** |
| CBAND Pavilion | 2.850 m | 2 | 2 ✓ | **2 ✓** |

→ **P1 placeholder = 2.0 m** for construction external lifts (the house-build 1.5 m rule
misfits three of four). Still ⚠ — four points, and the height datum is inconsistent across them.

### 15.2 Internal lifts — no rule fits yet
CBAND: hall internal independent **2 lifts** at 4.882 m clear; pavilion internal independent
**1 lift** at 2.990 m; birdcages **2 lifts** in both (hall 4.882 m, pavilion 2.990 m). A
"reach" formula ceil((h − 2.0) ÷ 2.0) gives 2 / 1 for the independents but 1 for the pavilion
birdcage (quoted 2). → internal/birdcage lifts are **suggestions only** (P6), always shown
for Colin to set.

### 15.3 Haki and loading bays follow the external lifts
CBAND: Haki **2 lifts**, loading bay **2 lifts** on both 2-lift buildings; Wren schedule: Haki
×3 and ×2, loading bay ×3 and ×2, matching its 3- and 2-lift runs. → P7/P8 placeholder:
Haki / loading-bay lifts = the external lifts where they stand. **This contradicts
`rules.ts HAKI_LIFTS = 3`** (from the call's example of a 2-storey building), which must
become a suggestion, not a constant.

### 15.4 Quote structure (both real quotes)
Airwright quotes **lump-sum sections per area** ("External Works Community Hall") with an
"Includes for" list, **a hire period per section** (CBAND 16 / 8 / 4 weeks; Murray Park 6) and
**an extra-hire rate per week per section**; inspections as their own line (£150 × 16 weeks
on CBAND, in the total though labelled optional). The measurement sheet and lines therefore
need an **area/section** grouping (building × external / internal / birdcage) — see docs/22
§4.10 and P17.

---

## 16. ⚠ Parameters (placeholders until Colin answers — every use is flagged)

| # | Parameter | Placeholder | Basis |
|---|---|---|---|
| P1 | external lift height | **2.0 m** | §15.1 (4/4 fit) |
| P2 | wall-top datum | pitched → U/S soffit; flat → top of parapet | house-build datum confirmed; parapet assumed |
| P2b | DPC above ground | 0.15 m | typical; Bovis heights are from DPC |
| P2c | which ground | lowest proposed spot level along the face; else FFL − P2b | assumption |
| P3 | band from | max scaffold height of the scoped runs | assumption |
| P4 | corner allowance | 1.0 m per external corner | house-build confirmed; construction unconfirmed |
| P5 | extra offset from the wall | 0 (covered by P4) | house-build convention |
| P5b | internal blockwork scaffold basis | none → blank + flag | unknown (KE) |
| P6 | internal/birdcage lifts | suggestion ceil((h − P6a) ÷ P1), P6a = 2.0 m reach | §15.2 — never auto-applied |
| P7 | Haki lifts | = external lifts at its face | §15.3 |
| P8 | loading-bay lifts | = external lifts at its face | §15.3 |
| P9 | gables counted | main gables only (porch/dormer excluded) | CBAND quote |
| P10 | parapet treated as edge | ≥ 0.95 m → roof edge protection is temporary (scope-only) | assumption |
| P11 | birdcage rooms | only scoped/marked rooms | D5 |
| P12 | slab-edge levels | every suspended level + roof slab | assumption (KE) |
| P13 | void edge | every slab opening on scoped levels | assumption |
| P13b | riser platforms | one per riser per level | assumption (KE) |
| P14 | leading edge basis | none → blank + flag | unknown (KE) |
| P15 | cross-check tolerance | max(0.2 m, 1 %) lengths; exact counts | Colin "100–200 mm is fine" |
| P16 | inspection weeks | weeks of the longest-hired line | CBAND (16) |
| P17 | output grouping | building × external / internal / birdcage sections | both real quotes |
| P18 | hire beyond the rate's included weeks | TERMS — the price covers the rates' 4 weeks, longer hire stated per week (INCLUDED adds each line's hire beyond its base into the price) | the real quotes print a hire period per section; §13 #4 |
| P19 | "lifts at each level" | one boarded lift per floor level above ground (EVERY_LIFT boards every lift) | KE scope wording |

---

## 17. What always stays human
Items (without a scope) · final lifts and band · Haki / loading bay / tower / ladder-bay
counts · which gables get table lifts + apex handrails · birdcage rooms when the scope is vague
· anything with an unknown basis (P5b, P14) · hire weeks and the commercial band · the
decision to quote something the scope did not ask for (never automatic).

---

## 18. Evaluation (measure before optimising)
- **Answer keys:** CBAND (our quote: section structure, lifts, gables, hire), Murray Park (our
  quote: 66 m × 2 lifts × 4 m), Wren (the marked-up numbers), KE (a hand-worked key until
  Airwright's own take-off arrives). ⚠ The CBAND quote has **no metreage** — it validates
  structure, lifts and gables, not lengths; Colin's working is needed for lengths.
- **Metrics:** register accuracy (bucket per file) · building grouping · level table exact ·
  outline closes + perimeter within 1 % of the key · corners exact · heights attributed to the
  right face · gable count · room areas exact (printed) · scope lines 100 % accounted · lift
  suggestions vs quoted lifts · cost per pack.
- **Runner:** `scripts/construction-offline.mts <folder>` prints the register, the building
  model and (mode A) the draft lines, and diffs against the key. Pure modules unit-tested
  (`sheetGeometry`, outline closure/corners, binding, fusion).

## 19. Keeping prompts in sync
1. Change this playbook first (authoritative).
2. Re-sync the prompt text + tool-schema field descriptions (`*Prompt.ts`, `*Schema.ts`).
3. Bump the reader's `PROMPT_VERSION`.
4. Re-run the offline runner on all four fixtures; a change must not regress Wren.

*Nothing here is priced by the model and nothing marked ⚠ is assumed silently. The model
reads and names; the engine measures and computes; the scope decides what; a person confirms.*


---

## 20. What the real packs showed (2026-09-30, as built)

| Pack | Result |
|---|---|
| CBAND Sports Pavilion | outline from the printed 20793 / 8965 → **59.516 m**, 4 corners, closes; soffit 2850 (2 sheets) → **2 lifts** (quote 2); gables **2 main + 1 porch** (quote apex ×2); floor-to-ceiling 2990 → internal **1 lift** (quote 1); the client's bands cover all external walls + internal runs (flagged to measure); the orange fill = **whole interior 168.74 m²** |
| CBAND Community Hall | stepped outline traced wholly from print (6965 + 1463 on the left) → **62.288 m**, 5 external + 1 internal corner; soffits 3300 / 2550 → 2 lifts; vault 4882 → 2 internal lifts (quote 2); gables roof plan 2 vs elevations 3 → **flagged** (quote 3; P9 is Colin's) |
| King Edward | levels exact; parapet +11.575 over proposed ground −0.350 → **11.925 m, 6 lifts, 6–12 m band**; parapet 1.85 m above the roof → temporary edge; all printed room areas, riser labels, cores, openings, lift entrances. **Outline NOT reliable** on this stepped A1 plan after three prompt revisions — the engine refuses or marks it low (floors disagree with the roof plan) |
| Wren | the numbered mark-up (once its annotations are flattened) → external 35.157 × 2 / 42.199 × 3, birdcages 203.34 × 2 / 123.88 × 3, Haki 3 / 2, loading bays 3 / 2, roof edge 77.357 → the 9 validated lines |
| Murray Park | raster plan + .pptx mark-up: nothing invented; the working platform / edge protection / Haki / skip positions are reported as flags to measure by hand |

**2026-10-01, scope mode on the same packs** (`scripts/construction-eval.mts`, real DB):
KE 15/15 — the 22 schedule rows all accounted for, "Birdcages" → confirm none required, leading
edge + 3 blockwork rows blank (P14 / P5b), 2nr towers, cores / shafts / risers counted, lift
entrances on the information list, and the outline now **96.036 m** from the printed overalls
(28.903 + 19.115; two unprinted steps solved as a total by closure — low, flagged) → scaffold run
102.036 m × 6 lifts. Wren 8/8 — the 9 mark-up lines each paired with their schedule row (all
agree), 7-week hire from the rows, no duplicates. CBAND 9/11 (mode B, no lines; the two misses are
the Hall gables, P9, and a stored Hall read whose outline does not close — never priced). Murray
Park 2/2 (nothing invented; its own email describes the works, the scaffold is in the .pptx).
Stanmore (scope only): 37 rows, dimensions → quantities by code (2.4×5.4 m → 12.96 m²).

**Lessons written back into the readers:** annotations must be flattened (§5.6); a mark-up's own
shape facts beat a picture for "is this fill the whole interior"; a clear height must be labelled
as reaching a ceiling / truss / vault (storey chains are not clear heights); a closed outline can
still be the wrong shape — cross-check every floor against the others and the roof plan.
