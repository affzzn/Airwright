# 14 · Pricing & Quote — how the priced side works (BUILT)

The other half of Build 1: turning a confirmed take-off (quantities) into **money
and documents**. Built end to end on 2026-08-20, running on **placeholder rates**
until Colin's real rate sheet arrives. Read `docs/11` first for the measurement
side; this doc is the pricing side.

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

`priceTakeoffLine` maps the take-off line to priced `LIFT / BIRDCAGE_* / GABLE /
GABLE_RAILS / RENDER_ADAPTION / LOW_LEVEL / PARTY_WALL` operations (erect +
dismantle). **⚠ Every mapping choice is Innate's reading of Colin's matrix and is
marked in the code — confirm against his rate sheet** (e.g. external perimeter =
LIFT × LM per lift; table lift priced as GABLE; chimney has no dedicated enum →
OTHER). Nothing here is a settled rule.

**Two concepts kept separate** (checklist §9 trap): the **true item cost**
(`lines[].amount`, summing to `subtotal`) vs the **presented stage value**
(`stages[].amount` = subtotal × stage %). The matrix shows the stage split; the
real per-item cost is what actually adds up. The immutable Quote freezes **both**.

**Stage splits** are confirmed 50/25/25 (standard) and 65/10/25 (bungalow); the
no-birdcage split (75/…) is ⚠ open. Chosen per plot by house shape
(`StageSplit.scenario` = STANDARD / BUNGALOW / NO_BIRDCAGE).

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

- **Rates + bands are placeholders** — the whole engine works; the numbers swap
  in from Colin's rate sheet, then validate against the Oadby matrix to the penny.
- **Shared-item apportionment** (loading bay / chute / access across a block) and
  **garages** (own staged set) — flagged in the matrix as "not yet applied";
  need the builder-profile extras + the 4-plot rule (docs/11 §8).
- **Construction pricing path** — model exists, unused; imported rate sheet + hire weeks.
- **Builder-profile screen** — model + placeholder Miller profile exist; needs a UI
  and to feed the extras into the take-off/price.
- **Client-specific matrix template** — *populate a housebuilder's OWN Excel template
  and export it.* The fixed Airwright Excel matrix works for now; **implement the
  client-specific version LATER — it needs a real client template to map against.**
- **ScaffoldOperation table** is unused (we price the engine line → QuoteLineItems
  directly, per the per-plot decision). Wire it only if a persisted op-list is wanted.

## Try it

1. Confirm a house type's take-off on its review screen.
2. Add rates under **Rates** (or use the seeded placeholders).
3. Open **Pricing** on the project → see the matrix → **Generate quote**.
4. On the quote: **Export Excel** or **Print / Save PDF** (the client quotation).
