# 08 · Colin's data (drawings + pricing matrices) — decode for Week 3

Colin sent real data on ~2026-08-11. This is a **complete worked example**: the
drawings (input) + his priced matrices (the answer key + the rules). Files live
in the user's `~/Downloads` (not committed to the repo).

## Two kinds of file

### A. Elevation drawings (`~/Downloads/Elevations/`, ~31 PDFs) — the INPUT
- Naming: `2522-{TYPE}-25-{seq}!C1! {Face} Elevation … Plot(s) N`.
  - `2522` = site/job number · `{TYPE}` = house-type code (BO, FR, MA, PW, TI, WE, PK…)
  - `C1` = revision · `{Face}` = Front / Rear / Side / Gable · trailing plots = which plots use it.
- **Structural gotcha:** this builder gives **one file per elevation face** (Front,
  Rear, 2× Side/Gable) *separately* per house type — NOT one combined PDF like Miller.
  → The tool must **group these separate elevation files back together by house type**
  (new work vs the Miller single-PDF assumption).
- Text layer carries the dimensions the take-off needs: `U/S Wallplate 5025`
  (height to soffit ≈ 5025 mm), `First FFL 2662`, window sizes, brick courses (`10BC`…).
- Some are **internal** — "Kitchen Elevation", "Cloak Plan Elevation" — NOT scaffolding.
  Our classifier currently mis-treats them as ELEVATION (they contain the word); needs a
  fix to exclude internal/room elevations.

### B. Pricing matrices (3 Excel files) — the OUTPUT + the RULES
Colin's actual take-off **and** pricing, one row per plot. Three sites, all same shape:
- `Airwright - Pricing Matrix Green Lane Traditional.xls` — his **original master**
  (264 rows: lift templates at top, ~140 priced plots, garages section, included-items list).
- `AWM Pricing Matrix Miller Homes Whitford Road, Bromsgrove.xlsx` — **same site as our
  tender pack** → a matched drawings↔answer pair.
- `airwright-pricing-matrix-standard-hill-phase-2-coalville.xlsx` — a cleaner
  "Airwright-style" version (3 sheets: Plots / Garages & Other / Summary).

**Column → operation mapping** (validates our `ScaffoldOperation` model):
| Column | Meaning |
|---|---|
| Storey / Config | storeys; detached / semi / end-/mid-terrace / maisonette |
| `1st … 8th` | the lifts (each priced = LM × rate) |
| Table Lifts & Guard Rails to Gables | access + gable scaffold |
| Render Adaptions | extra scaffold for rendered sections |
| Ground/1st/2nd/3rd Floor Birdcage | internal safety deck, one per floor |
| Strip GF/FF/SF/TF Birdcage | dismantle the birdcage (per floor) |
| Dismantle | take the external scaffold down |
| Plot Erect 50% · Birdcage Erect 25% · Dismantle 25% | the 3 **payment stages** (split of total) |
| Erect & Strip Price | the plot **total** |
| Screen Walls | extra item |

## What this CONFIRMS (rules we no longer have to guess)

- **Percentage splits (payment stages)** — written in the header and verified to
  reconcile against a real plot (total £7,040.52 → 50/25/25 = £3,520.26 / £1,760.13 /
  £1,760.13):
  - Standard: **Plot Erect 50% · Birdcage Erect 25% · Dismantle 25%**
  - Bungalow: **65% · 10% · 25%**
  - No birdcage: **Plot Erect 75%** (rest TBC)
  These become the configurable `StageSplit` rules. *Confirm they're current with Colin.*
- **Storey → lifts templates** (Green Lane top rows): 1-storey = 2 lifts; 2-storey =
  **3 (Barratt) or 4 (Standard)** — builder-specific!; 2.5/3 = 5/6; 4 = 8. Plus
  **Render / Hipped / No-birdcage** variants (which components apply).
- **Config drives the quantities:** detached vs semi vs maisonette rows have different
  LM values (semi ≈ shares a party wall → lower).
- **Garages** are priced as their own staged set (single / twin / car port).

## What's STILL needed from Colin

1. **His take-off sheet** — the raw **LM / m² quantities per plot** that *feed* these
   prices. The matrices show £ (LM × rate already combined), not the measuring.
2. **His rate sheet** — £/m per lift, £/m² birdcage, per band (super-comp/comp/med/high).
   (Could reverse-engineer some as price ÷ LM, but better to just get it.)
3. **Exact height → lifts cut-off** — templates are storey-based; confirm how he decides
   2.5-storey (where height matters) and the per-builder variation.

## How we use it in Week 3
- Elevations → test the deeper reader (does it pull height-to-soffit, wall lengths…).
- Split rule + templates → the configurable engine rules.
- ~140 priced plots (esp. Whitford Road, which pairs with drawings we have) → the
  **golden set** to prove the engine reproduces Colin's numbers.

See `docs/02-prd-build1.md` (Week 3) and `TODO.md` for the build plan.
