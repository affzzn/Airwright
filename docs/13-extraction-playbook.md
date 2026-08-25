# 13 · Extraction Playbook — the single source of truth for reading a drawing

**What this is.** The canonical, measurement-by-measurement guide to reading a
scaffold take-off off a house-builder's drawing: for every value — *what it is →
which drawing/page to find it on → how to read or derive it (step by step) →
which layer owns it → cross-checks & edge cases → confidence.* Plus the **reading
order** and **worked examples** from real drawings.

**Who reads this.** The team, *and* the model. `src/lib/extract/prompt.ts` is a
**distilled projection of this document** — when this changes, the prompt is
re-synced and `PROMPT_VERSION` is bumped. This doc is authoritative; the prompt
must never drift from it.

**Sources.** Built from `docs/03-domain-glossary.md` (term definitions),
`docs/11-takeoff-engine-spec.md` (confirmed rules + open questions), the coverage
checklist (`docs/Airwright-Estimator-Build-Checklist_from_call.docx`), and
verified worked examples from `colin-data/`.

---

## 0. The two doctrines that govern all reading

**A. Read observables, don't price.** The model reads *facts off the drawing*
(lengths, heights, counts, roof shape, stated areas) each with **confidence** and
**provenance** (which sheet, which printed dimension). The deterministic engine
(`src/lib/takeoff/engine.ts`) turns those into the take-off (lift count, perimeter
total, prices). The model must **never** output a lift count, a perimeter total,
a stage split or a price.

**B. Report the stated value AND the raw dimensions behind it — the engine derives
and reconciles.** For anything the drawing states as a number *and* prints the
dimensions behind it (birdcage area above all), the model reports **both** — the
stated value *and* the raw dimensions (overall dimension, wall thickness) — and
then **stops**. The deterministic engine does the subtraction, the multiply and
the reconciliation, and sets the confidence: agree within tolerance → high; diverge
→ use the more authoritative (stated) value and **flag** it for a human.

The model does **no arithmetic** — not even a subtraction. Reporting a raw printed
number you can point to is reliable; doing arithmetic in your head is not. (This
changed 2026-08-21 for the birdcage — see §3.10; the engine that owns the geometry
is `src/lib/extract/birdcage.ts`.)

---

## 1. The reading order (follow this sequence)

1. **House-type identity** — name + code (title/reference sheet).
2. **Structure & dwellings-wide** — single house / semi-or-terrace / apartment block; how many houses share the frontage. *This frames everything else (per-house vs whole-block).*
3. **Storeys & room-in-roof** — count levels; look for dormers/velux (2.5-storey).
4. **Height to soffit** — vertical dim (section or elevation, `U/S Wallplate …`).
5. **Roof type & apexes per elevation** — pitched vs hipped; count apex points on each face.
6. **Render per elevation** — which faces are rendered + the rendered length.
7. **Wall segments** — front/rear/gable lengths off the building line (ground-floor / setting-out plan).
8. **Corners** — external returns on the footprint.
9. **Birdcage per floor** — stated gross-internal area **and** derived L×W (floor plans + setting-out plan).
10. **Low level, chimney, smart-roof peak** — porches/bays; chimney *drawn*; unusually high peak.
11. **Confidence & notes** — mark anything unreadable `null` + `unknown`; short useful notes only.

---

## 2. Sheet guide — which drawing carries what

Housebuilders label sheets differently, but the **content** maps like this. Only
the "relevant" rows are sent to the model.

| Sheet (typical titles) | Relevant? | What to read from it |
|---|---|---|
| **Title / Drawing Reference Sheet** | ✅ | House-type name & code; **masonry area** (pair/dwelling total, e.g. "Masonry 71.21m²"); revision. |
| **Setting Out Plan** (Beam & Block / Suspended Slab) | ✅ **(often missed — fix)** | **Gross internal footprint area per dwelling** (e.g. "35.60m² (BEAM & BLOCK)"); **run of exterior wall**; overall footprint dims. **This is Colin's birdcage number.** |
| **Ground Floor Plan / First Floor Plan** | ✅ | Internal room dims & layout; **NDSS "Total Floor Area" schedule** (usable area — smaller); footprint dims; internal walls. |
| **Elevations** (front/rear/side/gable; brick/render/stone/boarded variants) | ✅ | Roof type; **apex count per face**; **render sections + LM**; height cues; chimney stack; porches/bays. |
| **Section (A-A, B-B)** | ✅ | Vertical heights — **height to soffit / U-S wallplate**, FFL, storey heights. |
| **Truss / Roof Setting Out (roofscape)** | ✅ | Roof **pitch**; overall wallplate dims; **chimney position note** (often conditional — see §3.12). |
| Internal room elevations ("Kitchen Elevation", "Cloak Plan Elevation") | ❌ | Joinery, not scaffolding — ignore. |
| Electrical / drainage / foundations / levels / lintel / bar schedule / services / general notes | ❌ | Not a scaffold take-off — ignore. |

> ⚠️ **Pipeline note (real bug found on Dekker):** the classifier excluded the
> **Setting Out Plan** (page 4), so the model only saw the NDSS schedule (35.00)
> and missed Colin's gross-internal 35.60. The classifier must treat **Setting Out
> Plan** sheets as relevant. Tracked as a fix to `src/lib/extract/classify.ts`.

---

## 3. The measurements

Each entry: **what · where · how (read/derive) · layer · edge cases · confidence.**

### 3.1 House-type identity
- **What:** name + code (e.g. Dekker / NSS.277).
- **Where:** title/reference sheet; portfolio line in the title block.
- **How:** read the printed name/code. For a mirrored pair it may read "NSS.277 / NSS.277-1" — that's **one** house type (a pair).
- **Layer:** reads.
- **Edge cases:** codes repeat across regions for the same builder → the bank matches on builder + code.

### 3.2 Structure & dwellings-wide
- **What:** SINGLE / PAIR_OR_TERRACE / APARTMENT_BLOCK; how many houses share the printed frontage.
- **Where:** floor plans + title sheet (mirrored dwellings drawn together, named X / X-1; a communal stair ⇒ flats).
- **How:** if two mirrored dwellings share a party gable → `PAIR_OR_TERRACE`, `dwellingsWide = 2`; a terrace → 3+. Flats with several units per floor and a communal entrance → `APARTMENT_BLOCK`, `dwellingsWide = 1`. A single detached house → `SINGLE`, `dwellingsWide = 1`.
- **Layer:** reads (the engine divides the frontage by `dwellingsWide`). **Consistency check (C3):** `persist` flags SINGLE/APARTMENT with dwellingsWide ≠ 1, or PAIR/TERRACE with < 2 (`warnings.structureDwellingsMismatch`) — this pair drives the division, so a contradiction silently mis-prices the perimeter.
- **Edge cases:** report front/rear as the **full printed frontage spanning all dwellings** — do **not** pre-divide. Gable-end walls are per-house depth, never divided.
- **Confidence:** high when the drawing clearly shows a pair/terrace/block.

### 3.3 Storeys & room-in-roof
- **What:** 1 / 2 / 2.5 / 3; whether there is a habitable room in the roof.
- **Where:** elevations & section (count floor levels); look for dormers, velux, raised eaves with living space.
- **How:** count storeys from the elevation. Set `roomInRoof = true` for a 2.5-storey (adds a lift + a birdcage floor downstream).
- **Layer:** reads (storeys cross-checks the height-based lift count; never count lifts).
- **Edge cases:** a room-in-roof can look like a 2-storey from the front — the dormers/velux on the rear or the section are the tell.

### 3.4 Height to soffit — triangulated (direct read vs storey ladder)
- **What:** vertical height to the soffit — the top of the wall the scaffold reaches.
- **Datum:** ✅ **soffit / underside of wallplate ONLY** (user-confirmed, docs/11 §8a) — always read `U/S Wallplate …`; never the ridge/eaves/mid-point; the same datum on every house type.
- **Where:** section (best) — read BOTH the soffit dim (`U/S Wallplate 4725`) into `heightToSoffitM` AND the floor-to-floor **storey heights** into `storeyHeightsM` (e.g. `[2.662, 2.063]`, the last up to the wallplate). ⚠️ These are **deltas** (each storey's height), NOT absolute FFL levels — if the section prints levels `0 / 2662 / 5325`, report the DIFFERENCES. The engine also surfaces a notable direct-vs-ladder gap (>0.15 m) even when the lift count still agrees.
- **How (model):** report the raw mm→m values; do NOT sum them. **The engine (`height.ts`) triangulates:** sums the ladder as a second estimate, compares it to the direct read and a storey sanity band, and sets a **computed** confidence.
- **How (engine, H3):** ✅ a disagreement is flagged **only when the two give a different LIFT count** (`ceil(h/1.5)`) — that's what changes the price — not a fixed mm gap. Both agree → high; different lift count → low + flag.
- **Layer:** model **reads** two sources; `height.ts` reconciles → engine lifts. Also verified: the soffit `sourceDimension` is checked against the text layer.
- **Edge cases:** only the direct read → lean on the storey band (medium, or low if out of band); only the ladder → use its sum (medium); neither → null/unknown.

### 3.5 Wall segments (front / rear / gable_left / gable_right)
- **What:** each external wall length along the building line, for one dwelling.
- **Where:** ground-floor plan / **setting-out plan** — the **building line (brickwork line)**, off the outside of the plan. Gable lengths also come from the side/gable elevation or the plan depth.
- **How:** read each wall separately with its dimension string. Front/rear = the eaves faces (the frontage); gable_left/right = the two side/end walls. For a pair, front/rear = the **full frontage spanning both houses** (engine divides); gables = full depth.
- **SOURCE (the classic error — wall line vs roof overhang):** read the length off the **FLOOR PLAN / setting-out plan** printed dimension, **never off an elevation and never by scaling**. The roof overhangs the wall by ~200–400 mm each side, so an elevation's overall over-reads the wall. If only the overhang line is legible, read it, set the wall LOW, and note it — **never subtract an overhang** yourself. The **text-layer candidate list** (§2 systemic) makes the model snap to the exact printed number.
- **Layer:** reads (engine sums → perimeter, applies config + corner allowance). Three automatic checks: the `sourceDimension` is **verified against the text layer**; a wall cited off an **ELEVATION** page is **capped + flagged** (`warnings.wallReadOffElevation`); and **symmetry (C9)** — front≈rear and gable_left≈gable_right, a >10% mismatch flags a likely role-swap/misread (`warnings.wallAsymmetry`), especially telling on a pair where front/rear span the same frontage.
- **Edge cases:** a minor step → bounding rectangle (still 4 corners); a genuine L/T/U → list the extra walls as `other` AND split the birdcage into rectangles. Do **not** sum them and do **not** add a corner allowance here.

### 3.6 Corners
- **What:** number of external corners/returns on the scaffolded footprint.
- **Where:** the footprint on the ground-floor / setting-out plan.
- **How:** count **external returns only** (a plain rectangle = 4). An L-shape adds returns (a real Dekker-type plot "technically got five corners").
- **Layer:** reads (engine adds the corner allowance).
- **Edge cases:** ⚠️ the allowance **quantum** (1 m/corner vs a 5 m allowance) is open — the model only counts corners; it never adds metres.

### 3.7 Roof type
- **What:** PITCHED / HIPPED / MIXED.
- **Where:** the elevations (the roof shape) and the roof/truss sheet.
- **How:** brickwork rising to an apex point = pitched (needs table lifts); slopes back on all sides with no brickwork above the eaves = hipped (no apex, no table lift); some faces each = mixed.
- **Layer:** reads (drives apex/table lift downstream).
- **Edge cases:** Keepmoat sites are mostly hipped. A hipped roof with reported apexes is contradictory → the engine forces 0 and flags it.

### 3.8 Apexes (per elevation)
- **What:** the count of gable apexes (triangular brickwork tops) per elevation face.
- **Where:** each elevation — physically count the points with brickwork to them.
- **How — GO FACE BY FACE, decide the shape before the number:** for each named face the schema order is `faceRoof` (GABLED/HIPPED) → `apexReason` (one line) → `apexCount` — reason FIRST, number LAST (C7), so the reasoning informs the count rather than rationalising it. Front and rear apexes (a projecting street/garden gable) are the ones most often MISSED — check them explicitly, don't assume apexes only sit on the two ends. Hipped face = 0. Micro-example (Dekker): front HIPPED 0, rear 0, left GABLED 1, right GABLED 1.
- **Layer:** reads (engine = table lift + apex handrail per apex, reduced by configuration). Automatic check: a face marked `HIPPED` that still reports an apex is flagged (`warnings.apexContradictions`); a hipped **overall** roof forces apex 0.
- **Edge cases:** a detached house typically has 2; more than 3 has never been priced (treat >3 as low confidence / check). A gablet/half-hip or chimney-on-gable → count normally if brickwork rises to a point (docs/11 §8a A2). In Strike this is "apex scaffold".

### 3.9 Render (per elevation)
- **What:** which elevations have a rendered/clad section, and its linear metres.
- **Where:** the elevations — render notes, a rendered variant sheet ("… Render Elevations"), or an "R"-suffixed code. Measure only the **rendered section**, not the whole wall.
- **How:** per face, set `rendered` and, if dimensioned, `renderLengthM` (only the rendered length).
- **Layer:** reads (engine = render LM × render lifts, in 2 m lifts).
- **Edge cases:** **render is per plot** — the same house type may supply brick/render/stone/boarded variants; the *base* take-off often asserts **no render metres** unless a specific plot is rendered (see the Dekker note). ⚠️ render-lift basis is open (Colin's table vs Laura's default).

### 3.10 Birdcage (internal area, per floor) — model REPORTS numbers, engine DERIVES & reconciles
- **What:** the m² of internal floor deck, per floor level (GF, FF, SF…). One birdcage per floor; a 2.5-storey has 3.
- **The doctrine (changed 2026-08-21):** the model does **no arithmetic** for the birdcage. It reports the **stated areas** and the **raw dimensions**; the deterministic engine (`src/lib/extract/birdcage.ts`) does the subtraction, the multiply, the pair-division, the compound-sum, and the reconciliation, and sets a **computed** confidence. This removes the class of errors where the model subtracts/multiplies in its head.
- **What the model reports, per floor** (schema `floorAreas[]`):
  1. `statedGrossInternalM2` — the **gross internal footprint area per dwelling**: **Setting Out Plan** (`35.60m² (BEAM & BLOCK)`), or the title/reference sheet **masonry area** (a pair total, e.g. `Masonry 71.21m²` — report the **per-dwelling** figure). **This is Colin's number.**
  2. `statedNdssM2` — the **NDSS "Total Floor Area"** schedule (e.g. `35.00m²`): the smaller **usable/habitable** area (excludes voids). A fallback.
  3. `rectangles[]` — the internal footprint as raw dims (one rectangle, or several for an L-shape). **Identify each printed number by its mark** (docs re-synced 2026-08-25, prompt `2026-08-25.2`):
     - `internalWidthM`/`internalDepthM` — the **directly printed internal span** (the MIDDLE number of an inner dimension line reading `[wall | span | wall]`, e.g. `328 | 5287 | 328` → 5287). **Preferred.**
     - `overallWidthM`/`overallDepthM` — the **outermost** external dimension line (tick-to-tick at the outer brick faces), reported as-is (used to derive the internal when no internal span is printed, and always as a cross-check).
     - `wallThicknessMm` — the **STRUCTURAL** wall thickness off the plan's dimension chain (the short end segment across the hatched wall, e.g. `328` Miller / `302` NSS / `392` Augusta). **Different on every drawing — read it, never assume.** The birdcage is measured to the **structural / blockwork** face (✅ confirmed 2026-08-25).
     - `legendWallThicknessMm` — the **WALL LEGEND** cavity-wall value (e.g. `353`), the **finished-face** thickness. **Fallback only** — used to strip the overall only when the plan doesn't dimension the structural wall, and then the floor is capped and flagged.
     **The model never subtracts or divides** — and the room/partition subdivision chain (numbers that sum to the overall but aren't flanked by wall zones) is **ignored**.
- **Same footprint, every floor:** a plain house has the same footprint on each floor, so the model reports the stated area and dimensions on **GF *and* FF** (and SF) alike — so each floor can be cross-checked, not just GF.
- **What the engine does** (`computeBirdcageFloor`) — the per-axis **ladder**: `depth = internalDepthM ?? (overallDepthM − 2·wall)`; `width = internalWidthM ?? (overallWidthM − 2·wall) ÷ dwellingsWide`, where `wall = wallThicknessMm (structural) ?? legendWallThicknessMm (finished)`; `derivedArea = Σ(width × depth)`; then **reconcile** against the stated gross-internal (within **2%**, ⚠️ a Colin sign-off tolerance): agree → use the stated area, **high** confidence; diverge → use the stated area but **flag**. **NDSS cross-check (C11):** when NO gross-internal is stated but NDSS is, the derived footprint is checked against the NDSS *usable* area — gross-internal should sit **0–12% ABOVE** usable (NDSS excludes voids) → **high** (medium if the finished-face legend wall was used); outside that band → low + flag. Only derived, no NDSS → **medium** (low if the legend wall was used). **There is NO default wall thickness:** an overall dimension with no internal span and no wall (plan or legend) leaves that floor **UNRESOLVED** (`m2 = null`, `source: none`) and flagged for a human — never guessed. The step-by-step working (width × depth, the reconciliation ✓/✗) is shown in the review tooltip.
- **Layer:** the model **reads** the stated areas + raw dims; **`birdcage.ts` computes + reconciles**; `persist.ts` stores the final m² with the computed confidence and the derivation trail.
- **Edge cases:** use the **internal** area, never the external footprint (bigger, over-reads). Irregular floor → **several rectangles** (the engine sums them). The wall thickness is **read off the drawing per-floor**, not defaulted; only the reconciliation **tolerance** remains an ⚠️ open param, flagged when used.
- **Which area to prefer:** **gross internal (Setting Out / masonry), not NDSS usable.** They differ because NDSS excludes voids; Colin's take-off uses the gross internal footprint.

### 3.11 Low level (porch / bay)
- **What:** count of porches + bay windows (each = one low-level tower).
- **Where:** elevations & plan.
- **How:** count porches and bays. A porch/entrance **GRP canopy still counts**.
- **Layer:** reads (unit-priced downstream — the model only spots & counts).
- **Edge cases:** some Bloor sites want a beam-over instead of a returning low-level — a builder-profile item, not read from the drawing.

### 3.12 Chimney
- **What:** whether a chimney stack is actually drawn.
- **Where:** elevations & roof/truss sheet.
- **How:** `chimney = true` **only if a stack is drawn**. A conditional note ("position of chimney to be supplied … for CLA & QA styles only, refer to plot log") with **no stack drawn** → `chimney = false`, and say so in notes.
- **Layer:** reads (engine = fixed chimney scaffold; a spec asking for one with none drawn is flagged, not priced).
- **Edge cases:** specs frequently demand a chimney scaffold even when none is drawn — that mismatch is flagged, never silently priced.

### 3.13 Smart-roof peak
- **What:** an unusually high roof peak (a "smart roof" → double table lift).
- **Where:** the roof/section — the peak height for the type.
- **How:** if the peak looks unusually high, report `smartRoofPeakHeightM`. **Do not apply a threshold** — just report the height and let a human judge.
- **Layer:** reads.
- **Edge cases:** ⚠️ the actual threshold is open; mainly a Bloor thing.

---

## 4. Worked examples (from real drawings)

### 4.1 Dekker (NSS.277) — birdcage, "report numbers, engine reconciles"
A semi-detached pair. The internal floor area is printed in **three** places, and
they are **not** all the same number:

- **Setting Out Plan (p.4):** `35.60m² (BEAM & BLOCK)` — the **gross internal footprint per dwelling**. ← **Colin's number.**
- **Title sheet (p.1):** `Masonry 71.21m²` — the **pair total** (= 35.60 × 2).
- **First Floor Plan (p.24):** NDSS `TOTAL FLOOR AREA … 35.00m² … 35.00m² … 70.00m²` — the **usable/habitable** area (smaller; excludes voids).

**What the model reports** (numbers only, per floor, GF and FF alike):
`statedGrossInternalM2 = 35.60`, `statedNdssM2 = 35.00`, `rectangles =
[{ internalWidthM: 4.877, overallDepthM: 7.904, wallThicknessMm: 302 }]`. It reads
`4877`, `7904`, `302` and **stops** — no subtraction, no multiply.

**What the engine computes** (`birdcage.ts`):
1. depth = 7.904 − 2×0.302 = **7.300 m**.
2. area = 4.877 × 7.300 = **35.602 m²** (derived).
3. reconcile: |35.602 − 35.60| / 35.60 = **0.0% ≤ 2%** → use the stated **35.60 m²**, **high confidence**.
4. GF + FF = **71.2 m²** total.

**Validated live (2026-08-21, prompt `2026-08-21.1`):** the runner returns
`GF: 35.6 m² [high] (stated) — ✓ cross-checked (derived 35.602, Δ 0.0%)`, and the
engine take-off reproduces Colin's line (`20.564 × 4 lifts / 71.202 m² × 2 floors /
1 apex / 1 low level / 1 party wall`). This is the fix for the earlier bug where
the tool read `35.00` (NDSS) because the classifier had excluded p.4 — Setting Out
Plans are now relevant, the gross-internal wins, and the derived footprint
cross-checks it deterministically.

### 4.2 Dekker — perimeter & lifts (for reference)
- Walls (per dwelling): front 10.66 / rear 10.66 (full pair frontage; engine divides by 2), gables 7.904 each.
- Height 4.725 m → `ceil(4.725 ÷ 1.5)` = 4 lifts; 2-storey template agrees (4). ✅
- Semi/End configuration → 3 sides, 2 corners, 1 party wall. Matches Colin's 20.5 (pair) / 10.6 (per house) lines.

---

## 5. Which layer owns each number (summary)

| Number | Model reads | Engine computes |
|---|---|---|
| Wall lengths, height, storeys, apex count/face, render LM/face, corners, **birdcage raw dims + stated areas**, porch/bay, chimney, roof type, structure, dwellings-wide | ✅ | |
| Lift count (`ceil(h ÷ 1.5) + RiR`) | | ✅ |
| Perimeter (Σ config walls + corner allowance) × lifts | | ✅ |
| Birdcage m²: depth = overall − 2·wall, width×depth, Σ rectangles, **reconcile vs stated** | reads stated areas + raw dims | ✅ `birdcage.ts` computes, reconciles & sets confidence |
| Apex → table lift + handrail, config reduction | | ✅ |
| Render LM × render lifts | | ✅ |
| Party walls, stage splits, all £ | | ✅ |

---

## 6. Open questions that touch reading

These stay **flags**, never guessed (full table: `docs/11 §8` / checklist §15):
height **datum** (§3.4), corner **quantum** (§3.6), the birdcage **reconciliation
tolerance** (§3.10 — the wall thickness itself is now read per-drawing, not
defaulted), **render-lift** basis (§3.9), smart-roof **threshold** (§3.13), the
two-lift-birdcage **client** (§3.10).

---

## 7. Keeping the prompt in sync

`src/lib/extract/prompt.ts` (`SYSTEM_PROMPT` + `USER_INSTRUCTION`) and the
`schema.ts` field descriptions are the **distilled, model-facing projection** of
this playbook. Process when this doc changes:
1. Update this playbook (authoritative).
2. Re-sync the affected prompt/schema wording.
3. Bump `PROMPT_VERSION` so evaluations stay comparable.
4. Re-run the eval harness (Phase 2) to confirm the change helped, not hurt.

*Nothing here is priced by the model, and nothing marked ⚠️ is assumed. The model
reads and derives; the engine computes; a person confirms.*
