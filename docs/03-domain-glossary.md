# 03 · Domain Glossary — Scaffolding terms as Airwright uses them

The precise meaning of every term in a scaffold take-off, written to be
unambiguous for both the team and the model. **Grounded in the 13 Aug 2026 call
with Colin (estimator) and Ben, and the coverage checklist** — not the pre-call
drafts. Where the call left a value unconfirmed it is marked, so nothing here is
mistaken for a settled rule.

**Legend**
- ✅ **confirmed** — stated by Colin/Laura/Ben on the call and safe to rely on.
- ⚠️ **open** — not yet confirmed; a configurable default + a review flag, never a silent assumption. Full list in `docs/11 §8` / checklist §15.
- **[reads]** — an *observable* the AI reads off the drawing.
- **[computes]** — a value the deterministic engine derives; the AI must **not** produce it.

**The one principle that governs everything:** the AI **reads observables**
(lengths, heights, counts, roof shape); a separate deterministic engine
**computes** everything derived (lift count, perimeter total, birdcage area,
prices). Never blur the two — reading is the AI's job, arithmetic is the engine's.

---

## 1. Units

| Term | Meaning |
|------|---------|
| **LM (linear metre)** | A metre of scaffold measured **along the wall**. The external scaffold is measured in LM, **per lift**. The core unit scaffold is priced in. |
| **m² (square metre)** | Area unit, used only for **birdcage** (internal decks) = length × width. |
| **Count / quantity** | Some things are just "how many": apexes, porches, bay windows, corners, loading bays. |
| **Lift** | One **working platform level** stacked up the wall. A standard lift ≈ **1.5 m of height** ✅ (the *average* — ⚠️ whether it is truly constant is open). Everything external is counted and priced **lift by lift**. Render lifts are the exception — **2 m** (see Render). |

---

## 2. The building & its shape

| Term | Meaning |
|------|---------|
| **Storeys** **[reads]** | Number of floor levels: **1, 2, 2.5, 3**. Observed off the drawing; used to cross-check the lift count, never to price directly. |
| **Room in roof** **[reads]** | A habitable room inside the roof space (dormers, velux, raised eaves with living space) → this is a **2.5-storey**. It **adds one lift and one birdcage floor** ✅. |
| **Structure** **[reads]** | What the drawing shows, named by how many houses are joined: **DETACHED** (1, free-standing), **PAIR_SEMI** (2 — a semi/pair), **THREE_BLOCK** (3), **TERRACE** (**4 or more** — "terrace" is reserved for 4+), or **APARTMENT_BLOCK** (flats — scaffolded as **one whole building**). House forms take off **per one house**; the frontage is divided by dwellingsWide. |
| **Dwellings wide** **[reads]** | How many houses share the printed **front/rear frontage** (1 single, 2 semi pair, 3+ terrace). The engine divides the frontage by this to get one house; gable-end walls are never divided. |
| **Configuration** | A **plot-level** attribute (from the plot schedule, **not** the elevation): **Detached / Semi-detached / End-terrace (end-of-3, end-of-4) / Mid-terrace**. It decides **which walls get scaffold**: detached = all 4 sides; semi & end = 3 sides (2 corners); mid-terrace = front + rear only (both gables are party walls) ✅. |
| **Party wall** | A wall **shared** with the joined house — **not scaffolded**. Detached = **0**, semi/end = **1**, mid-terrace = **2** ✅. |
| **JG (joint gable)** | A gable shared between two houses (i.e. a party gable). |
| **Building line** | The **brickwork line** — the outer face of the brickwork. The perimeter is taken off the **outside of the ground-floor plan along this line**, for one dwelling ✅. |

---

## 3. The external scaffold

| Term | Meaning |
|------|---------|
| **Perimeter** **[computes]** | The total run of external scaffold **for one lift**. Built from the **individual wall lengths** the configuration scaffolds, **plus a corner allowance**. The AI reports each wall length separately; the engine sums them. It repeats at every lift. |
| **Wall segment** **[reads]** | One external wall length, read off the building line and tagged by role: **front, rear, gable_left, gable_right**. Front/rear are the eaves faces (street/garden); gable_left/right are the two side/end walls that carry the apex and become party walls in a terrace. |
| **Corner / return** **[reads]** | An external corner of the footprint. Scaffold must **wrap past** a corner, so Airwright adds an allowance per corner. **Count external returns only** ✅ (internal ones are not counted). Allowance = **1 m per external corner** ✅ **CONFIRMED**. |
| **Number of lifts** **[computes]** | `ceil(height ÷ 1.5) + 1 if room-in-roof`, cross-checked against the storey template ✅. The AI supplies only the **height** and **storeys**; the engine computes the count. **Datum = soffit / underside of wallplate** ✅ (confirmed 2026-08-24, docs/11 §8a — no longer open). |
| **Height to soffit** **[reads]** | The vertical height from ground to the **soffit / underside of wallplate** — the top of the wall the scaffold reaches. Read from a vertical dimension (e.g. `U/S Wallplate 4725` = 4.725 m). This is the number the lift count divides. **Datum fixed to the soffit** ✅. **Triangulated:** the AI also reads the section's floor-to-floor storey heights (`storeyHeightsM`, deltas); the engine sums them as a second estimate and reconciles (see docs/13 §3.4). |
| **Storey template** | The rule-of-thumb lift counts, a **cross-check** on the height rule: garage/bungalow **2**, two-storey **4** (Barratt variant **3**), 2.5-storey **5**, three-storey **6**, four-storey **8** ✅. **Builder-specific.** If height and template disagree, the anomaly is flagged for a human. |

---

## 4. Roof, gable & apex

| Term | Meaning |
|------|---------|
| **Pitched roof** **[reads]** | A roof with a **gable apex** — brickwork rising to a point. Needs a **table lift** to reach that brickwork. |
| **Hipped roof** **[reads]** | A roof that **slopes back on all sides** — no brickwork above the eaves, so **no apex and no table lift** ✅. (Keepmoat sites are mostly hipped.) |
| **Gable / Apex** **[reads]** | The **triangular top of a wall** under a pitched roof (the pointy bit). Reaching its brickwork needs extra scaffold. **Counted per elevation** ✅ (physically count the points on each face — front and rear apexes count too, not just the ends). Hipped face = 0. A detached house typically has 2; more than 3 has never been priced. In **Strike this is called "apex scaffold"** — hold both names against the same item. |
| **Table lift** **[computes]** | An **additional lift above the main scaffold**, to reach the apex brickwork ✅. It is **on top of** the 4/5 main lifts, one per apex. |
| **Apex handrail / gable rails** **[computes]** | Guard rails up to the apex. Handled as a **count**, and the quantity **always equals the apex count** ✅. |
| **Smart roof** **[reads]** | A special roof with a **raised (higher) peak** — takes a **double table lift** (typically a 6 m + a 4 m) ✅. Detected only from the **peak height** being unusually high for the type ✅; the exact **threshold** is ⚠️ **open** (report the peak height, flag it, don't apply a cut-off). Mainly on Bloor sites. |

---

## 5. Internal scaffold (birdcage)

| Term | Meaning |
|------|---------|
| **Birdcage** **[reads → computes]** | An independent internal scaffold that **fills a whole floor** as a working/crash deck. Measured in **m² = internal floor area** ✅. The AI reads the **internal length × width** dimensions only (no stated area); the engine computes the area. **One per floor level** (GF, FF, SF…), summed for the total; a 2.5-storey has **3** ✅. Uses the **internal** area (inside the external walls), never the external footprint. |
| **Birdcage lifts** | Normally **one lift per room** (~90 % of the time) ✅. One client asks for **two lifts where a room exceeds 2.5 m** in height ⚠️ (identify which builder — held on their profile). |
| **Wall thickness / cavity deduction** | What is subtracted from an *overall external* dimension to get the *internal* one, when the internal span isn't printed directly. ✅ **RESOLVED 2026-08-25**: no fixed default — the **structural (blockwork) wall thickness is read off each drawing** (the short end segment on the plan's dimension chain, e.g. Miller **328**, NSS **302**, Augusta **392**), and the birdcage is measured to that structural face. The **WALL LEGEND** value (finished face, e.g. **353**) is a **flagged fallback** only. If neither a printed internal span nor a wall thickness is legible, the birdcage is left **unresolved** and flagged — never guessed. *(Colin to confirm the structural-face choice at sign-off.)* |
| **Strip birdcage** | **Dismantling** the birdcage, per floor — a separate operation from erecting it. |

---

## 6. Low-level, chimney & underbuild

| Term | Meaning |
|------|---------|
| **Low level** **[reads]** | A small scaffold tower for a **low feature — a porch or a SINGLE-storey bay window**. Each = **one** low level ✅. Re-erected **after** the main scaffold is struck. **Unit-priced**; the AI **spots, counts, and now records the TYPE** (porch: canopy vs solid; bay: single- vs two-storey) so the treatment can change later without re-reading. A porch/entrance **GRP canopy still counts** ✅. **A TWO-storey bay is NOT a low level** — it rises the full height (part of the main scaffold), so it is captured separately and **excluded from the low-level count** (`bayTwoStoreyCount`; `lowLevelQty` in `schema.ts`). |
| **Beam-over** | A spec variant (some Bloor sites): instead of returning with a low-level tower, a **beam is placed over** the porch/bay so it can be finished in one go. A **builder-profile** item ⚠️. |
| **Chimney scaffold** **[reads → computes]** | Scaffold **around the perimeter of a chimney stack**, at a **fixed rate for one or two lifts** ✅. Detect the chimney **from the drawing** ✅. Specs sometimes demand a chimney scaffold **even when none is drawn** — report `chimney = false` and **flag the spec-vs-drawing mismatch** rather than pricing it. |
| **Foot scaffold** | A low scaffold **around the base of the block**, at ground level. |
| **Underbuild** **[reads — not yet built]** | Where a plot sits on a **hill/slope**, extra scaffold is needed at the base so bricklayers can bring the floor level up ✅. The source is the **site elevations plan** — the elevation **of the site**, a *different* drawing from the house elevations ✅. The most-often-added item; not yet in the tool. |
| **Retaining wall (edge protection)** | Scaffold with guard rails where site levels drop off. **Parked** — a known later item, logged, not covered now. |

---

## 7. Access & shared (block) items

These serve a whole block, so their cost is **apportioned across the plots**.

| Term | Meaning |
|------|---------|
| **Loading bay (LB)** | A reinforced spot where materials are **lifted onto** the scaffold. **By lift, to full height**; **shared across a block** and apportioned. A four-block needs two ✅. Unit-priced. |
| **Rubbish chute / skip bay** | The waste route down the scaffold. **One per lift**, shared/apportioned. Whether it's a **chute or a skip bay is spec-driven**. |
| **Haki stair tower** | A proprietary **staircase** access tower (safer, dearer). **Client-spec** decides it. Apportioned across the block. Keepmoat mandates Haki. |
| **Ladder tower** | The cheaper **ladder** access alternative to a Haki. |
| **Hierarchy of safety** | Spec language like "Haki preferred, ladder tower allowed in a confined area." This is a **permission, not an instruction**, and isn't knowable at tender stage — encode the **preferred** option, ignore the allowance ✅. |
| **Joist support / props** | Temporary support when stairs/openings are formed. **One per set of stairs** (so typically one on a two-storey) ✅. Variants **single / double / sacrificial** — which one is **client-spec**. |
| **Screen walls** | Boundary/screen walls. **Usually not in the original tender** — priced later off a **separate drawing**, measured and allocated to plots ✅. A hook is needed now; a filter decides whether to show them to the client. |
| **Apportionment** | Splitting a shared item (loading bay, chute, access) across adjoining plots by configuration + block size: detached takes the full amount; semi charges 2 lifts/plot; a terrace of three ≈ 1.33/plot ✅. **Four-plot** split ("go back to two") is ⚠️ **open**. |

---

## 8. Render & cladding

| Term | Meaning |
|------|---------|
| **Render / render adaption** **[reads → computes]** | A wet **render** (or cladding) finish on part of an elevation. It is a **separate work type**, not a modifier ✅. Sequence: the external scaffold **comes down**, the **rendered section length (LM)** is measured, and it is **re-erected in 2 m boarded lifts** (not 1.5 m — the lifts are boarded and must be walkable) ✅. Priced at the **same £/LM** as the perimeter scaffold ✅. **Per plot** (`isRendered`) — the same house type can be rendered on one plot, not on another. |
| **Render lifts** | Colin's fixed table: two-storey = **2 lifts + a table lift**, 2.5-storey = **3**, three-storey = **4** ✅. Laura's version: 3 lifts default, 4 if full-height. Probably the same rule stated two ways — ⚠️ **confirm** before hardening. Only the **rendered section** is measured, never the whole wall ✅. |

---

## 9. Pricing, stages & process

| Term | Meaning |
|------|---------|
| **Take-off** | The measured list of scaffold **quantities/operations** for a house type — the thing this whole tool produces. |
| **Erect vs Dismantle** | Put up vs take down — **two separate priced operations** ✅. |
| **Payment stages / stage split** | The plot total split into billing stages: **Plot Erect 50 % · Birdcage Erect 25 % · Dismantle 25 %** ✅; **bungalow 65 / 10 / 25** ✅; **no-birdcage ≈ 75 / …**. **Configurable per client.** The stage value shown against an item is *how the payment is arranged*, **not** the item's true cost — hold the two separately. |
| **Rate band** | Colin's commercial pricing tier: **super-competitive / competitive / medium / high / custom**. Same take-off, different £/unit. Chosen per client (a commercial judgement, not automated). |
| **Builder profile / specification** | A **stored, per-housebuilder** profile (~20 builders) ✅ — access type, loading-bay policy, beam-over, chimney requirement, birdcage lifts by room height, render basis, joist variant, payment structure, extra-hire policy, preferred matrix template. The document that **governs** is the **"design standard specification for scaffolding"**, *not* the tender checklist ✅. |
| **Hire weeks** | How long scaffold stays rented up — a **construction-mode** concept (e.g. the Wetherspoon job), not standard housebuilding. |
| **Handover** | The certificate the gang signs when a stage is complete; triggers gang pay + client billing. |
| **Extra hire** | Charge where scaffold stays beyond the contracted period. Many housebuilders refuse it / zero it. How it's calculated is ⚠️ **open** (referred to Pippa). |

---

## 10. Drawings, systems & data

| Term | Meaning |
|------|---------|
| **Elevation** | A drawing of a **face** of the house (front/rear/side/gable). Read apexes, render and height here. **Ignore internal room elevations** ("Kitchen Elevation", "Cloak Plan Elevation") — those are joinery, not scaffolding. |
| **Floor plan** | A top-down drawing of a floor. Read the **internal dimensions** for the birdcage, and the **footprint** for wall lengths. |
| **Site / plot layout** | The site drawing mapping **plot numbers → house types → positions/blocks**. Source of configuration and block grouping. |
| **Site elevations plan** | A distinct drawing showing the **elevation of the site** (levels/slopes) — the only source for **underbuild / foot scaffold** ✅. Not the house elevations. |
| **Plot schedule** | Maps plot numbers to house types (and config). Not every housebuilder supplies one. |
| **Configuration variant** | Per plot: detached/semi/terrace position + render or no-render + garage — all of which change the take-off. |
| **TG20 (TG20:21)** | The industry scaffold **design-compliance** standard. A constraint, not a measurement. |
| **Strike** | The incumbent desktop software being replaced — **Alpha Estimator** (pricing) + **Job Manager** (billing). It keeps running alongside; outputs must be **keyable into it** (its item names/units, and it wants the **total** metreage, not per-lift). |
| **Confidence** **[reads]** | Every value the AI reports carries **high / medium / low / unknown**. `high` = the printed value is certain and unambiguous. Below threshold → leave blank and flag, never guess. |
| **Provenance** **[reads]** | Where a value came from — the **sheet** and the **exact printed dimension string** — recorded on every number so a human can trace it. |

---

*Source of truth for the confirmed rules and the full open-questions table:
`docs/11-takeoff-engine-spec.md` and the coverage checklist
(`docs/Airwright-Estimator-Build-Checklist_from_call.docx`). When a ⚠️ open item
is confirmed by Colin, update it here **and** in `docs/11`, and bump the prompt
version if it changes what the model is told.*
