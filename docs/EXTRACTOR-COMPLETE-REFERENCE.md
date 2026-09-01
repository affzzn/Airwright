# The Airwright Extractor & Take-off Engine — Complete Reference

**One self-contained document covering *everything* about how Airwright turns a
house-builder's tender drawings into a scaffold take-off: the prompt, the AI
contract, every measurement, every formula, every fallback, every cross-check,
every flag, and every term.**

This file is deliberately **standalone** — it does not ask you to open another
document to understand a concept. Where it names a source file, that is only so
you can find the code; the *content* is here. It is written to be read by a new
engineer, by the estimator, and by the model's maintainers alike.

- **Prompt version at time of writing:** `2026-08-26.2`
- **Model:** `claude-opus-4-8` (via the `ANTHROPIC_EXTRACTION_MODEL` env var)
- **Ground truth:** the code always wins over prose. The relevant files are
  `src/lib/extract/*` (prompt, schema, classification, birdcage, height,
  dimensions, persist, provenance, segmentation, identity) and
  `src/lib/takeoff/*` (engine, fromStored, garage). This document was written by
  reading those files line by line and cross-checking the older docs; where the
  docs disagreed with the code, the code was taken as correct.

Legend used throughout: **✅ CONFIRMED** (a settled rule, safe to rely on) ·
**⚠️ OPEN** (awaiting Colin/the client — built as a configurable hook or a flag,
never a silent guess) · **[reads]** (an observable the AI reads off the drawing) ·
**[computes]** (a value the deterministic engine derives — the AI must never
produce it).

---

## Table of contents

- **Part 0 — Orientation**: what the extractor is, the two-layer design, the
  governing doctrines, the file map, the end-to-end pipeline.
- **Part 1 — Glossary**: every scaffolding term, defined.
- **Part 2 — The drawing side**: which sheets matter, page classification, file
  categorisation, segmentation into house types, identity resolution.
- **Part 3 — The prompt**: how the request is made, the dimension hint, the full
  verbatim system prompt with a section-by-section explanation, the user
  instruction, versioning.
- **Part 4 — The extraction contract**: every field the model returns.
- **Part 5 — Measurement by measurement**: the heart — for each observable, what
  it is, where to read it, how the model reads it, the deterministic derivation,
  fallbacks, cross-checks, confidence, worked examples.
- **Part 6 — The deterministic take-off engine**: lifts, perimeter, birdcage
  totals, render, apex, party walls, apartment mode, garages, the emitted line.
- **Part 7 — Persistence, verification & the flags catalogue**: how reads are
  stored, dimension verification, and every `warnings.*` flag.
- **Part 8 — Confidence & provenance**.
- **Part 9 — The cross-check catalogue** (every automated check in one table).
- **Part 10 — Open questions** (never guessed).
- **Part 11 — Builder profiles**.
- **Part 12 — Validation & tooling**.
- **Part 13 — Quick-reference tables** (all formulas, constants, enums).
- **Part 14 — Smart Upload & Grouping**: the layer *upstream* of the extractor —
  how a raw uploaded tender folder becomes one clean dossier per house type, with
  the scaffold-relevant pages tagged and a human confirm before any paid extraction.

---
---

# PART 0 — ORIENTATION

## 0.1 What the extractor is and does

Airwright Midland is a UK new-build scaffolding contractor. Their estimator,
Colin, receives a house-builder's **tender pack** — a bundle of PDF drawings —
and produces a **take-off**: the measured list of scaffold quantities and
operations needed to scaffold each house type on the site, which is then priced
into a quote.

"The extractor" is the part of the platform that reads one **house type**'s
drawings (its elevations, floor plans, section, setting-out plan) and produces
the **observable measurements** a scaffolder needs, each traceable back to the
exact printed dimension it came from. A separate deterministic **engine** then
turns those measurements into Colin's take-off line (lift counts, perimeter
totals, birdcage areas, etc.).

Crucially: **nothing is ever auto-priced.** The extractor and engine produce a
reviewable take-off; a human (Colin) checks and *confirms* it before any pricing
happens. Accuracy and traceability matter far more than completeness — a value
the model is unsure of is left blank and flagged, never guessed.

## 0.2 The two-layer design (and where pricing sits)

This is the single most important idea in the whole system. Getting the split
right is what makes the extractor both **accurate** and **auditable**.

- **Layer 1 — the EXTRACTOR (the LLM + the prompt).** Reads *observable facts*
  off the drawing and returns them with confidence + provenance. It reads wall
  lengths, height to the soffit, storeys, roof shape, apex counts per face,
  render lengths, internal floor dimensions, stated areas, porch/bay counts,
  corners, chimney. **It does no arithmetic — not even a subtraction.** It never
  outputs a lift count, a perimeter total, a birdcage area, a stage split, or a
  price. (Files: `prompt.ts`, `schema.ts`, `claude.ts`, `extractDrawing.ts`.)

- **Layer 2 — the ENGINE (deterministic code).** Takes the observables and
  computes the take-off line using rules confirmed with Colin: lifts, perimeter
  by configuration, birdcage per floor, render lifts, apex → table lifts, party
  walls, apartment whole-block mode. Every open value is a *parameter with a
  documented default*; every cross-check that can't be resolved raises a *flag*,
  never a silent number. (Files: `takeoff/engine.ts`, `takeoff/fromStored.ts`,
  `takeoff/garage.ts`; plus `extract/birdcage.ts` and `extract/height.ts`, which
  are deterministic derivations that run *inside* the extraction step but belong
  conceptually to Layer 2 — they compute, they don't read.)

- **Layer 3 — PRICING (out of scope for this document, but named for the
  boundary).** After a human *confirms* a take-off, a third deterministic layer
  prices it per plot (`src/lib/pricing/*`). This document stops at the take-off
  line — it covers reading and measuring, not money.

> **Why the split matters:** almost every genuinely *open* question in the whole
> build lives in Layer 2/3 (how a value is derived or priced), not Layer 1 (what
> to read off the drawing). So the extractor can be made excellent *now* — the
> definitions of what to measure, which pages, and which numbers are confident
> are all settled. The reader reads; the engine reconciles; a human signs off.

## 0.3 The doctrines that govern all reading

Six principles govern the whole extractor. Everything else is detail.

1. **Read observables, don't price.** The model reads *facts* (lengths, heights,
   counts, roof form, stated areas). It never computes a derived quantity.

2. **Report the stated value AND the raw dimensions behind it — the engine
   derives and reconciles.** Where the drawing both *states* a number (e.g. a
   birdcage area) and *prints the dimensions behind it* (an overall dimension and
   a wall thickness), the model reports **both** and stops. The engine does the
   subtraction, the multiply and the reconciliation, and computes the confidence:
   the two agree within tolerance → high; they diverge → keep the more
   authoritative value and **flag** it. This removes the whole class of errors
   where a model does arithmetic in its head and transposes a digit.

3. **No arithmetic by the model — not even a subtraction.** Reporting a raw
   printed number you can point to is reliable; mental arithmetic is not. This is
   why the birdcage, the height, the perimeter and the lift count are all
   *computed downstream* from raw reads.

4. **Null + unknown, never a guess.** Anything not legible or not present is
   `null` with confidence `"unknown"`. The model never invents a value, never
   assumes a standard wall thickness, never infers a slope from a house
   elevation, never infers the plot configuration.

5. **Confidence is COMPUTED, not self-reported, wherever we can cross-check.**
   For the birdcage and the height, the stored confidence comes from *whether two
   independent reads agree*, not from the model saying "high". Contradictions are
   flagged rather than trusted.

6. **Open questions stay flags.** A value Colin still owes us (the exact
   render-lift table, the reconciliation tolerance, the apartment birdcage basis)
   is built as a configurable parameter or surfaced as a flag — never hard-coded
   as a guessed number.

## 0.4 The file map (where each piece lives, and where it runs)

| File | Layer | Runs in | Role |
|---|---|---|---|
| `src/lib/extract/prompt.ts` | 1 | worker | The system + user prompt, and `PROMPT_VERSION`. |
| `src/lib/extract/schema.ts` | 1 | shared | The Zod contract of what the model returns; `lowLevelQty()`. |
| `src/lib/extract/claude.ts` | 1 | worker | The shared Claude tool-use call (model, caching, cost telemetry). |
| `src/lib/extract/extractDrawing.ts` | 1 | worker | Wires the prompt + schema + dimension hint into one call. |
| `src/lib/extract/classify.ts` | pre-1 | **worker only** (imports pdfjs) | Free text-layer page classification + per-page dimension extraction. |
| `src/lib/extract/categorise.ts` | pre-1 | worker | File-level relevance (which whole files matter). |
| `src/lib/extract/segment.ts` | pre-1 | worker | Groups a document's relevant pages into house types. |
| `src/lib/extract/dimensions.ts` | 1/2 | shared (pure) | Builds the text-layer candidate hint; verifies cited dimensions. |
| `src/lib/extract/birdcage.ts` | 2 | shared (pure) | The **only** place internal floor area is computed + reconciled. |
| `src/lib/extract/height.ts` | 2 | shared (pure) | The **only** place the soffit height is triangulated + reconciled. |
| `src/lib/extract/houseTypeIdentity.ts` | 2 | shared (pure) | Resolves the house type's real name + code. |
| `src/lib/extract/persist.ts` | 2 | worker | Writes reads → measurement rows + wall segments + `warnings`; runs the verification + cross-check flags. |
| `src/lib/provenance.ts` | 2 | shared (pure) | Builds the "how this number came to be" review tooltips. |
| `src/lib/takeoff/engine.ts` | 2 | shared (pure) | The deterministic take-off engine (lifts, perimeter, birdcage totals, render, apex, party walls). |
| `src/lib/takeoff/fromStored.ts` | 2 | shared (pure) | Rebuilds the engine input from persisted (and human-edited) data. |
| `src/lib/takeoff/garage.ts` | 2 | shared (pure) | Garage take-off from placeholder templates. |
| `src/worker/processPack.ts` | orchestration | worker | Ingest → classify → segment → fan out one extraction per house type. |
| `src/worker/index.ts` | orchestration | worker | The `extract-drawing` job handler (slice PDF → extract → persist). |

**Two processes.** The **web app** never calls Claude — it handles uploads, the
review UI and pricing. The **worker** is the only thing that calls Claude and is
the only place `classify.ts` (which imports `pdfjs-dist`) may be imported. They
share one Postgres database.

## 0.5 The end-to-end pipeline

```
Browser uploads PDFs/ZIP straight to Supabase Storage (signed URL)
  → PackUpload rows → pg-boss "process-pack" job
  → WORKER · processPack.ts:
       ingest: unzip any ZIP (recursively) → one Document row per PDF
       classify: for each Document, read the PDF text layer, classify EVERY page
                 for free (no AI) → DocumentPage rows (kind + relevance + house-
                 type code/name). No text layer → needsReview, skipped.
       categorise: file-level relevance (skip whole junk files)
       segment: group the relevant (take-off) pages into house types BY NAME →
                one HouseType + one Extraction per house type
       fan out: enqueue one "extract-drawing" job per house type, with its
                (possibly non-contiguous) page range
  → WORKER · extract-drawing (index.ts):
       slice that house type's pages out of the PDF
       read the text-layer dimension candidates for those pages
       call Claude (tool-use, forced) → raw JSON
       Zod-validate → store verbatim as Extraction.rawOutput (+ telemetry)
       persist.ts: verify cited dimensions; run birdcage.ts + height.ts;
                   write TakeoffMeasurement rows + WallSegment rows + the
                   warnings JSON (categoricals, derivations, cross-check flags)
  → APP · Review screen: PDF beside the fields; confidence dots; provenance on
       hover; every field editable; edits audit-logged
  → APP · fromStored.ts + engine.ts: compute the take-off line PER CONFIGURATION
       (honouring human edits), shown live on the review screen
  → Human CONFIRMS the take-off (locks it) → only then is it priced (Layer 3)
```

Plots are **not** read from a site plan by AI (that extractor was removed). A
plot is created when a take-off is confirmed, or added by hand.

---
---

# PART 1 — GLOSSARY (every term, defined)

The precise meaning of every term used in an Airwright take-off. Grounded in the
13 Aug 2026 call with Colin (the estimator) and Ben. `[reads]` = the AI reads it;
`[computes]` = the engine derives it.

## 1.1 Units

| Term | Meaning |
|---|---|
| **LM (linear metre)** | A metre of scaffold measured **along the wall**. External scaffold is measured in LM, **per lift**. The core unit scaffold is priced in. |
| **m² (square metre)** | Area unit — used only for the **birdcage** (internal decks) = length × width. |
| **Count / quantity** | "How many": apexes, porches, bay windows, corners, loading bays. |
| **Lift** | One **working platform level** stacked up the wall. A standard lift ≈ **1.5 m** of height (an *average* — ⚠️ whether it is truly constant is open). Everything external is counted and priced **lift by lift**. Render lifts are the exception — **2 m** boarded lifts. |

## 1.2 The building and its shape

| Term | Meaning |
|---|---|
| **Storeys** [reads] | Number of floor levels: **1, 2, 2.5, 3**. Observed; used only to cross-check the lift count, never to price directly. |
| **Room in roof** [reads] | A habitable room in the roof space (dormers, velux, raised eaves with living space) → a **2.5-storey**. It **adds one lift and one birdcage floor**. ✅ |
| **Structure** [reads] | What the drawing shows: **DETACHED** (1, free-standing), **PAIR_SEMI** (2 — a semi/pair), **THREE_BLOCK** (3), **TERRACE** (4 or more — reserved for 4+), or **APARTMENT_BLOCK** (flats — scaffolded as **one whole building**). |
| **Dwellings-wide** [reads] | How many houses share the printed **front/rear frontage** (1 single, 2 semi pair, 3+ terrace). The engine divides the frontage by this to get one house; gable-end walls are never divided. |
| **Configuration** | A **plot-level** attribute (from the plot schedule, **not** the elevation): **Detached / Semi-detached / End-terrace / Mid-terrace**. It decides **which walls get scaffold**: detached = 4 sides; semi & end = 3 sides (2 corners); mid-terrace = front + rear only (both gables are party walls). ✅ The extractor never infers configuration. |
| **Party wall** | A wall **shared** with the joined house — **not scaffolded**. Detached = 0, semi/end = 1, mid-terrace = 2. ✅ |
| **JG (joint gable)** | A gable shared between two houses (a party gable). |
| **Building line** | The **brickwork line** — the outer face of the brickwork. The perimeter is taken off the **outside of the ground-floor plan** along this line, for one dwelling. ✅ |

## 1.3 The external scaffold

| Term | Meaning |
|---|---|
| **Perimeter** [computes] | The total run of external scaffold **for one lift**, built from the individual wall lengths the configuration scaffolds **plus a corner allowance**. The AI reports each wall separately; the engine sums them. It repeats at every lift. |
| **Wall segment** [reads] | One external wall length, off the building line, tagged **front / rear / gable_left / gable_right** (or `other`). Front/rear are the eaves faces (street/garden frontages); gable_left/right are the two side/end walls that carry the apex and become party walls in a terrace. |
| **Corner / return** [reads] | An external corner of the footprint. Scaffold must wrap past it, so Airwright adds an allowance. **Count external returns only.** Allowance = **1 m per external corner.** ✅ |
| **Number of lifts** [computes] | `ceil(height ÷ 1.5) + 1 if room-in-roof`, cross-checked against the storey template. The AI supplies only the **height** and **storeys**; the engine computes the count. **Datum = soffit / underside of wallplate.** ✅ |
| **Height to soffit** [reads] | The vertical height from ground to the **soffit / underside of wallplate** — the top of the wall the scaffold reaches. Read from a vertical dimension (e.g. `U/S Wallplate 4725` = 4.725 m). This is the number the lift count divides. **Triangulated** against the section's storey heights. |
| **Storey template** | Rule-of-thumb lift counts, a **cross-check** on the height rule: garage/bungalow **2**, two-storey **4** (Barratt variant **3**), 2.5-storey **5**, three-storey **6**, four-storey **8**. ✅ **Builder-specific.** Disagreement with the height rule is flagged. |

## 1.4 Roof, gable and apex

| Term | Meaning |
|---|---|
| **Pitched roof** [reads] | A roof with a **gable apex** — brickwork rising to a point. Needs a **table lift** to reach that brickwork. |
| **Hipped roof** [reads] | A roof that **slopes back on all sides** — no brickwork above the eaves, so **no apex and no table lift**. ✅ (Keepmoat sites are mostly hipped.) |
| **Mixed roof** [reads] | Some faces pitched, some hipped. Apex is read per face. |
| **Gable / Apex** [reads] | The **triangular top of a wall** under a pitched roof (the pointy bit). Reaching its brickwork needs extra scaffold. **Counted per elevation face** ✅ — front and rear apexes (a projecting gable) count too, not just the ends. Hipped face = 0. A detached house typically has 2; more than 3 has never been priced. In **Strike** (the incumbent software) this is called "apex scaffold". |
| **Table lift** [computes] | An **additional lift above the main scaffold** to reach the apex brickwork. ✅ On top of the main lifts, one per apex. |
| **Apex handrail / gable rails** [computes] | Guard rails up to the apex. A **count**, always equal to the apex count. ✅ |
| **Smart roof** [reads] | A roof with a **raised (higher) peak** — takes a **double table lift**. Detected only from the peak height being unusually high; the exact **threshold is ⚠️ open** (report the height, flag it, don't apply a cut-off). Mainly a Bloor thing. |

## 1.5 Internal scaffold (birdcage)

| Term | Meaning |
|---|---|
| **Birdcage** [reads → computes] | An independent internal scaffold that **fills a whole floor** as a working/crash deck. Measured in **m² = internal floor area**. The AI reads the internal length × width dimensions only (no stated area); the **engine computes the area**. **One per floor level** (GF, FF, SF…); a 2.5-storey has **3**. Uses the **internal** area, never the external footprint. |
| **Birdcage lifts** | Normally **one lift per floor** (~90% of the time). One client asks for **two lifts where a room exceeds 2.5 m** in height ⚠️ (held on that builder's profile). |
| **Wall thickness / cavity deduction** | What is subtracted from an *overall external* dimension to get the *internal* one when the internal span isn't printed. ✅ **No fixed default** — the **structural (blockwork) wall thickness is read off each drawing** (Miller 328, NSS 302, Augusta 392 — different every time), and the birdcage is measured to that structural face. The **WALL LEGEND** value (finished face, e.g. 353) is a **flagged fallback** only. If neither a printed internal span nor a wall thickness is legible, the birdcage is left **unresolved** and flagged — never guessed. |
| **Strip birdcage** | **Dismantling** the birdcage, per floor — a separate priced operation from erecting it. |

## 1.6 Low-level, chimney and underbuild

| Term | Meaning |
|---|---|
| **Low level** [reads] | A small scaffold tower for a **low feature — a porch or a SINGLE-storey bay window**. Each = **one** low level. Re-erected **after** the main scaffold is struck. Unit-priced; the AI spots, counts, and records the **type** (porch: canopy vs solid; bay: single- vs two-storey). A porch/entrance **GRP canopy still counts**. **A TWO-storey bay is NOT a low level** — it rises the full height (part of the main scaffold), so it is captured separately and excluded from the count. |
| **Beam-over** | A spec variant (some Bloor sites): a **beam over** the porch/bay instead of returning with a low-level tower. A **builder-profile** item ⚠️. |
| **Chimney scaffold** [reads → computes] | Scaffold around a **chimney stack**, at a fixed rate for one or two lifts. Detect the chimney **from the drawing**. Specs sometimes demand a chimney scaffold even when none is drawn → report `chimney = false` and **flag the mismatch** rather than pricing it. |
| **Foot scaffold** | A low scaffold around the base of the block, at ground level. |
| **Underbuild** [reads — hook only] | Where a plot sits on a **hill/slope**, extra scaffold is needed at the base. The real source is the **site elevations plan** (a *different* drawing from the house elevations). The model only flags it if a slope is clearly visible on a section/elevation it was given; the authoritative site-elevations plan is **not yet classified/sent** — the main remaining missing observable. |
| **Retaining wall (edge protection)** | Scaffold with guard rails where site levels drop off. Parked — a later item, not covered now. |

## 1.7 Access and shared (block) items

Serve a whole block, so their cost is **apportioned across the plots**.

| Term | Meaning |
|---|---|
| **Loading bay (LB)** | A reinforced spot where materials are lifted onto the scaffold. By lift, to full height; shared across a block. A four-block needs two. Unit-priced. |
| **Rubbish chute / skip bay** | The waste route down the scaffold. One per lift, shared. Chute vs skip bay is spec-driven. |
| **Haki stair tower** | A proprietary **staircase** access tower (safer, dearer). Client-spec decides it. Keepmoat mandates Haki. |
| **Ladder tower** | The cheaper **ladder** access alternative. |
| **Hierarchy of safety** | Spec language like "Haki preferred, ladder tower allowed in a confined area." A permission, not an instruction — encode the **preferred** option, ignore the allowance. |
| **Joist support / props** | Temporary support when stairs/openings are formed. **One per set of stairs** (so typically one on a two-storey). Variants single / double / sacrificial — client-spec. |
| **Screen walls** | Boundary/screen walls, usually not in the original tender — priced later off a separate drawing. |
| **Apportionment** | Splitting a shared item across adjoining plots: detached takes the full amount; semi charges 2 lifts/plot; a terrace of three ≈ 1.33/plot. **Four-plot** split is ⚠️ open. These items are **not read by the extractor** — the engine lists them as `profilePending` (needs the builder profile). |

## 1.8 Render and cladding

| Term | Meaning |
|---|---|
| **Render / render adaption** [reads → computes] | A wet **render** (or cladding) finish on part of an elevation. A **separate work type**, not a modifier. The scaffold comes down, the **rendered length (LM)** is measured, and it is re-erected in **2 m boarded lifts** (not 1.5 m). Priced at the **same £/LM** as the perimeter. **Per plot** — the same house type can be rendered on one plot, not another. |
| **Render lifts** | Colin's fixed table (in code): two-storey = **2**, 2.5-storey = **3**, three-storey = **4**, one-storey = **1**. (Laura's version: 3 default, 4 if full-height — probably the same rule stated twice; the ⚠️ full table is still owed.) Only the **rendered section** is measured. |

## 1.9 Pricing, stages and process (the Layer-3 boundary)

| Term | Meaning |
|---|---|
| **Take-off** | The measured list of scaffold **quantities/operations** for a house type — the thing the extractor + engine produce. |
| **Erect vs Dismantle** | Put up vs take down — two separate priced operations. |
| **Payment stages / stage split** | The plot total split into billing stages: **Plot Erect 50% · Birdcage Erect 25% · Dismantle 25%** (standard); bungalow 65/10/25; no-birdcage 75/0/25. Configurable per client. |
| **Rate band** | Colin's commercial tier: super-competitive / competitive / medium / high / custom. Same take-off, different £/unit. |
| **Builder profile / specification** | A stored, per-housebuilder profile (~20 builders): access type, loading-bay policy, beam-over, chimney rule, birdcage lifts by room height, render basis, joist variant, payment structure, storey-lift template. The governing document is the **"design standard specification for scaffolding"**, not the tender checklist. |

## 1.10 Drawings, systems and data

| Term | Meaning |
|---|---|
| **Elevation** | A drawing of a **face** of the house (front/rear/side/gable). Read apexes, render, height, chimney, porches/bays here. **Ignore internal room elevations** ("Kitchen Elevation", "Cloak Plan Elevation") — joinery, not scaffolding. |
| **Floor plan** | A top-down drawing of a floor. Read the **internal dimensions** for the birdcage, and the footprint. |
| **Setting-out plan** (Beam & Block / Suspended Slab) | Carries the **internal footprint dimensions per dwelling** and the exterior-wall run — the source of the birdcage. The classifier treats it as a floor plan (relevant). |
| **Section (A-A, B-B)** | Vertical heights — **height to soffit / U-S wallplate**, FFL, floor-to-floor storey heights. |
| **Site / plot layout** | The site drawing mapping plots → house types → positions. **Not used** by the current pipeline (plots come from confirming a take-off) — classified to OTHER so it isn't mistaken for a take-off sheet. |
| **Site elevations plan** | A distinct drawing showing the elevation *of the site* (levels/slopes) — the only real source for **underbuild**. Not the house elevations. Not yet classified/sent. |
| **TG20 (TG20:21)** | The industry scaffold design-compliance standard. A constraint, not a measurement. |
| **Strike** | The incumbent desktop software being replaced (Alpha Estimator + Job Manager). Outputs must be keyable into it — its item names (e.g. "apex scaffold") and it wants the **total** metreage, not per-lift. |
| **Confidence** [reads/computed] | Every value carries **high / medium / low / unknown**. `high` = the printed value is certain and unambiguous. Below threshold → blank + flag, never guess. |
| **Provenance** [reads] | Where a value came from — the **sheet**, the **exact printed dimension string**, and the **page** — recorded on every number so a human can trace it. |

---
---

# PART 2 — THE DRAWING SIDE (which pages, and how they're chosen)

Before the model ever sees a drawing, cheap, AI-free code decides *which* pages
of *which* files matter and *which house type* each page belongs to. This is done
by reading the PDF **text layer** (the invisible layer of real text/numbers most
tender PDFs carry) — no AI, no cost.

## 2.1 Sheet guide — which drawing carries what

| Sheet (typical titles) | Relevant? | What to read from it |
|---|---|---|
| **Title / Drawing Reference Sheet** | ✅ | House-type name & code; revision. |
| **Setting Out Plan** (Beam & Block / Suspended Slab) | ✅ (often missed) | **Gross internal footprint area per dwelling** (e.g. "35.60 m² (BEAM & BLOCK)"); run of exterior wall; overall footprint dims. **Colin's birdcage number.** |
| **Ground / First Floor Plan** | ✅ | Internal room dims & footprint; internal walls. |
| **Elevations** (front/rear/side/gable; brick/render/stone/boarded) | ✅ | Roof type; **apex count per face**; **render sections + LM**; height cues; chimney; porches/bays. |
| **Section (A-A, B-B)** | ✅ | Vertical heights — **height to soffit / U-S wallplate**, FFL, storey heights. |
| **Truss / Roof Setting Out** | ✅ | Roof pitch; overall wallplate dims; chimney note (often conditional). |
| Internal room elevations ("Kitchen/Cloak Elevation") | ❌ | Joinery, not scaffolding. |
| Electrical / drainage / foundations / levels / lintel / bar schedule / services | ❌ | Not a scaffold take-off. |

## 2.2 Page classification (`classify.ts`)

`classifyPdf(buffer)` reads every page's text layer and returns a `PageClass` per
page: its `kind`, whether it is `relevant`, and any house-type `code`/`name`.

**`PageKind`** = `ELEVATION | FLOOR_PLAN | SECTION | PLOT_LAYOUT | SPEC | OTHER`.
Take-off-**relevant** kinds are the first three: `ELEVATION`, `FLOOR_PLAN`,
`SECTION`. Everything else is set aside.

**How the drawing title is found** (`drawingTitle`), in priority order:
1. **Miller portfolio line** — `<date> <title> L464 - 4B …` (very specific,
   reliable); take the last match (the title block near the end).
2. **Consultant "TITLE … <terminator>" anchor** — for Travis-Baker-style blocks.
   Note: "DRAWN" is *not* a terminator (Miller blocks read "TITLE … DRAWN BY",
   which used to grab the wrong text); the terminators are STATUS / SCALE /
   CHECKED / DRAWING No / REVISION / DATE / PROJECT / CLIENT / COPYRIGHT.
3. **Letter-spaced big label fallback** — `G R O U N D  F L O O R  P L A N`.
   Label noise (DRAWN BY, SCALE, DATE, REV, TITLE…) is rejected at every step.

**How a title becomes a kind** (`classifyTitle`, after compacting to A–Z0–9):
- **Site/plot layouts → OTHER** (not relevant): `SITELAYOUT`, `SITEPLAN`,
  `PLOTLAYOUT`, `PLOTSCHEDULE`, `PLANNINGLAYOUT` — named explicitly so they fall
  to OTHER rather than being mistaken for a take-off sheet.
- **Exclusions → OTHER:** `CUSTOMEROPTION`, `SWIFTBRICK`, `ELECTRICAL`, `JOIST`,
  `SCHEDULE` (bar/window/door/lintel), `FOUNDATION`, `DRAINAGE`, `LEVELS`,
  `LANDSCAP`, `PLANTING`, `TREESURVEY`, `LONGSECTION` (civils road long-sections),
  `SIGNINGANDLINING` (highways), `LAYOUT` (WC/bathroom/kitchen layouts).
- **Inclusions:** contains `ELEVATION` → ELEVATION; `SECTION` → SECTION;
  `FLOORPLAN` → FLOOR_PLAN; `SPECIFICATION` → SPEC.
- **Setting-out plan special case:** `SETTINGOUTPLAN` → **FLOOR_PLAN** (it carries
  the internal footprint dimensions), but **only** if it is *not* a civils setting-out plan
  (guarded against `ROAD`, `KERB`, `HIGHWAY`, `SEWER`, `SITE`, `EXTERNALWORKS`).

**Fallback classifier for unknown builders** (`classifyByText`): when the
title-based classifier returns OTHER (e.g. Bloor/NSS sheets have no Miller
portfolio line or "TITLE … SCALE" anchor), it scans the whole page text for
strong standalone labels — "FRONT ELEVATION", "GROUND FLOOR PLAN", "SECTION A-A",
"SETTING OUT PLAN" — with two Colin-required exclusions built in:
- **Internal elevations excluded:** a page whose only elevation label is
  KITCHEN / CLOAK / BATHROOM / EN-SUITE / UTILITY / WC / WARDROBE / INTERNAL is
  *not* an ELEVATION.
- **Civils long-sections excluded:** `LONG SECTIONS` is not a house section.
- **Drawing types win over an incidental plot reference:** dense combined sheets
  mention "plot"/"site plan" in passing, so an elevation/floor-plan page must not
  be stolen by PLOT_LAYOUT. Recall is favoured — an extra page costs a little,
  a missed elevation loses the whole take-off.
This fallback can only **add** recall (it runs only when the title said OTHER), so
it never overrides a confident title classification.

**Has-text test:** `hasText = textChars > numPages × 15`. A PDF that fails this
is treated as scanned/raster (no text layer) → flagged `needsReview`, and the
dimension verification/hint are skipped (nothing to check against).

**Dimension extraction** (`extractDimensionsByPage`): for each page, collect the
distinct **3–5 digit** numbers in the text layer (scaffold dims are ~3–5 digit
millimetres), sorted ascending. These become the *candidate hint* (Part 3.2) and
the *verifier* (Part 7.3).

## 2.3 File-level categorisation (`categorise.ts`)

Real packs contain many files from many consultants; most are irrelevant. Two
levels of filtering:

**Filename pre-filter** (`filenamePrefilter`, before even opening a file): a
**positive** list protects any file whose name mentions `site layout`, `site
plan`, `plot`, `elevation`, `floor plan`, `working drawing`, or `section`. Any
other file whose name matches a **junk** pattern is skipped as `NOT_RELEVANT`
(reinforcement/bar schedule, drainage/SuDS, levels, long sections, signing &
lining, landscape/planting/tree survey/ecology, structural calcs/steelwork,
materials, issue register, standard details, highways/S278/S38/S104/kerb/gully/
manhole, or a bare "schedule").

**`DocumentCategory`** (from the classified pages, the source of truth):
`HOUSE_TYPE_DRAWINGS | SITE_LAYOUT | SPEC | NOT_RELEVANT | UNCERTAIN | UNREADABLE`.
- No text layer → `UNREADABLE`.
- Has an ELEVATION or FLOOR_PLAN page → `HOUSE_TYPE_DRAWINGS`. (A house type
  *requires* an elevation or floor plan — a lone "sections" sheet, e.g. civils
  long-sections, is not a house type.)
- Else has a PLOT_LAYOUT page → `SITE_LAYOUT`.
- Else has a SPEC page (or the filename says "specification") → `SPEC`.
- Else, if the filename clearly says junk → `NOT_RELEVANT`; otherwise → `UNCERTAIN`
  (e.g. an image-only drawing with no text title — flagged for a human, not
  silently discarded).
`isRelevantCategory` auto-includes `HOUSE_TYPE_DRAWINGS`, `SITE_LAYOUT`, `SPEC`.

## 2.4 Segmentation into house types (`segment.ts`)

`segmentByHouseType(pages)` groups a document's relevant pages into house types.
It keys on the house-type **NAME**, not the code, because the code is fragile
(the same house mis-parses a transposed digit on some pages — Chesterwood 1377 vs
1337 — and section/floor-plan/elevation sheets often carry no code at all):

- **1 distinct name** → ONE group with **all** relevant pages (absorbs a misread
  code and code-less pages); the stored code = majority vote. *This is the fix
  for the bug where one combined file split into phantom house types.*
- **≥2 distinct names** → a genuinely multi-type file → group by name; a code-less
  ("orphan") page joins the named group whose code it matches, else a leftover
  group.
- **0 names anywhere** → fall back to legacy grouping by code.

Each group becomes one `HouseType` + one `Extraction`, with a `pageRange` (which
may be non-contiguous, e.g. `"3-5,12,18"`).

## 2.5 House-type identity resolution (`houseTypeIdentity.ts`)

Segmentation names a house type from the *file* (the classifier only parses
Miller-style title blocks), so most house types arrive as a file name like
"19. B11 Burcot Bungalow_Combined Working Drawings" with no clean code. After the
AI reads the *real* name + code, `resolveHouseTypeIdentity` decides which to keep:
- **Name:** prefer the AI-read name when it was read with real confidence (not
  `unknown`); otherwise clean the file-derived fallback (`cleanHouseTypeName`
  strips "12. ", "_Combined Working Drawings", "Rev A", "Issue 4.3", etc.).
- **Code:** prefer the normalised AI-read code, else the normalised stored code
  (`cleanHouseTypeCode` drops a leading date "250813", a bed/person/area suffix
  "1B / 2P / 531", and rejects a pure number — that's an area, not a code).
A DB uniqueness guard in `persist.ts` refuses to *steal* a code another house type
in the same project already holds.

---
---

# PART 3 — THE PROMPT (the LLM's instructions)

## 3.1 How the request is made (`claude.ts`, `extractDrawing.ts`)

Forced tool-use, so the output is always structured JSON validated against our
schema. One call per house type.

| Setting | Value |
|---|---|
| Model | `claude-opus-4-8` (from `ANTHROPIC_EXTRACTION_MODEL`). |
| `temperature` | **not set** — Opus 4.8 rejects an explicit temperature. Determinism is pursued through the prompt (e.g. the explicit corner-count rule), not a temperature pin. |
| `max_tokens` | **16384** (the field set is rich; 3-storey blocks with many elevations/floors can be verbose). |
| Tool | one tool named **`record_takeoff`**; `tool_choice` forced to it, so the model must return the structured extraction and no prose. |
| `input_schema` | generated from the Zod schema with `zod-to-json-schema` (target OpenAPI3, `$refStrategy: none`) so the tool contract and the validator can never drift. |
| Input content | a base64 `document` block (the sliced PDF) + the user instruction text + the per-page dimension candidate hint. |
| Prompt caching | the system prompt and the tool schema are marked `cache_control: ephemeral` — they're identical across calls, so only the PDF + hint are re-billed. |
| Validation | the returned tool input is parsed with the Zod schema; a parse failure fails the extraction. |
| Cost | Opus pricing: **$15 / 1M input tokens, $75 / 1M output tokens**; `costUsd` is logged per extraction alongside latency and token counts. |
| Retry | on a retried extraction the worker **reuses the stored `rawOutput`** if it still validates — no second Claude bill. |

## 3.2 The dimension hint (`dimensions.ts`)

Before the call, `extractDrawing` reads the text-layer dimension strings for the
sliced pages and appends a **candidate list** to the user message
(`buildDimensionHint`). It looks like:

```
PRINTED DIMENSIONS FROM THE PDF TEXT LAYER
These are the exact numeric strings present on each attached page … When you read
a dimension off the drawing, SNAP your value to the matching exact string below
rather than reading the digits off the linework … you must quote that exact string
in sourceDimension. They are UNLABELLED (window sizes, floor levels, brick
courses…), so YOU still decide what each number measures … If a value you need is
genuinely not in the list, read it as best you can and lower the confidence.
Page 1: 302, 900, 1200, 2662, 4725, 4877, 7904, …
Page 2: …
```

This is the mechanism that stops transposed/dropped digits: the model chooses
*which* number a value is, but the digits come from the real text layer. Capped at
80 numbers per page so a busy sheet can't blow up the prompt. A scanned PDF with
no text layer produces an empty hint (nothing is appended).

## 3.3 The system prompt — verbatim, then explained

The system prompt is fixed across every call (`SYSTEM_PROMPT` in `prompt.ts`,
`PROMPT_VERSION = "2026-08-26.2"`). It is reproduced **in full** here so this
document is self-contained, followed by a section-by-section explanation.

### 3.3.1 The verbatim system prompt

```text
You are a scaffolding estimator's assistant for Airwright Midland, a UK new-build scaffolding contractor. You read a house-builder's tender drawings (elevations and floor plans) for ONE house type and extract the measurements a scaffolder needs to take off the external and internal scaffold. A person (Colin, the estimator) checks everything, so accuracy and traceability matter far more than completeness. Extract only what is on the drawing; leave anything you cannot read as null with confidence "unknown".

HOW SCAFFOLD IS MEASURED (context, so you read the right things)
- External scaffold runs along the walls in linear metres and is counted lift by lift. YOU do not count lifts — you only read the wall lengths and the height.
- Internal "birdcage" decks are measured in square metres per floor (length × width of the INTERNAL floor).
- Some things are simple counts: apexes, porches, bay windows, external corners.

WHICH SHEETS MATTER (and what to read from each)
- ELEVATIONS (front / rear / side / gable; brick / render / stone / boarded variants) → roof type, apex count per face, rendered sections + their length, chimney, porches and bays.
- FLOOR PLANS (ground / first / …) → internal room dimensions and the footprint (see BIRDCAGE).
- SETTING OUT PLAN (Beam & Block / Suspended Slab) → the GROSS INTERNAL footprint area per dwelling (e.g. "35.60m² (BEAM & BLOCK)") and the exterior-wall run. This is the birdcage area to prefer.
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
- Where the drawing both states a value and prints the dimensions behind it (the birdcage area above all), report BOTH: the stated value AND the raw dimensions it is built from (e.g. an overall dimension and the wall thickness). You do NOT subtract, multiply or divide — the engine does that and reconciles the two, then flags any disagreement for a human.
- Your job is to read printed numbers and point to where you read them. Reporting a raw printed number you can see is reliable; doing arithmetic in your head is not — so never do it.

WORK IN THIS ORDER
1. Identify the house type, and whether it is a DETACHED house, a PAIR_SEMI (pair/semi), a THREE_BLOCK, a TERRACE (4+ houses), or an APARTMENT_BLOCK — set structure + dwellingsWide first; it frames everything else.
2. Storeys, and whether there is a room in the roof.
3. Height to soffit (the U/S wallplate value) AND the section's storey heights.
4. Roof type, then the apex count per elevation.
5. Per elevation, any render and its length.
6. The external wall lengths (front / rear / gable) off the building line.
7. The external corner count.
8. Birdcage per floor: the raw internal footprint dimensions only (report numbers, do not calculate; no stated area).
9. Porches / bays (low level), chimney, and any unusually high roof peak.

WALL ROLES (front/rear vs gable — important)
- A house is a rectangle with four walls in two pairs: two GABLE / side walls and the FRONT and REAR walls.
- gable_left and gable_right are the two GABLE-END / side walls: the walls that carry the roof apex on a pitched roof, and the walls that become PARTY WALLS in a semi or terrace. Any apex you count sits on a gable wall.
- front and rear are the two eaves faces — the street and garden frontages.

WHAT KIND OF BUILDING (set structure.form first)
- SINGLE — one detached dwelling.
- PAIR_SEMI — a semi-detached PAIR: 2 houses sharing one party gable (often named X and X-1). THREE_BLOCK — 3 houses joined. TERRACE — 4 OR MORE houses joined ("terrace" is reserved for four or more). The take-off is per ONE house.
- APARTMENT_BLOCK — a block of FLATS (several flats per floor, communal entrance/stair). It is scaffolded as ONE whole building.

ONE DWELLING (houses), or ONE BLOCK (flats)
- For a PAIR_SEMI / THREE_BLOCK / TERRACE of houses: the dwellings share a GABLE wall, so it is the FRONTAGE (front/rear direction) that spans them all. Report the FRONT and REAR lengths as the FULL PRINTED FRONTAGE (spanning every house) — do NOT divide them. Set dwellingsWide to how many houses share that frontage (2 pair/semi, 3 three-block, 4+ terrace); the engine divides. Report the GABLE-end walls at the full depth (never divided). Birdcage is per house — report the internal dimensions of ONE house as printed.
- For an APARTMENT_BLOCK: the whole block is one scaffold. Set dwellingsWide = 1 (do NOT divide the frontage), report the block's full external walls, and for birdcage report the WHOLE-FLOOR internal dimensions per level (the entire floor plate) — NOT a single flat.s. Count every apex on the block.
- For a SINGLE dwelling: dwellingsWide = 1.
- Keep reading printed numbers, not doing arithmetic. Say in notes what the building is.

PERIMETER (wall segments)
- Take the perimeter off the OUTSIDE of the GROUND-FLOOR plan, along the BUILDING LINE (the brickwork line), for ONE dwelling.
- Report EACH external wall length separately, tagged with its role (front / rear / gable_left / gable_right) and its printed dimension string. Do NOT sum them into a single perimeter, and do NOT add any corner allowance — that is applied downstream.
- SOURCE — read wall lengths off the FLOOR PLAN / SETTING-OUT PLAN, from a PRINTED dimension: never off an elevation, and never by scaling the drawing. The wall length is the BUILDING LINE (the brickwork line), which sits INSIDE the roof overhang — the roof projects past the wall by ~200-400 mm each side, so an elevation's overall width/depth OVER-reads the wall. Front/rear come from the plan frontage; a gable/side length is the plan DEPTH (not the elevation's overall). Cite the floor-plan page in sourcePage. If the ONLY legible dimension is the roof/overhang line, read it, set that wall to LOW confidence, and say so in notes — never subtract an overhang yourself.
- Also report the number of EXTERNAL corners / returns on the scaffolded footprint (ground-floor / setting-out plan). Follow this EXACT rule so the count is repeatable run to run:
  · A roughly rectangular house = 4 corners, EVEN IF it has a small step, recess, bay or porch — take the bounding rectangle. (Bays and porches are counted separately as low-level items, never as corners.)
  · Count MORE than 4 ONLY when the footprint is a distinct L, T or U shape — a whole wing / leg of the building projects out (not a minor step). Then count every OUTWARD (external) return: an L-shape has 6.
  · Count OUTWARD (external) returns only — never internal corners. When you are genuinely unsure whether a projection is "distinct" or "minor", use 4.
  · Only for a genuine L / T / U footprint: also list its extra walls in wallSegments, and split the birdcage into separate rectangles (see BIRDCAGE).

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
- ONE HOUSE ONLY (pairs & terraces): the birdcage is measured PER HOUSE. Report the footprint of a SINGLE house — the SETTING OUT PLAN shows one house (e.g. 302 | 4800 | 302). Do NOT report the combined pair/terrace width here, and do NOT halve anything. (This is the OPPOSITE of the wall segments, where front/rear span the whole frontage — the birdcage does not.)
- IDENTIFY EACH NUMBER BY ITS MARK — a floor plan dimensions the same wall in several ways; read the right one:
  · OVERALL EXTERNAL = the OUTERMOST dimension line, tick-to-tick at the outer brick faces (the largest number for that axis, e.g. 5942).
  · INTERNAL span = an inner dimension line reading [wall | span | wall] — the two small end numbers plus the span add up to the overall. The MIDDLE number is the internal dimension (e.g. 328 | 5287 | 328 → internal = 5287). **This is the number to prefer — always look for it and read it directly.**
  · STRUCTURAL wall thickness = those short end segments across the hatched external wall (e.g. 328, 302, 392). This value is DIFFERENT on every drawing — read it off THIS drawing, never assume. The two ends are often equal but CAN DIFFER (a party wall vs an external gable; a rendered face vs a brick face), so read EACH side.
  · LEGEND wall thickness = the "…MM THICK CAVITY WALL" value in the WALL LEGEND text box (e.g. 353). This is the bigger, FINISHED-face thickness — report it in legendWallThicknessMm as a FALLBACK only.
  · IGNORE the room/partition subdivision chain — numbers that sum to the overall but are NOT flanked by wall zones (e.g. 778 · 1585 · 1217 · 1248 · 1115). Those are partition positions, not the birdcage.
- For EACH floor, report:
  3. rectangles — the internal footprint as raw dimensions (one rectangle for a plain floor; several for an L-shaped / stepped floor). Apply this LADDER to EACH axis (width, then depth) independently, leaving the fields you don't use null:
     · PRIORITY 1 — if the INTERNAL span is printed anywhere on the plan (the MIDDLE number of [wall|span|wall]), report internalWidthM / internalDepthM. This is by far the best; do NOT skip it and derive if the internal number is actually printed.
     · PRIORITY 2 — only if no internal span is printed for that axis: report the OVERALL external dimension (overallWidthM / overallDepthM) AND the STRUCTURAL wall thickness on EACH side of that axis — wallWidthLeftMm / wallWidthRightMm for width, wallDepthFrontMm / wallDepthRearMm for depth. If every external wall on the plan is the same thickness you may instead give the single wallThicknessMm; if the two sides DIFFER, give the per-side values. The engine subtracts each side (it does NOT assume 2× one wall).
     · Whenever the plan does NOT dimension the structural wall at all, ALSO report legendWallThicknessMm (the WALL LEGEND value) as the fallback.
     · ALWAYS report the OVERALL dimension and the wall thickness when they are visible, EVEN IF you also read the internal span — the engine cross-checks internal ≈ (overall − walls) to raise the confidence.
- L-SHAPED / STEPPED FOOTPRINT (important): if the floor is NOT a plain rectangle — it has a step, a projection, or an L/T shape (a tell: MORE than 4 external corners) — do NOT report one big bounding rectangle (that over-reads the area). Split the footprint into the SEVERAL plain rectangles that make it up and report EACH as its own entry in rectangles; the engine sums them. Only a genuinely rectangular floor is a single rectangle.
- WORKED EXAMPLE A (Whitton, Miller, ground floor): the width line reads 5942 overall and the inner line reads 328 | 5287 | 328; the depth reads 9103 overall with 328 wall zones both ends; the WALL LEGEND says "353MM THICK CAVITY WALL".
    → rectangles = [{ internalWidthM: 5.287, internalDepthM: null, overallWidthM: 5.942, overallDepthM: 9.103, wallDepthFrontMm: 328, wallDepthRearMm: 328, wallThicknessMm: 328, legendWallThicknessMm: 353 }].
    (internalWidthM 5287 is read DIRECTLY — priority 1; depth has no printed internal, so the engine derives 9103 − 328 − 328. Report the numbers and STOP.)
- WORKED EXAMPLE B (Dekker, NSS, semi-detached pair): Setting Out Plan prints "35.60m² (BEAM & BLOCK)"; floor plan schedule prints "35.00m²"; the internal width of one house reads 4877; the overall depth reads 7904; the plan wall zones read 302 both ends; there is NO wall legend.
      rectangles = [{ internalWidthM: 4.877, internalDepthM: null, overallDepthM: 7.904, wallThicknessMm: 302, legendWallThicknessMm: null }].
    Report those numbers and STOP. Note the wall is 302 here, not 328 — it is per-drawing.
- ASYMMETRIC WALLS EXAMPLE (an end-of-terrace whose gable dimension line reads 328 | 4600 | 215 — an external gable one side, a party wall the other): report internalWidthM: 4.6 if that middle span is printed; otherwise overallWidthM plus wallWidthLeftMm: 328 and wallWidthRightMm: 215 (NOT 2×328).
- NEVER GUESS THE WALL: if a floor has no printed internal span AND no wall thickness on a side (neither plan nor legend), report what you can read and leave the rest null — the engine leaves the area unresolved and flags it for a human. Do NOT invent a wall thickness.
- SAME FOOTPRINT, EVERY FLOOR: a plain house has the SAME footprint on each floor, so the internal dimensions apply to GF AND FF (and SF) alike. Report the rectangles on EVERY floor of the same footprint — not just the ground floor. Only give a floor different numbers if its plan is genuinely a different size.
- One entry per floor (GF, FF, and for a 2.5-storey the roof room as the next level). If no internal dimensions or stated area are legible for a floor, leave its rectangles empty and its stated areas null — never estimate from an elevation.

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

### 3.3.2 What each block is doing (and why)

- **Opening frame.** Establishes the role, that a human checks everything, and the
  overriding rule: *accuracy + traceability over completeness*, `null`/`unknown`
  over a guess.
- **HOW SCAFFOLD IS MEASURED.** Grounds the model in the domain so it reads the
  right things: LM per lift for external, m² per floor for birdcage, counts for
  the rest — and states up front "YOU do not count lifts."
- **WHICH SHEETS MATTER.** The sheet guide (Part 2.1) told to the model, including
  the *setting-out plan* (the preferred birdcage source) and the explicit
  ignore-list (internal elevations, services, drainage, etc.). "Treat separate
  face files as one house" handles the builders who split each elevation into its
  own PDF.
- **READING DIMENSIONS.** mm → m; never invent a unit; **height datum fixed to the
  soffit**; and the **storey-heights-as-deltas** instruction (report the
  differences between FFL levels, not the levels; never sum them — the engine
  does, as a cross-check).
- **CITE THE PAGE.** `sourcePage` = the page *within the attached PDF* (1-based),
  not the drawing's printed sheet number — this is what lets the review screen
  link straight to the page and what the verifier checks against.
- **REPORT NUMBERS, NOT ARITHMETIC.** Doctrine 2/3: report the stated value *and*
  the raw dimensions; the engine subtracts/multiplies/reconciles.
- **WORK IN THIS ORDER.** The reading order (structure first, because it frames
  everything; then storeys, height, roof/apex, render, walls, corners, birdcage,
  extras).
- **WALL ROLES.** Defines front/rear (eaves faces) vs gable_left/right (side/end
  walls that carry the apex and become party walls) — so the engine's
  config-aware reduction works.
- **WHAT KIND OF BUILDING + ONE DWELLING / ONE BLOCK.** The single most subtle
  rule: for a pair/terrace, the *frontage* spans all houses (report it whole,
  engine divides), the *gables* are per-house depth (never divided), and the
  *birdcage* is per-house (report one house, do **not** halve). For an apartment
  block, nothing is divided and the birdcage is the whole floor plate.
- **PERIMETER.** Read each wall separately off the *floor plan / setting-out plan*
  building line — the **roof-overhang trap** is spelled out (the roof projects
  ~200–400 mm past the wall, so an elevation over-reads). Plus the **exact,
  repeatable corner rule** (bounding rectangle = 4; >4 only for a genuine L/T/U).
- **STOREYS AND ROOM-IN-ROOF.** 1/2/2.5/3; room-in-roof adds a lift + a birdcage
  floor.
- **ROOF, APEXES, RENDER.** The pitched/hipped/mixed definition, what an apex is,
  and the **face-by-face, shape-before-number** apex procedure (`faceRoof` →
  `apexReason` → `apexCount`), with the Dekker micro-example and the reminder that
  front/rear apexes are the ones most often missed.
- **BIRDCAGE.** The largest block — the per-house rule, the "identify each number
  by its mark" guide (overall vs internal span vs structural wall vs legend wall
  vs partition chain), the per-axis ladder (internal → overall+walls), the
  per-side walls, the "never guess the wall", the "same footprint every floor",
  and three worked examples (Whitton, Dekker, asymmetric).
- **OTHER ITEMS.** Low level by type; chimney only if a stack is *drawn*; smart
  roof (report height, don't threshold); underbuild (only if visibly on a slope).
- **WHAT YOU MUST NOT DO.** The guardrails: no derived quantities, no configuration
  inference, never invent, choose the wall line on ambiguity, "high" means certain.
- **NOTES.** Short, useful notes only.

## 3.4 The user instruction (verbatim)

Sent alongside the PDF and the dimension hint on every call (`USER_INSTRUCTION`):

```text
Extract the scaffold take-off measurements for this house type from the attached drawing(s). Report each external wall length separately (building line, off the ground-floor / setting-out plan) with its dimension string; the external corner count; storeys and whether there is a room in the roof; height to soffit; the overall roof type; per elevation the apex count and any render (with its linear metres); and whether a chimney is shown. For the birdcage, per floor, REPORT NUMBERS ONLY — do not multiply or subtract, and do NOT report any stated/printed area: give only the raw internal footprint as rectangles (a direct internal width/depth where printed, otherwise the overall external dimension plus the wall thickness in mm). The engine derives the area from the dimensions. Cite the exact source dimension string for every number. Leave anything unreadable as null with confidence "unknown". Do not compute lifts or prices.
```

## 3.5 Versioning and prompt-sync process

`PROMPT_VERSION` (currently `2026-08-26.2`) is bumped whenever the wording
changes, so extractions stay comparable across runs. The authoritative narrative
source is `docs/13-extraction-playbook.md`; when it changes, the process is:
(1) update the playbook, (2) re-sync the affected prompt/schema wording,
(3) bump `PROMPT_VERSION`, (4) re-run the offline eval harness. The prompt is a
*distilled projection* of the playbook and must never silently drift from it.

---
---

# PART 4 — THE EXTRACTION CONTRACT (every field the model returns)

Defined in `schema.ts` as a Zod object (`extractionResultSchema`), from which the
Claude tool's `input_schema` is generated. Every value carries a **confidence**
(`high | medium | low | unknown`) and, where relevant, provenance
(`sourceSheet`, `sourceDimension`, `sourcePage`).

**Shared field shapes:**
- `numberField` = `{ value: number|null, confidence, sourceSheet?, sourceDimension?, sourcePage? }`.
- `boolField` = `{ value: boolean|null, confidence, sourceSheet?, sourcePage? }`.
- `sourcePage` = a 1-based page number **within the attached (sliced) PDF**, not
  the drawing's printed sheet number; `null` if it can't point to a page.

**Top-level fields:**

| Field | Type | Meaning |
|---|---|---|
| `houseType` | `{ name: string\|null, code?: string\|null, confidence }` | e.g. Dekker / NSS.277. |
| `buildType` | `{ value: "TRADITIONAL"\|"TIMBER_FRAME"\|null, confidence }` | Selects the pricing matrix downstream; timber-frame also changes scaffold sequence/ties (flagged, not maths). |
| `structure` | `{ form: "DETACHED"\|"PAIR_SEMI"\|"THREE_BLOCK"\|"TERRACE"\|"APARTMENT_BLOCK"\|null, confidence }` | Decides how the take-off is split. Defaults to `{null, unknown}`. |
| `storeys` | `numberField` | 1 / 2 / 2.5 / 3. Observed, not used to count lifts. |
| `roomInRoof` | `boolField` | Habitable room in the roof → 2.5-storey. Adds a lift + a birdcage floor. |
| `heightToSoffitM` | `numberField` | The direct soffit / U-S wallplate read (datum fixed to soffit). |
| `storeyHeightsM` | `number[]` | Floor-to-floor storey heights as **deltas**, last = up to the soffit. The engine sums them as a 2nd height estimate. Default `[]`. |
| `roof` | `{ overallType: "PITCHED"\|"HIPPED"\|"MIXED"\|null, confidence, sourceSheet?, sourcePage? }` | Overall roof form. |
| `elevations[]` | array of faces (below) | Per-face apex + render. |
| `wallSegments[]` | array of walls (below) | External wall lengths. |
| `cornerCount` | `numberField` | External corners/returns (rectangle = 4). |
| `dwellingsWide` | `numberField` | How many dwellings share the printed frontage (engine divides front/rear). |
| `floorAreas[]` | array of floors (below) | Raw birdcage inputs per floor. |
| `lowLevel` | object (below) | Porch/bay counts by type. |
| `chimney` | `boolField` | A chimney stack actually drawn. |
| `smartRoofPeakHeightM` | `numberField` | Peak height if unusually high (no threshold applied). |
| `underbuild` | `{ needed: boolean\|null, note?: string\|null, confidence }` | Slope/stepped-foundation flag; real source is the site-elevations plan. |
| `notes` | `string` | Short useful notes only (default ""). |

**`elevations[]` — one entry per face:**

| Field | Type | Meaning |
|---|---|---|
| `face` | `front\|rear\|left\|right\|other` | Which elevation face. |
| `faceRoof` | `GABLED\|HIPPED\|null` | **STEP 1** — the roof shape where it meets this face. |
| `apexReason` | `string\|null` | **STEP 2** — one short line of reasoning, *before* the number. |
| `apexCount` | `number\|null` | **STEP 3** — how many apexes on this face (0 if hipped). |
| `rendered` | `boolean\|null` | Has a rendered/clad section. |
| `renderLengthM` | `number\|null` | LM of the rendered section only. |
| `sourceSheet/sourceDimension/sourcePage/confidence` | — | Provenance. |

**`wallSegments[]` — one entry per external wall:**

| Field | Type | Meaning |
|---|---|---|
| `position` | `front\|rear\|gable_left\|gable_right\|other` | Wall role. |
| `lengthM` | `number` | Length in metres (converted from printed mm). |
| `sourceDimension/sourcePage/confidence/label?` | — | Provenance. |

**`floorAreas[]` — one entry per floor (the birdcage inputs, raw, no arithmetic):**

| Field | Type | Meaning |
|---|---|---|
| `level` | `GF\|FF\|SF\|TF` | Floor level (room-in-roof = next level, usually SF). |
| `rectangles[]` | array | The internal footprint (one rectangle, or several for an L-shape). Default `[]`. |
| `confidence` | — | Default `medium`. |

**Each `birdcageRect`:**

| Field | Type | Meaning |
|---|---|---|
| `internalWidthM` / `internalDepthM` | `number\|null` | Directly-printed internal span (middle of `[wall\|span\|wall]`) — **priority 1**. |
| `overallWidthM` / `overallDepthM` | `number\|null` | Overall external dim of ONE house (derive from, and cross-check). |
| `wallWidthLeftMm` / `wallWidthRightMm` | `number\|null` | Structural wall per side of the **width** axis (can differ). |
| `wallDepthFrontMm` / `wallDepthRearMm` | `number\|null` | Structural wall per side of the **depth** axis. |
| `wallThicknessMm` | `number\|null` | Uniform structural wall (mm) when all equal — the common case. |
| `legendWallThicknessMm` | `number\|null` | WALL LEGEND finished-face thickness — **fallback only**. |
| `sourceDimension/sourcePage` | — | Provenance. |

**`lowLevel`:**

| Field | Type | Meaning |
|---|---|---|
| `porchCanopyCount` | `number\|null` | Open canopy/hood porches (GRP/glass). Still count as a low level. |
| `porchSolidCount` | `number\|null` | Solid/enclosed porches. Also the default when the kind is unclear. |
| `baySingleStoreyCount` | `number\|null` | Ground-floor-only bays → a low level. |
| `bayTwoStoreyCount` | `number\|null` | Full-height bays → **NOT** a low level (excluded from the count). |
| `confidence` | — | — |

---
---

# PART 5 — MEASUREMENT BY MEASUREMENT (the heart)

For each observable: **what it is · where to read it · how the model reads it ·
what it must NOT do · which layer owns it · the deterministic derivation
(formula/ladder/fallbacks/multiple methods/tolerances) · cross-checks & flags ·
confidence · worked examples.**

## 5.1 House-type identity

- **What:** the house type's name + code (e.g. Dekker / NSS.277).
- **Where:** the title / drawing-reference sheet; the portfolio line in the title
  block.
- **How (model):** read the printed name/code. A mirrored pair may read
  "NSS.277 / NSS.277-1" — that is **one** house type (a pair).
- **Layer:** reads. The engine/persist then resolves the *canonical* identity
  (Part 2.5): prefer the confident AI-read name over the file-derived name; clean
  the code of date/bed-person/area noise; never steal a code another house type
  in the project holds.
- **Edge cases:** codes repeat across regions for the same builder → the bank
  matches on builder + code.

## 5.2 Build type (traditional vs timber-frame)

- **What:** `TRADITIONAL` or `TIMBER_FRAME`.
- **Where:** spec notes / construction type on the drawing.
- **Layer:** reads. Downstream (Layer 3) it *selects the pricing matrix*
  (Traditional 27-col / Timber-Frame 17-col, different stage splits). Timber-frame
  also changes the scaffold sequence/ties — but **not** the LM/lift maths — so
  `persist` surfaces a `warnings.buildTypeNote` for the estimator to confirm.

## 5.3 Structure & dwellings-wide

- **What:** `DETACHED` / `PAIR_SEMI` / `THREE_BLOCK` / `TERRACE` (4+) / `APARTMENT_BLOCK`; and how many houses
  share the printed frontage.
- **Where:** floor plans + title sheet (mirrored dwellings named X / X-1; a
  communal stair ⇒ flats).
- **How (model):** two mirrored dwellings sharing a party gable → `PAIR_SEMI`,
  `dwellingsWide = 2`; three joined → `THREE_BLOCK`, `= 3`; four or more → `TERRACE`,
  `= 4+`; flats with a communal entrance → `APARTMENT_BLOCK`, `dwellingsWide = 1`;
  a free-standing house → `DETACHED`, `dwellingsWide = 1`. **Report front/rear as the full printed frontage spanning
  all dwellings — do not pre-divide.** Gable-end walls are per-house depth, never
  divided.
- **Layer:** reads. The engine divides the frontage by `dwellingsWide` (Part 6.3).
- **Cross-check (C3):** `persist` flags a contradiction — DETACHED/APARTMENT with
  `dwellingsWide ≠ 1`, or PAIR_SEMI/THREE_BLOCK/TERRACE with the wrong count
  (`warnings.structureDwellingsMismatch`) — because this pair drives the frontage
  division, so a contradiction silently mis-prices the perimeter.

## 5.4 Storeys & room-in-roof

- **What:** 1 / 2 / 2.5 / 3; whether there's a habitable room in the roof.
- **Where:** elevations & section (count floor levels); look for dormers, velux,
  raised eaves with living space.
- **How (model):** count storeys; set `roomInRoof = true` for a 2.5-storey.
- **Layer:** reads (storeys cross-checks the height-based lift count; never count
  lifts). Room-in-roof adds a lift and a birdcage floor downstream.
- **Cross-check:** `persist` flags `roomInRoofMismatch` when `storeys = 2.5` but
  `roomInRoof = false`, or when `roomInRoof = true` but storeys is a whole number
  ("should this be X.5?").
- **Edge case:** a room-in-roof can look like a 2-storey from the front — the
  dormers/velux on the rear or the section are the tell.

## 5.5 Height to soffit — the triangulation (`height.ts`)

- **What:** the vertical height to the soffit — the top of the wall the scaffold
  reaches. This is the number the lift count divides.
- **Datum:** ✅ **soffit / underside of wallplate ONLY** — always read
  `U/S Wallplate …`; never the ridge, eaves or mid-point; the same datum on every
  house type.
- **Where:** the section (best). The model reads **two** independent things:
  1. `heightToSoffitM` — the direct soffit dimension (e.g. `U/S Wallplate 4725`).
  2. `storeyHeightsM` — the floor-to-floor storey heights as **deltas** (e.g.
     `[2.662, 2.063]`, the last up to the wallplate). If the section prints
     absolute FFL levels `0 / 2662 / 5325`, report the *differences*
     (`2662, 2663`), not the levels.
- **How (model):** report the raw mm→m values; **do NOT sum them.**
- **Layer:** the model reads; **`height.ts` triangulates and computes the
  confidence.** The derivation:
  - `directM` = the direct soffit read (rounded to 3 dp).
  - `ladderSumM` = `Σ storeyHeightsM` (or null if none given).
  - `liftsDirect = ceil(directM / 1.5)`, `liftsLadder = ceil(ladderSumM / 1.5)`.
  - Storey **sanity band** ≈ `storeys × 2.2` to `storeys × 3.0` m.
  - The stored height (`soffitM`) = `directM ?? ladderSumM`.
- **The H3 rule (✅ confirmed):** a disagreement is flagged **only when the two
  estimates give a different LIFT COUNT** (`ceil(h/1.5)` differs) — that's the
  thing that changes the price — not on a fixed mm gap.
- **Confidence outcomes:**
  | Situation | Confidence | Note |
  |---|---|---|
  | Both present, same lift count | **high** | "Soffit X ✓ cross-checked; ladder sums to Y — both give N lifts." (If the raw gap > 0.15 m, adds "worth a glance".) |
  | Both present, different lift count | **low** | "…different lift count, CHECK." |
  | Direct only, outside the storey band | **low** | "…outside the expected band for an N-storey, CHECK." |
  | Direct only, within/no band | worse of medium/read-confidence | — |
  | Ladder only | worse of medium/read-confidence | "derived from the storey ladder." |
  | Neither | **unknown** | "height not established." |
- **Worked example (Dekker):** direct `4725`; ladder `2.662 + 2.063 = 4.725`;
  `ceil(4.725/1.5) = 4` from both → **4 lifts, high**.

## 5.6 Roof type

- **What:** `PITCHED` / `HIPPED` / `MIXED`.
- **Where:** the elevations (the roof shape) and the roof/truss sheet.
- **How (model):** brickwork rising to an apex = pitched (needs table lifts);
  slopes back on all sides, no brickwork above the eaves = hipped (no apex, no
  table lift); some faces each = mixed.
- **Layer:** reads (drives apex/table lift downstream).
- **Edge cases:** Keepmoat sites are mostly hipped. A **hipped roof with reported
  apexes is contradictory** → the engine forces apex 0 and flags it.

## 5.7 Apexes (per elevation face)

- **What:** the count of gable apexes (triangular brickwork tops) per elevation.
- **Where:** each elevation — physically count the points with brickwork to them.
- **How (model) — face by face, shape before number:** for each face the schema
  order is `faceRoof` (GABLED/HIPPED) → `apexReason` (one line) → `apexCount`, so
  the reasoning informs the count rather than rationalising it. Front and rear
  apexes (a projecting street/garden gable) are the ones most often **missed** —
  check them explicitly. Hipped face = 0.
- **Layer:** reads. `persist` sums the per-face `apexCount` into the `GABLE_QTY`
  measurement (= the table-lift qty = the apex-handrail qty). The **engine** then
  reduces the total by configuration (Part 6.6) and turns each apex into a table
  lift + a handrail.
- **Cross-checks & flags:**
  - A face marked `HIPPED` that still reports an apex → `warnings.apexContradictions`.
  - A hipped **overall** roof forces `GABLE_QTY = 0`. (If the model returns no
    apex at all on a hipped roof, `GABLE_QTY` is stored as 0.)
  - The engine flags "Pitched/mixed roof but no apex counted — check" and
    "Hipped roof but apexes were reported — forced to 0."
- **Edge cases:** a detached house typically has 2; more than 3 has never been
  priced (low confidence / check). A gablet/half-hip or chimney-on-gable → count
  normally if brickwork rises to a point (**A2**, ⚠️ confirm). In Strike this is
  "apex scaffold".
- **Micro-example (Dekker):** front HIPPED 0, rear 0, left GABLED 1, right GABLED
  1 → total 2.

## 5.8 Render (per elevation)

- **What:** which elevations have a rendered/clad section, and its linear metres.
- **Where:** the elevations — render notes, a rendered-variant sheet, or an
  "R"-suffixed code. Measure **only the rendered section**, not the whole wall.
- **How (model):** per face set `rendered` and, if dimensioned, `renderLengthM`.
- **Layer:** reads. `persist` sums the rendered faces' `renderLengthM` into the
  `RENDER_LENGTH` measurement. The engine computes render LM × render lifts
  (Part 6.5), in 2 m boarded lifts.
- **Cross-check (C8):** a rendered face with **no** `renderLengthM` →
  `warnings.renderedNotDimensioned` (so render isn't silently dropped).
- **Edge cases:** render is **per plot** — the same house type may supply
  brick/render/stone variants; the base take-off often has no render metres unless
  a specific plot is rendered. ⚠️ the render-lift basis is still open (Colin's
  table vs Laura's default).

## 5.9 Wall segments (front / rear / gable_left / gable_right)

- **What:** each external wall length along the building line, for one dwelling.
- **Where:** the **ground-floor plan / setting-out plan** — the building line
  (brickwork line), off the outside of the plan.
- **How (model):** read each wall separately with its dimension string. Front/rear
  = the eaves faces (the frontage); gable_left/right = the two side/end walls. For
  a pair, front/rear = the **full frontage spanning both houses** (engine divides);
  gables = full depth.
- **THE CLASSIC ERROR — wall line vs roof overhang:** read the length off the
  **floor plan** printed dimension, **never off an elevation and never by
  scaling**. The roof overhangs the wall by ~200–400 mm each side, so an
  elevation's overall over-reads. If only the overhang line is legible, read it,
  set the wall **low**, and note it — **never subtract an overhang yourself** (W2,
  ⚠️ confirmed as the plan).
- **Layer:** reads. The engine sums → perimeter, applies config + corner
  allowance (Part 6.3).
- **Three automatic checks (`persist.ts`):**
  1. The `sourceDimension` is **verified against the text layer** — unverified →
     confidence capped + listed in `warnings.unverifiedDimensions`.
  2. A wall cited off an **ELEVATION** page is **capped + flagged**
     (`warnings.wallReadOffElevation`) — the roof-overhang risk — **unless** the
     same dimension also appears on a floor-plan/section page (then the cited page
     was just miscounted and the number is a real plan dimension).
  3. **Symmetry (C9):** front ≈ rear and gable_left ≈ gable_right; a **> 10 %**
     mismatch flags a likely role-swap/misread (`warnings.wallAsymmetry`),
     especially telling on a pair where front/rear span the same frontage.
- **Edge cases:** a minor step → bounding rectangle (still 4 corners); a genuine
  L/T/U → list the extra walls as `other` AND split the birdcage into rectangles.
  Do not sum the walls and do not add a corner allowance here.

## 5.10 Corners

- **What:** the number of external corners/returns on the scaffolded footprint.
- **Where:** the footprint on the ground-floor / setting-out plan.
- **How (model) — the exact, repeatable rule:**
  - A roughly rectangular house = **4** corners, even with a small step, recess,
    bay or porch — take the **bounding rectangle**. (Bays/porches are low-level
    items, never corners.)
  - Count **more than 4 only** for a distinct L/T/U (a whole wing projects out):
    an L-shape has 6. Count **outward (external) returns only**.
  - When genuinely unsure whether a projection is "distinct" or "minor", use **4**.
- **Layer:** reads. The engine adds the corner allowance = **1 m per external
  corner** ✅ (Part 6.3), and reduces the count by config on non-detached shapes.
- **Flag:** an L-shaped/stepped footprint on a non-detached config (`cornerCount >
  4`) is flagged (the corner reduction assumes the step is on the scaffolded side).

## 5.11 Birdcage (internal floor area per floor) — the big one (`birdcage.ts`)

The birdcage is the m² of internal floor deck, per floor level. One birdcage per
floor; a 2.5-storey has 3. This is the most-engineered read in the whole system,
because it is derivable from several sources that don't always agree.

### 5.11.1 The doctrine

The model does **no arithmetic** for the birdcage. It reports the **stated areas**
and the **raw dimensions**; `birdcage.ts` does the subtraction, the multiply, the
compound-sum and the reconciliation, and sets a **computed** confidence. **The
birdcage is per-house — it does NOT divide by `dwellingsWide`** (that division is
the *perimeter's*; the birdcage does not divide, or pairs would read half the
area — the Byron bug: 19 vs 39.36).

### 5.11.2 What the model reports, per floor

The birdcage is derived **purely from the dimensions** — the model reports **no
stated/printed area** (no `statedGrossInternalM2` / GIA, no `statedNdssM2` / NDSS;
those were removed 2026-09-01). It reports only:

- `rectangles[]` — the internal footprint as raw dims (one rectangle, or several
   for an L-shape), each number identified by its **mark**:
   - `internalWidthM` / `internalDepthM` — the **directly printed internal span**
     (middle of `[wall|span|wall]`, e.g. `328 | 5287 | 328` → 5287). **Preferred.**
   - `overallWidthM` / `overallDepthM` — the **outermost** external dimension.
   - `wallWidthLeftMm/RightMm`, `wallDepthFrontMm/RearMm` — the **structural**
     wall thickness per side (they can differ: party wall vs gable; render vs
     brick). Or `wallThicknessMm` for a uniform wall.
   - `legendWallThicknessMm` — the **WALL LEGEND** finished-face value (e.g. 353) —
     **fallback only**.
   - The room/partition subdivision chain is **ignored**.

### 5.11.3 The engine's per-axis ladder (`computeRect`)

Each axis is resolved independently:

```
width = internalWidthM ?? (overallWidthM − wallLeft − wallRight)
depth = internalDepthM ?? (overallDepthM − wallFront − wallRear)
```

- **Each side is subtracted SEPARATELY — never `2 × wall`.** The two walls of an
  axis can differ.
- **Wall resolution per axis** (`resolveAxisWalls`): prefer the two printed
  per-side values; if only ONE side is printed, assume the other equal and flag
  (`assumedSymmetric`); if a uniform `wallThicknessMm` is given, use it both
  sides; else fall back to the **legend** wall (`usedLegendWall`); else **nothing**
  (the axis is unresolved). **There is NO hard-coded default wall.**
- `area = Σ(width × depth)` over the rectangles (handles compound / L-shaped
  floors). The stored `derivedM2` is set only if **every** rectangle fully
  computed.
- The **overall − walls** derivation is computed **even when the internal span was
  read**, as an independent cross-check (`crossCheckM2`).

### 5.11.4 Which number wins, and the confidence (`computeBirdcageFloor`)

The stored VALUE is always the **derived footprint** — internal span preferred,
else overall − walls (no stated area / NDSS is used). The confidence is computed:

| Situation | Stored `m2` | Confidence | Cross-check |
|---|---|---|---|
| Internal span read + overall−walls both present | `derivedM2` | **high** if `|derived − crossCheck| / derived ≤ 5%` (medium if a wall was assumed symmetric), else **low** + flag | internal vs (overall − walls), `BIRDCAGE_INTERNAL_XCHECK_TOLERANCE = 5%` |
| Bare footprint, no cross-check, structural wall | derived | **medium** | — |
| Bare footprint, no cross-check, legend wall or assumed-symmetric | derived | **low** + flag | — |
| A rectangle given but no wall to strip it | **null** | **unknown** | "birdcage unresolved, needs a human" |
| Nothing legible | **null** | **unknown** | — |

The confidence is capped by the model's own read confidence. Two persistent flags
travel with a stored value: `usedLegendWall` (a derived axis fell back to the
finished-face legend wall — confirm) and `assumedSymmetric` (a one-sided wall was
assumed equal). Both also downgrade the confidence.

**Confidence tolerance (constant):** `BIRDCAGE_INTERNAL_XCHECK_TOLERANCE = 0.05`.
⚠️ approximate — the sign-off band is a Colin question (docs/11 §8 #11).

### 5.11.5 Worked examples

- **Dekker (semi pair), GF:** rectangle
  `{ internalWidthM: 4.877, overallDepthM: 7.904, wallThicknessMm: 302 }`.
  Engine: `depth = 7.904 − 0.302 − 0.302 = 7.300`; `area = 4.877 × 7.300 = 35.602`
  → store **35.602**; internal width read + structural derived depth, no full
  overall−walls cross-check → **medium**. GF + FF = 71.2 m².
- **Whitton (Miller), GF:** width `328 | 5287 | 328`, depth `9103` overall with
  `328` walls, legend `353`. Engine: width = internal `5.287` (read directly);
  depth = `9.103 − 0.328 − 0.328 = 8.447`; area ≈ `44.66 m²`. Cross-checked against
  the internal width.
- **Same footprint, every floor:** the model reports the stated area + rectangles
  on GF *and* FF alike, so each floor is independently cross-checked.

## 5.12 Low level (porches + single-storey bays) (`schema.ts:lowLevelQty`)

- **What:** porches + SINGLE-storey bays (each = one low-level tower), recorded by
  type.
- **Where:** elevations & plan; bay height is read off the **elevation**.
- **How (model):** count and classify — `porchCanopyCount` (open GRP/glass canopy)
  vs `porchSolidCount` (enclosed; the default when unsure); `baySingleStoreyCount`
  (ground-floor only) vs `bayTwoStoreyCount` (rises through both floors). A porch
  GRP canopy **still counts**.
- **Layer:** reads. The priced count is
  `LOW_LEVEL_QTY = porchCanopy + porchSolid + baySingleStorey`.
  **A TWO-storey bay is NOT a low level** — it is full height (part of the main
  scaffold), so it is captured (`bayTwoStoreyCount`, `warnings.twoStoreyBay`) but
  **excluded** from the count. `lowLevelQty` returns null only when nothing was
  read at all. The type split is kept in `warnings.lowLevelBreakdown` for a future
  treatment change; pricing is unchanged for porches and single-storey bays today.
- **Edge case:** some Bloor sites want a beam-over instead of a returning
  low-level — a builder-profile item, not read from the drawing.

## 5.13 Chimney

- **What:** whether a chimney stack is actually drawn.
- **Where:** elevations & roof/truss sheet.
- **How (model):** `chimney = true` **only if a stack is drawn**. A conditional
  note ("chimney if required") with no stack drawn → `chimney = false`, and say so
  in notes.
- **Layer:** reads. The engine adds a fixed chimney scaffold when true; a spec
  demanding one with none drawn is flagged, never silently priced.

## 5.14 Smart-roof peak

- **What:** an unusually high roof peak (a "smart roof" → double table lift).
- **Where:** the roof/section — the peak height for the type.
- **How (model):** if the peak looks unusually high, report `smartRoofPeakHeightM`.
  **Do not apply a threshold** — report the height and let a human judge.
- **Layer:** reads (stored on `warnings.smartRoofPeakM`).
- **Edge case:** ⚠️ the actual threshold is open; mainly a Bloor thing.

## 5.15 Underbuild

- **What:** whether the plot needs underbuild / a foot scaffold at the base
  because it sits on a slope or has stepped foundations.
- **Where:** the authoritative source is the **site elevations plan** (a separate
  drawing). The model only sets `underbuild.needed = true` if a slope/stepped
  foundation is clearly visible on a section/elevation it was given; otherwise
  `null`. **Never infer a slope from a house elevation alone.**
- **Layer:** reads (stored on `warnings.underbuild`). The site-elevations plan is
  **not yet classified/sent** — this is the main remaining missing observable.

---
---

# PART 6 — THE DETERMINISTIC TAKE-OFF ENGINE (Layer 2, `engine.ts`)

Pure, unit-tested, no I/O, no model. `buildTakeoff(input, params)` turns the
observables into Colin's take-off line. Every open value is a parameter with a
documented default; every unresolved cross-check raises a flag.

## 6.1 The engine input, and how it's assembled (`fromStored.ts`)

`TakeoffInput` = `{ storeys, roomInRoof, heightToSoffitM, roofType, wallSegments[],
dwellingsWide, isApartmentBlock, cornerCount, apexByFace, renderSegmentsM[],
floors[], lowLevelCount, chimney, config }`.

`takeoffInputFromStored(measurements, walls, warnings, config)` rebuilds this from
the persisted take-off, **honouring human edits**:
- Floors come from the `BIRDCAGE_GF/FF/SF_M2` measurements.
- Apex-per-face comes from `warnings.elevations`, but the **editable `GABLE_QTY`
  total is the source of truth**: if it differs from the per-face sum, the faces
  are **scaled** to the edited total (so the config-aware reduction still works);
  with no per-face data, the total is split across the two gable ends.
- Render prefers the editable `RENDER_LENGTH` total; else the per-face segments; an
  explicit `rendered = false` clears render entirely.
- `dwellingsWide` and `isApartmentBlock` come from `warnings`.

## 6.2 Lifts (`computeLifts`)

```
hasRoom  = roomInRoof OR storeys is not an integer (e.g. 2.5)
heightLifts = ceil(heightToSoffitM / 1.5) + (hasRoom ? 1 : 0)     [null if no height]
storeyLifts = storeyLiftTemplate[storeys]                          [null if not in the table]
```

**Storey template** (the cross-check), default STANDARD/Miller:
`{ 1: 2, 2: 4, 2.5: 5, 3: 6, 4: 8 }`. ⚠️ **Builder-specific** — the real template
comes from the builder profile (`params.storeyLiftTemplate`); e.g. Barratt
2-storey = 3, not 4.

**Precedence when the two disagree** (⚠️ Innate's proposed rule, Ben to confirm):
- Both agree → use the height value (`basis = "height"`).
- Disagree **and** whole-storey building → the **storey template wins**
  (`basis = "storey"`) — reliable at boundaries the height rule can round wrong.
- Disagree **and** half-storey (2.5) → the **height rule wins** (height +
  room-in-roof is the intended path).
- Only one available → use it.
- **Either way the disagreement is flagged** ("Lift mismatch: height gives X,
  storey template gives Y").

## 6.3 Perimeter (`computePerimeter`)

```
dwellings = isApartmentBlock ? 1 : max(dwellingsWide, 1)
front = Σ(front walls) / dwellings          rear = Σ(rear walls) / dwellings
gableLeft = Σ(gable_left)   gableRight = Σ(gable_right)   other = Σ(other)   [never divided]
```

Then, by configuration (apartment block = whole building, config ignored):

| Config | Walls scaffolded | Corners used |
|---|---|---|
| **Apartment block** | front + rear + both gables + other (whole block) | `cornerCount ?? 4` |
| **Detached** | front + rear + both gables + other (4 sides) | `cornerCount ?? 4` |
| **Semi / End-terrace** | front + rear + **max(gableLeft, gableRight)** + other (3 sides — the exposed gable) | `max(2, cornerCount − 2)` (rectangle wraps 2) |
| **Mid-terrace** | front + rear only (both gables are party walls) | `max(0, cornerCount − 4)` (rectangle wraps 0) |

```
perLiftM = round3(walls + corners × cornerAllowanceM)        [cornerAllowanceM = 1.0 ✅]
totalM   = round3(perLiftM × lifts)                          [what Strike is keyed with]
```

**Flags:** `irregular` (an `other` wall on a non-detached config) and, on a
non-detached L-shape (`cornerCount > 4`), a note that the corner reduction assumes
the step is on the scaffolded side.

## 6.4 Birdcage totals (`computeBirdcage`)

`totalM2 = round3(Σ floor m²)` over the floors with `m² > 0`; `floorCount` = how
many. Each floor = one lift. Expected floor count for a cross-check:
`{ 1: 1, 2: 2, 2.5: 3, 3: 3, 4: 4 }` — a mismatch is flagged ("Birdcage floors (N)
don't match X-storey (expected M)"); zero floors is flagged too.

## 6.5 Render (`computeRender`)

`lengthM = round3(Σ renderSegmentsM)`; null if none. **Render lifts by storey**
(2 m boarded lifts): `{ 1: 1, 2: 2, 2.5: 3, 3: 4 }`. ⚠️ the full table is still
owed by Colin; a rendered house with no render-lift rule for its storey count is
flagged.

## 6.6 Apex → table lifts + handrails (`computeApex`)

```
Hipped overall roof → { count: 0, tableLifts: 0, handrails: 0 }
Apartment block     → count = round(Σ all faces); no reduction
Otherwise:
  frontRear = apex.front + apex.rear                    [front/rear apexes ALWAYS count]
  gable = DETACHED:      apex.left + apex.right + apex.other
          SEMI/END:      max(apex.left, apex.right)      [one exposed gable end]
          MID_TERRACE:   0                               [both gables are party walls]
  count = max(0, round(frontRear + gable))
tableLifts = handrails = count
```

## 6.7 Party walls (`partyWalls`)

`DETACHED → 0`, `SEMI_DETACHED/END_TERRACE → 1`, `MID_TERRACE → 2`. An apartment
block → 0 (scaffolded whole).

## 6.8 Apartment whole-block mode

When `structure = APARTMENT_BLOCK`: the frontage is **not** divided (dwellings =
1), **every** external wall is scaffolded, **every** apex counts (no config
reduction), there are **no party walls**, and the birdcage should be the **whole
floor plate**. The engine adds an informational flag and a distinct
`profilePending` list (multiple loading bays/chutes, progressive dismantle,
communal/stair handrails). ⚠️ the apartment birdcage basis (whole plate vs sum of
flats) and the apartment perimeter/extras are Colin questions.

## 6.9 Garages (`garage.ts`)

Garages are priced as a separate section but have **no extracted geometry** (the
drawing extractor doesn't read garages). So — exactly like the rate sheet —
quantities come from a **flagged placeholder template** per type, never a silent
guess:

| `garageType` | lifts | perimeter/lift (m) | gables | GF birdcage (m²) | has birdcage |
|---|---|---|---|---|---|
| SINGLE | 2 | 15 | 1 | 18 | yes |
| TWIN | 2 | 22 | 1 | 32 | yes |
| CAR_PORT | 2 | 15 | 1 | 0 | no |

Every garage line carries a flag to confirm the real take-off with Colin. `⚠️`
these numbers are placeholders (docs/15 §11.6).

## 6.10 The emitted take-off line

`buildTakeoff` returns a `TakeoffLine` with the computed `lifts`, `perimeter`,
`birdcage`, `render`, `apex`, `partyWalls`, `lowLevel`, `chimney`, plus:
- **`flags[]`** — cross-checks needing a human eye (see Part 9).
- **`profilePending[]`** — items that need the builder profile / spec and can't be
  computed yet (loading bay + apportionment, rubbish chute/skip bay, access
  Haki/ladder, propping/joist-support variant).
- **`text`** — a Colin-style one-liner, e.g.
  `20.564 × 4 lifts / 71.2 m² × 2 floors / 2 apex (table + H/R) / 1 low level / 1 party wall`.

## 6.11 Engine parameters (`EngineParams` / `DEFAULT_PARAMS`)

| Param | Default | Status |
|---|---|---|
| `liftHeightM` | 1.5 | ✅ (an "average" — constancy ⚠️ open) |
| `cornerAllowanceM` | 1.0 | ✅ CONFIRMED (1 m per external corner, external returns only) |
| `storeyLiftTemplate` | STANDARD `{1:2,2:4,2.5:5,3:6,4:8}` | ✅ default; ⚠️ per-builder overrides come from the profile |

---
---

# PART 7 — PERSISTENCE, VERIFICATION & THE FLAGS CATALOGUE (`persist.ts`)

`persistExtraction(extractionId, result, dimensions?)` writes the validated
extraction into the take-off, in a transaction, measurements only. It resolves the
house-type identity, runs the birdcage + height engines, verifies cited
dimensions, and writes the cross-check flags.

## 7.1 What gets stored where

**`TakeoffMeasurement` rows** (`key`, `valueNumber`, `aiValue` — the original AI
read, kept so the editor can show "edited — AI read X" — `confidence`,
`sourceSheet`, `sourceDimension`, `ambiguous`). The keys actually written:

| Key | Source |
|---|---|
| `STOREYS` | `result.storeys` |
| `HEIGHT_TO_SOFFIT` | `height.ts` (`heightRes.soffitM`), confidence computed |
| `GABLE_QTY` | Σ per-face `apexCount` (hipped → 0) |
| `RENDER_LENGTH` | Σ rendered faces' `renderLengthM` (only if any) |
| `BIRDCAGE_GF_M2` / `_FF_M2` / `_SF_M2` | `birdcage.ts` per floor (TF is skipped — extremely rare for housing) |
| `LOW_LEVEL_QTY` | `lowLevelQty(result.lowLevel)` (only if any read) |
| `CORNER_COUNT` | `result.cornerCount` |

(The `MeasurementKey` enum also contains `ROOF_PITCH`, `LIFTS`, `FOOT_SCAFFOLD_QTY`
and `OTHER`, which `persist` does **not** currently write — the roof/room/render
categoricals live in `warnings` instead.)

**`WallSegment` rows** (`position`, `lengthM`, `aiLengthM`, `confidence`,
`sourceDimension`, `ambiguous`).

## 7.2 Confidence → float, and the `ambiguous` flag

The AI/computed label is stored as a float: `high → 0.95`, `medium → 0.7`,
`low → 0.4`, `unknown → 0`. A measurement is `ambiguous` when its confidence is
`low` or `unknown` (a wall is also ambiguous if its dimension didn't verify or it
was read off an elevation).

## 7.3 Dimension verification (`dimensions.ts`)

Each cited `sourceDimension` is checked against the PDF text layer
(`makeDimensionVerifier`): a number the model claims to have read that isn't
actually printed on that page (or anywhere) is a likely misread/hallucination →
its confidence is **capped to "low"** and the string is listed in
`warnings.unverifiedDimensions`. The check is lenient by design (matches the
numeric runs, tolerant of "7.904" vs "7904"), and a scanned PDF with no text layer
passes everything (nothing to check against).

## 7.4 Wall-off-elevation detection (the roof-overhang guard)

A wall whose cited `sourcePage` maps back to an **ELEVATION** page is suspect (the
roof overhang over-reads the wall). It is capped + flagged in
`warnings.wallReadOffElevation` — **unless** the same dimension also appears on a
FLOOR_PLAN/SECTION page (`dimOnPlanPage`), in which case the cited page was just
miscounted and the number is treated as a real plan dimension.

## 7.5 The full `warnings.*` catalogue

Everything that isn't a numeric measurement or a wall row lives on the take-off's
`warnings` JSON, read by the review screen. The complete set:

| Key | Meaning |
|---|---|
| `notes` | The model's short notes. |
| `dwellingsWide` | The dwellings-wide count (drives the frontage division). |
| `structure` | DETACHED / PAIR_SEMI / THREE_BLOCK / TERRACE (4+) / APARTMENT_BLOCK. |
| `roofType` | PITCHED / HIPPED / MIXED. |
| `roomInRoof` | boolean. |
| `buildTypeNote` | Present when TIMBER_FRAME — confirm sequence/tie requirements. |
| `roomInRoofMismatch` | storeys=2.5 but roomInRoof=false, or roomInRoof=true on a whole-number storey. |
| `rendered` | true if any face rendered; false if elevations present but none rendered. |
| `lowLevelBreakdown` | `{ porchCanopy, porchSolid, baySingleStorey, bayTwoStorey }`. |
| `twoStoreyBay` | Present when a two-storey bay was seen (full height, excluded from the low-level count). |
| `chimney` | boolean. |
| `smartRoofPeakM` | The reported peak height, if unusually high. |
| `underbuild` | `{ needed, note }`. |
| `structureDwellingsMismatch` (**C3**) | structure ↔ dwellingsWide contradiction. |
| `wallAsymmetry` (**C9**) | front/rear or gable_left/right differ by > 10%. |
| `renderedNotDimensioned` (**C8**) | a rendered face with no `renderLengthM`. |
| `elevations[]` | The per-face breakdown: `face, apexCount, rendered, renderLengthM, faceRoof, apexReason`. |
| `apexContradictions` | A face marked HIPPED that still reported an apex. |
| `birdcageDerivation[]` | Per floor: the full derivation trail (`m2, source, derivedM2, crossCheckM2, statedM2, ndssM2, reconciled, confidence, usedLegendWall, assumedSymmetric, note`). |
| `unverifiedDimensions` | Cited strings not found in the text layer. |
| `wallReadOffElevation` | Walls whose length was read off an elevation page. |
| `heightDerivation` | The triangulation trail (`soffitM, directM, ladderSumM, liftsDirect, liftsLadder, reconciled, withinBand, confidence, note`). |

---
---

# PART 8 — CONFIDENCE & PROVENANCE

- **Confidence labels:** `high` (the printed value is certain and unambiguous) ·
  `medium` · `low` · `unknown` (couldn't read it). For birdcage and height the
  label is **computed** from cross-check agreement, not self-reported; for other
  reads it is the model's own label, then possibly **capped** by verification.
- **The `worseConf` rule:** a derived total is only as strong as its weakest input
  — the birdcage/height engines take the *worse* of the read confidence and the
  computed confidence.
- **Provenance (`provenance.ts`):** every measurement gets a review-screen card
  showing *how it came to be*, of one of three methods:
  - **read** — the model read it → show the printed dimension string + the sheet +
    a resolvable page link (`resolvePage` matches the model's sheet label to a real
    page, restricted to this extraction's relevant pages).
  - **counted** — apexes, corners, low levels → the per-face/per-item breakdown.
  - **computed** — the engine derived it (height triangulation, birdcage width ×
    depth with each wall subtracted, perimeter = config walls + corners × 1 m,
    lifts = ⌈h ÷ 1.5⌉ + room-in-roof) → the arithmetic shown step by step, each
    input traceable.
  The birdcage card shows each rectangle's width/depth (read or derived), the
  overall−walls cross-check, the note, and the floor total — plus footnotes when
  the legend wall or an assumed-symmetric wall was used, or when the internal span
  and the overall−walls derivation disagreed.
- Nothing in provenance invents a source: a value with no cited sheet shows the
  value + confidence and simply omits the page link.

---
---

# PART 9 — THE CROSS-CHECK CATALOGUE (every automated check in one place)

Two kinds: **named Layer-1 checks** (computed in `persist.ts` / the birdcage/height
engines, surfaced as `warnings.*`) and **engine flags** (computed in `engine.ts`,
surfaced in the take-off line's `flags[]`).

## 9.1 Named Layer-1 cross-checks

| ID | Check | Trigger | Effect |
|---|---|---|---|
| **C3** | structure ↔ dwellingsWide | SINGLE/APARTMENT with dwellingsWide≠1, or PAIR/TERRACE with <2 | `warnings.structureDwellingsMismatch` |
| **C5** | storey ladder = deltas | direct vs ladder height gap > 0.15 m even when lift count agrees | note in `heightDerivation` |
| **C7** | apex reasoning order | schema orders faceRoof → apexReason → apexCount | reason committed before the number |
| **C8** | rendered-but-undimensioned | a rendered face with no `renderLengthM` | `warnings.renderedNotDimensioned` |
| **C9** | wall symmetry | front≈rear and gable_left≈gable_right; >10% mismatch | `warnings.wallAsymmetry` |
| **C11** | Birdcage internal-vs-derived cross-check | printed internal span AND overall−walls both present; agree within 5% | high (medium if assumed symmetric) / low+flag (in `birdcageDerivation`) |
| **H3** | height lift-count | direct vs ladder give a different `ceil(h/1.5)` | height confidence → low + flag |
| **A2** | gablet/half-hip/chimney-on-gable | brickwork rises to a point | count normally (⚠️ confirm) |
| **W2** | overhang-only wall | only the roof/overhang dim is legible | store low-confidence as-is, never subtract |
| — | dimension verification | a cited `sourceDimension` not in the text layer | cap to low + `warnings.unverifiedDimensions` |
| — | wall off elevation | wall cited on an ELEVATION page (and not on a plan) | cap + `warnings.wallReadOffElevation` |
| — | apex contradiction | face marked HIPPED but apex>0 | `warnings.apexContradictions` |
| — | room-in-roof ↔ storeys | 2.5 with roomInRoof=false, or roomInRoof=true on a whole storey | `warnings.roomInRoofMismatch` |

## 9.2 Engine flags (`buildTakeoff.flags[]`)

- No height or storeys read → cannot derive lifts.
- Lift mismatch: height gives X, storey template gives Y.
- Birdcage floors (N) don't match the storey count (expected M).
- No internal floor dimensions — birdcage not computed.
- Pitched/mixed roof but no apex counted — check the elevations.
- Hipped roof but apexes were reported — forced to 0.
- Irregular ('other') walls on a non-detached config — check the perimeter.
- L-shaped/stepped footprint on a non-detached config — corner reduction assumes
  the step is on the scaffolded side.
- Rendered, but no render-lift rule for this storey count.
- Apartment block — whole-building scaffold; birdcage should be the whole plate.

---
---

# PART 10 — OPEN QUESTIONS (never guessed)

Built as a configurable hook or a flag, never a silent number. Owner in brackets.

**Resolved (now confirmed, encoded):**
- Height datum → **soffit / underside of wallplate** ✅.
- Corner allowance → **1 m per external corner, external returns only** ✅.
- Birdcage cavity deduction → **no default; read the structural wall per drawing;
  legend value a flagged fallback** ✅.
- Stage splits → 50/25/25 (bungalow 65/10/25) ✅ (a Layer-3 concern).

**Still open (flagged, awaiting the owner):**
1. Lift height constancy — is 1.5 m truly constant? (Colin)
2. Full render/cladding go-to table — Colin's vs Laura's 3-lift default. (Colin)
3. Party-wall count per config — sheets show semi ×1 and ×2; mid ×2. (Colin)
4. Smart-roof peak threshold number. (Colin)
5. Which client wants 2-lift birdcages where a room > 2.5 m. (Colin)
6. Birdcage internal-vs-derived tolerance (the 5%). (Rayyan + Ben)
7. Lift-vs-storey precedence on disagreement (the proposed rule). (Ben confirms)
8. Per-builder storey-lift templates (have Barratt 2→3, Standard 2→4; need the rest). (Colin)
9. A2 — gablet/half-hip/chimney-on-gable apex treatment. (Colin)
10. W2 — overhang-only wall handling (proposed: store as-is + flag). (Colin)
11. Apartment birdcage basis — whole plate vs sum of flats. (Colin)
12. Apartment perimeter/footprint (recesses/setbacks) + extras. (Colin)
13. 4-plot apportionment ("back to two"?). (Laura) — a shared-item concern.
14. Anomalies: Tyard "1-storey / 2 floors", Whitgrove "1-storey / 4 lifts". (Colin)
15. The **site elevations plan** (the real underbuild source) is not yet
    classified/sent — the main missing observable.

---
---

# PART 11 — BUILDER PROFILES (the per-builder spec layer)

Specs are per **housebuilder** (~20 of them). A `BuilderProfile` model exists
(access type, ladder-allowed-in-confined, beam-over-low-level, chimney-always,
birdcage-lifts-over-2.5m, loading-bay policy, joist-support variant, extra-hire
policy, `storeyLiftTemplate` JSON, free-form `spec`), versioned with effective
dates. Only the **`storeyLiftTemplate`** is currently *used* by the engine (via
`getStoreyLiftTemplate`); the rest of the "extras" have model + placeholder
profiles but no UI/logic yet — the engine lists them as `profilePending`. The
governing document is the builder's **design-standard specification for
scaffolding**; the AI may read it as an *assist that proposes profile changes*,
never an authority. Missing spec → the Airwright-default profile.

Seeds from the sheets: **Avant Homes** (ladder tower, plain propping, party-wall
scaffold, chutes + loading bays); **Haki builder / Keepmoat-style** (Haki
everywhere, double propping, mostly hipped roofs); a **Sheet-1 builder** (ladder
tower, single + sacrificial prep, render on some types). Barratt 2-storey = 3
lifts, Standard = 4 — the confirmed builder-specific lift-template difference.

---
---

# PART 12 — VALIDATION & TOOLING

The extractor + engine are validated **offline against Colin's real data** (all
gitignored PII in `colin-data/` and `data/`), rate-independent — so the take-off
side can be graded *before* Colin's rate sheet lands.

**Runners (`scripts/`):**
- `offline-extract.mts` — run `extractDrawing` on a local PDF, then the full engine
  (`buildTakeoff`, `computeBirdcageFloor`, `computeHeight`), no DB. The dev/eval
  harness. `npx tsx scripts/offline-extract.mts <NAME>`.
- `validate-against-bank.mts` — grade the extracted + computed **quantities** (LM,
  birdcage m², gables, low levels) against Colin's real take-off bank
  (`data/pricing-data/bank.json`). This is the first real **correction-rate**
  metric, and it needs no rates.
- `backfill-house-type-names.mts` / `merge-duplicate-house-types.mts` — re-apply
  identity resolution / collapse duplicate house types from stored `rawOutput`
  (no Claude calls).

**Golden set:** matched drawing ↔ take-off pairs — **Rosewood, Dekker, Augusta,
Tyard** (drawings in `colin-data/` + their lines on Colin's handwritten sheets),
plus the **House Take-Offs Bank** (8 builder sheets, hundreds of types) as the
ground-truth quantities.

**Validated results (live extractor + engine vs Colin's sheets):**
- **Dekker** (semi pair): engine → Semi/End **20.56** (Colin 20.5), Mid **10.66**
  (Colin 10.6), birdcage **35.6/floor**, apex 1/0 by config, 1 low level. Essentially exact.
- **Rosewood** (detached bungalow, hipped): perimeter **48.51** (Colin 48.5,
  exact), 2 lifts, 0 apex (hipped), birdcage ~102–107 m².
- **Augusta** (3-storey apartment block): right structure + 6 lifts; whole-block
  perimeter 58.6 (Colin 65.4 — apartment footprints are irregular); birdcage
  over-reads (the apartment basis is an open Colin question).
- **Tyard** (maisonette): semi 27.5 (Colin 28.5), 2 lifts; the maisonette
  1-vs-2 birdcage floors and its apex are Colin questions.

Grading method: lifts, floor count, apex count, low-level count, config → **exact
match**; perimeter LM and birdcage m² → within a **stated tolerance** (to agree
with Colin); test **blind** against tenders Colin already priced, keeping every
disagreement with its cause. Built into a regression suite (`*.test.ts` beside
every pure module).

---
---

# PART 13 — QUICK-REFERENCE TABLES

## 13.1 Which layer owns each number

| Number | Model reads | Engine computes |
|---|---|---|
| Wall lengths, height, storeys, apex/face, render LM/face, corners, birdcage raw dims + stated areas, porch/bay, chimney, roof type, structure, dwellings-wide, build type, smart-roof peak, underbuild | ✅ | |
| Height to soffit (reconciled from direct read vs storey ladder) | reads both | ✅ `height.ts` |
| Birdcage m² per floor (subtract walls, width×depth, Σ rectangles, reconcile) | reads stated + raw dims | ✅ `birdcage.ts` |
| Lift count `ceil(h ÷ 1.5) + roomInRoof` | | ✅ |
| Perimeter (Σ config walls ÷ dwellings + corners × 1 m) × lifts | | ✅ |
| Apex → table lift + handrail, config reduction | | ✅ |
| Render LM × render lifts | | ✅ |
| Party walls, garages, stage splits, all £ | | ✅ |

## 13.2 Every formula

```
lifts        = ceil(heightToSoffitM / 1.5) + (roomInRoof or half-storey ? 1 : 0)
             (cross-checked vs storeyLiftTemplate[storeys]; template wins on whole-storey
              disagreement, height wins on 2.5; always flagged if they differ)
front/rear   = Σ(front|rear walls) / dwellings         [dwellings = 1 for apartment/single]
gables       = Σ(gable_left), Σ(gable_right)           [never divided]
perLiftM     = walls_for_config + corners × 1.0
totalM       = perLiftM × lifts
birdcage/axis: width = internalWidthM ?? (overallWidthM − wallLeft − wallRight)   [per house]
               depth = internalDepthM ?? (overallDepthM − wallFront − wallRear)
               area  = Σ(width × depth)
birdcageTotal= Σ floor m²    (one lift each; floors = {1:1,2:2,2.5:3,3:3,4:4})
render       = Σ renderSegmentsM × renderLifts[storeys]  (renderLifts {1:1,2:2,2.5:3,3:4}; 2 m lifts)
apex         = frontRear + gable(config)  → tableLifts = handrails = apex   (hipped → 0)
partyWalls   = {detached:0, semi/end:1, mid:2}
heightSoffit = directRead, cross-checked vs Σ storeyHeightsM (flag if different lift count)
```

## 13.3 Every constant / tolerance

| Constant | Value | Where |
|---|---|---|
| Lift height | 1.5 m | `DEFAULT_PARAMS.liftHeightM` |
| Corner allowance | 1.0 m/corner | `DEFAULT_PARAMS.cornerAllowanceM` |
| Storey → lifts (Standard) | 1:2, 2:4, 2.5:5, 3:6, 4:8 | `STANDARD_STOREY_LIFTS` |
| Render lifts | 1:1, 2:2, 2.5:3, 3:4 | `renderLiftsForStoreys` |
| Expected birdcage floors | 1:1, 2:2, 2.5:3, 3:3, 4:4 | `expectedFloors` |
| Birdcage stated tolerance | 2% | `BIRDCAGE_TOLERANCE` |
| Birdcage internal-vs-derived | 5% | `BIRDCAGE_INTERNAL_XCHECK_TOLERANCE` |
| Height gap note | 0.15 m | `HEIGHT_GAP_NOTE_M` |
| Storey sanity band | 2.2–3.0 m/storey | `storeyBand` |
| Confidence floats | high 0.95, medium 0.7, low 0.4, unknown 0 | `confToNumber` |
| Dimension token size | 3–5 digits | `DIM_RE` |
| Model cost | $15 / $75 per 1M in/out | `claude.ts` |
| `max_tokens` | 16384 | `extractDrawing.ts` |

## 13.4 Every enum

- **Confidence:** high · medium · low · unknown.
- **Structure:** DETACHED · PAIR_SEMI · THREE_BLOCK · TERRACE (4+) · APARTMENT_BLOCK.
- **Build type:** TRADITIONAL · TIMBER_FRAME.
- **Roof:** PITCHED · HIPPED · MIXED. **faceRoof:** GABLED · HIPPED.
- **Elevation face:** front · rear · left · right · other.
- **Wall position:** front · rear · gable_left · gable_right · other.
- **Floor level:** GF · FF · SF · TF.
- **Configuration:** DETACHED · SEMI_DETACHED · END_TERRACE · MID_TERRACE.
- **PageKind:** ELEVATION · FLOOR_PLAN · SECTION · PLOT_LAYOUT · SPEC · OTHER
  (take-off-relevant = the first three).
- **DocumentCategory:** HOUSE_TYPE_DRAWINGS · SITE_LAYOUT · SPEC · NOT_RELEVANT ·
  UNCERTAIN · UNREADABLE.
- **MeasurementKey (written):** STOREYS · HEIGHT_TO_SOFFIT · GABLE_QTY ·
  RENDER_LENGTH · BIRDCAGE_GF/FF/SF_M2 · LOW_LEVEL_QTY · CORNER_COUNT.
- **GarageType:** SINGLE · TWIN · CAR_PORT.

---
---

# PART 14 — SMART UPLOAD & GROUPING (getting a pack ready for the extractor)

Everything so far assumes the extractor is handed a clean set of drawings for one
house type. **This part is how that clean set comes to exist.** It sits *upstream*
of Parts 2–13: it turns a raw uploaded tender folder into one tidy dossier per
house type, tags which pages a scaffolder needs, and gets a human sign-off — all
*before* a penny is spent on AI extraction. Downstream of the tagged relevant
pages, nothing changes: the extractor and engine (Parts 3–13) run exactly as
described. (Canonical spec: `docs/17-smart-upload-and-grouping.md`. Code:
`src/lib/ingest/*`, `src/lib/upload/*`, `src/server/grouping.ts`,
`src/server/actions/{upload,grouping}.ts`, `src/worker/processPack.ts`,
`src/components/{upload-form,grouping-confirm}.tsx`.)

## 14.1 The problem, and the two ideas that solve it

**The problem.** A real tender pack is a whole *folder* — often hundreds of PDFs,
single- or multi-page, buried under trade sub-folders (kitchens, SAP, roofs), with
revisions and material/handing variants of the same sheet. And **every builder
packages it differently** — there are no "known builders" to hand-configure; in
production every pack shape is effectively new. Someone used to sort out "which
files belong to which house type" by hand.

**Two ideas make it reliable, not just clever:**

1. **Grouping = identity only; relevance = a separate per-page tag.** Grouping just
   answers *"which house type is this file?"* and puts **every** file for a type —
   relevant or not — into **one combined PDF** (the complete "dossier"). A separate
   per-page **relevant?** flag then decides which pages the extractor reads and
   which the review preview shows. Nothing is ever discarded: "Open full drawing"
   always shows the entire dossier.

2. **The AI infers the *rule*; plain code applies it.** This is the key reliability
   trick. Asked to place 500 files in one pass, an LLM **silently drops items** — a
   dropped house type is a missing line on the quote. So instead the AI reads a
   compact **text** summary of the pack and returns a small **recipe** ("house types
   are the folder under `Scaffold/`; these folders are junk; the names look like
   X"), and **deterministic code applies that recipe to every single file**, with a
   guarantee that every file is accounted for exactly once. Smart where it needs to
   be, deterministic where it counts. It's the same doctrine as the rest of this
   document: **read many signals → reconcile in code → flag, never silently drop.**

## 14.2 The pipeline, step by step

The worker (`processPack.ts`) runs these in order. AI steps are marked **[AI]**;
everything else is deterministic.

| Step | What happens |
|---|---|
| **Upload** | A folder-first, resumable uploader (drag a folder, pick one, or drop loose files / a ZIP). Files upload in parallel with retry/backoff and are **registered as they finish**, so an interrupted session resumes by re-dropping — only the missing files re-upload. |
| **Ingest** | ZIPs are expanded; a zip-vs-unzipped duplicate is deduped by **content hash**; each file keeps its folder path (the main grouping signal). |
| **Classify (Tier 1, free)** | Read each page's **text layer**, find the title block, and tag the drawing type + relevance deterministically (the same classifier as Part 2). Most pages settle here for nothing. A page with **no text layer** (scanned/raster) is flagged for a human — not OCR'd. |
| **Relevance triage [AI]** | Only *ambiguous* pages (weak/unfamiliar title text) get a small LLM look — and it can **only rescue** a page (flip a missed drawing to relevant), never remove one. **Recall beats precision:** a wrongly-included page wastes a few tokens; a wrongly-excluded one is a silent hole in the take-off. |
| **Infer the recipe [AI]** | The pack's folder tree + a sample of filenames and title blocks are summarised as **text** and handed to the model (forced tool + strict schema, low variance). It returns the packaging strategy, the junk folders/keywords, and the list of distinct house-type names — and **explicitly does not place files**. |
| **Apply the recipe** | Code compiles the recipe into the same profile shape the built-in profiles use, then assigns **every** file to a house type (or to "junk / pack-level"). Within each house type it then tightens the set (§14.5). |
| **Assemble** | Each house type's chosen pages are merged into **one combined PDF**, relevant pages **first**, with a **page manifest** tracing every page back to its source file + page. |
| **Answer-key self-check [AI]** | Many packs contain a take-off / plot-schedule / drawing-register sheet. The sheet is found deterministically, its house-type list is read **[AI]**, and code cross-checks it against our grouping → *expected / matched / missing / extra* ("expected 16, found 15"). |
| **Propose → confirm** | The worker **stops** at a `PROPOSED` state and creates *pending* extractions. A human reviews the confirm screen and only then approves — which enqueues the paid extraction (§14.6). |

## 14.3 What's AI vs deterministic

There are exactly **three** AI touch-points, all **text-based**, all forced-tool +
schema, all on the grouping model (`ANTHROPIC_GROUPING_MODEL`, defaulting to the
extraction model `claude-opus-4-8`):

1. **Recipe inference** (`inferRecipe.ts`) — picks the packaging strategy + junk +
   house-type names from a text manifest. Never places files.
2. **Relevance triage** (`relevanceTriage.ts`) — rescue-only re-judging of
   ambiguous pages, batched, never removes a page.
3. **Answer-key list** (`answerKey.ts`) — reads the house-type names off a schedule
   sheet for the cross-check.

**Everything else is deterministic:** path/filename/title-block parsing
(`parsePath.ts`), revision/variant/canonical-role dedup, file placement
(`group.ts`), recipe compilation (`recipe.ts`), the built-in builder profiles and
detection (`profiles.ts`), Tier-1 classification, PDF assembly/merge
(`assemble.ts`), the answer-key comparison, and the whole confirm / override /
enqueue gate.

All three AI steps are gated by one env flag, **`INGEST_GROUPING_AI`** (default
**on**; set to `false` to run the fully deterministic path — offline, free,
identical every time). **Fallbacks:** if the AI is off or the recipe inference
fails, code falls back to a built-in **deterministic builder profile**; if neither
resolves a pack, it falls back to the legacy per-file segmentation and marks the
pack `FALLBACK` (auto-queued). Grouping degrades safely; it never stalls.

## 14.4 Grouping = identity, relevance = a per-page tag

The output of grouping is, per house type: **one combined PDF (the complete
dossier)** + a **page manifest** recording, for every page, its source (file +
page) and a **`relevant`** flag. That manifest drives everything:

- **Extraction** reads only the **relevant** pages — and because they're ordered
  **first**, that's a clean contiguous page range.
- **Review — the left preview** shows only the relevant pages (just the scaffold
  drawings).
- **"Open full drawing"** opens the **entire** dossier (every page, trades and
  all). It's built lazily and cached only when someone actually clicks it, so the
  eager assembled PDF stays small. This is also the **safety net**: if the relevant
  tag ever wrongly hides a page, it's still there in the full PDF and can be flipped
  on.

## 14.5 Keeping the extraction set tight

A house type's material (brick/stone/render) and handing (LH/RH) options repeat the
**same** plans and sections many times, so the *relevant* page count can balloon
(real packs hit 18–26 pages where a take-off needs ~10–14). Three deterministic
collapses trim it, in the dossier's grouping step:

- **Latest revision wins** — `ISSUE 7.2` supersedes `ISSUE 7.1` of the same sheet.
- **Config/variant collapse** — one *primary* file per variant is chosen for
  extraction (preferring the non-"affordable" variant), while **all** variants stay
  in the full dossier.
- **Canonical-role dedup** — among the relevant pages, keep **one per canonical
  geometry role**: floor plan *by level* (GF/FF/SF/TF), setting-out, roof, section.
  Duplicates are demoted to dossier-only (`relevant = false`) — still in the full
  PDF, just not re-read. This is informational; it does **not** lower a group's
  confidence.

> ⚠️ **Elevations are never collapsed — deliberately.** On real packs the text layer
> labels every elevation identically ("FRONT ELEVATION", or a bare "ELEVATION") and
> does **not** name the rear/side/gable faces. Two pages that *read* the same may be
> different faces or a render variant, so dropping one could silently lose a face's
> apex / render / height read — a hole in the take-off. An extra elevation page
> wastes a few tokens; a missing one mis-prices the quote. A page whose role can't
> be *positively* identified is likewise left relevant. The only ceiling on
> elevations is a hard page cap (`MAX_EXTRACTION_PAGES`).

## 14.6 The self-checks and the human gate

Two things make grouping trustworthy before any money is spent:

- **The in-pack answer key** (§14.2) surfaces "expected 16 house types, found 15"
  right when a human can fix it — a free ground-truth check at runtime, no separate
  test suite.
- **The confirm screen is a hard gate.** The worker produces only *pending*
  extractions and stops at `PROPOSED`. The confirm screen sorts **low-confidence
  groups to the top**, shows the answer-key mismatch banner and any unplaced files,
  and lets a human **rename / merge / exclude** groups. **Only "Confirm & extract"
  enqueues the paid extraction** — nothing costs money until a person approves.
  (This mirrors the whole platform's rule: nothing is ever auto-priced; a human
  confirms first.)

## 14.7 What's built vs later

- ✅ **Built (all five near-term features):** folder-first resumable upload;
  group-everything + per-page relevance tag with the preview-relevant /
  open-full-everything split; AI-first grouping (infer recipe → deterministic
  apply, with profile/legacy fallbacks); the in-pack answer-key cross-check;
  Tier-2 rescue-only relevance triage; and the rename/merge/exclude override UI.
  Verified end-to-end on the four real fixture packs (Vistry, Bloor, Tilia, Taylor
  Wimpey — gitignored PII).
- ⚠️/🔭 **Later or optional:** *recipe caching* (persist a confirmed recipe and
  reuse it on repeat packs — deferred because inference is already cheap and a
  *stale* cached recipe could silently mis-group when a builder changes their
  packaging); *OCR / vision rescue* of raster (image-only) PDFs (today they're
  flagged for a human, not read); and an offline *grading harness*. File-level
  reassign / split in the confirm UI is a follow-up to the rename/merge/exclude
  already shipped.

**Data model (migration `smart_upload_grouping`):** `PackUpload.relativePath`;
`Document.relativePath` + `contentHash` + `pageManifest`; `DocumentKind.ASSEMBLED`
(the synthetic combined PDF); `TenderPack.groupingStatus` (`PROPOSED` / `CONFIRMED`
/ `FALLBACK`, plus a transient `GROUPING`) + `groupingData` + `builderProfileId`;
`BuilderProfile.ingestProfile` (reserved for the later recipe cache).

---

*Ground truth: `src/lib/extract/*` + `src/lib/takeoff/*` at `PROMPT_VERSION
2026-08-26.2`, model `claude-opus-4-8`. Companion docs: `docs/13` (the playbook the
prompt projects), `docs/12` (the live prompt/contract mirror), `docs/11` (rules +
open questions), `docs/03` (glossary), `docs/17` (smart upload & grouping — Part 14).
This file is the single self-contained reference; if it and the code disagree, the
code wins — and this file should be re-synced.*
