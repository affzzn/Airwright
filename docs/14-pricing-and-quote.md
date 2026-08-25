# 14 · Pricing & Quote — how the priced side works (BUILT)

The other half of Build 1: turning a confirmed take-off (quantities) into **money
and documents**. Built end to end on 2026-08-20, running on **placeholder rates**
until Colin's real rate sheet arrives. Read `docs/11` first for the measurement
side; this doc is the pricing side.

> **Superseded in part — read `docs/16` for the current pricing engine.** Since this
> doc was written, Track 2 (`docs/16`) rebuilt the priced side to Colin's real matrix:
> **per-lift-level rates** (1st dearer), **combined table+rails**, **birdcage per floor
> GF→TF**, a **Timber-Frame** path, **priced garages**, all stage scenarios (incl.
> 75/0/25 and 80/20), and a **single-sheet Excel** in Colin's exact column layout
> (`src/lib/pricing/quoteExcel.ts`). The "what's placeholder / not built" list below is
> updated accordingly. `docs/15` is the canonical pricing spec; `docs/16` the buildout.

## The one idea

The take-off gives **quantities** (LM of scaffold, m² birdcage, counts). Pricing
turns each into money: **price = quantity × rate**, per operation, summed to the
plot total, then split into payment stages. Everything hangs off **one £/metre
rate** so the client quote, the gang pay (Build 2) and the bill can't disagree.

## The pipeline (drawing → quote)

```
confirmed take-off (per house type)
  → per plot: buildTakeoff(observables, plot.config, plot.render)   [measurement engine]
  → priceTakeoffLine(line, rates, stageSplits)                      [pricing engine]
      → priced line items (true cost) + subtotal + stage split
  → priceProject(...) over all plots → pricing matrix + grand total
  → generateQuote(...) → immutable Quote + QuoteLineItems (frozen)
  → outputs: quote view (print → client PDF), Excel export (matrix + line items)
```

**Per-plot pricing at quote time** is the confirmed design: config + render are
per plot, so each plot is priced by running the deterministic take-off engine
with *its own* configuration — not by baking operations onto the house type.

## The files

| Path | Role |
|------|------|
| `src/lib/pricing/engine.ts` | **Pricing engine** (pure, tested): `priceTakeoffLine()` — quantity × rate per operation, integer pence, reconciles to the penny; `buildRateResolver()`. |
| `src/lib/pricing/priceProject.ts` | Prices every plot with its own config/render; picks the stage split by house shape; reconciles plots → grand total. |
| `src/server/pricing.ts` | `loadProjectPricing()` — loads a project + active rate card and prices it (shared by page, quote action, export). |
| `src/server/actions/quotes.ts` | `generateQuote()` — snapshots the priced development into an immutable Quote + QuoteLineItems. |
| `src/server/actions/rates.ts` | Rate-card admin actions (create/delete card, edit rates, edit stage splits). |
| `src/app/rates/page.tsx` + `rates-manager.tsx` | Rate-card screen (`/rates`). |
| `src/app/projects/[id]/pricing/page.tsx` | The pricing matrix + Generate-quote + quotes list. |
| `src/app/quotes/[id]/page.tsx` | Quote view — summary by house type + matrix, print-ready (= the client quotation). |
| `src/app/quotes/[id]/export/route.ts` | Excel export (ExcelJS) with formula-injection sanitisation. |

## The rules (mapping take-off → priced operations)

`priceTakeoffLine` (Traditional) maps to `LIFT` (erect **per lift level**, 1st dearer;
one dismantle) / `BIRDCAGE_GF..TF` (erect + strip) / `GABLE` (combined table + rails) /
`RENDER_ADAPTION` / `LOW_LEVEL` / `PARTY_WALL` / chimney→`OTHER`. `priceTimberFrameLine`
maps to `TF_EXTERNAL` (erect + dismantle) / `GABLE_RAILS` (apex handrails) / `ADAPTION`
(per lift) / `RENDER_ADAPTION`. `priceGarageLine` = per-lift + `GABLE` + `BIRDCAGE_GF`
erect/strip + dismantle. **⚠ Every mapping is Innate's reading of Colin's matrix (marked
in the code) — confirm against his rate sheet.**

**Two concepts kept separate** (checklist §9 trap): the **true item cost**
(`lines[].amount`, summing to `subtotal`) vs the **presented stage value**
(`stages[].amount` = subtotal × stage %). The matrix shows the stage split; the
real per-item cost is what actually adds up. The immutable Quote freezes **both**.

**Stage splits** (all now seeded — `docs/16 A1`): STANDARD 50/25/25, BUNGALOW
65/10/25, NO_BIRDCAGE 75/0/25, GARAGE 65/10/25, GARAGE_NO_BCAGE 75/0/25,
TIMBER_FRAME 80/20. Chosen per plot by house shape + `buildType`
(`StageSplit.scenario`); a missing scenario is surfaced (`pricing.missingScenarios`),
not silently STANDARD.

## Data model (Phase-0 additions)

- `BuilderProfile` — per-housebuilder spec profile (access type, loading-bay
  policy, beam-over, chimney rule, birdcage-lifts-over-2.5m, joist variant,
  extra-hire policy, `spec` JSON), versioned. **Model only — no UI/logic yet.**
- `ClientMatrixTemplate` — a client's own matrix template + `fieldMapping` JSON.
  **Model only** — see TODO below.
- `StageSplit.scenario` (StageScenario enum) — splits by house shape.
- Existing: `RateCard` / `RateItem` / `StageSplit`, `Quote` / `QuoteLineItem`
  (immutable), `ConstructionRateItem` / `ConstructionScope`, `Takeoff.status`
  (DRAFT/IN_REVIEW/CONFIRMED + confirmedBy/At).

## What's placeholder / not built (flagged)

- **Rates + bands are placeholders** — the whole engine works and now *prices*
  (placeholders filled by `scripts/fill-placeholder-rates.mts`); swap in Colin's real
  sheet, then validate against a real priced site (Windermere £20,228.06) to the penny.
- ✅ **Garages** are now priced (`docs/16 A6`) — own block + 65/10/25, into the grand
  total; ⚠️ their *quantities* are a flagged placeholder template (no extracted geometry).
- ⬜ **P6 — low-level / party-wall / chimney** still priced as separate client lines
  (may over-state the quote); the bundled-vs-itemised toggle needs Colin (`docs/16 A-gate`).
- **Shared-item apportionment** (loading bay / chute / access across a block) — Build-2;
  needs the builder-profile extras + the 4-plot rule (docs/11 §8).
- **Construction pricing path** — model exists, unused; imported rate sheet + hire weeks.
- **Builder-profile screen** — model + placeholder Miller/Barratt profiles exist; the
  `storeyLiftTemplate` is used, but the "extras" have no UI yet.
- **Client-specific matrix template** — the export now matches Colin's **fixed Airwright**
  Traditional/Timber-Frame layout (`quoteExcel.ts`); populating a housebuilder's OWN Excel
  template is still a LATER TODO (needs a real client template to map against).
- **ScaffoldOperation table** is unused (we price the engine line → QuoteLineItems
  directly, per the per-plot decision). Wire it only if a persisted op-list is wanted.

## Try it

1. Confirm a house type's take-off on its review screen.
2. Add rates under **Rates** (or use the seeded placeholders).
3. Open **Pricing** on the project → see the matrix → **Generate quote**.
4. On the quote: **Export Excel** or **Print / Save PDF** (the client quotation).
