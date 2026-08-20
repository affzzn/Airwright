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

**B. Read the stated value AND derive it independently — then reconcile.** This is
the new rule and it matters. For anything the drawing states as a number *and*
can be computed from dimensions (birdcage area above all), do **both**:
1. **Report the stated value** if the drawing prints one (say where it came from).
2. **Derive it from the dimensions** step by step.
3. **Reconcile.** Agree → high confidence. Diverge → report the **more
   authoritative** value (see each field), and **flag** the discrepancy for a human.

Deriving is still "reading" — a dimension the drawing doesn't print directly
(e.g. internal depth) is *derived from ones it does* (overall − wall thicknesses).
That derivation is the model's job; only the final pricing math is the engine's.

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
- **Layer:** reads (the engine divides the frontage by `dwellingsWide`).
- **Edge cases:** report front/rear as the **full printed frontage spanning all dwellings** — do **not** pre-divide. Gable-end walls are per-house depth, never divided.
- **Confidence:** high when the drawing clearly shows a pair/terrace/block.

### 3.3 Storeys & room-in-roof
- **What:** 1 / 2 / 2.5 / 3; whether there is a habitable room in the roof.
- **Where:** elevations & section (count floor levels); look for dormers, velux, raised eaves with living space.
- **How:** count storeys from the elevation. Set `roomInRoof = true` for a 2.5-storey (adds a lift + a birdcage floor downstream).
- **Layer:** reads (storeys cross-checks the height-based lift count; never count lifts).
- **Edge cases:** a room-in-roof can look like a 2-storey from the front — the dormers/velux on the rear or the section are the tell.

### 3.4 Height to soffit
- **What:** vertical height to the soffit/eaves — the top of the wall the scaffold reaches.
- **Where:** section (best) or a dimensioned elevation; a vertical dim like `U/S Wallplate 4725`.
- **How:** read it in mm, convert to m (4725 → 4.725 m). "FFL" (finished floor level) confirms storey height.
- **Layer:** reads (engine computes lifts = `ceil(height ÷ 1.5) + room-in-roof`).
- **Edge cases:** ⚠️ **which datum** (soffit / eaves / wall plate / ridge) is an open question — read the soffit/wallplate value and cite the exact string; do not switch datums between house types.
- **Confidence:** high only if the printed vertical dim is unambiguous.

### 3.5 Wall segments (front / rear / gable_left / gable_right)
- **What:** each external wall length along the building line, for one dwelling.
- **Where:** ground-floor plan / **setting-out plan** — the **building line (brickwork line)**, off the outside of the plan. Gable lengths also come from the side/gable elevation or the plan depth.
- **How:** read each wall separately with its dimension string. Front/rear = the eaves faces (the frontage); gable_left/right = the two side/end walls. For a pair, front/rear = the **full frontage spanning both houses** (engine divides); gables = full depth.
- **Layer:** reads (engine sums → perimeter, applies config + corner allowance).
- **Edge cases:** a minor step in the footprint → take the bounding rectangle; a genuinely L-shaped footprint → list the extra walls as `other`. Do **not** sum them and do **not** add a corner allowance here.

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
- **How:** count per face (front and rear apexes count too, e.g. a projecting front gable). Hipped face = 0. Record per-face so config reduction can drop the party-gable apex.
- **Layer:** reads (engine = table lift + apex handrail per apex, reduced by configuration).
- **Edge cases:** a detached house typically has 2; more than 3 has never been priced (treat >3 as low confidence / check). In Strike this is "apex scaffold".

### 3.9 Render (per elevation)
- **What:** which elevations have a rendered/clad section, and its linear metres.
- **Where:** the elevations — render notes, a rendered variant sheet ("… Render Elevations"), or an "R"-suffixed code. Measure only the **rendered section**, not the whole wall.
- **How:** per face, set `rendered` and, if dimensioned, `renderLengthM` (only the rendered length).
- **Layer:** reads (engine = render LM × render lifts, in 2 m lifts).
- **Edge cases:** **render is per plot** — the same house type may supply brick/render/stone/boarded variants; the *base* take-off often asserts **no render metres** unless a specific plot is rendered (see the Dekker note). ⚠️ render-lift basis is open (Colin's table vs Laura's default).

### 3.10 Birdcage (internal area, per floor) — the flagship example of "read AND derive"
- **What:** the m² of internal floor deck, per floor level (GF, FF, SF…). One birdcage per floor; a 2.5-storey has 3.
- **Where (in priority order):**
  1. **Setting Out Plan** — the **gross internal footprint area per dwelling** (e.g. `35.60m² (BEAM & BLOCK)`). **This is Colin's number.**
  2. **Title/reference sheet** — the **masonry area** (pair/dwelling total, e.g. `Masonry 71.21m²` = 35.60 × 2 → ÷ dwellings-wide).
  3. **Floor plans** — the **NDSS "Total Floor Area" schedule** (e.g. `35.00m²`). This is the **usable/habitable** area (excludes stair voids etc.) and is **slightly smaller** — use it only if the gross-internal isn't available, and note it's usable-area.
  4. **Derive from dimensions** (always, as a cross-check — see below).
- **How to DERIVE (do this every time, even when an area is stated):**
  - **Internal width** = the clear internal span of one dwelling (the big internal dimension along the frontage, e.g. `4877` mm = 4.877 m). For a pair, the full frontage `10660` = width + party wall + width.
  - **Internal depth** = overall depth − the front & rear external wall thicknesses. E.g. overall `7904` − `302` (front) − `302` (rear) = `7300` mm = 7.3 m.
  - **Area** = internal width × internal depth = 4.877 × 7.3 = **35.6 m²** per floor.
  - Report **both**: `internalAreaM2` = the stated **gross-internal** value, and `internalLengthM` / `internalWidthM` = the derived dims (the engine multiplies these if no area is stated).
- **Reconcile:** stated gross-internal ≈ derived → high confidence. If only the NDSS usable area is available, expect it to read ~1–2% low vs the derived footprint; report it, note it's usable-area, and flag.
- **Layer:** reads the dims / stated area → engine (or `persist.ts`) computes L×W and sums the floors.
- **Edge cases:** use the **internal** area, never the external footprint (bigger, over-reads). Irregular floor → treat as a compound shape (sum the rectangles). ⚠️ the cavity deduction (600 vs 900 mm) and the no-internal-dims fallback are open.
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

### 4.1 Dekker (NSS.277) — birdcage, "read AND derive"
A semi-detached pair. The internal floor area is printed in **three** places, and
they are **not** all the same number:

- **Setting Out Plan (p.4):** `35.60m² (BEAM & BLOCK)` — the **gross internal footprint per dwelling**. ← **Colin's number.**
- **Title sheet (p.1):** `Masonry 71.21m²` — the **pair total** (= 35.60 × 2).
- **First Floor Plan (p.24):** NDSS `TOTAL FLOOR AREA … 35.00m² … 35.00m² … 70.00m²` — the **usable/habitable** area (smaller; excludes voids).

**Derivation (cross-check):**
1. Internal width of one house = **4877 mm = 4.877 m** (the clear internal span; the pair's 10660 = 4877 + party wall + 4877).
2. Internal depth = overall 7904 − front 302 − rear 302 = **7300 mm = 7.3 m**.
3. 4.877 × 7.3 = **35.6 m²** per floor.
4. GF + FF = 35.6 + 35.6 = **71.2 m²** total, **2 lifts** (one per floor).

**What the tool did & the lesson:** it read `35.00` (NDSS usable) because the
classifier excluded p.4, so it never saw the gross-internal `35.60`. **Fix:**
include Setting Out Plans; prefer the gross-internal area; and always derive L×W
as a cross-check. Both numbers are "right" — but Colin prices the **gross
internal**.

### 4.2 Dekker — perimeter & lifts (for reference)
- Walls (per dwelling): front 10.66 / rear 10.66 (full pair frontage; engine divides by 2), gables 7.904 each.
- Height 4.725 m → `ceil(4.725 ÷ 1.5)` = 4 lifts; 2-storey template agrees (4). ✅
- Semi/End configuration → 3 sides, 2 corners, 1 party wall. Matches Colin's 20.5 (pair) / 10.6 (per house) lines.

---

## 5. Which layer owns each number (summary)

| Number | Model reads | Engine computes |
|---|---|---|
| Wall lengths, height, storeys, apex count/face, render LM/face, corners, internal dims / stated area, porch/bay, chimney, roof type, structure, dwellings-wide | ✅ | |
| Lift count (`ceil(h ÷ 1.5) + RiR`) | | ✅ |
| Perimeter (Σ config walls + corner allowance) × lifts | | ✅ |
| Birdcage m² (L × W) & floor total | reads dims / stated area | ✅ multiplies & sums |
| Apex → table lift + handrail, config reduction | | ✅ |
| Render LM × render lifts | | ✅ |
| Party walls, stage splits, all £ | | ✅ |

---

## 6. Open questions that touch reading

These stay **flags**, never guessed (full table: `docs/11 §8` / checklist §15):
height **datum** (§3.4), corner **quantum** (§3.6), birdcage **cavity deduction**
& no-dims **fallback** (§3.10), **render-lift** basis (§3.9), smart-roof
**threshold** (§3.13), the two-lift-birdcage **client** (§3.10).

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
