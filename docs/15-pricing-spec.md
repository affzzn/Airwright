# 15 · Pricing Spec — the House-Build matrix, decoded from Colin's real files

**This is the canonical spec for how the house-build client quote is priced.** It
is built from Colin's actual Excel files in `data/pricing-data/` (gitignored PII) —
the pricing-matrix templates (Traditional + Timber Frame), a real priced site
(Windermere operatives matrix), the estimating take-off template, the LM/area
calculator, and the per-builder **House Take-Offs Bank**. It supersedes the
provisional reading in `docs/14` (which was written before these files arrived).

**Scope.** House-build only (`Project.estimatingMode = HOUSE_BUILD`). Construction
mode (per-elevation, gang-days, hire weeks — the `Labour Cross Reference` sheet) is
a *separate* structure and is **out of scope here** (noted in §11). The **operatives
/ gang-pay** matrix (Windermere) is **Build 2**, not Build 1 — but it's decoded in
§8 because it confirms several Build-1 rules and shares the take-off.

> Legend: **✅ CONFIRMED** (from the files) · **⚠️ CONFIRM** (needs Colin) · **🔧 APP GAP**
> (what our code must change).

---

## 1. The two estimating modes AND the two build types

There are two orthogonal splits, and **the app currently only handles one of them**:

- **Estimating mode** (`Project.estimatingMode`): HOUSE_BUILD vs CONSTRUCTION. *This spec = HOUSE_BUILD.*
- **Build type** (`buildType`, read per house type): **TRADITIONAL vs TIMBER_FRAME**. ✅ **These are two DIFFERENT pricing matrices with different columns and different stage splits.** 🔧 **APP GAP: we read `buildType` but ignore it for pricing — it must select the matrix.** (This corrects the earlier note that `buildType` was "unused metadata"; it is load-bearing.)

---

## 2. The take-off inputs (what feeds pricing)

From the **Estimating Take-Off** sheet + the **House Take-Offs Bank**. Per house
type × configuration, the take-off produces:

| Input | Meaning | Our field |
|---|---|---|
| **LM PERIMETER** | linear metres of external scaffold for ONE house at that config | engine `perimeter.perLiftM` |
| **BIRDCAGE M2** (per floor) | internal deck area per floor | `BIRDCAGE_*_M2` |
| **GABLES** | apex count — a number, OR the word **"Hipped"** (= 0) | `GABLE_QTY` |
| **LOW LEVELS** | porch/bay low-level towers | `LOW_LEVEL_QTY` |
| **RENDER / CLADDING ADAPTIONS** (+ Render Meterage) | rendered length, per plot | `RENDER_LENGTH` |
| **Rubbish Chutes / Skip Bay** | shared access item | — (not extracted; gang-pay) |
| **HOP UPS** | small platform item | 🔧 not extracted (add) |
| **DORMERS** (some builders) | room-in-roof signal | `roomInRoof` |
| QTY | how many plots use it | `Plot` count |
| HIRE (Weeks) | construction only | n/a for house-build |

**Geometry (confirmed by the LM & Area Calculator — matches our engine exactly):**
- Detached = `2 × (L + W)` (4 sides) · Semi/End = `L + 2W` (3 sides) · Mid = `2W` (2 sides).
- Internal birdcage = `(L − 0.6) × (W − 0.6)` — Colin's calculator deducts **0.6 m per dimension** as a shortcut when only overalls are to hand. Our engine instead **reads the actual structural wall off each drawing** (e.g. Miller 328 → 0.656 m/dim, NSS 302 → 0.604 m/dim) and prefers a directly-printed internal span — no fixed default (docs/13 §3.10). His 0.6 m is a good cross-check on the result, not the method we use.
- **"ADD CORNERS"** — the corner allowance is added on top of the wall LM (✅ our engine does this; **1 m per external corner, CONFIRMED**).

---

## 3. The Traditional client matrix — the target output

One row per plot; the columns that carry cost (and sum to the total) are:

| Cols | Column | Meaning |
|---|---|---|
| A–D | Plot · House Type Code · (Config) · Storey | identity |
| **E–L** | **1st · 2nd · 3rd · 4th · 5th · 6th · 7th · 8th** | **per-lift ERECT price, one column per lift level** |
| M | **Table Lifts & Guard Rails to Gables** | apex access — **ONE combined column** |
| N | Render Adaptions | rendered-section scaffold |
| O–R | Ground / 1st / 2nd / 3rd Floor Birdcage | birdcage ERECT, per floor |
| S–V | Strip GF / FF / SF / TF Birdcage | birdcage DISMANTLE, per floor |
| W | Dismantle | external scaffold dismantle (one column) |
| X | **Plot Erect 50% (65% Bung) (75% NO BCAGE)** | payment stage 1 |
| Y | **Birdcage Erect 25% (10% Bung)** | payment stage 2 |
| Z | **Dismantle 25%** | payment stage 3 |
| AA | **Erect & Strip Price** | the plot total = Σ(E…W) |

**Reconciliation:** `AA = Σ(E…W)` (all the erect + strip + dismantle cost cells);
then `X = AA × 50%`, `Y = AA × 25%`, `Z = AA × 25%`. ✅ This is exactly our app's
"subtotal = Σ lines; stages = subtotal × %" mechanic — the mechanic is correct.

**⚠️ Critical structural facts from these columns:**
1. **Per-lift-level pricing (E–L).** Each lift level is its own cost, and on the real Windermere data the **1st lift is dearer than upper lifts** (e.g. 234.5 vs 201). ✅ CONFIRMED. 🔧 **APP GAP: we use ONE `LIFT` rate for every lift.**
2. **Table lift + gable rails were ONE column (M) in Colin's source matrix.** 🔧 **The app now SPLITS this into two client line items/columns — `TABLE_LIFT` ("Table Lifts to Gables") + `GABLE_RAILS` ("Apex Guard Rails to Gables")** (changed 2026-09-01). ⚠️ **RATES: each needs its OWN rate — both are unconfirmed placeholders (unpriced → £0 + flagged) until Colin's rate sheet gives how the one combined figure splits.**
3. **Birdcage erect (O–R) AND strip (S–V) are per-floor, GF→TF.** 🔧 **APP GAP: we only handle GF/FF.**
4. **Low level, chimney, access (Haki/LB/chute) are NOT client columns** — they're bundled into the rates / a standard-inclusions list, so `LOW_LEVEL` and chimney (`OTHER`) stay **inclusions** (priced as audit lines but excluded from the total). **PARTY WALL is NOW its own priced column (2026-09-01 call):** the inside apex (no rails) is a spec item at **£165/unit provisional**, **one unit per non-detached house** (detached = 0), removable per plot at spec stage (`Plot.includePartyWall`). Still confirm with Colin whether low-level/chimney are (a) bundled in the lift rate, (b) a separate inclusions list, or (c) absent.

---

## 4. The template rows = builder × storey × variant

The template's rows 4–32 are **reference templates**, grouped by builder, that
Colin copies per plot. They encode the whole variant space:

- **Builder** — Barratt vs STANDARD (and by extension each housebuilder). ✅ This is `BuilderProfile.storeyLiftTemplate` (just added). Barratt `3 Lifts (2Storey)` vs STANDARD `4 Lifts` — ✅ CONFIRMS the builder-specific lift template.
- **Storey → lifts** — Barratt: 1→2, 2→3, 2.5/3→4. STANDARD: 1→2, 2→4, 2.5→5, 3→6, 4→8.
- **Variant flags** in the template name, each toggling which columns apply:
  - **Render** → adds column N (and, on 2-storey, an extra lift + a table lift).
  - **Hipped** → **drops the table-lift/gable column M** (hipped = no apex).
  - **NO BCAGE** → drops birdcage columns O–V, and switches the stage split to **75 / 0 / 25**.

So a plot's template is picked from `(builder, storeys, rendered?, hipped?, has-birdcage?)`. 🔧 **APP:** our per-plot engine already derives from those exact facts (config, render flag, roof type, floor count) — we must make the **priced operation set line up with the matching template's columns** (e.g. a Hipped plot must produce **no** table-lift line; a NO-BCAGE plot must use the 75/0/25 split).

---

## 5. Payment stage splits (all confirmed)

Applied to the plot total `AA`. ✅ CONFIRMED from the column headers:

| Scenario | Plot/Gar Erect | Birdcage Erect | Dismantle |
|---|---|---|---|
| **Standard** | 50% | 25% | 25% |
| **Bungalow** | 65% | 10% | 25% |
| **NO BIRDCAGE** | **75%** | **0%** | **25%** |
| **Garage (standard)** | 65% | 10% | 25% |
| **Garage NO BCAGE** | 75% | 0% | 25% |
| **Timber Frame** | 80% (erect) | — | 20% (dismantle) |

🔧 **APP GAP:** we define STANDARD (50/25/25) and BUNGALOW (65/10/25), but **NO_BIRDCAGE is undefined and silently falls back to STANDARD** — it must be **75 / 0 / 25**. Garage and Timber-Frame splits aren't modelled at all.

---

## 6. Garages — a separate priced section

Own block, own columns, own split (✅ CONFIRMED):

`Garage · Type (Single / Twin / Car Port, Det) · Storey · 1st Lift · 2nd Lift ·
Gable Lift & Rails · GF Birdcage · Dismantle · Gar Erect 65% (75% NO BCAGE) ·
Bcage Erect 10% · Dismantle 25% · Total Price`.

The **Grand Total = Erect & Dismantle (plots) + Garages**. 🔧 **APP GAP: garages are counted (`hasGarage`) but NOT priced.** Needs its own take-off + priced set + 65/10/25 (75/0/25) split, added into the grand total.

---

## 7. The Timber-Frame matrix (different structure)

`Storey · Erect Timber Frame External 2-4 Lifts · Erect Apex Handrails · Adaption
1st…6th Lift · Render/Cladding Adaption · Dismantle · Plot Erect 80% · Dismantle
20% · Erect & Strip Price`.

Differences from Traditional: **a single external erect** (not per-lift), **per-lift
"Adaptions"** (the frame is adapted as it rises), **apex handrails** as their own item,
**no birdcage stage**, and an **80 / 20** split. 🔧 **APP GAP: not implemented — `buildType = TIMBER_FRAME` must switch to this matrix.**

---

## 8. The Operatives (gang-pay) matrix — Build 2, but it confirms Build-1 rules

The Windermere file is the **gang-pay** breakdown (what operatives are paid), far
finer than the client quote. It is **out of scope for Build 1**, but it confirms:

- **Per-lift ERECT and DISMANTLE separately**, per level, with the **1st lift dearer**.
- **Per-lift access items** — `Haki Erect/Dismantle`, `LB (loading bay) Erect/Dismantle`, `Rubbish Chute Erect/Dismantle` — at **flat unit amounts** per lift (e.g. Haki 40/20, LB 40/20, Chute 7.5/2.5).
- **Apportionment across a block** ✅ — "Benford **JG**" (joint-gable) plots **omit** Haki/LB/chute because they share access with the adjacent plot of the pair.
- **Table Lift** and **Gable Rails** as **separate** items (unlike the combined client column M).
- **Joist Support** (props) Erect/Dismantle, **Low Level** Erect/Dismantle, birdcage per floor Erect/Dismantle.

**Implication for Build 1:** access/joist/low-level are itemised for the *gang*, but
bundled for the *client*. So the "one rate" spine is: measure once → the **client**
quote bundles into the per-lift £/LM + the matrix columns; the **gang** self-bill
itemises everything. Build 1 only needs the client side.

---

## 9. The House Take-Offs Bank — our golden validation set

8 builder sheets (Vistry, TW, Avant, Tila, Bloor, Miller, Keepmoat, Bellway),
hundreds of house types each, with Colin's **actual** take-off per type × config:
`House Type/Code · Type · Storey · (Length · Width) · LM · Gables (n or "Hipped") ·
Quantity No Render · Quantity Render · Render Meterage · Low Levels · Birdcage m²
per floor · [Dormers] · Notes`.

**This is ground truth.** For every house type we have a drawing for
(Chesterwood, Hayton, Cherrywood, Allamont, Braxton, Glenwood, Delmont…), we can
compare our extracted+computed **LM / birdcage m² / gables / low-levels** against the
bank row → the first real **correction-rate** metric. (Notes worth heeding: many
Miller types are **"Hipped"** → this is exactly where the deferred MIXED-roof issue
(C6) bites; and "Double check if still hipped per site" appears a lot → hipped is
plot-dependent.)

---

## 10. Gap analysis — current app vs this spec

**Update (2026-08-25): the structural gaps P1–P5, P7 are BUILT** (Track 2, see
`docs/16`). What remains is P6 (needs Colin) + the data gate (P11, real rates).

| # | Finding | Status | Fix / how it's done |
|---|---|---|---|
| P1 | **`buildType` selects Traditional vs Timber-Frame matrix** | ✅ done (`85ef4d4`) | `priceProject` branches on `buildType` → `priceTimberFrameLine` (single external erect + adaptions + apex handrails, no birdcage, 80/20). |
| P2 | **Per-lift-level rates (1st lift dearer)** | ✅ done (`93b3f7a`) | `RateItem.liftLevel` (0 = base, 1..8); resolver = exact level → base fallback. |
| P3 | **NO_BIRDCAGE split = 75 / 0 / 25** | ✅ done (`93b3f7a`) | `StageScenario` += NO_BIRDCAGE / GARAGE(_NO_BCAGE) / TIMBER_FRAME, seeded; missing scenario now flags instead of silently STANDARD. |
| P4 | **Table lift + gable rails split into TWO client columns** | ✅ done (2026-09-01) | `priceTakeoffLine` emits `TABLE_LIFT` + `GABLE_RAILS` separately; matrix has "Table Lifts to Gables" + "Apex Guard Rails to Gables". ⚠️ both rates unconfirmed — Colin. (Was one combined `GABLE` line; garage block still uses combined `GABLE`.) |
| P5 | **Birdcage erect + strip per floor, GF→TF** | ✅ done (`93b3f7a`) | `ScaffoldComponent` += `BIRDCAGE_SF/TF`; each floor priced to its own component, erect + strip. |
| P6 | **Low-level / chimney are inclusions; party wall is now a priced column** | 🟢 party wall DONE (2026-09-01); low-level/chimney still OPEN | Party wall = £165 provisional spec item, one per non-detached house, per-plot `includePartyWall` toggle. Low-level/chimney stay inclusions pending Colin (bundled / list / absent?). |
| P7 | **Garages priced (own columns + 65/10/25)** | ✅ done (`5e8b115`) | `takeoff/garage.ts` template + `priceGarageLine`; garages block in the matrix + folded into grand total. ⚠️ quantities are placeholders (no extracted geometry). |
| P8 | **Access items (Haki/LB/chute) bundled for client, itemised + apportioned for gang** | 🟡 later | Build-1: fold into the rate. Build-2: itemise + apportion (JG rule). |
| P9 | **Template = builder × storey × Render/Hipped/NO-BCAGE variants** | 🟢 mostly | Derived ops reconcile to the matching template row (Hipped → no table lift; NO-BCAGE → 75/0/25 via scenario). |
| P10 | **HOP UPS not extracted** | 🟡 minor | Add to the take-off if it's a client line. |
| P11 | **Rates are placeholders** | 🔴 GATE | Placeholders filled (`scripts/fill-placeholder-rates.mts`) so the matrix prices; still must enter Colin's real sheet + **validate to the penny** (Windermere/Branston/Oadby). |

The **arithmetic and reconciliation mechanics are sound** (pence, subtotal = Σ ops,
stages = subtotal × %, immutable quote), and the **structural** gaps are now closed.
What's left is **P6** (a Colin confirmation) and **data** (real rates, per-builder
templates, the confirmations below).

---

## 11. ⚠️ Still needs Colin (house-build pricing)

1. **The rate sheet** — £ per lift level (1st vs upper), £/m² birdcage erect & strip, £ table+rails, £/LM render, per band.
2. **Are low-level / chimney bundled** into the lift rate, a separate inclusions list, or absent from the client quote? (Party wall is resolved: a priced £165 spec item, one per non-detached house.) Confirm the final **£165 party-wall rate**.
3. **Per-builder lift templates** (we have Barratt 2→3, Standard 2→4; need the rest).
4. ~~**The corner allowance quantum**~~ **RESOLVED**: 1 m per external corner (docs/11 §8 #2).
5. **Render on 2-storey** — the "+1 table lift" rule (docs/11 §4), and whether the render £/LM equals the perimeter £/LM.
6. **Garage rates + which stage split** (65/10/25 vs 75/0/25 by garage type).
7. **Timber-Frame rates** for the 80/20 structure.

**Then:** load the rate sheet and prove the engine reproduces a real priced site
(Windermere `Erect & Strip Price` per plot, grand total 20,228.06) **to the penny**.

---

## 12. Out of scope here (noted for completeness)

- **Construction mode** — per-elevation, `meterage ÷ 42 m per gang-of-3 per day × day-rate`, hire weeks; benchmarked against Strike (the `Labour Cross Reference` sheet). A different engine entirely.
- **Build 2 (gang pay / self-bill)** — the operatives matrix in §8: itemised per-lift erect/dismantle + access + joist + low-level, apportioned across blocks.

*Sources: `data/pricing-data/` (gitignored). Cross-refs: `docs/14` (superseded pricing
notes), `docs/11 §4-5` (confirmed take-off rules + stage-split proof), `docs/08`
(the earlier matrix decode). Update this doc when Colin confirms a ⚠️ item.*
