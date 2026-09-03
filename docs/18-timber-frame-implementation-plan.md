# 18 · Timber-Frame Support — Implementation Plan

**What this is.** The in-depth, correctness-first plan for adding **Timber-Frame**
take-off + pricing to the app, from the 1 Sep Colin/Laura call ("Introduction to
Timber Frames") + Laura's follow-up email. It also **retires Construction** from the
new-tender form and makes **build system a project-level choice**. Read `docs/11`
(take-off engine) and `docs/15` (pricing spec) first — this plan sits inside both.

> Legend: **✅ CONFIRMED** (from the call/email — build it) · **⚠️ CONFIRM** (needs a
> Colin/Laura answer — flag, don't guess) · **🔧** (a code/schema change).

> **STATUS (2026-09-03): ✅ IMPLEMENTED (branch `feat/timber-frame`).** All three tracks
> built + green (typecheck, lint, 288 tests, build). Engine (`computeLiftsTimberFrame`,
> `computeAdaptions`) validated to Laura's Aspen figures (66.49 / 45.66) and the lift table
> (3/4/4). Migration `20260903000000_add_timber_frame_support` (project `buildType` + the
> two adaption components) applies on the next `db:deploy`. Rates are placeholders (the §7
> Colin questions remain open).

> **Decisions locked with the user (2026-09-03):**
> - The "Estimating mode" dropdown becomes **Traditional / Timber frame**. **Remove
>   Construction** from the create form.
> - **Build system is a PROJECT-level choice**, set by the user when creating the
>   tender. It flows to every house type + plot and **selects the take-off + pricing
>   logic**. The engine does **not** try to detect timber-frame from the drawing.
> - Correctness of the take-off is the priority. Nothing open is guessed.

---

## 0. The one big idea

Today `buildType` only affects **pricing** (Layer 3). The **take-off engine (Layer 2)
is build-system-agnostic** — it always computes traditional lifts (`ceil(h/1.5)`) and
always computes a birdcage. So a timber-frame 2-storey currently gets **4 lifts + a
birdcage** — both wrong (should be **3 lifts, no birdcage**).

**The fix: make the take-off ENGINE build-system-aware, so the take-off LINE is correct
before anything is priced.** Timber frame changes exactly **three** things in the line —
**lifts**, **no birdcage**, and **adaptions**. Everything else (perimeter, corners, apex,
render, config split) is **identical** ("everything else is shared" — Colin). Pricing
then just prices whatever line the engine produced.

---

## 1. The domain rules (ground truth)

### 1.1 What is the SAME as traditional (do not touch)
- External perimeter by config (detached 4 / semi 3 / mid 2) + **1 m per corner**.
- Apex **scaffold** + apex **rails** (per apex, config-reduced the same way).
- Render / cladding adaption.
- Loading bay / Haki / chute — shared access items, apportioned across a block
  (deferred for both build types — same as today). TF note: **always Haki, never a
  ladder tower.**
- Same drawings, same extraction, same review → confirm → price flow.
- **Height datum = the soffit** (`HEIGHT_TO_SOFFIT`) — same field we already read.

### 1.2 What is DIFFERENT

**(a) Lifts — top-down from the soffit, in 2 m lifts, minus a fixed 450 mm step.**
The reliable driver is **storey → lift count** (Laura's email):

| Storeys | TF lifts | Breakdown (top → bottom) | (Traditional was) |
|---|---|---|---|
| **2** | **3** | 450 mm · 2 m · 2 m (kicker) | 4 |
| **2.5** | **4** | 450 mm · **1 m** · 2 m · 2 m (kicker) | 5 |
| **3** | **4** | 450 mm · 2 m · 2 m · 2 m (kicker) | 6 |

The method (how Colin derives it, and how to handle "funny" TF heights): start at the
soffit, take **450 mm** off the top (that's the top lift — the max step a roofer can take
off the apex), then come **down in 2 m lifts**; the **bottom "kicker" lift** absorbs the
remainder. **Every lift is priced the SAME rate** (450 mm, 1 m or 2 m — all boarded, all
have an inside handrail). Worked example (the drawing shown on the call, 2-storey): soffit
= 2.7 + 2.1 = **4.8 m** → 450 mm · 2 m · ~2.35 m kicker = **3 lifts**.

> The height method reproduces all three rows exactly (see §6 test vectors), but it's
> fuzzy at the storey boundaries — so **storey count is primary, height is a cross-check
> that flags a divergence** (same "read two ways → reconcile → flag" doctrine we use for
> height/birdcage). The only case needing the 1 m lift is **2.5-storey**, which the
> storey signal already tells us.

**(b) No birdcage.** Timber frame has **no internal decks** ("no internal work normally;
if asked, added after"). Drop birdcage m² × floors entirely, and the birdcage payment
stage.

**(c) Adaptions — new, priced on a linear-metre (LM) rate.** Because the whole scaffold
goes up **before** the house and is fully boarded, boards are pulled and replaced as the
trades work. **Two types, each with its own LM rate:**

- **Inside-board adaption — ALL lifts** + each apex converted to **4 LM**:
  `insideBoardLM = perimeterPerLift × lifts  +  apexCount × 4`
- **Hop-up adaption — every lift EXCEPT the 1st (kicker)** + each apex as **4 LM**:
  `hopUpLM = perimeterPerLift × (lifts − 1)  +  apexCount × 4`

### 1.3 The canonical fixture — Aspen Semi, 2-storey (Laura's email)
`perimeterPerLift = 20.83 LM` (incl. 2 corners) · `lifts = 3` · `apexCount = 1`:

| Line | Qty | Check |
|---|---|---|
| External erect | 3 × 20.83 = **62.49 LM** | flat rate, all lifts |
| Apex scaffold | **1** (unit) | |
| Apex rails | **1** (unit) | |
| Inside-board adaption | 62.49 + (1×4) = **66.49 LM** | × adaption-rate-1 |
| Hop-up adaption | (2 × 20.83) + (1×4) = **45.66 LM** | × adaption-rate-2 |
| Birdcage | — | none |
| Loading bay / Haki / chute | 1 each (shared) | deferred (as today) |

**These two numbers — 66.49 and 45.66 — are the engine's acceptance test.**

---

## 2. Where "build system" lives (data model)

- 🔧 **Add `Project.buildType : BuildType @default(TRADITIONAL)`** — the single source of
  truth, set on the new-tender form.
- `HouseType.buildType` (read from the drawing) **stays but is demoted to a cross-check**:
  the project value is authoritative for take-off + pricing. Optionally flag when the
  drawing's read disagrees with the project ("drawing looks TRADITIONAL, project is
  TIMBER_FRAME"). Low priority.
- `EstimatingMode` (HOUSE_BUILD / CONSTRUCTION) **stays in the schema**, but the create
  form only ever writes `HOUSE_BUILD`. We **remove Construction from the UI**, not from
  the enum/dead code (a full removal is a bigger, riskier migration — do it later if ever).

---

## 3. The plan — three tracks, in order

### TRACK A — UI + project model (retire Construction, add the toggle)

1. 🔧 **Migration** `add_project_build_type`: `Project.buildType BuildType @default(TRADITIONAL)`.
   Existing rows default to TRADITIONAL (correct — everything built so far is traditional).
2. 🔧 **`src/components/projects-workspace.tsx`** (the new-tender modal, ~line 238):
   replace the `mode` select ("House build" / "Construction") with a **`buildType`
   select**: `Traditional` (`TRADITIONAL`) · `Timber frame` (`TIMBER_FRAME`). Relabel the
   field "Build type". Update the `mode` field on the list-row type (~line 34) → `buildType`,
   and the row subtitle (~line 345) to show `Traditional` / `Timber frame`.
3. 🔧 **`src/server/actions/projects.ts` → `createProject`**: stop reading `mode`; read
   `buildType` (validate against the enum, default `TRADITIONAL`); set `estimatingMode`
   to `HOUSE_BUILD` always; set `buildType`.
4. 🔧 **`src/app/page.tsx`** (~line 52): pass `buildType` through to the workspace instead
   of (or alongside) `mode`.
5. 🔧 **`src/app/projects/[id]/page.tsx`** (~line 164): the `estimatingMode === "CONSTRUCTION"`
   label becomes a **build-type badge** (`Traditional` / `Timber frame`) from `project.buildType`.

*(Out of scope: the `/rates` card `mode` dropdown still lists Construction — leave it;
it's the rate-card mode, not the tender. Revisit later.)*

### TRACK B — the take-off engine (the correctness core) — `src/lib/takeoff/engine.ts`

Pure, unit-tested. This is where mistakes would hurt, so it's built and tested **first**,
in isolation, against the §1.3 / §6 fixtures.

1. 🔧 **New type + constants:**
   ```ts
   export type BuildSystem = "TRADITIONAL" | "TIMBER_FRAME";
   export const TIMBER_FRAME_STOREY_LIFTS: Record<string, number> = { "2": 3, "2.5": 4, "3": 4 };
   export const TF_TOP_STEP_M = 0.45;   // fixed step off the roof/apex → the top lift
   export const TF_LIFT_HEIGHT_M = 2.0; // boarded 2 m lifts
   export const APEX_LM_PER = 4;        // each apex = 4 LM when converted for adaptions
   ```
2. 🔧 **`TakeoffInput` gains `buildSystem: BuildSystem`** (default `TRADITIONAL`).
3. 🔧 **`computeLiftsTimberFrame(input, params): LiftResult`** —
   - **effective storey**: `2 + roomInRoof → "2.5"`, else `String(storeys)`.
   - **primary** = `TIMBER_FRAME_STOREY_LIFTS[effStorey]`.
   - **cross-check** = height method:
     ```
     rem = heightToSoffit − 0.45           // remove the top step (1 lift)
     if effStorey === "2.5": rem −= 1.0     // the 1 m lift (1 more lift)
     liftsBelow = max(1, round(rem / 2))    // 2 m lifts; kicker absorbs remainder
     heightLifts = 1 + (effStorey==="2.5" ? 1 : 0) + liftsBelow
     ```
   - **result**: use the storey value when present; else height; **flag when they differ**
     (record both, like the traditional `LiftResult.flag`). Reuse the `LiftResult` shape.
4. 🔧 **`AdaptionResult` + `computeAdaptions(perLiftM, lifts, apexCount)`** (pure, directly
   testable against 66.49 / 45.66):
   ```ts
   export interface AdaptionResult { insideBoardLM: number; hopUpLM: number; apexLM: number; }
   const apexLM = apexCount * APEX_LM_PER;
   insideBoardLM = round3(perLiftM * lifts + apexLM);
   hopUpLM       = round3(perLiftM * Math.max(0, lifts - 1) + apexLM);
   ```
5. 🔧 **`buildTakeoff` branches on `input.buildSystem`:**
   - lifts: `TIMBER_FRAME` → `computeLiftsTimberFrame`, else `computeLifts`.
   - birdcage: `TIMBER_FRAME` → **empty** (`{ floors: [], totalM2: 0, floorCount: 0 }`); skip
     all birdcage flags for TF.
   - adaptions: `TIMBER_FRAME` → `computeAdaptions(perimeter.perLiftM, lifts.lifts ?? 0, apex.count)`,
     else `null`.
   - party wall: **`TIMBER_FRAME` → 0** by default (⚠️ §7 — the Aspen semi line has no
     party-wall item; confirm with Colin). Traditional unchanged.
   - flags: drop birdcage flags for TF; keep the lift height-vs-storey flag; add a TF
     "unusual height" note when the cross-check diverges.
6. 🔧 **`TakeoffLine` gains `adaptions: AdaptionResult | null` + `buildSystem`.**
7. 🔧 **`formatTakeoffText`**: a TF branch — show `perLift × lifts`, the two adaption LM
   totals, apex; **omit birdcage**.

`computeLifts`, `computePerimeter`, `computeApex`, `computeRender`, `partyWalls` — **unchanged**
(shared). Perimeter already bakes in the corner allowance ("incl. 2 corners"), so
`perimeter.perLiftM` is exactly the 20.83 the email uses.

### TRACK C — pricing, matrix, rates, review display

**C1 · `src/lib/pricing/engine.ts` → rewrite `priceTimberFrameLine`** to match the email:
   - `TF_EXTERNAL` ERECT — one line, `perLift × lifts` LM (flat rate → one column matches
     Colin's "Erect Timber Frame External" single column; per-lift = lump at a flat rate).
   - `TABLE_LIFT` ERECT — `apex.count` EACH → **apex scaffold**.
   - `GABLE_RAILS` ERECT — `apex.count` EACH → **apex rails**.
   - 🔧 `ADAPTION_INSIDE_BOARD` ERECT — `line.adaptions.insideBoardLM` LM.
   - 🔧 `ADAPTION_HOP_UP` ERECT — `line.adaptions.hopUpLM` LM.
   - `RENDER_ADAPTION` ERECT — if rendered (unchanged).
   - `TF_EXTERNAL` DISMANTLE — `perLift × lifts` LM.
   - **No birdcage. No party-wall line** (⚠️ §7).
   - **Remove** the old generic per-lift `ADAPTION` loop (the pre-call guess).

**C2 · Schema — two new components** (additive enum migration `tf_adaption_components`):
   `ScaffoldComponent += ADAPTION_INSIDE_BOARD, ADAPTION_HOP_UP`. Keep the legacy `ADAPTION`
   value for now (unused; note as deprecated). `TF_EXTERNAL` already exists.

**C3 · `src/lib/pricing/priceProject.ts`** — build system is **project-level**:
   - Add `buildType: string` to the `priceProject` input.
   - `isTimberFrame = input.buildType === "TIMBER_FRAME"` (not `ht.buildType`).
   - Set `engineInput.buildSystem = input.buildType` before `buildTakeoff`.
   - Scenario for TF stays `"TIMBER_FRAME"` (80/20). Traditional unchanged.

**C4 · `src/server/pricing.ts` → `loadProjectPricing`** — select `project.buildType`, pass
   it into `priceProject({ ..., buildType })`. (Already loads everything else.)

**C5 · `src/lib/pricing/matrix.ts` → TF columns/cells rework** (affects the **Excel export**;
   the on-screen pricing table is stage-column based and needs no column change):
   - `timberFrameColumns`: `External Erect · Apex Scaffold · Apex Rails · Inside-Board
     Adaption · Hop-Up Adaption · Render/Cladding Adaption · Dismantle · [2 stage cols] ·
     Erect & Strip Price`. **Remove** the `adaption1..6` per-lift columns + the party-wall
     column.
   - `timberFrameCells`: map `TABLE_LIFT→apexScaffold`, `GABLE_RAILS→apexRails`,
     `ADAPTION_INSIDE_BOARD→insideBoard`, `ADAPTION_HOP_UP→hopUp`, render, `TF_EXTERNAL`
     erect/dismantle.
   - `src/lib/pricing/quoteExcel.ts` (`pricedPlotsByBuildType`, ~line 93): group by the
     **project** build type (one matrix per project now — a project is all-one-system), not
     per-house-type. Thread `project.buildType` into the export route
     (`src/app/quotes/[id]/export/route.ts`) / the quote snapshot.

**C6 · Rates + seed** (placeholders, like everything else until Colin's sheet):
   - 🔧 `prisma/seed.ts` + `scripts/fill-placeholder-rates.mts`: add rate items
     `ADAPTION_INSIDE_BOARD` (LM) and `ADAPTION_HOP_UP` (LM); ensure `TF_EXTERNAL`
     erect/dismantle + `TABLE_LIFT`/`GABLE_RAILS` exist for TF. Drop the old generic
     `ADAPTION` seed rate (or leave, unused).
   - 🔧 `src/components/rates-manager.tsx` `COMPONENT_OPTS`: add "Inside-board adaption
     (TF)" + "Hop-up adaption (TF)"; keep `TF_EXTERNAL`. (`usesLiftLevel` no longer needs
     `ADAPTION` — the new adaptions are single LM totals, base rate only.)

**C7 · Review display** — `src/components/takeoff-editor.tsx` + the review page
   (`src/app/extractions/[id]/…`):
   - Thread the **project `buildType`** into the editor (new prop).
   - Set `buildSystem` on the input before `buildTakeoff` so the shown line is TF-correct
     (TF lifts, no birdcage, the two adaption LMs). For TF, the "Details" panel shows
     adaptions instead of birdcage m².

---

## 4. Schema & migrations (summary)

| Migration | Change | Risk |
|---|---|---|
| `add_project_build_type` | `Project.buildType BuildType @default(TRADITIONAL)` | none (defaulted) |
| `tf_adaption_components` | `ScaffoldComponent += ADAPTION_INSIDE_BOARD, ADAPTION_HOP_UP` | none (additive enum) |

`StageScenario.TIMBER_FRAME` (80/20) and `TF_EXTERNAL` already exist — no migration.

---

## 5. What stays deferred (parity with traditional — not new debt)
- **Access apportionment** (loading bay / Haki / chute across a block) — deferred for both
  build types today; TF is listed the same way in `profilePending` (with the "always Haki"
  note). Not priced yet.
- **Garages** — priced on placeholder quantities today; unchanged. (A TF garage question is
  hypothetical; keep the existing garage path.)
- **Apartment blocks in TF** — out of scope; flag if one appears in a TF project.

---

## 6. Tests (correctness gate — write these with Track B, before wiring)

**`src/lib/takeoff/engine.test.ts`:**
- `computeLiftsTimberFrame`: storeys `2 → 3`, `2.5 → 4`, `3 → 4`; `2 + roomInRoof → 4`.
- Height cross-check vectors (soffit m → lifts): `4.8 → 3`, `6.5 → 4`, `5.5 (2.5) → 4`; a
  tall 2-storey (`5.6`) → **flag** (height says 4, storey says 3).
- `computeAdaptions(20.83, 3, 1)` → `{ insideBoardLM: 66.49, hopUpLM: 45.66, apexLM: 4 }`.
- `buildTakeoff` with `buildSystem: "TIMBER_FRAME"`: birdcage empty; adaptions present;
  party wall 0; a full **Aspen-semi fixture** (walls summing to `perLiftM = 20.83`, apex 1,
  2-storey) reproducing 3 lifts + 66.49 / 45.66.

**`src/lib/pricing/engine.test.ts`:** `priceTimberFrameLine` emits exactly the §1.3 lines,
no birdcage/party-wall, and reconciles subtotal = Σ lines to the penny; unpriced components
surface at £0.

**`src/lib/pricing/matrix.test.ts`:** TF columns = the §C5 set; cells map correctly;
`total = Σ cost columns`.

---

## 7. ⚠️ Confirm with Colin / Laura (build the hook, flag, do not guess)
1. **Party wall on timber frame?** The Aspen semi line has **no** party-wall item — so the
   default is **0 for TF**. Confirm TF has no inside-apex party-wall spec item (or give the
   rule if it does).
2. **Stage split 80 / 20** — confirm, and confirm whether the **adaptions sit inside the
   80% erect** or are billed separately.
3. **Apex = 4 LM** each in the adaption totals — confirm it's a fixed standard (the email
   states it plainly; we'll treat it as a constant).
4. **Hop-up generalises** to "all lifts except the 1st (kicker) + apex" for 3-storey too
   (i.e. lifts 2·3·4 + apex)? (Assumed yes.)
5. **Lift precedence** when the height cross-check diverges from the storey count — storey
   wins, height flags? (Assumed; same as traditional.)
6. **2.5-storey detection** — we treat `storeys = 2.5` or `2 + room-in-roof` as 2.5 (the
   only case with a 1 m lift). Confirm that's how the drawings read.
7. **Access items** (loading bay / Haki / chute) apportionment — still the shared open item
   for both build types (`docs/11 §8`, `docs/15 P8`). Confirm the semi "1 shared" basis when
   we build apportionment.

---

## 8. Docs to sync (with the code, not after)
- **`docs/15 §7`** — rewrite the Timber-Frame section to this real structure (per-lift flat
  external, two named adaptions with the LM formulas, apex scaffold + rails, no birdcage,
  80/20); it was a pre-call guess.
- **`docs/11`** — add a "Timber-frame lift rule + adaptions" block (the storey table, the
  450 + 2 m method, `computeAdaptions`).
- **`src/lib/dev-spec/*`** (the in-app `/docs`) — the `buildType` note currently says TF
  "changes sequence/ties, **not** the LM/lift maths." That's now **wrong** — update it: TF
  changes lifts, drops birdcage, adds adaptions.
- **`src/lib/extract/persist.ts`** (~line 366) — the `buildTypeNote` warning says the same
  wrong thing; update or drop it (build system is project-level now).
- **`PROGRESS.md` / `TODO.md` / `CLAUDE.md`** — note TF support + the retired Construction
  option + the project-level build system.

---

## 9. Build order & correctness checklist
1. **Track B first, in isolation** — the engine's TF lifts + no-birdcage + adaptions, with
   the §6 tests green (66.49 / 45.66, lift counts 3/4/4). This is the take-off correctness
   core; nothing downstream matters if this is wrong.
2. **Track A** — the project-level toggle + retire Construction (small, self-contained).
3. **Track C** — pricing line + matrix + rates + review display, threading `project.buildType`
   end to end; reconcile to the penny.
4. Run `npm run typecheck && npm run lint && npm run test && npm run build` at each track.
5. Rates stay **placeholders** (flagged) until Colin's real timber-frame rate sheet lands;
   then validate the engine reproduces a real TF priced site to the penny (same gate as
   traditional).

*Sources: the 1 Sep "Introduction to Timber Frames" call transcript + Laura's follow-up
email (both in the session record). Cross-refs: `docs/11`, `docs/15 §7`, `ARCHITECTURE.md`.*
