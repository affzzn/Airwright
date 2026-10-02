# 22 · Construction Reading Pipeline — plan (tender-pack scale)

**What this is.** The plan for making the construction estimator read a **real construction
tender pack** — a whole folder of architect's drawings plus the client's scope of works — the
way the house-build side already reads a housing pack: sorted automatically, read in the
background, measured deterministically wherever the drawing allows it, fused with the scope,
reviewed by a human, then priced off the picking list.

It builds on `docs/19` (the construction estimator: picking list, per-lift pricing, hire, the
four-step job workspace) and `docs/20` (the scope reader + the per-drawing vision reader +
`assemble.ts`). Nothing in the house-build take-off or pricing engine changes; construction
reuses house-build **infrastructure** (queue, worker, upload, text-layer tooling, Claude
helpers), never its rules.

> **STATUS (2026-10-01): Milestones 1–4 BUILT** — M1–M2 (pack sorting + reading) on
> 2026-09-30, M3 (scope mode: schedule structure, binding, fusion, alias learning) and M4
> (measurement sheet + "use this", job settings, items by building × section, Airwright's
> section quote, client-template export) on 2026-10-01. See PROGRESS.md and the two "As built"
> sections at the end. What is left is Airwright's answers (§13) and the real rate sheet.
>
> **(Original status: PLAN.)** Written after analysing
> `data/construction/BSN Group/King Edward VI College, Stourbridge/` (the "KE" pack, CN215).
> Build order and acceptance criteria are in §12. Open questions for Airwright are in §13
> and must NOT be guessed.

---

## 0. Why a new plan — what KE taught us

Wren Park (`eg-01`) was a *marked-up* enquiry: the client's QS had already drawn the scaffold
on the drawing and written the numbers on it. Reading it was "read the mark-up". KE is the
normal case for a larger job, and it breaks every assumption that made Wren easy:

| | Wren (`eg-01`) | **King Edward (CN215)** |
|---|---|---|
| Files | 8 loose files | **55 files in a nested folder tree** (36 drawing sheets, a 105-page spec, an issue sheet, backups, stray images) |
| Scope | email prose + a schedule with quantities | a **schedule with item names + hire weeks only — every quantity blank** |
| Drawings | marked up (blue/red/green zones, lengths written on) | **clean architect's CAD**, no scaffold mark-up at all |
| Where quantities come from | read off the mark-up | **must be derived**: perimeter from the outline, height from levels, openings from each floor |
| Call-off to cross-check | yes | **none** — the drawing is the only source |
| Sheets needed per item | one | **several** (plan for length, elevation/section for height, every floor for openings) |
| Hire | one duration | **per line: 8 / 10 / 16 / 30 weeks** |
| Client's pricing template | Item · Lifts · Unit · Qty · Rate · Duration · Total | **w · l · h · Lifts · Hire weeks · Weekly rate · Cost** |

So the system has to do, for a construction job, what Colin does by hand: open the right
sheets, find the building outline, the levels, the cores and openings, work the numbers out,
and price exactly the lines the client listed.

**The good news, proven on KE.** Every KE drawing is a **vector A1 at a printed scale (1:50 @
A1) with a full text layer**. Each text item carries its page position. From the positions of
the grid bubbles and the printed scale alone, grid A→F measures **28,910 mm** — the printed
dimension chain says **28,903 mm** (7 mm out, 0.02%). So on a pack like this, lengths do not
have to be *read* or *guessed* by a model; they can be **measured by code** once the model
has said *which* grid points the outline runs through. That is the core idea of this plan (§5).

---

## 1. The pack, decoded (KE, the reference fixture)

**Job.** New 3-storey classroom block, King Edward VI College, Stourbridge. Main contractor BSN
Group (ref CN215), architect BPN Architects, "Revised Tender Issue" T8/T9 (06/02/2026).
Brick + block cavity walls, precast plank floors, timber flat roof behind a parapet, one
hydraulic lift, a main stair core + an escape stair, 5 service shafts with risers.

**Levels (text layer — deterministic):** GF ±0.000 (78.150) · 1F +3.225 · 2F +6.450 · RF
+9.725 · Parapet +11.575 · Foundation −0.900. Ground: proposed levels around the building run −0.350 to +0.850 m relative to FFL (so 10.7–11.9 m
from ground to parapet top); the existing survey's spot levels run 77.37–79.14 AOD across the whole
site, and the lowest would give 12.36 m. Either way the job sits at the **6–12 / 12–18 m band
boundary** (a Colin question).

**Footprint:** grid A–F × 1–7, overall 28.903 × 17.990 m, a stepped (orthogonally convex)
outline — about **93.8 m** at the wall face, 8 external / 4 internal corners (my reading;
the pipeline must reproduce it with provenance).

**File triage (55 files):**

| Bucket | Files | Why |
|---|---|---|
| **Core** (read by AI) | GF/1F/2F floor plans (2591.1100–1102), roof plan (1103), 4 elevations (1201–1204), 3 sections (2000–2002) | outline, grids, cores, shafts, risers, stairs, levels, parapet, roof access |
| **Context** (text only, no vision) | existing site plan (0100 — survey spot levels), proposed site plan (1000), compound plan (1001 — Duke Street, public interface, hoarding, deliveries), issue sheet (drawing register) | ground levels per side; site-constraint flags; latest-revision check |
| **Not scaffold-relevant** | finishes (1500s), ceilings (1700s), furniture (4000s), door/window schedules (2200/2400), details (3000–3021), Ibstock vent-brick sheet, the 105-page NBS spec | architectural detail; the NBS has no scaffold/temporary-works section |
| **Junk** | 9 × `.~qsbak` (QS software backups = near-duplicates), 5 × loose `.png/.bmp` (CAD image assets: EV charger, tree texture, glazing-regs clipping), `.DS_Store` | never read, never shown by default |

**The scope (`CN215 Scaffold Schedule.xlsx`)** — sections + items + hire weeks, all dimension /
lift / rate / cost cells empty, a `SUM` total:

| Section | Lines (hire weeks) |
|---|---|
| Perimeter Scaffolding | Independent tied scaffold · Lifts at each level · Triple guardrails & toe boards · Ladder access bays · Staircase access towers; 2nr (30) |
| Edge Protection | Slab edge protection · Edge protection (lift, stairs, risers) · Leading edge protection during precast install (16) |
| Loading Bays | Loading bays · Loading bay platforms · Gates (30) |
| Internal Scaffolding | GF / 1F / 2F blockwork walls (8 each) |
| Birdcages | *(heading, no lines)* |
| Cores/Shafts | Lift shaft internal scaffold · Stair core 2 access scaffold · Stair core 1 access scaffold · Riser access platform (16) |
| Roof | Edge protection · Access · Temporary handrails (10) |
| Adaptions | Generally (item) |

---

## 2. Principles (carried over — do not break)

1. **Price exactly the scope** (Ben). A scope line is priced; a feature on a drawing that the
   scope didn't ask for is **shown as information, never priced**. An empty section (KE
   "Birdcages") is surfaced as "confirm none required", never filled.
2. **Two layers.** AI reads *observables* with confidence + provenance; **pure, tested code**
   does every number, every rule, every price. The model never adds up a dimension chain.
3. **Measure, don't guess.** Order of trust for a length: *printed on the drawing* → *measured
   by code from vector positions at the printed scale* → *model estimate (low confidence,
   flagged)* → *blank + "measure by hand"*. Never a silent default.
4. **Account for everything.** Every scope line, every file, every sheet is shown with a
   status (read / context / not relevant / junk / failed). Nothing is dropped silently.
   Relevance triage may **rescue** a sheet, never quietly remove one.
5. **Human confirms before anything prices.** The review is the product.
6. **Open values are parameters, not guesses** (scaffold offset, lift height, corner allowance,
   leading-edge basis…) — defaults are flagged `⚠ Colin` until answered (§13).
7. **Background, resumable, idempotent.** No AI call runs inside a web request. Every paid
   model call's output is stored and **reused on retry** (no second bill).
8. **Construction only.** New code lives under `src/lib/construction/`, `src/server/*construction*`,
   `src/components/construction/`, `src/worker/construction*`. House-build behaviour is untouched.

---

## 3. Architecture

```
UPLOAD (folder tree or loose files, resumable)             §4.1
 └─ ATTACHMENTS stored with their relative path
WORKER · construction-ingest job                           §4.2–4.3
 ├─ junk filter (backups, CAD image assets, OS files)
 ├─ per-PDF: pages, paper size, text layer?, scale, title block
 ├─ SHEET REGISTER: drawing no. · title · rev · kind · level → keep latest rev
 ├─ relevance: deterministic rules → LLM rescue triage (unsure only)
 └─ SHEET GEOMETRY (no AI): positioned text → scale, grid system,
    level table, dimension strings, room labels/areas, feature labels
WORKER · construction-read-sheet jobs (one per core sheet, bounded concurrency)   §4.4
 └─ vision reader, SCHEMA PER SHEET KIND, fed the sheet geometry as hints,
    tiled for A1/A0; returns TOPOLOGY in grid terms + labelled features
WORKER · construction-read-scope job                        §4.6
 └─ scope reader (sections, items, per-line hire, stated dims) → picking-list mapping
WORKER · construction-assemble job (pure code)              §4.5, §4.7, §4.8
 ├─ BUILDING MODEL: levels · footprint per floor · perimeter + corners ·
 │   cores/shafts/openings · roof edge · ground per side — every value with provenance
 ├─ QUANTITY RULES: one formula per scope item over the building model (+ params)
 └─ FUSE + VERIFY: scope × model → draft lines + measurements + flags
REVIEW (job workspace, existing 4 steps, extended)          §4.9
 └─ register · building model w/ provenance · draft lines w/ formula → confirm
PRICE (existing price.ts, per-line hire) → OUTPUT (Airwright layout | client template)   §4.10
```

---

## 4. Stage by stage

### 4.0 Picking list for development (construction only) — do FIRST

The live library is the 13-item placeholder seed (`src/lib/construction/library.ts`); it
cannot express KE (no ladder access, towers, shaft scaffolds, slab-edge, leading-edge…).
Airwright's real sheet is imported-but-retired in the DB. Until they send the final
construction list, extend the **seed** into a realistic **development library** modelled on
the real sheet's construction families, so the pipeline has real targets to map to.

- Edit `CONSTRUCTION_ELEMENT_SEED` (and `scripts/restore-seed-library.mts` picks it up);
  `line = CONSTRUCTION` / `GENERAL` only. Every added item carries `defaultRuleNote` starting
  **"DEV placeholder"** so nobody mistakes it for a real rate.
- Give every rate a **base hire period (4 weeks), an E/H value and a band %** so the extra-hire
  maths is exercised (today the seed has none → extra hire = £0).
- Aliases seeded from the calls + KE + Stanmore wording (they drive the scope mapping).

| Category | Item (canonical) | Unit | Aliases (seed) |
|---|---|---|---|
| Access | Independent Scaffold | LM_PER_LIFT | working platform, independent tied scaffold, ConInscaff, perimeter scaffold, wrap scaffold |
| Access | Additional Boarded Lift | LM_PER_LIFT | lifts at each level, boarded lift, working lift |
| Access | Ladder Access Bay (gate + door) | NR_PER_LIFT | ladder access, ladder bay, ladder access bays |
| Access | Haki Stair Tower | NR_PER_LIFT | haki, hacky stairs, staircase access tower, stair tower |
| Access | Scaffold Tower | NR_PER_LIFT | tower, access tower, independent tower |
| Access | Loading Bay | NR_PER_LIFT | loading bay, loading platform |
| Access | Loading Bay Platform (cantilever / offset) | NR_PER_LIFT | loading bay platform, offset loading bay |
| Access | Loading Bay Gate | NR | gates, loading bay gate, up-and-over gate |
| Access | Rubbish Chute / Skip Bay | NR_PER_LIFT | chute, rubbish shoot |
| Access | Roof Access (ladder / tower) | NR | roof access, access to roof |
| Protection | Double Handrail + Toe Board | LM | handrail, guardrail, edge protection |
| Protection | Single / Additional Handrail | LM | additional handrail, single rail |
| Protection | Triple Handrail | LM | triple guardrail, triple guardrails & toe boards |
| Protection | Slab Edge Protection | LM | slab edge, floor edge protection |
| Protection | Leading Edge Protection | LM | leading edge, precast install edge |
| Protection | Opening / Void Edge Protection | LM | edge protection (lift, stairs, risers), void protection, LV pit edge |
| Protection | Roof Edge Protection | LM | roof edge, parapet edge protection |
| Protection | Temporary Handrail | LM | temporary handrails, precast stair handrail |
| Protection | Lift Gate (Safegate) | NR | safegate, lift gate |
| Protection | Foam Protection | NR | foam, upright padding |
| Protection | Pedestrian Hoarding / Fan | LM | hoarding, protection fan |
| Protection | Debris Netting / Sheeting | M2 | monarflex, sheeting, debris netting |
| Internal | Birdcage (crash deck) | M2_PER_LIFT | crash deck, birdcage |
| Internal | Internal Access Scaffold | LM_PER_LIFT | blockwork walls, internal scaffold |
| Internal | Lift Shaft Scaffold | NR_PER_LIFT | lift shaft internal scaffold |
| Internal | Stair Core Scaffold | NR_PER_LIFT | stair core access scaffold |
| Internal | Riser Access Platform | NR | riser platform, riser access |
| Extras | Scaffold Mat / Dummy Lift | NR | dummy lift, scaffold mat |
| Extras | Weekly Inspection | PER_WEEK | inspection, scafftag inspection |
| Extras | Adaption (general) | FIXED | adaptions, generally |
| Extras | Design / TG20 Compliance | FIXED | design, TG20 |

Rates: bracketed (≤6 / 6–12 / 12–18 / 18–24 / 24–30) and banded (H/M/C/SC) placeholders
shaped like the real ladders (e.g. Ind Scaff ~35/42/45/51). When Airwright's final list
arrives: run `scripts/import-rate-sheet.mts`, and **map dev items → real items** (a small
mapping table) so aliases and test fixtures carry over.

### 4.1 Upload — a folder, not a few files

- `/construction/new` and step 1 accept a **folder drop** (and zips), reusing the house-build
  folder-first resumable uploader (`src/lib/upload/plan.ts`: `isUploadableName`,
  `isArchiveName`, `normalizeRelativePath`) and signed-URL direct-to-Storage uploads.
- 🔧 `ConstructionAttachment.relativePath` (keep `1.Arch/1100 Proposed Floor Plans/…`) — the
  folder names are strong relevance signals ("Door Schedules", "Room Data Sheets").
- Upload does nothing else; it enqueues `construction-ingest` and the page shows progress.

### 4.2 Ingest — the sheet register (deterministic, no AI)

For every file (worker):
1. **Junk filter** (pure, tested): `.~qsbak`/`.bak`/`~$*`/`.DS_Store`/thumbs; images that are
   tiny, textures, or sit inside a drawings folder with no drawing number → `JUNK`
   (shown collapsed, never read). Byte-identical duplicates → `DUPLICATE`.
2. **Per PDF page:** paper size, text-layer presence, raster-only?, **scale** (`1:50 @ A1`,
   `1:100`, `NTS` from the title block), **title block** fields (drawing no., title, revision,
   status) — reuse `classify-rules.ts` (`drawingTitle`, `classifyTitle`) and the house-build
   `parsePath.ts` (`parseRevision`, `revisionStrippedKey`).
3. **Sheet register row:** `drawingNo · title · rev · kind · level(s) · scale · hasText ·
   source file/page`. Kind = PLAN (by level) / ROOF_PLAN / ELEVATION (by face) / SECTION /
   SITE / LOGISTICS / SCHEDULE / DETAIL / SPEC / FINISHES / FURNITURE / OTHER.
4. **Latest revision wins** per drawing number (T9 over T8), and the **issue sheet**, when
   present, is parsed as the register of record — a mismatch is flagged.

### 4.3 Relevance + sheet geometry

**Relevance (recall first):**
- Tier 1 (rules): PLAN/ROOF_PLAN/ELEVATION/SECTION → **CORE**; SITE/LOGISTICS/survey →
  **CONTEXT** (text only); FINISHES/FURNITURE/SCHEDULE/DETAIL/SPEC → **NOT RELEVANT**.
  Drawing-number series help (architects commonly use 1000 site / 1100 plans / 1200
  elevations / 2000 sections) but are hints, never the only rule.
- Tier 2 (LLM, `relevanceTriage.ts` pattern, batched ≤10, text only, cheap model): only for
  sheets Tier 1 is unsure about; may only **promote**.
- The estimator can override any row (the register is editable in step 1).

**Sheet geometry (pure, per CORE/CONTEXT sheet — the big lever):** from pdfjs positioned text:
- **Scale** → pt-to-mm factor (A1 @ 1:50: 1 pt = 17.64 mm).
- **Grid system**: bubble labels (A–F, 1–7…) → grid-line coordinates (verified on KE: A→F
  28,910 vs printed 28,903 mm). Cross-check every adjacent grid spacing against the printed
  dimension strings between them; a mismatch lowers confidence.
- **Level table**: `+9.725 · 3 RF-Roof (87.875)` style markers → `{name, relative m, AOD}`.
- **Dimension strings with position + orientation** (reuse `extractDimensionsByPage` /
  `dimRuns` / `makeTokenMatcher`), grouped into **chains** along a line.
- **Labels**: room names + areas (`Classroom 01 CA: 50.467 m²`), `LIFT SHAFT`, `Stair Core`,
  `Escape Stair`, `Shaft n Riser n`, `LV`, `Lift 0n`, `Loading Bay`, `ACCESS HATCH`,
  `Parapet`, spot levels on the survey.
- Later (v2): vector **paths** (thick hatched external-wall lines) for outline measurement
  where there is no grid.

### 4.4 The drawing reader — typed by sheet kind

Replace the single Wren-shaped `DrawingObservations` with **one schema per sheet kind**, each
fed the sheet geometry as candidate text (docs/20 §3 trick) and tiled (`drawingTiles.ts`):

- **PLAN (per level):** `outline` as an **ordered list of grid-intersection/offset points**
  (`C2 → D2 → D1 → F1 → F5 → E5 → E6 → B6 → B4 → A4 → A3 → C3`) — *topology, not lengths*;
  where the face is off-grid, the printed offset string that locates it. Plus `cores`
  (lift shaft, stair cores: bounding grid refs + printed internal dims), `openings/voids`
  (stair, lift, riser openings in the slab), `risers` (labels), `entrances per lift`,
  `external doors / fire exits` (for foam info), `features` (LV pits, loading-bay marks).
- **ROOF_PLAN:** roof outline (topology), parapet or open edge per run, roof levels if
  stepped, lift overrun, access hatch/ladder/skylights, plant zones.
- **ELEVATION:** face name + which grid span it shows, level markers used, **ground line**
  at each end, parapet/eaves height, any stepped roof.
- **SECTION:** levels, foundation, lift pit/overrun, stair flights per floor.
- **MARKED_UP** (Wren): the existing schema, unchanged — mark-ups are the answer when present.
- **SITE / LOGISTICS:** text-only extraction (no vision): public road/pedestrian interface,
  hoarding, compound, crane/delivery notes → **flags**.

Post-hoc verification (docs/13 `persist.ts` pattern): every cited printed string must exist
on that sheet's text layer; every grid ref must exist in the sheet's grid system; otherwise
the value drops to low confidence.

### 4.5 The building model (pure, tested) — `buildingModel.ts`

Fuses all sheet readings into one job-level model; **every number carries provenance**
(sheet no., rev, the printed string or "measured from grids at 1:50"):
- `levels[]` (from level tables; conflicts between sheets flagged).
- `footprints[level]`: outline polygon in mm from grid topology → **perimeter**, external /
  internal corner counts, per-face lengths (N/E/S/W via the elevation↔grid mapping).
- `heights`: per face, ground (survey/elevation) → parapet/eaves → scaffold height →
  height band.
- `cores[]`, `shafts[]`, `openings[level][]` with perimeters; `lift entrances per floor`.
- `roof`: edge length by type (parapet/open), access points.
- `constraints`: public road / pedestrian interface / school in operation (from context sheets).
- Cross-checks: outline vs printed overall chains; GF vs 1F vs 2F footprints; plan vs
  elevation widths. Disagreements become review flags, never silent picks.

### 4.6 The scope reader — upgraded for real schedules

Keep the text reader (`draftFromScope`, `scopeText`, `scopeDimension`) and add:
- **Structure:** section headings (Perimeter / Edge Protection / Internal / Cores / Roof…)
  carried onto each line as `section`; the model copies cells verbatim; tested code parses.
- **Blank = we measure.** A line with no quantity is not "unknown", it is "**derive from the
  building model**" — tagged so the fuse step knows to compute it.
- **Per-line hire weeks** (built) · stated counts in text ("Staircase access towers; 2nr").
- **Template capture:** record the client's column layout (w/l/h/Lifts/Hire/Weekly rate/Cost)
  so the output can be written back in their template (§4.10).
- **Picking-list mapping** via aliases; **port alias learning** to the current apply path
  (`applyDrawingDraft` — it only lived in the retired `applyConstructionDraftLines`).
- Email text and multi-sheet workbooks handled as today.

### 4.7 Quantity rules (pure, tested) — `quantityRules.ts`

One small, readable rule per picking-list item, over the building model + the scope line +
**job parameters** (§13 defaults flagged). Each returns `{quantity, lifts, bracket, formula,
provenance[], confidence, flags[]}`. Examples (KE):

| Item | Rule (all params editable per job) |
|---|---|
| Independent scaffold | Σ face lengths + `cornerAllowance × externalCorners` (+ offset) ; lifts = f(height, `liftHeight`) ; band from max scaffold height |
| Additional boarded lift | same run × extra boarded lifts ("lifts at each level") |
| Triple guardrail | scaffold run at top lift |
| Ladder access bays / towers | scope count (or 1 per face as a *suggestion*); lifts from height |
| Slab edge protection | Σ footprint perimeter at each suspended level (1F, 2F, roof) |
| Opening edge protection | Σ opening perimeters per level (lift, stair, riser voids) |
| Leading edge protection | ⚠ basis unknown → blank + "measure by hand" until Colin answers |
| Loading bay / platform / gates | scope count; per lift from height; gates = 1 per bay per lift (param) |
| Internal blockwork scaffold | ⚠ LM of internal walls **or** floor area — Colin param; blank until set |
| Lift shaft / stair core scaffold | lifts from pit→overrun / floor→roof; one per core |
| Riser access platform | count of risers (labels) per level (param: all or top only) |
| Roof edge protection | roof edge length where edge is open; parapet ≥ 950 mm → info flag |
| Temporary handrail | precast stair flights × flight length (param) |

### 4.8 Fuse + verify (pure) — evolves `assemble.ts`

- For each **scope line**: take the stated quantity if given, else the rule's derived
  quantity; if both, **cross-check** (tolerance param) and keep the drawing value + flag.
- **Price exactly the scope:** drawing-only features (e.g. 4 external doors → foam) → an
  *information* list, never lines.
- Every line keeps: client wording (note), section, hire weeks, the formula string, the
  provenance chain, confidence, flags.
- Measurements (docs/19 §4.6) are written from the building model, kept separate from lines.

### 4.9 Background jobs, persistence, cost (reuse house-build patterns)

- New pg-boss queues (worker only): `construction-ingest`, `construction-read-sheet`
  (per sheet, **bounded concurrency** e.g. 3, retry with backoff), `construction-read-scope`,
  `construction-assemble` (runs when all reads for a run settle).
- 🔧 `ConstructionReadRun` (quoteId, status, startedAt, finishedAt, costUsd, promptVersions,
  result Json = the draft) — **the draft is persisted**, not returned to one browser tab
  (today `readConstructionEnquiry` returns it to the client only; a reload loses it).
- 🔧 `ConstructionSheet` (attachmentId, page, drawingNo, title, rev, kind, level, scale,
  relevance, relevanceReason, geometry Json, readStatus, readRawOutput, readMeta).
- **Reuse stored raw output on retry** and **skip unchanged sheets** on a re-run (key on file
  hash + promptVersion) — no double bill.
- Page refresh uses the cheap status-probe pattern (`auto-refresh.tsx`), never a fast
  `router.refresh()` poll.
- Cost/tokens per sheet + per run shown as a small chip; model per run from env
  (`ANTHROPIC_CONSTRUCTION_DRAWING_MODEL`), triage on the cheap model.
- Local dev must not race the Render worker (see the local-vs-Render note): an offline
  runner (`scripts/construction-offline.mts <folder>`) runs the whole pipeline without the queue.

### 4.10 Review + output

**Step 1 Enquiry** becomes the **pack view**: the sheet register grouped by bucket
(core / context / not relevant / junk) with override toggles, per-sheet read status + cost,
and the scope file with its sections. **Step 2 Site facts** is pre-filled from the building
model (height, band, constraints) with provenance. **Step 3 Items** shows each draft line's
formula (`93.8 m + 8 × 1.0 m = 101.8 m × 6 lifts`), provenance on hover linking to the sheet
(opens the reference pane at that sheet), confidence dot, flags. **A "Building" tab** in the
side pane shows the model: levels table, outline with per-face lengths, cores, openings.

**Output:** (a) Airwright's layout (built); (b) 🔧 **client-template mode** — fill the client's
own workbook (w · l · h · lifts · hire weeks · weekly rate · cost) and export it, once Colin
answers how a 30-week line is presented against 4-week-inclusive rates (§13 #4).

---

## 5. Why "AI names the shape, code measures it"

- A1 sheets downsample; small dimension text is the first thing lost. Grid bubbles are the
  **largest** text on the sheet and survive any resolution.
- The model is good at *spatial topology* ("the outline steps in at D between rows 1 and 2")
  and bad at *arithmetic over 30 small numbers*. This split plays to both.
- Code measurement is **checkable**: every grid spacing is verified against the printed chain
  between the same bubbles; an outline that does not close, or disagrees with the overall
  chain, is flagged automatically.
- Fallbacks when a sheet has no grid: printed overall chains (text layer) → vector-path
  measurement (v2) → model estimate at low confidence → blank.

---

## 6. Data model (additive, construction only)

| Change | Why |
|---|---|
| `ConstructionAttachment.relativePath String?`, `contentHash String?`, `bucket String?` (CORE/CONTEXT/NOT_RELEVANT/JUNK/DUPLICATE) | folder uploads, dedupe, register |
| `ConstructionSheet` (new, 1 row per relevant page) | register + geometry + per-sheet read output |
| `ConstructionReadRun` (new) | persisted, resumable, costed read runs; the draft lives here |
| `ConstructionQuote.jobParams Json?` | scaffold offset, lift height, corner allowance… per job (defaults flagged) |
| `ConstructionQuote.clientTemplate Json?` | the client's schedule layout for template output |
| `ConstructionQuoteLine.section String?`, `formula String?`, `provenance Json?`, `confidence String?` | review traceability |
| `ConstructionMeasurement.provenance Json?`, `confidence String?` | same |

No change to house-build tables. One migration per phase.

---

## 7. Evaluation — measure before optimising

Golden set (all gitignored PII):

| Fixture | Shape | What it tests |
|---|---|---|
| `eg-01` Wren | detailed + marked up + schedule with quantities | mark-up reading, call-off cross-check (regression) |
| `eg-02` Murray Park | vague, raster | graceful "measure by hand", no hallucinated dims |
| `cons-data` Stanmore scope | scope-only spreadsheet, 37 rows | scope parsing, per-line hire, mapping |
| `cons-data` Layout & Elevations | A3 raster-ish | tiled reading |
| **KE CN215** | full pack, blank schedule | triage, register, geometry, building model, rules, fusion |

- **Hand-worked KE answer key** (`data/construction/.../ke-answer.json`, gitignored): levels,
  outline per floor, perimeter, corners, cores, openings — built once by hand from the
  drawings; **ideally replaced by Airwright's own CN215 take-off/quote** (§13 #1).
- Metrics: triage precision/recall per bucket; outline perimeter error (target ≤ 1%);
  levels exact; item recall vs the scope (target 100% accounted); quantity within Colin's
  tolerance (100–200 mm on lengths, exact counts); band correct; cost per pack.
- Unit tests for every pure module; an offline runner that prints the register, the
  building model and the draft for a folder, and diffs against the answer key.

---

## 8. Performance and cost

- Only CORE sheets go to vision (~11 on KE, not 36); context sheets are text-only; junk and
  not-relevant sheets cost nothing.
- Tiling (built) keeps A1 legible; the sheet geometry hints mean the model reads labels as
  text, so fewer tiles may be needed per sheet — measure.
- Estimated KE read: ~11 sheets × (overview + ~6 tiles) on Opus ≈ **$3–8 per pack**, a few
  minutes in the background with concurrency 3. Re-runs reuse unchanged sheets for free.

---

## 9. What changes in the existing construction code

| Existing | Change |
|---|---|
| `readConstructionEnquiry` (server action, reads inline) | becomes **enqueue a run**; the reading moves to the worker |
| `readDrawing.ts` + `drawingSchema.ts` (one Wren schema) | per-kind schemas; the Wren schema stays as MARKED_UP |
| `assemble.ts` | split: `buildingModel.ts` + `quantityRules.ts` + fuse; Wren tests kept green |
| `fileKinds.ts` | superseded by the register/junk/relevance rules (keep `looksLikeOurOwnQuote`) |
| `applyDrawingDraft` | reads the persisted run; gains alias learning |
| enquiry step UI | pack/register view + run progress |
| `library.ts` seed | dev library (§4.0) |

---

## 10. Non-goals (still)

- No Google Earth automation; vague raster enquiries stay "measure by hand".
- No auto-pricing, no auto-send; nothing prices before the estimator confirms.
- No invented picking-list items; unmatched scope lines are flagged for a human.
- No cross-job grouping/house types (construction jobs are one-off).
- No change to house-build rules or pricing.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Packs without grids / non-orthogonal buildings | printed chains → vector paths (v2) → low-confidence estimate → blank |
| Scale missing or "NTS" | no measurement from that sheet; use sheets with a scale; flag |
| Multiple buildings / phases in one pack | register groups sheets by building (title/grid system); v1 = one building, flag if more |
| Mixed revisions | latest rev per drawing no.; issue-sheet cross-check |
| Scope item bases unknown (leading edge, internal blockwork) | parameterised rules, blank + flag until Colin answers |
| Cost creep on huge packs | CORE-only vision, per-run budget cap, reuse on retry |
| Dev picking list mistaken for real | "DEV placeholder" on every item; swap via importer + mapping |

---

## 12. Build order (each phase: typecheck + lint + tests + build green; docs + PROGRESS synced)

| Phase | Deliverable | Acceptance |
|---|---|---|
| **P0** Dev picking list | §4.0 seed + restore script; E/H + band % on every rate | Rates → Construction shows the dev list; KE scope maps every line to an item or a flagged gap; extra hire non-zero |
| **P1** Pack ingest (no AI) | folder upload, relativePath, junk/dup filter, title-block register, latest-rev, Tier-1 relevance; `construction-ingest` job | KE: 55 files → 11 core / 3 context + issue sheet / 1 scope / 23 not relevant / 16 junk (docs/23 §5.4) |
| **P2** Sheet geometry (no AI) | scale, grid system, level table, chains, labels | KE: levels exact; A→F within 10 mm of 28,903; all grid spacings verified vs printed chains |
| **P3** Background runs | `ConstructionReadRun`, `ConstructionSheet`, queues, persisted draft, reuse-on-retry, status probe, cost chip | a run survives a page reload; a retry makes no second model call |
| **P4** Typed sheet readers | PLAN / ROOF / ELEVATION / SECTION schemas + prompts + verification; Tier-2 triage | KE GF outline topology matches the answer key; cores/risers/openings found |
| **P5** Building model + rules + fuse | `buildingModel.ts`, `quantityRules.ts`, fuse; job params | KE: perimeter within 1%, levels exact, every scope line accounted; Wren regression green |
| **P6** Scope upgrade | sections, blank=derive, template capture, alias learning ported | KE + Stanmore + Wren schedules parse with sections + per-line hire |
| **P7** Review UX | register view, Building tab, formula + provenance on lines | click-through on KE end to end on real DB |
| **P8** Output | client-template export (after §13 #4) | KE schedule filled in the client's own layout |

P0–P3 need no answers from Airwright. P5's parameters and P8 do.

---

## 13. ⚠ Questions for Airwright (flag, never guess)

1. **Did Airwright price CN215?** Their take-off/quote is the answer key for KE.
2. **Lifts & band:** lift height used for construction (2.0 m?), which height sets the band
   (max scaffold height incl. the top handrail?), and at 11.6–12.35 m which band applies.
   Does "lifts at each level" mean every lift boarded?
3. **Perimeter basis:** scaffold offset from the face, and the corner allowance for
   construction (house-build uses 1 m per external corner).
4. **Hire presentation:** the client asks for a *weekly rate × hire weeks*; Airwright's rates
   include 4 weeks + extra hire per unit per week. How is a 30-week line quoted?
5. **Bases** for: internal blockwork scaffold (LM of wall or floor area?), leading-edge
   protection during precast install, lift-shaft and stair-core scaffolds, riser platforms.
6. **Roof:** with a 1.85 m parapet, is roof edge protection only needed before the parapet
   is built (i.e. priced as temporary)?
7. **Empty "Birdcages" section:** genuinely none required?
8. The final **construction picking list** + the **terminology list** (Laura).

---

*Sources: analysis of `data/construction/BSN Group/King Edward VI College, Stourbridge/`
(probed 2026-09-30: page sizes, text layers, title blocks, levels, grid measurement), the
existing construction code (`src/lib/construction/*`, `src/server/actions/construction*`),
`docs/17` (ingest), `docs/19`, `docs/20`. All client files are gitignored PII.*


---

## As built (2026-09-30) — where the build differs from the plan, and why

- **Queues:** two, not four — `construction-ingest` (sort) and `construction-read` (one run
  reads every sheet with 3 model calls in flight, then assembles). Same guarantees (background,
  resumable, reuse on retry) with one job to track instead of fan-out + completion detection.
  The ingest queue is pg-boss "stately" keyed by job, so an upload burst collapses into one sort.
- **Reader versions are per reader** (`READER_VERSIONS`), so a mark-up prompt change does not
  force a paid re-read of every plan. A sheet's read key = file hash + page + version + kind.
- **Outline is a list of one-line strings** (`"E | 20793 | - | WALL | north wall"`), not objects:
  on dense A1 plans the object form broke the model's tool call. Every reader also detects a
  broken call (raw markup / leaked fields) and retries once.
- **Annotations are flattened before tiling** (`pack/flattenAnnots.ts`) — a pre-existing bug:
  tiling's `embedPage` dropped Bluebeam mark-ups, so Wren's measure sheet read as empty.
- **Mark-ups from .pptx** are redrawn to PDF (picture + shapes + theme colours) and the reader is
  given the file's own shape facts (fill vs band, where each sits, whether a fill matches the
  outer band — i.e. the whole interior). A PDF export with a .pptx twin is read via the PDF with
  the twin's shape facts.
- **Safety nets added from real results:** printed length vs grid distance (a window-width chain
  running past a corner loses to the grid, flagged); floors must agree with each other and with
  the roof plan's overall size, else every perimeter drops to low.
- **Local testing:** `scripts/construction-offline.mts` (no DB) and `scripts/e2e-construction.mts`
  (real DB, in-process, cleans up); `WORKER_QUEUES=construction` for a local worker.


---

## As built (2026-10-01) — Milestones 3 + 4

**M3 · scope mode** (validated on KE, Wren, Stanmore; CBAND / Murray Park stay mode B / flags):
- **Schedule structure is code, not the model** — `scopeTable.ts` reads a spreadsheet scope's
  header (one or two rows), column roles (w · l · h · Lifts · Hire · Weekly rate · Cost …),
  sections (a row with only a name), EMPTY sections (KE "Birdcages"), items and the total; a
  re-sorted duplicate sheet (Stanmore "In Order") is skipped. The reader is given the table row
  by row (`[R12] Independent tied scaffold | Hire Period (weeks): 30`) and returns a `rowRef`
  per line; `attachScopeTables` takes section, hire, lifts, quantity and dimensions from the
  ROW (the model only maps), adds back any row the model missed, clears an unknown ref.
  Counts in the wording ("2nr", "x2") are parsed by code. Headings must be printed in the scope
  (the model may not invent "Email scope"). The scope read is cached on the job
  (`draftRawOutput`, key = text + prompt version + picking list) — a re-run never re-bills it.
  Output cap 20k tokens and a clear error when an answer is cut off (Stanmore's 37 rows broke
  the old 8k cap).
- **Binding** — `bindScope.ts` (pure): each item's ROLE (from its name, works for the real sheet's
  "(A) Con …" names too) picks a rule over the building model: scaffold run (perimeter + corner
  allowance, or the marked faces), boarded lifts "at each level" (⚠ P19), top-lift guardrail,
  counts from the scope (towers, ladder bays, loading bays — blank + "count by hand" when none),
  slab edge per suspended level (⚠ P12), opening edges (only printed sizes), lift gates from
  entrances, risers (⚠ P13b), named cores / shafts, roof edge (open edge, else the wall line under
  a parapet — temporary, P10), inspections (row hire, else longest, P16). Leading edge (P14) and
  blockwork (P5b) stay BLANK with an unknown basis. Client number vs drawing → AGREES / DIFFERS
  (drawing kept, D6). A traced outline that does not close never pre-fills a price. Drawing
  features not asked for → the INFORMATION list. Every scope line is accounted for
  (`ScopeAccount`). A numbered mark-up (Wren) pairs each schedule row with ONE mark-up line by
  lifts, then quantity — no duplicates.
- **Apply** — `applyDrawingDraft` saves section, building, formula, provenance, confidence,
  params, flags, the client's row (`clientRef`) and per-line hire; "replace the lines an
  earlier draft added"; **alias learning restored** on a genuine correction.
- **Engine fixes found on the way** (`outline.ts`): several unprinted walls running the SAME way
  are solved as a TOTAL by closure (KE 1F: 96.036 m from 28.903 + 19.115 printed), low
  confidence + flagged; a printed OVERALL chain beats a partly-scaled grid (D4) — otherwise the
  grid still beats a misread chain. `buildingModel.ts`: opening-edge perimeters (printed sizes
  only), lift shafts and stair cores counted apart, every measurement names its source sheet.

**M4 · screens and output:**
- Pack view: the measurement sheet per building (heights · runs · roof · internal · features),
  confidence, working on hover, source sheets that open the drawing at its page, ⚠ placeholder
  codes, **"Use this"** → a priced line with the measurement's working
  (`addConstructionLineFromMeasurement`). Scope review panel (accounting, empty sections with
  "confirm none required", information list). Draft review grouped by building × section, with
  formula, status, the client's figure and per-line hire.
- Site facts: "From the drawings" (height / lifts / band per building, one click to adopt) and
  the **job settings panel** (P1–P19: value, basis, confirm, reset; "Re-measure" re-runs the read
  with every saved sheet + scope read reused — $0).
- Items: grouped by building × section, formula + confidence + flags + the client's wording and
  figure + live placeholder codes on each line, editable per-line hire; the scope review on top.
- Quote: checks for blank lines, unconfirmed placeholders and unconfirmed empty sections; the
  output format (SECTIONS · SCHEDULE · CLIENT — see docs/19 §10).
- New columns (migration `20261001120000_construction_scope_mode`, additive):
  `ConstructionQuote.scopeReview / outputFormat`, `ConstructionMeasurement.key / sheetRefs`,
  `ConstructionQuoteLine.clientRef / flags`.
- Testing: `scripts/e2e-scope.mts` (real DB, in-process: read → bind → apply → price → sections →
  client template; `--job <id>` re-runs a kept job for free), `scripts/scope-offline.mts` (the
  scope on its own), `scripts/construction-eval.mts --key cband|ke|wren|murray` (answer keys).


---

## As built (2026-10-02) — simplified: reliable numbers, section cards, measuring tool

Grading the reads honestly showed the engine filled too much that could not be confirmed (a
stepped outline traced from one AI read, label-counted risers, opening edges…). Now: automatic =
printed + read by code (+ a second drawing for shape values); everything else is the estimator's
on per-building SECTION CARDS (External / Internal / Birdcage + inspections, matching Quote-1350),
with a MEASURING TOOL on the drawing and ticked ADD-ONS. See docs/23 (top note) and PROGRESS
2026-10-02. Eval (`construction-eval.mts`, rule "right or blank"): CBAND 11/11, KE 13/13, Wren
9/9, Murray Park 3/3.

---

## As built (2026-10-02 b) — three upload boxes, three scenarios

**Why.** Guessing what each file is (scope? drawing? email?) and which mode the job is in was a
source of mistakes, and Scenario 1 was doing far more than a scope job needs (reading and
cross-checking drawings the client had already measured). Now the estimator says what each file
is by where they put it, and a scope job is simply the client's lines priced as written.

**Upload.** Three boxes — **Scope · Drawings · Email**, all optional — on the new-job form and on
step 1 (`enquiry-boxes.tsx`). The box is saved on `ConstructionAttachment.kind`
(`SCOPE | DRAWINGS | EMAIL`) and is the file's label from then on; files unpacked from a zip take
the zip's box. The Drawings box still takes a folder or zip and is still tidied (junk,
duplicates, latest revision, grouped by building). A file from before the boxes gets one from
its type (`boxOf`: email → Email; spreadsheet / text / Word → Scope; else Drawings) — a fixed
rule, not a guess. A spreadsheet dropped in the Drawings box is shown, not read; a scope that is
also inside the drawings folder keeps its Scope-box copy (the register sorts Scope → Email →
Drawings before de-duplicating).

**Scenario = the boxes** (`scenarioFromBoxes`, `register.ts`; stored as `mode`, re-derived on
every sort; the A/B/C auto-detect and the switch buttons are gone):

| Scenario | When | Read | Screens |
|---|---|---|---|
| **1** (`A`) | a scope was uploaded | the scope + the email (extra lines) ONLY | the client's lines, no cards, no job settings |
| **2** (`B`) | drawings, no scope | the drawings, sure things only; email = reference | cards, measuring tool, add-ons (unchanged) |
| **3** (`C`) | anything else | nothing (the read refuses to start) | cards by hand; measuring tool on a photo-plan |

**Scenario 1 (`scopeOnly.ts`, pure, tested).** No drawing is read (no sheet reads, no geometry,
no buildings, no measurements), so there is nothing to cross-check: no AGREES / DIFFERS, no
information list, no confidence, no formula, no cards. Each mapped scope line → one draft line
with the client's own numbers: quantity from the row, else a count in the wording ("2nr",
"1600hrs"); lifts, hire and section from the row; height → band when stated; a line with no
number is left BLANK for the estimator. Kept from the scope reader: per-line hire, `scopeFixes`
(two items in one row, temporary stairs not Haki, "× 2 — in total or each?" kept as a small
note on the line), empty sections ("confirm none required"), P18 = the full hire is priced.
Weekly inspections are priced for the row's hire weeks (the "1" on such a row is one a week).
**The email adds extra lines only:** a prose line (no schedule row) for an item the schedule
already prices is not repeated — it is listed in the flags (Wren: 3 email sentences repeat
schedule rows; the one new item, roof access, is kept blank).

**Eval (all re-run for $0 from cached reads, `e2e-scope.mts --job <id> --resort`):** KE 9/9 and
Wren 11/11 on new Scenario 1 keys (the client's numbers exact, every row drafted, no drawing
reads, empty section, per-line hire, email extras only); CBAND 11/11 and Murray Park 3/3
unchanged (Scenario 2).

