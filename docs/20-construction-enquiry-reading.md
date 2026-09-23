# 20 · Construction Enquiry Reading — reading the SCOPE + the DRAWINGS (spec)

**What this is.** The canonical spec + technical build plan for the **AI reading of a
real construction enquiry** — the email/scope-of-works (words) **and** the technical
drawings (numbers) — into a **draft, human-confirmed quote**. It is the missing half of
the construction estimator: `docs/19` built the manual picking-list quote builder + the
**text scope reader** ("Draft from enquiry"); this doc adds the **drawing reader** and the
**assemble-and-verify** layer, so the tool reads what the client actually sends.

Read `docs/19` (construction estimator), `docs/11` + `docs/13` (the house-build extractor
this mirrors) and `docs/03` (glossary) first. **Nothing in the house-build take-off/pricing
engine is touched.** Sources: the 9 Sep "Construction Walkthrough" + 16 Sep "Strike
Construction Walkthrough" calls, and the two real fixtures in `data/construction/` (gitignored PII).

> **STATUS (2026-09-23): ✅ BUILT (Tracks A–E).** The drawing-reading layer is wired end to end:
> the Opus 4.8 multimodal reader (`readDrawing.ts` + `drawingSchema/Prompt/Text.ts`), the pure
> tested assemble+verify core (`assemble.ts`, 12 tests reproducing the Wren draft), the data
> model (migration `construction_enquiry_reading`: attachment `useForDrafting` + reader output),
> the server actions (`constructionDrawings.ts` — toggle / read / apply, with the answer-file
> guard), and the UI ("Read drawings" modal + the per-file AI toggle). Green: typecheck, lint,
> full tests + build. **Validated LIVE against `eg-01`**: the reader pulled the exact Wren values
> (external 42.199/35.157, birdcages 203.34/123.88 m², roof edge 77.357, Haki ×3/×2, loading bays
> ×3/×2, building height 4.955 m → ≤6 m bracket), and a full storage→read→assemble→insert
> round-trip produced the 10-line quote (£12,619.83 on placeholder rates) + 6 measurements, then
> cleaned up. `eg-02` raster degraded gracefully (hasTextLayer=false, no hallucinated dims).
> Deferred (v2): auto-measuring un-dimensioned CAD geometry (§16); scope×drawing call-off merge
> (the cross-check engine is built + tested, just not yet fed the scope reader's numbers). Rates +
> terminology remain the open Airwright items.

> Legend: **✅ CONFIRMED** (from the calls/examples — build it) · **⚠️ CONFIRM** (needs a
> Colin/Laura answer — flag, don't guess) · **🔧** (a code/schema change) · **🚫 OUT OF
> SCOPE** (explicitly not building).

---

## 0. The one big idea — the enquiry is SCOPE + DRAWINGS, and we verify one against the other

A construction enquiry is never the answer; it is **what the client asks for** (the scope,
in words) plus **the drawings** (where the numbers live). The AI's job is the same
propose-then-confirm shape as house-build, but on this pair of inputs:

| | House-build | **Construction (this doc)** |
|---|---|---|
| The document the AI reads | the **drawings** | the **scope (words) + the drawings (numbers)** |
| What it produces | a derived take-off | **draft priced lines against the picking list** |
| The drawing's role | the source of the take-off | **the source of TRUTH that VERIFIES the client's stated quantities** |
| The governing rule | judgment fills a vague scope | **price EXACTLY the scope — no more, no less** (Ben) |

**Two doctrines carried over from `docs/13` (do not break):**
- **A. Read observables, don't price.** The readers return facts (a count, a length, a
  height) with **confidence + provenance**. They NEVER output a price, a stage split, or a
  final line — a deterministic layer + a human do that.
- **B. Report the stated/printed value, don't do arithmetic in your head.** Reading a printed
  "42.198 m" or counting three labelled "Lift 02" entrances is reliable; inferring a length
  from raw geometry is not. Prefer the printed number; measure only when it is absent, and
  flag the lower confidence.

**The construction-specific doctrine (Ben, firmly):** *"It doesn't just price from the
schedule — it works it out itself from the drawing."* The client's number (the QS's
**call-off**) is a **double-check**, never the answer. Colin: *"I always do my own call-off…
find lift 02, count the entrances, cross-check it's 3 and not 4."*

---

## 1. Ground truth from the two real fixtures (probed 2026-09-23)

`data/construction/` holds two enquiries that bracket the whole problem. **The internal
Airwright "answer" files in each folder are for our understanding only and must NEVER be fed
to a model** (see §9).

### 1.1 `eg-01/` — Wren Park (Stepnell): the DETAILED "dream" enquiry
- **Enquiry inputs:** `Re_ Scaffolding quote…​.eml` (prose scope: *"scaffold wrap around the
  building for brickwork lifts; access scaffold to the roof with edge protection; crash decks
  in each classroom for roof lights"*), `Wren park elevation plan.pdf` / `…2.pdf`,
  `wren park roofing plan.pdf`, `Wren park skylight locations.pdf`, `wren park way in to
  site…​.pdf`, and the **marked-up** `Wren - Scaffolding Measure.pdf`.
- **Probe result:** the drawings are **A1 vector CAD PDFs WITH a full text layer** (embedded
  ArialMT / Arial Narrow). Selectable content includes real dimensions ("18,892.16 mm",
  "7848", "2889"), feature labels ("3nr Lift", "Loading Bay", "Classroom Entrance"), and full
  door/window/roof schedules. The Measure sheet carries the human mark-up: **blue = 3-lift
  external scaffold (42.2 m/lift), red = 2-lift birdcage (~35.2 m/lift), green = handrail
  perimeter**, with side notes.
- **Answer file (do NOT feed):** `Wren - Scaffolding Schedule.xlsx` (Airwright's own priced
  schedule — this is the output shape, `docs/19 §2`).

### 1.2 `eg-02/` — Murray Park: the VAGUE enquiry (school, edge protection)
- **Enquiry inputs:** `FW_ Murray Park - Scaffolding.eml` (thin; the substance was attached),
  `Block F Roof Plan.pdf`, `Site plan.pdf`, `Muarry Park Scaffolding and Logistics Plan.pptx`.
- **Probe result:** `Block F Roof Plan.pdf` and `Site plan.pdf` are **A4 "Microsoft: Print To
  PDF" RASTER images — ZERO text layer, ZERO selectable dimensions.** They show *where* to
  scaffold, not *how much*. This is precisely why Colin measured it on **Google Earth** (3D,
  counting windows for height → ~4 m → 2 lifts).
- **Answer file (do NOT feed):** `Quote-1375-1-1.pdf`.

### 1.3 The decisive split this creates
| Drawing world | Example | Text layer / dimensions | AI leverage |
|---|---|---|---|
| **Detailed vector** (readable) | eg-01 | yes — printed dims + labels + mark-ups | **HIGH**: read counts + measurements directly |
| **Vague raster** (a picture) | eg-02 | none | **LOW**: read the scope + legible labels only; **measurements are entered by hand** |

**So the AI's high-value target is: the scope text + the detailed/marked-up drawings.** Vague
image-only plans stay a human-measures case (**no Google-Earth automation**, §2).

### 1.4 The three enquiry shapes (from the 9 Sep call)
1. **Vague** — email + a bird's-eye photo + a sentence (eg-02). No dimensions.
2. **Scope of works (Excel)** — the QS lists exactly what they want, row by row, with
   locations and often a call-off metreage (the National Grid / McLaughlin-Harvey job). *A
   pricing document.* (No such Excel is in the repo yet — ⚠️ get one to tune against.)
3. **Detailed** — photos + prose + fully **marked-up** drawings (eg-01). "The dream ones."

---

## 2. Scope & non-goals (read twice)

**🚫 EXPLICITLY OUT OF SCOPE:**
- **No Google-Earth automation** — no geocoding, no API, no window-counting. Vague, un-
  dimensioned enquiries are measured **by hand** by the estimator (confirmed; it is rare and
  manual). The AI never guesses a dimension that isn't on the drawing.
- **No smart-upload / cross-file grouping** (`docs/17`). Construction jobs are **one-off**;
  the estimator uploads a handful of files to the quote. No builder profiles, no page
  segmentation, no combined-PDF assembly.
- **No auto-pricing, no auto-send.** AI proposes; Colin confirms every line. "The AI won't
  take the phone call" — humans own scope changes.
- **The AI never invents a picking-list item.** An un-matched scope/feature is flagged for a
  **human** to add to the library (`docs/19 §1.3`).
- **We never feed the internal "answer"** (Airwright's schedule/quote) to a model (§9).

**✅ IN SCOPE:**
1. A **drawing reader** (Opus 4.8, multimodal) that returns labelled counts, measurements,
   heights and mark-ups with confidence + provenance.
2. An **assemble-and-verify** layer that fuses the scope items with the drawing observations
   into draft measurements + draft lines, and **cross-checks the client's call-off against the
   drawing**.
3. A **per-file "use for drafting" control** and the answer-file boundary.
4. Wiring the drawing output into the existing **measurements panel** + **line builder**,
   with provenance and cross-check flags — the same review-and-confirm loop as the text draft.

**The bar:** on a detailed/marked-up enquiry the estimator gets near-complete, traceable draft
lines to check ("I'd just type it in"); on a vague one, a correct item list with quantities
flagged "measure by hand"; and on any enquiry, the drawing is used to **verify**, not to invent.

---

## 3. The model + the multimodal mechanics (Opus 4.8 for BOTH)

**One model — `claude-opus-4-8` — does text and vision.** It is multimodal; there is no
separate "vision model". Both readers use the shared tool-use helpers in
`src/lib/extract/claude.ts` (`runToolExtraction` for a PDF, `runToolText` for pure text),
forcing a single tool call, prompt-caching the system prompt + tool schema, returning token/
cost telemetry.

- **Text scope reader** → `runToolText` on `env.constructionModel` (cheap/fast is fine). ✅ built.
- **🔧 Drawing reader** → `runToolExtraction`: send the drawing **as a base64 `document`
  block**. Claude renders each PDF page to an image (it *sees* the linework + mark-ups) **and**
  reads the embedded text. Use the **extraction model (Opus 4.8)** here — vision + spatial
  reasoning needs the strong model. New env: **`ANTHROPIC_CONSTRUCTION_DRAWING_MODEL`**
  (default → `env.extractionModel`).

**⚠️ The A1 resolution problem — and the mitigation (critical for correctness).** Claude
downsamples a page to ~1568 px on its longest edge. An A1 sheet is **2383.94 × 1683.78 pt**;
small dimension text blurs at that scale. Mitigations, in order:
1. **Feed the text-layer strings as a candidate list** (exactly the house-build trick,
   `extractDimensionsByPage` + `buildDimensionHint` in `classify.ts`/`dimensions.ts`): extract
   **every label and dimension string** off the sheet (all `Lift 0n`, `LV`, `Stair 0n`, `W1..`,
   every `nnnn` / `n,nnn.nn mm`) and give them to the model as text, so it reads *labels and
   numbers as text* and uses the *image* only for spatial reasoning (which feature is where,
   how many per floor, what encloses a perimeter). This makes counting and reading printed
   dimensions reliable even on a blurry A1.
2. **Per-feature region crops (v2).** For a fine measurement the model can't resolve, crop the
   sheet to the feature's bounding region (from its label's text-layer coordinates) and re-read
   that tile at full resolution. Deferred; §16.
3. **Raster-only sheets (eg-02):** no text layer → no candidates → the model reads only the
   image and returns **low-confidence labels + "no measurable dimensions"**. Correct behaviour:
   surface the items, flag every quantity for manual entry.

---

## 4. Architecture — two layers, mirroring house-build

```
ENQUIRY (uploaded: email/scope text + drawings; answer files excluded)
 └─ LAYER 1 · READ (AI, observables + confidence + provenance)
      ├─ (a) Scope reader  (text)     ✅ BUILT  → picking-list items + client call-off
      └─ (b) Drawing reader (vision)  🔧 NEW    → labelled counts + measurements + mark-ups
 └─ LAYER 2 · ASSEMBLE + VERIFY (deterministic, no AI, PURE + tested)
      • fuse scope items × drawing observations
      • apply construction rules (Haki=3, roof→triple, gate = entrances×floors, per-lift…)
      • CROSS-CHECK call-off vs drawing → flag divergence
      • emit draft Measurements (source=DRAWING, provenance) + draft Lines (isAuto)
 └─ HUMAN REVIEW (existing builder: measurements panel + line builder) → confirm
 └─ PRICING (existing price.ts) → quote        [UNCHANGED]
```

Layer 1 readers are AI and per-document. Layer 2 is pure, unit-tested, and holds every rule —
so all the "must be correct" logic is testable in isolation, exactly like the house-build
engine.

---

## 5. The drawing-reader observable schema (the heart) — 🔧 `readDrawing`

Per drawing, `readDrawing(pdf, candidateHints) → DrawingObservations`. Zod-defined; the tool's
JSON schema is generated from it (via `zodToJsonSchema`) so contract and parser cannot drift
(`docs/13` pattern). **Every measured value is a field wrapper** carrying provenance:

```ts
// A single observed value, traceable (mirrors the house-build numberField).
type Field<T> = {
  value: T | null;
  confidence: "high" | "medium" | "low" | "unknown";
  sourceDimension: string | null; // the EXACT printed string, if read off the text layer
  sourceSheet: string | null;      // the sheet/title-block name
  sourcePage: number;              // 1-based page in the attached PDF
};

interface DrawingObservations {
  sheet: {
    kind: "ELEVATION" | "FLOOR_PLAN" | "ROOF_PLAN" | "SITE_PLAN" | "SECTION" | "MARKED_UP" | "OTHER";
    title: string | null;
    hasTextLayer: boolean;          // false → raster/vague → treat measurements as unreliable
    siteTypeHint: "SCHOOL" | "PUBLIC" | "SITE" | null; // drives mat/foam suggestion
    confidence: Field<never>["confidence"];
  };

  buildingHeightM: Field<number>;   // off an ELEVATION → lift count + height band (≤6/6-12/12-18)

  // Counted, labelled features (RELIABLE — count off the text layer, confirm on the image).
  liftShafts: Array<{
    label: string;                  // "Lift 01", "Lift 02"
    entrancesByFloor: Array<{ floor: string; count: number }>; // per FLOOR PLAN
    totalEntrances: Field<number>;  // Σ across floors → lift-gate count
  }>;
  lvPits: Array<{ label: string; perimeterM: Field<number> }>;       // "LV" markings
  stairs: Array<{
    label: string;                  // "Stair 01"…
    kind: "PRECAST" | "STRAIGHT_SET" | "UP_OVER" | "ACCESS" | "OTHER";
    heightM: Field<number>;         // off ELEVATION/SECTION (precast ~10 m, upstand ~0.8 m…)
    perimeterM: Field<number>;      // if edge protection wraps it
  }>;
  loadingBays: Array<{ label: string; widthM: Field<number>; lengthM: Field<number>; heightM: Field<number> }>;

  // Runs / areas — prefer the PRINTED or MARKED-UP figure; measure only if absent (low conf).
  externalRuns: Array<{ zone: string | null; lengthM: Field<number>; liftsMarked: number | null }>; // blue zones
  birdcages: Array<{ zone: string | null; areaM2: Field<number>; liftsMarked: number | null }>;      // crash decks (red)
  roofEdgePerimeterM: Field<number>; // green line

  // Human mark-ups, read VERBATIM (the "dream" case — these are the answer).
  markups: Array<{ text: string; valueM: number | null; zoneColour: string | null; note: string | null }>;

  accessPoints: { doorways: Field<number>; fireExits: Field<number> }; // → foam
  notes: string; // short, useful only
}
```

**What each reader field maps to downstream is fixed in §6–§7.** The reader itself does **no
arithmetic** — it reports counts and printed/marked figures; Layer 2 multiplies and prices.

---

## 6. The item catalogue — what to FIND / COUNT / MEASURE, per item (from the calls) ✅

The exhaustive map from a picking-list item to *what the drawing reader looks for*. This is
the extraction contract, decoded line-by-line from the two walkthroughs.

| Picking-list item | Find on the drawing | Measure / count | Rule (Layer 2) |
|---|---|---|---|
| **Independent scaffold / working platform** | mark-up / "working platform" dotted line; blue zones | run length per lift (printed/marked, e.g. 42.2 m) | LM **per lift**, height band from elevation |
| **Edge protection (handrail)** | roof/edge perimeter (green line); LV pit + stair perimeters | perimeter LM | **default TRIPLE** on roof/edge; double+toe otherwise; single only for an obstruction |
| **Lift gate ("Safegate")** | every `Lift 0n` on **each floor plan** | count entrances per floor, Σ | **one gate per entrance per floor**; **verify vs call-off** (3 not 4) |
| **Birdcage (crash deck)** | red zones; "crash decks in each classroom" | area m² per zone + lifts marked | m² **per lift** |
| **Haki stair tower** | "hacky stairs", stair access box; roof access | height off elevation → lifts | **3 lifts** (kicker+to-1st+to-2nd); per-lift inflated rate |
| **Loading bay** | boxed "loading bay" mark-up | 3.6 × 2.4 grid; height "up to 15 m" from external plan | **per lift**; height ≠ lifts (read carefully) |
| **LV pit edge protection** | `LV` markings | perimeter of each pit | double/triple LM; **cumulative-vs-per-pit flag** ("20 LM × 2 pits") |
| **Precast stair edge protection** | `Stair 0n`, precast stairs | height off elevation (~10 m, straight line) | temp handrail until balustrade; LM/height |
| **Straight stair set** | floor-level transition (e.g. 0.65 m drop, plant↔main) | find the transition + drop | temporary steps; "roughly right is fine" |
| **Up-and-over stair set** | concrete upstand (~0.8 m) | find the upstand (may be hard) | up one side, down the other; flag if not found |
| **Roof-level access scaffold** | stair structure on roof slab; "3 m platform" | 20 m perimeter; 3 m platform; ladders ×3 | independent scaffold **+ separate** roof edge protection |
| **Scaffold mat / dummy lift** | site type = school / public street | n/a (rule) | first lift only; auto-suggest for 2.7 m walking lift |
| **Foam protection** | doorways, fire exits, walk-unders | count access points | on uprights; schools may want every upright |
| **Inspections** | — | — | per hire week |
| **Extra hire** | — | — | **0.05 % of job/week** beyond inclusive weeks (⚠️ confirm) |

**The two things the AI must nail (9 Sep call):** (a) **terminology mapping** — client word ≠
picking-list word ≠ Strike word ("Safegate"→Lift Gate, "working platform"→Independent Scaffold,
"crash deck"→Birdcage); handled by `element.aliases` + the scope reader, then applied to
drawing features. (b) **verify quantities from the drawing**, never trust the call-off.

---

## 7. Layer 2 — deterministic assemble + verify (PURE, unit-tested) 🔧

Given the scope reader's items (with call-off numbers) and each drawing's observations, emit
draft **Measurements** (`source = DRAWING`, provenance) and draft **Lines** (`isAuto = true`):

1. **Match features to scope items** by label + type, using aliases (scope "Safegate" ↔
   drawing `Lift 0n` entrances ↔ picking-list Lift Gate).
2. **Compute the quantity from the drawing** per the §6 rule (e.g. gate count =
   Σ entrances-per-floor; roof handrail = green perimeter; external = blue run × lifts).
3. **CROSS-CHECK against the call-off:** if the scope stated a number and it differs beyond
   tolerance (§13), keep the drawing value and **flag** (`callOff: 45 LM / 3 gates · drawing: 4
   entrances → check`). If the scope stated nothing, use the drawing value at its confidence.
4. **Apply the rules:** Haki = 3 lifts; roof/edge → triple; loading bay/Haki/chute **per lift**;
   height → band; scaffold mat if school/public; foam = doorways+fire exits+walk-unders;
   inspections = hire weeks; extra hire = 0.05 %·job/week.
5. **Rounding:** measurements to a sensible figure at emit (42.198 → 42.2); money in integer
   pence (existing `price.ts`).
6. **Unresolved:** a scope line with no drawing evidence, or a raster sheet, → the line is still
   emitted with the **quantity blank and flagged "measure by hand"** (never dropped, never
   guessed).

Reconciliation is unchanged: lines feed the existing `priceConstructionQuote` (Σ lines to the
penny). This layer adds **no** pricing — it only produces the lines the estimator confirms.

---

## 8. The three enquiry-shape flows (end-to-end)

- **Detailed + marked-up (eg-01):** scope email → items; Measure PDF → reader returns the blue/
  red/green mark-ups + printed lengths + `3NR`/`2NR` lift counts → Layer 2 emits near-complete
  lines (external 42.2 ×3, birdcage 35.2 ×2 / m² ×3, roof handrail = green perimeter, loading
  bay, Haki ×3). Colin rounds + confirms.
- **Excel scope (National Grid):** each row → item + call-off; drawings → reader counts lift
  gates per floor, measures LV-pit perimeters, reads stair/loading-bay heights → Layer 2 emits
  lines **with cross-check flags** (the "3 not 4" and "cumulative vs per pit" cases).
- **Vague email + raster plans (eg-02):** scope email → item list (working platform, edge
  protection, Haki, skip is client-supplied); rasters → `hasTextLayer=false`, labels only →
  every quantity flagged **"measure by hand"**; site type = school → suggest scaffold mat +
  foam. Estimator measures + confirms. **No Google Earth.**

---

## 9. Uploads + the "answer-file" boundary 🔧 (simple, no grouping)

- Reuse the existing `ConstructionAttachment` + signed-URL uploader (`docs/19 §8`). No grouping.
- 🔧 Add **`ConstructionAttachment.useForDrafting Boolean @default(false)`** and let the
  estimator tick which files the AI reads. Default heuristics: emails/scope/drawings → on;
  logistics/site photos → reference only. **The internal Airwright schedule/quote is never
  eligible** — surface a clear "this looks like a priced answer, not an enquiry" guard if a file
  matches (`*Schedule*.xlsx`, `Quote-*.pdf`). Only ticked files are ever sent to a model.
- Text is extracted from scope files with the existing `scopeText.ts` (xlsx/csv/pdf-text/txt);
  drawings go to the drawing reader as `document` blocks.

---

## 10. Data model (additive — a parallel island, migration `construction_enquiry_reading`) 🔧

Reuse `docs/19`'s models; add only what the reader needs. **All additive; house-build untouched.**

```prisma
model ConstructionAttachment {            // + fields
  useForDrafting  Boolean  @default(false) // estimator ticks the files the AI reads
  drawingKind     String?                  // ELEVATION | FLOOR_PLAN | ROOF_PLAN | SITE_PLAN | SECTION | MARKED_UP | OTHER
  readStatus      String?  @default("NONE")// NONE | PENDING | READ | FAILED
  readRawOutput   Json?                    // the DrawingObservations for audit + re-assembly
  readMeta        Json?                    // model, promptVersion, tokens, costUsd
}

model ConstructionMeasurement {           // reuse; the reader writes these
  // source = "DRAWING" ; note = provenance ("Lift 02: 3 gates from GF/FF/SF") ;
  // + a nullable callOffValue Decimal? and callOffMismatch Boolean @default(false) for the cross-check
}
```

`ConstructionQuote.draftRawOutput` (already present) stores the combined draft run
(scope + drawings + assembly) for audit and a future correction-rate eval.

---

## 11. Prompt design 🔧 (versioned, tool-use, Zod)

Two prompts, both versioned like `PROMPT_VERSION`, both prompt-cached:

- **Scope prompt** — ✅ built (`scopePrompt.ts`).
- **🔧 Drawing prompt** (`drawingPrompt.ts`) — a construction-drawing analogue of
  `extract/prompt.ts`. It states the doctrines (observe don't price; report printed/marked
  values; no arithmetic), gives the **candidate hints** (all labels + dimension strings off the
  text layer), and instructs, per §6: find and **count** labelled features per floor, read
  **printed** dimensions/heights, read **mark-ups verbatim**, set `hasTextLayer`, and return
  **confidence + provenance** on every value; never invent a value → `null` + `unknown`. Forced
  single tool `record_drawing_observations`; input schema generated from the Zod schema (§5).
  Verify each cited `sourceDimension` against the text layer post-hoc (like `persist.ts`) and cap
  an unverifiable number to low confidence.

---

## 12. Review UX (extend the existing builder — no new screen) 🔧

- **Measurements panel** (already in `construction-builder.tsx`) is **pre-filled** by the
  reader: each row shows value, `source=DRAWING`, **confidence dot** (the sanctioned
  `ConfidenceDot`), and **provenance** on hover ("counted from Floor Plans GF/FF/SF"). A
  **cross-check flag** row appears where the call-off and the drawing disagree.
- **Line builder** gets the assembled draft lines (`isAuto`), editable, the client's wording in
  the note — same as the text draft today. A **"Read the drawings"** action (next to "Draft from
  enquiry") runs the drawing reader over the ticked drawings and merges the result.
- Everything stays **propose-then-confirm**; nothing prices or sends without Colin.

---

## 13. Validation, tolerance, confidence, reconciliation ✅

- **Tolerance (Colin):** out by 100–200 mm is fine; "have a go, roughly right." What must not
  happen: missing a whole item, or a whole 15 m height. So confidence is calibrated to *presence
  and magnitude*, not millimetres.
- **Confidence → the existing red/orange/green** `ConfidenceDot`. Printed/marked value = high;
  counted labels = high; measured-from-geometry = medium; raster/absent = low/unknown.
- **Cross-check flags** are first-class (call-off vs drawing) and printed as assumptions on the
  quote.
- **Account for everything**: every scope line and every drawing feature is surfaced (matched,
  flagged, or "measure by hand") — never silently dropped.
- **Reconciliation unchanged**: Σ lines to the penny (`price.ts`).

---

## 14. Routes, screens, file map 🔧 (all under `construction`)

| Path | Role |
|---|---|
| `src/lib/construction/drawingSchema.ts` | the `DrawingObservations` Zod contract (pure) |
| `src/lib/construction/drawingPrompt.ts` | drawing system/user prompt + `PROMPT_VERSION` (pure) |
| `src/lib/construction/readDrawing.ts` | `runToolExtraction` call + candidate hints + Zod parse (server) |
| `src/lib/construction/assemble.ts` | Layer 2: fuse scope × drawings → measurements + lines + cross-check (pure, tested) |
| `src/lib/construction/drawingText.ts` | extract text-layer labels + dimension candidates off a drawing PDF (server; reuse `classify.extractDimensionsByPage`) |
| `src/server/actions/constructionDraft.ts` | + `readConstructionDrawings(quoteId)` + merge into the draft |
| `src/components/construction/construction-builder.tsx` | + "Read the drawings" action; provenance + cross-check in the measurements panel |
| `prisma/schema.prisma` | + the §10 fields; migration `construction_enquiry_reading` |
| `src/lib/env.ts` | + `ANTHROPIC_CONSTRUCTION_DRAWING_MODEL` (default → extraction model) |

Reuses house-build infra: `claude.ts` (`runToolExtraction`), `classify.ts`
(`extractDimensionsByPage`), `dimensions.ts` (`buildDimensionHint`), the Zod→tool-schema
pattern. **Worker-only pdfjs imports stay out of the app bundle** (drawing text is read server-
side in the action, lazily importing pdfjs — same discipline as `scopeText.ts`).

---

## 15. Build order (tracks, correctness-first)

1. **Track A — the assemble+verify core** (pure, tested FIRST): `assemble.ts` — given mock
   scope items + mock drawing observations, produce the right lines + cross-check flags.
   **Acceptance: reproduce the Wren draft** (external 42.2×3, birdcage 35.2×2 / m²×3, roof
   handrail = green perimeter, Haki ×3, loading bay) and the "3 not 4" / "20 LM × 2 pits" flags.
2. **Track B — the drawing schema + prompt** (`drawingSchema.ts`, `drawingPrompt.ts`), pure,
   with the candidate-hint builder; unit-test the schema + hint assembly.
3. **Track C — `readDrawing` + `drawingText`** (the model call), behind
   `ANTHROPIC_CONSTRUCTION_DRAWING_MODEL`; validate against **eg-01** (counts + printed dims)
   and confirm graceful low-confidence on **eg-02** (raster).
4. **Track D — data model + the "use for drafting" toggle + answer-file guard** (migration).
5. **Track E — server action `readConstructionDrawings` + merge**, then the builder UX
   (provenance, cross-check, "Read the drawings" action).
6. Run `typecheck && lint && test && build` at each track. Rates + terminology stay placeholders.

---

## 16. Risks & mitigations (be honest about the hard part)

- **Measuring un-dimensioned geometry is the stretch.** *Counting labelled features* and
  *reading printed/marked numbers* is the high-confidence v1 win. *Auto-measuring a perimeter
  from raw CAD lines* is v2; until then, absent a printed/marked figure, the line is flagged
  "measure by hand". Mitigations: candidate hints (§3.1), region crops (§3.2, v2), and Colin's
  tolerance + the drawing-as-double-check philosophy.
- **A1 resolution** — text-layer candidates now; per-feature tiling later.
- **Vague raster enquiries** — measurements stay manual (no Google Earth); the AI still drafts
  the item list + flags.
- **Scope changes mid-job** — humans own them; the AI re-drafts on request (versioned quotes).

---

## 17. Still needs Airwright (build the hook, flag, don't guess) ⚠️

1. **The terminology list** (Laura) — client/Strike → Airwright names, to seed `aliases` so
   drawing-feature matching is reliable.
2. **The real rate sheet** + the exact **extra-hire %** (0.05 %/wk verbal) + inspection basis +
   the **height bands** (≤6 / 6-12 / 12-18…).
3. **A real Excel scope-of-works** (National-Grid type) to tune the row→item + cross-check.
4. **Per-lift confirmation** for loading bay / Haki / chute (Ben confirmed; keep as the rule).
5. **Strike walkthrough** — how inclusive vs extra hire is built up, to mirror it exactly.

---

## 18. Coverage matrix — call points → where handled

| Call point | Section |
|---|---|
| Scope is a pricing document; price exactly what's asked | §0, §2 |
| Three enquiry shapes (vague / Excel / detailed) | §1.4, §8 |
| Terminology mapping (Safegate→Lift Gate, working platform→Independent Scaffold, crash deck→Birdcage) | §6, §7.1 |
| Verify quantities from the drawing, not the call-off (3 not 4; 20 LM × 2 pits) | §0, §6, §7.3 |
| Lift gates = entrances × floors, per Lift 0n label | §5, §6 |
| LV pits, precast/straight/up-over stairs, roof-access scaffold + separate roof edge | §6 |
| Haki = 3 lifts; loading bay/Haki/chute per lift; height bands | §6, §7.4 |
| Scaffold mat (school/public/2.7 m), foam (doorways/exits/walk-unders), inspections, extra hire | §6, §7.4 |
| Handrail default triple; single/double/triple as items | §6 |
| Google Earth for vague, un-dimensioned enquiries | 🚫 §2 (manual, not automated) |
| Marked-up "dream" drawing (blue/red/green zones, printed lifts) | §1.1, §6, §8 |
| Human confirms; AI won't take the phone call | §0, §12, §16 |

*Sources: 9 Sep "Construction Walkthrough" + 16 Sep "Strike Construction Walkthrough" (session
record); `data/construction/eg-01` (Wren, detailed) + `eg-02` (Murray Park, vague) — gitignored
PII. Cross-refs: `docs/19` (construction estimator), `docs/11`/`docs/13` (house-build extractor
this mirrors), `docs/03` (glossary), `docs/07` (design system), `ARCHITECTURE.md`.*
