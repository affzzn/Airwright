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

## 1. Current state (what exists in code)

- **`src/lib/pricing/engine.ts` → `priceTakeoffLine`** — turns a `TakeoffLine` into true-cost
  `PricedLine[]`; `subtotal = Σ lines` (pence), `stages = subtotal × %`. Reconciles to the
  penny. **Wrong shape vs the matrix:** one flat `LIFT` rate for every lift; `GABLE` +
  `GABLE_RAILS` as two lines; birdcage only `GF`/`FF` (SF+ folded into FF); low-level /
  party-wall / chimney priced as separate client lines.
- **`src/lib/pricing/priceProject.ts`** — per-plot pricing with the plot's own config/render;
  `scenarioFor` → STANDARD/BUNGALOW/NO_BIRDCAGE; **`splitsFor` silently falls back to
  STANDARD**; garages **counted, not priced**; **`buildType` never read**.
- **Schema:** `RateItem` unique `[rateCardId, component, action, band]` (**no lift level**);
  `StageScenario` = STANDARD/BUNGALOW/NO_BIRDCAGE (**no GARAGE/TIMBER_FRAME**);
  `ScaffoldComponent` has `TABLE_LIFT` but **not** `BIRDCAGE_SF/TF` or `CHIMNEY`;
  `HouseType.buildType` **is** persisted (`persist.ts`) but unused; `QuoteLineItem.liftLevel`
  already exists.
- **Export `src/app/quotes/[id]/export/route.ts`** + both on-screen matrices emit a **generic
  stage matrix** (`Plot | House type | Config | <stages> | Total`) — **not** Colin's layout.

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

**A1 · Stage splits: NO_BIRDCAGE / Garage / Timber-Frame (P3)** — *small* 🔧
- `StageScenario` += `GARAGE`, `GARAGE_NO_BCAGE`, `TIMBER_FRAME` (migration).
- Seed the ✅ confirmed splits: NO_BIRDCAGE **75/0/25**, GARAGE **65/10/25**,
  GARAGE_NO_BCAGE **75/0/25**, TIMBER_FRAME **80/20**.
- `priceProject.splitsFor`: a **missing** scenario becomes a flag, not a silent STANDARD.

**A2 · Birdcage per floor GF→TF (P5)** — *small* 🔧
- `ScaffoldComponent` += `BIRDCAGE_SF`, `BIRDCAGE_TF` (migration).
- `engine.ts` birdcage loop maps each floor to its own component (GF/FF/SF/TF), erect + strip.
  Remove the `SF→FF` fold.

**A3 · Combine table lift + gable rails for the client (P4)** — *small* 🔧
- Emit ONE client apex-access item (table lift + handrails) instead of `GABLE` + `GABLE_RAILS`.
  Keep the split noted for Build 2 (gang matrix separates them).

**A4 · Per-lift-level rates (P2)** — *medium, schema change* 🔧
- Migration: `RateItem` += `liftLevel Int?`, unique `[rateCardId, component, action, band, liftLevel]`.
- `buildRateResolver`/`RateResolver` resolve by `(component, action, liftLevel)` with a fallback
  ladder: exact level → upper-lift default → single rate (sparse cards still price).
- `/rates` UI + `actions/rates.saveRateItem` accept a per-level rate (min: base vs upper).

**A5 · `buildType` → Timber-Frame priced path (P1)** — *medium* 🔧
- Plumb `buildType` into the `houseTypes` select (`loadProjectPricing`) + `HouseTypeForPricing`.
- `TRADITIONAL` = current path; `TIMBER_FRAME` = single external erect + per-lift adaptions +
  apex handrails, **no birdcage stage**, 80/20 — a `priceTimberFrameLine` selected by buildType.

**A6 · Garages priced set (P7)** — *medium* 🔧
- Garage take-off keyed on `Plot.garageType` → its priced set (1st/2nd lift, gable lift+rails,
  GF birdcage, dismantle) + 65/10/25 (or 75/0/25), folded into the grand total as a section.

**A-gate · P6 bundling (low-level / party-wall / chimney)** — ⚠️ needs Colin
- A rate-card / builder-profile **toggle** (`bundled` vs `itemised`), **default = flag for review**.
  Don't silently keep pricing them as client lines (currently over-states the quote).

---

## 4. Workstream B — the client matrix export (headline)

**B1 · `src/lib/pricing/matrix.ts` (new, pure, tested)** 🔧
- `buildClientMatrix(pricedPlots, buildType)` pivots each plot's `PricedLine[]` into the exact
  columns in §2 (Traditional or Timber-Frame), plus a garages section + grand total.
- Encodes the reconciliation: `Σ(cost columns) === plot total`; `stages === total × %`.

**B2 · Rewrite `src/app/quotes/[id]/export/route.ts`** 🔧
- Render `buildClientMatrix` into ExcelJS matching Colin's layout: a Traditional sheet (+ a
  Timber-Frame sheet only if any TF plots), the garages block, the 3-line grand-total block.
- Keep `safe()` formula-injection sanitising + the versioned filename. Optionally keep the
  "Line items" sheet as the true-cost audit backing.

**B3 · On-screen** — unchanged for now (Excel-first decision). Simple stage matrix stays.

---

## 5. Workstream C — tests & acceptance
- Unit tests per A-item; `matrix.test.ts` (columns reconcile; Traditional vs TF; garages fold in).
- **Structural golden test:** generated Traditional columns/reconciliation match the Windermere
  layout (values validated later against real rates — Track 3's penny-exact test).

---

## 6. Build order
1. **A1 + A2 + A3** (small, confirmed) → correct priced lines.
2. **A4** (schema: per-lift rates) → the matrix's per-lift columns become meaningful.
3. **B1 + B2** → **the deliverable: Colin's real matrix format**.
4. **A5** (Timber-Frame) → **A6** (garages).
5. **A-gate/P6** switch + **C** tests throughout.

---

## 7. Still needs Colin (do not guess — see `docs/15 §11`)
Rate sheet (per lift level / band / birdcage erect+strip / table+rails / render LM); the P6
bundling answer; per-builder lift templates; corner quantum; render-on-2-storey (+table lift,
£/LM = perimeter?); garage rates + split; Timber-Frame rates. **Acceptance:** load the sheet →
reproduce Windermere `£20,228.06` to the penny.
