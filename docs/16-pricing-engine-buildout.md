# 16 · Pricing-Engine Buildout — Track 2 (structural fixes + the client matrix export)

**What this is.** The build plan for completing the **house-build pricing engine** and
generating **Colin's real pricing-matrix Excel** (the client quotation format). It
turns the gap analysis in `docs/15 §10` (P1–P11) into sequenced, code-level work.
Scope is the ✅ CONFIRMED *structures* from Colin's real files — we build the shape now
on **placeholder rates**; the numbers swap in when his rate sheet lands (Track 3).

> Legend: **✅ CONFIRMED** (from Colin's files — safe to build) · **⚠️ OPEN** (needs
> Colin — build a switch/flag, never a guessed number) · **🔧** (a code/schema change).

Sources: `docs/15-pricing-spec.md` (the decode), the live pricing code
(`src/lib/pricing/`), and a verbatim column extract of Colin's real templates
(`data/pricing-data/`, gitignored) captured below.

> **STATUS (2026-08-25): A1–A6 + B1–B2 all BUILT, deployed, verified.** The engine
> emits Colin's real column set (per-lift, per-floor birdcage, combined table+rails,
> Timber-Frame path, garages) and the Excel export is Colin's **single-sheet** matrix
> (plots → garages → grand total). Running on **placeholder rates** (`scripts/fill-placeholder-rates.mts`
> filled the active card). **Still open:** the P6 bundling switch (A-gate), the structural
> golden test (C), and — the real gate — Colin's actual rate sheet (Track 3). Section
> bodies below are annotated ✅/⬜ with the shipping commit.

---

## 0. Decisions taken (2026-08-25)

1. **The export reproduces the CLIENT matrix** — Traditional (27-col, 50/25/25) and
   Timber-Frame (17-col, 80/20), with the garages block + grand total. The granular
   **Operatives / gang-pay matrix (Windermere, 50-col) is Build 2** and out of scope —
   but its grand total **£20,228.06** stays the penny-exact *cost*-validation target.
2. **Excel-first.** The full column-per-operation matrix ships in the **Excel export**;
   the on-screen pricing/quote pages keep the simpler stage matrix (readable, monochrome).
3. Rates stay **placeholder**; nothing here guesses a number Colin owns. The one open
   *structural* question (P6 bundling) is built as a **switch**, defaulting to "flag".

---

## 1. As-built (what exists in code now)

- **`src/lib/pricing/engine.ts`** — `priceTakeoffLine` (Traditional) + `priceTimberFrameLine`
  (TF) + `priceGarageLine`; `subtotal = Σ lines` (pence), `stages = subtotal × %` via the shared
  `allocateStages`. Reconciles to the penny. Now the **right shape**: per-lift `LIFT` erect by
  `liftLevel` (1st dearer) + one `LIFT` dismantle; **one combined `GABLE`** (table+rails) for the
  client; birdcage `GF/FF/SF/TF` erect + strip; TF = `TF_EXTERNAL` erect+dismantle + `ADAPTION`
  per lift + `GABLE_RAILS`. ⬜ low-level / party-wall / chimney are **still** separate client
  lines (P6, A-gate — needs Colin).
- **`src/lib/pricing/priceProject.ts`** — per-plot pricing with the plot's own config/render;
  branches on `buildType` (TF → `priceTimberFrameLine`, TIMBER_FRAME split); prices each
  `hasGarage` plot's garage into `pricing.garages[]` and folds it into `grandTotal`; a missing
  scenario is surfaced in `pricing.missingScenarios` (still falls back to STANDARD so it never
  breaks).
- **`src/lib/pricing/matrix.ts`** — `buildClientMatrix` (Traditional/TF) + `buildGarageMatrix`
  pivot priced lines → Colin's columns; stage columns render in a fixed order with the % in the
  header (`Plot Erect 80%`).
- **`src/lib/pricing/quoteExcel.ts`** — `buildQuoteWorkbook` renders the **single stacked sheet**
  (plots per build type → garages → 3-line grand total) + a Line-items audit tab; shared by the
  export route and `scripts/*` so both produce the identical file.
- **Schema:** `RateItem` unique `[rateCardId, component, action, band, liftLevel]` (`liftLevel 0`
  = base); `StageScenario` += GARAGE / GARAGE_NO_BCAGE / TIMBER_FRAME; `ScaffoldComponent` +=
  `BIRDCAGE_SF/TF`, `TF_EXTERNAL`, `ADAPTION`; `GarageType` += `CAR_PORT`; `Document.plotListData`
  added (plot re-matching). `HouseType.buildType` now drives pricing.
- **Rates:** `scripts/fill-placeholder-rates.mts` populated the active card (band MEDIUM) with all
  6 stage scenarios + 19 placeholder rate items. ⚠️ placeholders until Colin's sheet.

---

## 2. The target column layouts (verbatim from Colin's templates)

### Traditional client matrix — 27 cols, single header row
`A Plot · B House Type Code · C (Det/Semi marker) · D Storey · E–L 1st…8th (per-lift erect) ·
M Table Lifts & Guard Rails to Gables · N Render Adaptions · O–R Ground/1st/2nd/3rd Floor
Birdcage (erect) · S–V Strip GF/FF/SF/TF Birdcage · W Dismantle · X Plot Erect 50% (65% Bung)
(75% NO BCAGE) · Y Birdcage Erect 25% (10% Bung) · Z Dismantle 25% · AA Erect & Strip Price`.

- **Reconciliation:** `AA = Σ(E…W)`; `X = AA×50%`, `Y = AA×25%`, `Z = AA×25%`.
- **Garages block** (own section): `A Garage · B Type · D Storey · E 1st Lift · F 2nd Lift ·
  G Gable Lift & Rails · H GF Birdcage · I Dismantle · M Gar Erect 65% (75% NO BCAGE) ·
  N Bcage Erect 10% · O Dismantle 25% · P Total Price`.
- **Grand-total block:** three lines — `Erect & Dismantle Price` / `Garages` / `Grand Total`.
- Top rows are **reference templates** (`C = "Template"`), keyed by builder × variant
  (`2 Lifts (1 Storey Bung)`, `4 Lifts (2.5/3 Storey)`, `… Render Hipped NO BCAGE`).

### Timber-Frame client matrix — 17 cols
`A Plot · B Code · D Storey · E Erect Timber Frame External 2-4 Lifts (single, NOT per-lift) ·
F Erect Apex Handrails · G–L Adaption 1st…6th Lift · M Render/Cladding Adaption · N Dismantle ·
O Plot Erect 80% · P Dismantle 20% · Q Erect & Strip Price`.

- **No birdcage** in plot rows. Garages are still priced **traditionally** (per-lift + gable +
  GF birdcage + 65/10/25). Grand-total block same 3-line shape.

### NOT reproduced (Build 2): the Operatives matrix
Windermere = 50 cols, 4-row merged header, per-lift × {Lift, Haki, Loading Bay, Rubbish
Chute} × {Erect, Dismantle} + table/gable/render/joist/GF+FF birdcage/low-level. `JG` (joint
gable) rows omit access (shared with the pair). Grand total £20,228.06 — the cost-validation
target only.

---

## 3. Workstream A — engine correctness (the priced lines)

**A1 · Stage splits: NO_BIRDCAGE / Garage / Timber-Frame (P3)** — ✅ BUILT (`93b3f7a`)
- `StageScenario` += `GARAGE`, `GARAGE_NO_BCAGE`, `TIMBER_FRAME` (migration).
- Seed the ✅ confirmed splits: NO_BIRDCAGE **75/0/25**, GARAGE **65/10/25**,
  GARAGE_NO_BCAGE **75/0/25**, TIMBER_FRAME **80/20**.
- `priceProject.splitsFor`: a **missing** scenario becomes a flag, not a silent STANDARD.

**A2 · Birdcage per floor GF→TF (P5)** — ✅ BUILT (`93b3f7a`)
- `ScaffoldComponent` += `BIRDCAGE_SF`, `BIRDCAGE_TF` (migration).
- `engine.ts` birdcage loop maps each floor to its own component (GF/FF/SF/TF), erect + strip.
  Remove the `SF→FF` fold.

**A3 · Combine table lift + gable rails for the client (P4)** — ✅ BUILT (`93b3f7a`)
- Emit ONE client apex-access item (table lift + handrails) instead of `GABLE` + `GABLE_RAILS`.
  Keep the split noted for Build 2 (gang matrix separates them).

**A4 · Per-lift-level rates (P2)** — ✅ BUILT (`93b3f7a`); `liftLevel 0` = base, exact-level → base fallback
- Migration: `RateItem` += `liftLevel Int?`, unique `[rateCardId, component, action, band, liftLevel]`.
- `buildRateResolver`/`RateResolver` resolve by `(component, action, liftLevel)` with a fallback
  ladder: exact level → upper-lift default → single rate (sparse cards still price).
- `/rates` UI + `actions/rates.saveRateItem` accept a per-level rate (min: base vs upper).

**A5 · `buildType` → Timber-Frame priced path (P1)** — ✅ BUILT (`85ef4d4`)
- Plumb `buildType` into the `houseTypes` select (`loadProjectPricing`) + `HouseTypeForPricing`.
- `TRADITIONAL` = current path; `TIMBER_FRAME` = single external erect + per-lift adaptions +
  apex handrails, **no birdcage stage**, 80/20 — a `priceTimberFrameLine` selected by buildType.

**A6 · Garages priced set (P7)** — ✅ BUILT (`5e8b115`)
- `src/lib/takeoff/garage.ts` (`GARAGE_TEMPLATES` + `buildGarageTakeoff`) — garages have **no
  extracted geometry**, so quantities come from a **flagged placeholder template** per `garageType`
  (⚠️ confirm with Colin). `priceGarageLine` → 65/10/25 (or 75/0/25), rendered as the Garages block.

**A-gate · P6 bundling (low-level / party-wall / chimney)** — ⬜ NOT DONE — ⚠️ needs Colin
- Still priced as separate client lines (may over-state the quote). The toggle
  (`bundled` vs `itemised`, default = flag for review) is not built yet.

---

## 4. Workstream B — the client matrix export (headline)

**B1 · `src/lib/pricing/matrix.ts` (pure, tested)** — ✅ BUILT (`4728251`)
- `buildClientMatrix(pricedPlots, buildType)` + `buildGarageMatrix` pivot priced lines into the
  exact columns in §2. Encodes `Σ(cost columns) === plot total`; stage columns render in a fixed
  order with the % in the header (`Plot Erect 80%`).

**B2 · Excel export — Colin's SINGLE-SHEET layout** — ✅ BUILT (`4728251`, single-sheet `45bde80`, refactor `1f258c4`)
- `src/lib/pricing/quoteExcel.ts` `buildQuoteWorkbook` renders ONE stacked sheet (plots per build
  type → garages block → 3-line grand-total) + a Line-items audit tab; `safe()` sanitising +
  versioned filename kept. The route (`quotes/[id]/export`) is now a thin query → `buildQuoteWorkbook`,
  so a script produces the identical file (`scripts/*`). Verified on a regenerated quote:
  Rosewood (Traditional bungalow) → full 27-col sheet, 1st lift dearer, 65/10/25, reconciles £3572.05.

**B3 · On-screen** — unchanged (Excel-first decision). Simple stage matrix stays.

---

## 5. Workstream C — tests & acceptance
- ✅ Unit tests per A/B item: `pricing/engine.test.ts` (per-lift, birdcage floors, combined apex),
  `pricing/matrix.test.ts` (columns reconcile; Traditional vs TF), `pricing/garage.test.ts`,
  `pricing/priceProject.test.ts`. 157 tests green.
- ⬜ **Structural golden test** (generated Traditional columns/reconciliation vs the Windermere
  layout) — NOT built yet.

---

## 6. Build order — ✅ A1–A6 + B1–B2 DONE (in this order); ⬜ A-gate/P6 + the C golden test remain

---

## 7. Still needs Colin (do not guess — see `docs/15 §11`)
The **real rate sheet** (per lift level / band / birdcage erect+strip / table+rails / render LM) —
placeholders are filled but not real; the **P6 bundling answer**; per-builder lift templates;
render-on-2-storey (+table lift, £/LM = perimeter?); real garage quantities + rates; Timber-Frame
rates. **Acceptance:** load the sheet → reproduce Windermere `£20,228.06` to the penny.

## 8. Related follow-ups shipped alongside (identity / plots)
Not part of Track 2 but done in the same window (see `PROGRESS.md`): house-type identity backfill
(real name+code, `houseTypeIdentity.ts` + `persist.ts`, `f8eed0b`), duplicate house-type merge
(`bda6060`), plot→pricing flow + auto re-match (`persistPlots.rematchProjectPlots`, `9f66f28`).
