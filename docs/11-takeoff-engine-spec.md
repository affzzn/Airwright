# 11 · Take-off Engine — Build Spec & Knowledge Base (post-Colin)

**This is the canonical reference for building the take-off engine.** It merges
everything we know as of the 13 Aug Colin/Laura call, the build checklist, and
Colin's handwritten take-off sheets (`colin-data/`). The pre-call drafts (old docs
09/10) have been deleted — this doc plus the live code (`src/lib/extract/prompt.ts`,
`schema.ts`, `src/lib/takeoff/engine.ts`) are the only sources of truth. For plain
domain vocabulary see `03-domain-glossary.md`; for the pricing matrices see
`08-colin-data.md`.

Legend: **✅ CONFIRMED** (encode now) · **⚠️ OPEN** (do not guess — flag + ask, see
§8) · **🔭 LATER** (shapes the model now, built later).

---

## 1. The mental model — two layers

The whole build is two layers. Getting this split right is what makes the
extractor accurate *and* auditable.

- **Layer 1 — the EXTRACTOR (model + prompt).** Reads drawings, returns
  **observable facts** with confidence + provenance. It does **not** compute
  lifts, pricing, or the take-off line. This is what we make "perfect" now (§3).
- **Layer 2 — the ENGINE (deterministic code).** Turns extracted facts into
  Colin's take-off line using confirmed rules (§4–§5). Open parameters (§8) are
  configurable hooks, never hard-coded guesses.

Then we **grade Layer 1+2 against Colin's handwritten sheets** (§7).

> Key realisation: almost all the **⚠️ open questions live in Layer 2 (derivation
> / pricing), not Layer 1 (what to read off the drawing).** So the extractor can
> be made excellent now — the definitions of what to measure, which pages, and
> which numbers are confident.

---

## 2. The take-off line — the target output (Colin's grammar)

Every one of Colin's take-off lines has the same shape. This is the format our
take-off summary must emit (his handwritten sheet is the layout benchmark):

```
<HOUSE TYPE> — <CONFIG> — <STOREYS> [— RENDER] [— <roof>]
  <perimeter LM> × <lifts>              external scaffold
  <birdcage m²> × <n floors>            internal decks, 1 lift each
  [<render LM> × <render lifts>]        only if rendered (+ a table lift on 2-storey)
  <table lifts>, <apex H/R>             only if pitched roof with apex
  <extras…>                             low level, chute, loading bay, access,
                                        party wall(s), propping, bcage lift
```

Worked reference lines to keep as fixtures (from `colin-data/`):
- `Dekker · Semi/End · 2-st → 20.5×4 lifts / 35.6×2 floors / 1 table / 1 apex H/R / 1 low level / ladder tower / sac+single prep / loading bay`
- `Dekker · Mid · 2-st → 10.6×4 lifts / 35.6×2 floors / … (no apex)`
- `Rosewood · Detached · 1-st · Hipped → 48.5×2 lifts / 107 m² / loading bay / chute / Haki`
- `Augusta · Apartments · 3-st · Render → 65.4×6 lifts / 128.2×3 floors / 4 apex H/R / progressive dismantle ×2 / …`

---

## 3. LAYER 1 — the extractor spec (what the model reads)

For each house type, from **elevations + floor plans (+ site-elevation plan)**,
extract these observables. Every field carries **confidence + source (sheet +
dimension string)**. Unreadable → `null` + `unknown`, never a guess.

| # | Field | Where from | Notes / status |
|---|---|---|---|
| 1 | House type **name + code** | Title block | ✅ |
| 2 | **Storeys** | Elevation / spec | ✅ 1 / 2 / 2.5 / 3 |
| 3 | **Room-in-roof flag** (→ 2.5-storey) | Elevation: dormers, roof windows, higher eaves | ✅ drives +1 lift & +1 birdcage floor |
| 4 | **Height** to the datum | Vertical dims (`U/S Wallplate`, `FFL`) | ✅ read it; ⚠️ *which datum* is open (§8) |
| 5 | **Roof type per elevation** (pitched / hipped) | Elevation shape | ✅ hipped → no apex/table |
| 6 | **Apex count per elevation** | Count triangular apexes with brickwork | ✅ pitched only; hip = 0; ≤3 typical |
| 7 | **Wall segments** (building line) | Outside of the **ground-floor plan** | ✅ each external wall length + face + dim string |
| 8 | **Corner count** | Plan | ✅ count returns; ⚠️ external-only vs internal, and the +metre quantum, are open (§8) |
| 9 | **Render sections + length (LM)** | Elevation render hatching / "R" variant | ✅ only the rendered section; per elevation |
| 10 | **Internal floor dims per floor** (GF/FF/SF/roof-room) | **Floor plans**, internal measurement | ✅ L×W → birdcage m²; ⚠️ cavity deduction open |
| 11 | **Chimney present?** | Elevation / roof plan | ✅ spot it (unit-priced later); flag spec-vs-drawing mismatch |
| 12 | **Low-level features** (porch, bay) | Elevation / plan | ✅ count (each = 1 low level) |
| 13 | **Smart-roof peak height** | Elevation peak | ✅ read peak; ⚠️ threshold open |
| 14 | **Underbuild / foot scaffold need** | **Site elevations plan** (NOT house elevation) | 🔭 new page type to add; read slope/underbuild |
| 15 | **Configuration** (if shown) | Usually the **plot schedule**, not the elevation | ✅ leave `unknown` on the drawing; don't infer |

**Page relevance the extractor must handle:** house-type elevations, floor plans,
**site-elevations plan** (underbuild), plot schedule; ignore services, drainage,
levels, internal room elevations ("Kitchen/Cloak"). Mixed mm/metres → a dimension
without a resolved unit is a **flag, not a number**.

---

## 4. LAYER 2 — the deterministic engine rules

Applied in code to the extracted facts. Confirmed values below; open params in §8.

**Lifts** ✅
```
lifts = ceil(height / 1.5)  + (1 if room_in_roof)
```
Cross-check against the storey template (below); if they disagree, populate from
the height calc and **flag** (record both). ⚠️ datum for `height` is open.

**Storey template (cross-check, ~99%)** ✅ — verified live on the sheets:
| Type | Lifts | Sheet evidence |
|---|---|---|
| Garage | 2 | Double garage 30.5×2 |
| Bungalow / 1-storey | 2 | Rosewood 48.5×2 |
| 2-storey | 4 | Dekker, Ashorn, Saltburn… ×4 |
| 2.5-storey (room in roof) | 5 | Baildon, Gasburn ×5 |
| 3-storey | 6 | Augusta ×6 |

**Perimeter** ✅ (structure) / ⚠️ (quantum)
```
perimeter_per_lift = Σ(external wall lengths for the config) + corner_allowance
total = perimeter_per_lift × lifts        (store BOTH; Strike wants the total)
```
Config → which walls (✅ pattern, quantified on the sheets):
- Detached = 4 sides · Semi/End = 3 sides · **Mid = front + rear only** (≈ 40–45% of the semi LM).

**Birdcage** ✅ (structure) / ⚠️ (cavity)
```
birdcage_floor_m2 = internal_length × internal_width   (compound shape if irregular)
n_floors = storeys        → 1-storey:1 · 2-storey:2 · 2.5-storey:3 · 3-storey:3
each floor = 1 lift (a client-spec exception uses 2 lifts where room height > 2.5 m)
```

**Render** ✅ (separate work type)
```
render = render_LM × render_lifts     render_lifts: 2-storey→2, 1-storey→1
2-storey render also carries 1 table lift
priced at the same £/LM as perimeter; 2-metre lifts, not 1.5
```
(Full go-to table still owed by Colin — §8.)

**Apex / table lifts** ✅
```
table_lifts, apex_handrails = apex_count       hipped → 0
apex_handrail_qty == apex_qty                  (Strike name: "apex scaffold")
```

**Extras** — counts, mostly unit-priced:
- Party wall scaffold: config-driven (⚠️ exact count per config open).
- Propping / joist support: ~1 per stair set; variant (single / sacrificial /
  double) from the **builder profile**.
- Loading bay / rubbish chute / access (Haki | ladder): unit-priced, **apportioned
  across the block** (detached full; semi 2 lifts/plot; terrace-of-3 ≈ 1.33/plot;
  4-plot ⚠️ open). Access type from the **builder profile**.
- Low level (porch/bay), chimney scaffold: unit-priced, spot-and-price.

---

## 5. Confirmed rules — one-glance summary

| Rule | Value | Status |
|---|---|---|
| Lifts | `ceil(height/1.5) + room_in_roof` | ✅ (datum ⚠️) |
| Storey lifts | garage 2 · bung 2 · 2-st 4 · 2.5-st 5 · 3-st 6 | ✅ verified on sheets |
| Config → walls | det 4 · semi 3 · mid 2 (front+rear) | ✅ |
| Corner allowance | +1 m per corner | ✅ (quantum/internal ⚠️) |
| Birdcage | internal L×W × storeys-floors, 1 lift each | ✅ (cavity ⚠️) |
| Birdcage floors | 2.5-storey = 3 floors | ✅ new from sheets |
| Render lifts | 2-st→2 (+table) · 1-st→1 · 2 m lifts | ✅ (full table ⚠️) |
| Roof | hipped → no apex/table; pitched → table + apex H/R | ✅ |
| Apex H/R qty | = apex count (≤3 typical) | ✅ |
| Stage split | 50 / 25 / 25 default, per-client configurable | ✅ |

**Stage-split proof (worked, penny-exact — Oadby matrix, Plot 401 WOLLATON R,
detached 2-storey, total £5,879.53):** the components literally group into the
three stages — Plot Erect = lifts £2,087.23 + gables £352.77 + render £499.76 =
**£2,939.76 = exactly 50%**; Birdcage Erect = GF+FF birdcage = **£1,469.88 = 25%**;
Dismantle = external £1,322.89 + strip £146.99 = **£1,469.88 = 25%**. So the split
is a real component grouping, not an arbitrary percentage bolted on.
| Access / propping | from builder profile | ✅ |

---

## 6. Builder profiles (the per-builder spec layer)

Specs are per **housebuilder**, ~20 of them. From the sheets we can already seed:

| Builder (from sheets) | Access | Propping | Notes |
|---|---|---|---|
| **Avant Homes** | Ladder tower | plain propping | party-wall scaffold used; chutes + loading bays |
| **Haki builder** (Keepmoat-style) | **Haki** everywhere | **double propping** | mostly hipped roofs → few apexes |
| Sheet-1 builder | Ladder tower | single + sacrificial prep | render on Kone/Hopkins |

Profile fields to carry: access type (+ alternatives allowed?), loading-bay
policy, beam-over vs low-level, chimney requirement, birdcage lifts by room
height, render lift basis, joist-support variant, payment-stage split, extra-hire
policy, required matrix template. AI reads the design-standard spec as an
**assist that proposes profile changes**, never an authority. Version with
effective dates. Missing spec → Airwright-default profile.

---

## 7a. Validated on real drawings (2026-08-19)

Ran the live extractor (Opus 4.8, prompt `2026-08-19.2`) + engine offline against
`colin-data/` via `scripts/offline-extract.mts`, compared to Colin's handwritten
sheets:

- **Dekker (semi-detached pair):** engine → Semi/End **20.56** (Colin 20.5), Mid
  **10.66** (Colin 10.6), birdcage **35.0/floor** (Colin 35.6), apex **1 / 0** by
  config (Colin 1 / none), 1 low level ✓. Essentially exact.
- **Rosewood (detached bungalow):** perimeter **48.51** (Colin 48.5, exact), lifts
  **2** ✓, hipped → **0 apex** ✓, birdcage **102.39 m²** GIA (Colin 107, ~4%).

Fixes that got it there: model reports the printed frontage + `dwellingsWide` and
the **engine halves front/rear** for a pair (not the model); birdcage prefers the
stated **GIA**; porch canopy counts as a low level; conditional chimney → false;
**apex reduced by config** (semi drops the party-wall gable, mid drops both).
Residual gaps are within tolerance and tied to open params (corner quantum;
Colin's exact birdcage-area basis).

**Augusta (3-storey apartment block) + Tyard (maisonette)** then drove two more
rules:
- **Apartment mode** (`structure.form = APARTMENT_BLOCK`): scaffolded as ONE whole
  building — frontage NOT divided, all walls, all apexes, no party walls,
  whole-floor birdcage. Augusta now → **6 lifts** (was 5), whole-block perimeter
  **58.6** (Colin 65.4 — apartment footprints are irregular, read as a rectangle),
  birdcage still **over-reads** (external vs internal; the apartment birdcage basis
  — whole plate vs sum of flats — is a **Colin question**), apex reading on a
  MIXED roof is non-deterministic (2–4). Apartments remain the hardest case.
- **Lift precedence** (⚠️ proposed, Ben to confirm): on a height-vs-storey
  disagreement, the **storey template wins for whole storeys** (Augusta 3-storey →
  6, not the 7.5/1.5=5 boundary) and **height wins for half storeys** (2.5).
  Always flagged.
- **Tyard**: unaffected by the above (correctly a house) — semi **27.5** (Colin
  28.5), 2 lifts ✓; the **maisonette 1-vs-2 birdcage floors** and its apex are a
  Colin question (the drawing reads as a single-storey bungalow).
- Reliability: trailing metadata fields now have **schema defaults**, so a
  non-deterministic dropped field no longer fails the whole extraction.

## 7. Validation set + grading method

We have **matched drawing ↔ take-off pairs**: **Rosewood, Dekker, Augusta,
Tyard** (drawings in `colin-data/` + their lines on the sheets). Plus ~16
take-off lines without drawings yet (Avant + Haki-builder sheets) as rule
fixtures.

**Grading (define before testing — §8):**
- Lifts, floor count, apex count, low-level count, config → **exact match**.
- Perimeter LM, birdcage m² → within a **stated tolerance** (to agree with Colin).
- Test **blind** against tenders Colin already priced; keep every disagreement
  with its cause (bad extraction / missing rule / ambiguous drawing / judgement).
- Build these into a **regression suite** so week-6 changes can't silently break a
  week-5 pass.

---

## 8. ⚠️ Open questions — set aside, do NOT guess (owners)

Build the hook, leave configurable, flag in review. From the call + sheets:

1. **Height datum** for lifts — soffit / eaves / wall plate / ridge (Colin).
2. **Corner allowance quantum** — 1 m/corner vs Laura's 5 m; internal vs external returns (Colin).
3. **Birdcage cavity deduction** — 600 vs 900 mm (Colin).
4. **Full render/cladding go-to table** — confirm Colin's vs Laura's 3-lift default (Colin).
5. **Party-wall count per config** — sheets show semi ×1 and ×2; mid ×2 (Colin).
6. **Smart-roof peak threshold** number (Colin).
7. **Which client** wants 2-lift birdcages > 2.5 m (Colin).
8. **4-plot apportionment** ("back to two"?) (Laura).
9. **Rounding rule** + where applied (Colin).
10. **Lift-vs-storey precedence** on disagreement (Innate proposes → Ben confirms).
11. **Sign-off tolerance** for LM / m² / price (Rayyan + Ben).
12. **Rate sheet** — £/LM per lift, £/m² birdcage, unit prices per band (Colin).
13. **Anomalies:** Tyard "1-storey / 2 floors" and Whitgrove "1-storey / 4 lifts"
    — what these house types actually are (Colin).

_Apartment-block questions (surfaced testing Augusta — §7a):_
14. **Apartment birdcage basis** — is it the whole floor plate, or the sum of the
    flat areas excluding the communal/stair core? (Colin's Augusta = 128.2/floor,
    ≈ 2 flats, not the ~158 whole plate.) (Colin).
15. **Apartment perimeter / footprint** — apartment blocks are irregular (wings,
    projections, recessed entrances); confirm how Colin takes the block perimeter
    and whether recesses/setbacks are included. (Colin).
16. **Apartment extras** — progressive dismantle basis, number of loading bays /
    chutes per block, and communal/stair access + handrails. (Colin).

---

## 8a. Extraction-accuracy work items (scoped 2026-08-24 — the birdcage pattern reused)

Three medium-risk reads to harden the same way birdcage was hardened: **read
multiple independent sources → reconcile in code → compute the confidence from
agreement → keep the genuinely-open bits as flags.** Scope decisions confirmed by
the user; the sub-questions (H3/A2/W2) confirmed as the proposed defaults.
**✅ IMPLEMENTED 2026-08-24 (prompt `2026-08-24.1`)** — validated live on Dekker:
storey ladder [2.662, 2.063] → 4.725 reconciles the soffit (4 lifts, high); per-face
apex front/rear HIPPED 0, left/right GABLED 1; walls verified. Engines:
`src/lib/extract/height.ts` (triangulation) + the wall page-kind + apex per-face
checks in `persist.ts`.

**A. Height to soffit — FULL TRIANGULATION (confirmed).**
- **Datum: soffit / underside of wallplate ONLY** ✅ (user-confirmed; supersedes
  open-question §8 #1 for extraction — always read `U/S Wallplate`, never ridge/
  eaves/mid-point, same datum on every house type; drop the "datum open" hedge).
- **Plan:** the model reads a second, independent vertical stack — the printed
  FFLs per floor + the top-floor-to-soffit — as raw numbers (never summed by the
  model). A new pure `computeHeight` sums the ladder, compares it to the direct
  soffit read and a storey sanity band, and sets confidence from agreement.
- **⚠️ H3 (tolerance, proposed):** flag a disagreement only when the two height
  estimates give a **different lift count** (`ceil(h/1.5)` differs) — that's the
  thing that changes the price — rather than a fixed mm gap. *Confirm.*

**B. Apex per face — PROMPT + PER-FACE FIELDS (confirmed).**
- **Plan:** prompt walks each named face explicitly (front/rear/left/right →
  "brickwork rising to a point?") with a Dekker micro-example (`front 0, rear 0,
  left 1, right 1`); schema adds `faceRoof` (GABLED/HIPPED) + a one-line
  `apexReason` per elevation (commit shape + reason before the count). Engine
  flags a face marked hipped that still reports an apex.
- **⚠️ A2 (proposed):** treat a **gablet / half-hip** and a **chimney-on-gable**
  as normal faces (count the apex if brickwork rises to a point); no special rule
  unless Colin wants one. *Confirm.*

**C. Wall segments — PROMPT + PAGE-KIND CROSS-CHECK (confirmed).**
- **Plan:** prompt enforces "read the wall length off the FLOOR PLAN / setting-out
  plan from a printed dimension — never off an elevation, never scaled; the
  building line is the brickwork INSIDE the roof overhang." Then thread the page
  classification into `persist.ts` and flag/downgrade any wall whose cited
  `sourcePage` is an ELEVATION page (catches the overhang error even when the
  number is "real"). Complements the text-layer candidate list + verification.
- **⚠️ W2 (proposed):** if ONLY the overhang dim is legible (no wall dim), store
  it low-confidence AS-IS and flag — never subtract a standard overhang (same
  no-arithmetic principle as birdcage). *Confirm.*

## 8b. Layer-1 confidence & cross-check hardening (✅ IMPLEMENTED 2026-08-25, prompt `2026-08-25.1`)

From the Layer-1 audit. The theme: replace SELF-REPORTED confidence with COMPUTED
cross-checks, and flag contradictions instead of trusting one read.

- **C7 — apex reasoning order:** schema now orders each face `faceRoof → apexReason
  → apexCount`, so the model reasons *before* committing the number (was post-hoc).
- **C3 — structure ↔ dwellingsWide consistency:** `persist` flags SINGLE/APARTMENT
  with dwellingsWide ≠ 1, or PAIR/TERRACE with < 2 (`warnings.structureDwellingsMismatch`).
- **C11 — NDSS birdcage cross-check** (`birdcage.ts`): with no stated gross-internal,
  the derived footprint is checked against the NDSS *usable* area — gross-internal
  should sit **0–12% above** usable → high (medium if an assumed wall was used);
  outside the band → low + flag. ⚠️ band approximate, confirm with Colin.
- **C9 — wall symmetry** (`persist`): front≈rear and gable_left≈gable_right;
  a >10% mismatch flags a likely role-swap/misread (`warnings.wallAsymmetry`).
- **C5 — storey ladder = deltas:** prompt + schema clarify `storeyHeightsM` are
  floor-to-floor DIFFERENCES, not absolute FFLs; `height.ts` surfaces a notable
  direct-vs-ladder gap (>0.15 m) even when the lift count still agrees.
- **C8 — rendered-but-undimensioned:** a rendered face with no `renderLengthM`
  is flagged (`warnings.renderedNotDimensioned`) instead of render being dropped.
- **D4 — underbuild hook:** a `underbuild {needed, note}` observable added — the
  model fills it only if a slope/stepped foundation is visible; **the site-elevations
  plan (the real source) is still not classified/sent — that remains the main
  MISSING observable** (glossary §6, docs/11 §3 #14).
- **NOT done (by decision):** C6 (MIXED-roof / honour per-face faceRoof over the
  overall label) — the "hipped overall → force apex 0" behaviour is left as-is.

---

## 9. Extractor prompt v2 — ✅ WIRED IN (2026-08-19)

Live in `src/lib/extract/prompt.ts` (`PROMPT_VERSION = 2026-08-19.1`) and
`schema.ts`, persisted by `persist.ts`, shown on the review screen. Still
**measurements only** — no lifts, no pricing. Fields the model now returns:
`storeys`, `roomInRoof`, `heightToSoffitM`, `roof.overallType`, `elevations[]`
(per-face **apexCount** + **render LM**), `wallSegments[]` (building line, ground-
floor plan), `cornerCount` (external), `floorAreas[]` (internal L×W per floor,
incl. roof room → SF), `lowLevel` (porch/bay), `chimney`, `smartRoofPeakHeightM`,
`buildType`, `houseType`. Configuration stays out (comes from the plot schedule).

Persistence: per-elevation apexes summed → `GABLE_QTY`; rendered faces' LM summed
→ `RENDER_LENGTH`; `floorAreas` → `BIRDCAGE_GF/FF/SF_M2` (SF enum added by
migration `add_birdcage_sf`); porch+bay → `LOW_LEVEL_QTY`; `CORNER_COUNT`,
`STOREYS`, `HEIGHT_TO_SOFFIT`. Roof type, room-in-roof, rendered, chimney,
smart-roof peak and the per-elevation breakdown go on the take-off `warnings`
JSON and render as review "Details".

**Layer 2 engine — ✅ BUILT (2026-08-19).** Pure, unit-tested in
`src/lib/takeoff/engine.ts` (+ `fromStored.ts` maps a persisted take-off to its
input). Computes: `lifts = ceil(height/1.5) + roomInRoof` (storey cross-check +
flag), perimeter by config (detached 4 sides / semi-end 3 / mid 2) + corner
allowance (default 1 m, configurable), birdcage m²×floors, render LM × render
lifts (storey table), apex = table lift + handrail (hipped → 0), party walls by
config — and emits Colin's take-off line. 16 tests reproduce his real sheet
lines (Rosewood 48.5×2, Dekker semi 20.5 / mid 10.6, Baildon 2.5→5 lifts/3
floors, garage 30.5×2, Kone render 9.23×2). Shown on the review screen per
config. Open params (corner quantum, height datum, render table) are flagged, not
guessed.

**Still NOT built:** builder-profile extras (loading bay / chute / access /
propping apportionment) and the site-elevations/underbuild page type. Model:
**claude-opus-4-8**, `max_tokens` 8192.
