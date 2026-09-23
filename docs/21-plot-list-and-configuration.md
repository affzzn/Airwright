# 21 · Plot list & Configuration — findings, TODOs and the build plan

**What this is.** Two related problems found on 2026-09-23 while tracing how the app
decides a house is detached / semi / end / mid. Both come from the same root shape:
**a fact that varies per PLOT is currently stored once per HOUSE TYPE.**

- **Part A — the plot list.** Parked, not being built now. Documented in full so the
  finding is not lost. **This is the single largest correctness gap in the product.**
- **Part B — configuration from the drawing.** The active work. The configuration IS
  printed on the drawings; we are not reading it.

Read `docs/11` (take-off engine) and `docs/13` (extraction playbook) first.

> Legend: **✅ EVIDENCED** (measured on real packs in `data/`) · **⚠️ OPEN** (needs Colin
> or more data — flag, don't guess) · **🔧** (a code/schema change).

---

# PART A — The plot list (⏸ PARKED)

## A1. The problem

`ensureDefaultPlot` (`src/server/plots.ts:69`) creates **exactly one plot per house
type** when a take-off is confirmed. The pricing matrix is **one row per plot** and the
grand total is the sum over plots — so plot count *is* the quote.

A development with 120 plots across 11 house types therefore prices as **11 plots**
unless a human hand-builds the other 109. Nothing flags it.

## A2. Measured scale ✅ EVIDENCED

Counted from the real packs in `data/` (gitignored client PII):

| Builder | Pack | Where the plot list lives | Real plots | App today |
|---|---|---|---|---|
| Miller | Bromsgrove (Whitford Rd) | `BRO-MATS-01 Materials Schedule` — a table | **120** | 11 |
| Tilia | Hawkesbury | drawing title blocks / filenames | **110** | ~12 |
| Bellway | Green Lane, Chesterton | drawing title blocks (`PLOTS: AS: 27, 50`) | **147** (stated "147 UNITS") | ~8 |

~377 real plots across three packs; the app would produce ~30.

**Tilia was derived from filenames alone** — union of the plot numbers in each
drawing's name, grouped by house type. The result covers **1..110 with ZERO gaps**.
That contiguity is the key result: it means completeness can be *proved arithmetically*,
without a human checking and without trusting a model.

## A3. Why the old extractor was removed, and why that was half-right

Removed in `bfdea41` (2026-08-25) as an **architecture change**, not for bad output:
*"plots now come from server/plots.ts… multi-plot developments are added by hand in
plot-editor."* But a real accuracy concern was recorded separately and never resolved
(`TODO.md:59`, `PROGRESS.md:606`): *"plot configuration often can't be read from a site
plan."*

**Both are true, and the second explains the first.** The old extractor read the
**site plan** — whose text layer is scattered, position-dependent noise:

```
96  W  BC  P  96  E  EV  97  BLOCK PAVING  97 …
```

It was pointed at the *worst* document in the pack. The schedule and the title blocks
are structured text. **Rebuilding it the same way would reproduce the same weakness.**

## A4. The design when we come back to it

**Strategies are per DOCUMENT SHAPE, not per builder.** Run every one that applies and
fuse them; agreement raises confidence, disagreement raises a flag.

| | Shape | Method | Gives |
|---|---|---|---|
| **S1** | Schedule table (Miller) | deterministic text-layer parse **using x/y coordinates**, not whitespace regex | plot, type, handing, render |
| **S2** | Drawing declares its plots (Tilia, Bellway) ← **dominant** | extend existing title-block parsing in `classify.ts` | plot, type, handing |
| **S3** | Block plans (`BLOCK 01 = L255, plots 17–20`) | filename + title block | authoritative block grouping |
| **S4** | Site plan | AI vision, **last resort, always flagged** | plot numbers only |

**S2 needs almost no new machinery** — `classify.ts` already parses title blocks and
`segment.ts` already groups pages by house type. We currently discard the plot refs.

### Reliability comes from the invariants, not the parser
This is how an unseen builder is handled safely. After any strategy runs, check:

- every plot number unique
- the set is contiguous (`1..110`) — gaps **listed**, never swallowed
- parsed row count == detected data-row count (nothing dropped)
- every house type resolves to one in the pack, else a flagged stub
- an independent total, where one exists (Bellway's title block says `147 UNITS`)
- multiple drawings of one house type agree on its plot set

### Where the LLM belongs
**Inducing a recipe once per builder, never transcribing rows.** For a shape S1–S4
don't cover, one call returns *"table on page 2, plot column x 40–90, house type
x 200–320, render = the column headed 'Elevational Treatment' where ≠ 'N/A'"*. Store it
on **`BuilderProfile`** (already exists, already holds learned per-builder rules like
`storeyLiftTemplate` / `ingestProfile`). Then every later pack from that builder is
deterministic and free. The recipe is human-readable, Colin-correctable, and rejected
automatically if it fails the invariants. The universe is ~8–20 builders
(the Take-Offs Bank has 8), so this is tractable.

### Failure floor
Degrade **loudly**. Today's failure is invisible. It should read: *"no plot list found —
this quote covers 11 plots; the pack references ~120"*, with the existing manual path
(`addPlot` with a count, `bulkUpdatePlots`) as the fallback.

## A5. Part A TODOs

- [ ] **Plot-count flag (do this early — it is small and independent).** When a project's
      plot count equals its house-type count, flag *"plot list may not have been built"*.
      Surfaces the gap on every existing project for a few lines of code.
- [ ] S2 — collect plot refs from title blocks (`classify.ts`), union per house type.
      Acceptance test: Tilia Hawkesbury reproduces `1..110`, zero gaps.
- [ ] S1 — schedule table parse by coordinates. Acceptance: Miller Bromsgrove = 120 rows,
      10 rendered.
- [ ] Invariant checker, shared by all strategies; results shown to the human.
- [ ] S3 block plans → `Plot.blockGroup` (**the field exists at `schema.prisma:625` and is
      used nowhere — no migration needed**).
- [ ] `BuilderProfile` recipe induction (LLM) for unknown shapes.
- [ ] Plot review screen — the human-confirm step `TODO.md:59` originally asked for.
- [ ] ⚠️ Ambiguous plot refs: Bellway's `Plots 145` — plot 145, or plots 1, 4, 5? Tilia
      uses commas and is unambiguous. **Parse the title block in preference to the
      filename; flag anything that doesn't parse cleanly. Never guess.**

---

# PART B — Configuration from the drawing (✅ PHASE 2 BUILT 2026-09-23)

> **STATUS.** Phase 2 (`isPartyWall`) + the `other`-face fixes are **built and validated
> against real drawings**. Green: typecheck, lint, **458 tests**, production build.
> Migration `20260923130000_wall_segment_party_wall` applies on the next `db:deploy`.
>
> **Validated live (Opus 4.8) on three Miller house types vs Colin's own take-off bank:**
>
> | Type | Config | Colin LM | ours | Colin bcage | ours | gables |
> |---|---|---|---|---|---|---|
> | Chesterwood | detached | 38.5 | 37.076 (Δ3.7%) | 64 | 62.897 | hipped→0 ✓ |
> | Whitton | semi | 23 | 22.635 (Δ1.6%) | 44.2 | 44.659 | 1 ✓ |
> | Delmont | mid | 9 | 18.88 ❌ | 34.8 | 34.409 | 0 ✓ |
>
> **Two real defects found by this validation and fixed:**
> 1. **The wall legend is invisible to the model.** On Whitton the `300MM THICK PARTY
>    WALL` legend sits ONLY on pages 4–7 — all FOUNDATION sheets, which
>    `classify-rules.ts:68` EXCLUDES. Every floor plan had none. The model therefore
>    read the semi as DETACHED. **Fixed** by reading the legend off the WHOLE document's
>    text layer (`extractWallLegend`) and feeding it as a prompt hint, mirroring
>    `buildDimensionHint` — no extra pages, no extra cost. After the fix the same drawing
>    reads `structure: PAIR_SEMI` with both gables honestly `null`.
> 2. **Wall roles swapped on Delmont.** The model read front/rear = 9.44 and gable =
>    4.567; Colin's bank implies frontage 4.5, depth 9.5 — exactly reversed, which
>    DOUBLES a mid-terrace perimeter. Correcting the roles gives mid 9.134 (Colin 9,
>    Δ1.5%) and semi 20.574 (Colin 20.5, Δ0.4%). **Guarded**: an attached house type is
>    normally narrow and deep, so frontage > gable now raises a flag (it does NOT
>    auto-correct — the drawing is not re-read). Verified firing on the live extraction.
>
> **CROSS-BUILDER VALIDATION (2026-09-23).** The legend format is NOT universal — only
> Miller and Vistry print `NNNMM THICK PARTY WALL`. Bloor, Tilia, Taylor Wimpey and
> Bellway do not. **This does not matter**, because `isPartyWall` is read off the PLAN;
> the legend is only a booster where it exists.
>
> | Builder | Legend? | Where | Type tested | Config derived | LM vs Colin |
> |---|---|---|---|---|---|
> | Miller | ✓ | FOUNDATION (excluded → needs the hint) | Chesterwood / Whitton | detached ✓ / attached ✓ | 3.7% / 1.6% |
> | Bloor | ✗ (boilerplate only) | — | Sorley | **SEMI, correct gable identified, zero flags** | **0.8%** (mid 5.1%) |
> | Tilia | ✗ | — | Benington | **DETACHED, no false positive** | 3.0% |
> | Vistry | ✓ | GF/FF PLANS (model sees it) | — | — | — |
> | Taylor Wimpey / Bellway | ✗ | — | — | — | — |
>
> ⚠️ **False-positive trap, avoided.** Bloor prints boilerplate on EVERY drawing —
> "PARTY WALL INSULATION…", "DENOTES PARTY WALL SPANDREL PANEL STRAPS" — identical on
> Kilburn (**detached**) and Byron (**semi**). A naive "does the text mention a party
> wall" test would call every Bloor house attached. The `NNNMM THICK` legend regex
> correctly matches none of it, so no hint is emitted and the model reads the plan.
> **Do not loosen that regex to a bare phrase match.**

> **THE PARTY WALLS NOW SET THE CONFIGURATION (2026-09-23).** `resolveConfiguration`
> (`structure.ts`) replaces `configFromStructure` at `persist.ts`. Rules:
>
> - **A positive party sighting leads.** 0 → detached · 1 → semi/end · 2 → mid.
> - **The structure form breaks the semi-vs-end tie**, which the party count cannot:
>   one party gable + `TERRACE`/`THREE_BLOCK` → **END_TERRACE**, otherwise SEMI_DETACHED.
>   A terrace therefore gets a REAL answer instead of the old END_TERRACE default.
> - **ASYMMETRIC TRUST — party walls may ADD attachment, never REMOVE it.** Marking a
>   gable `true` is a positive sighting; marking it `false` usually just means "I did not
>   see one", and absence of evidence is not evidence of absence. So "no party gable" +
>   an attached building type hands back to the structure form and flags.
> - The same rule runs in `configurationBasisFrom`, so the review screen can never
>   explain a different answer from the one on the record.
>
> ⚠️ **Why the asymmetry exists — a live regression.** Two runs of the SAME Bloor Sorley
> drawing returned `gable_right = party` and then `both gables = false` (and storeys 2
> then 2.5). The first version of this rule let the second reading override `PAIR_SEMI`
> and wrote **DETACHED** — wrong, on a case the old structure-only path got right. With
> the asymmetry both runs now resolve to SEMI_DETACHED. **The extractor is not
> deterministic on this field; the decision rule must be robust to that.**
>
> Replayed against the real extraction outputs:
>
> | Case | → | basis | certain |
> |---|---|---|---|
> | Sorley run 1 (right = party) | SEMI_DETACHED | party-walls | ✓ |
> | Sorley run 2 (both "no") | SEMI_DETACHED | structure | ✓ |
> | Chesterwood (detached, both "no") | DETACHED | party-walls | ✓ |
> | Whitton (both unknown) | SEMI_DETACHED | structure | ✓ |
> | Delmont (terrace, both party) | MID_TERRACE | party-walls | ✓ |
> | Delmont (terrace, one party, one unknown) | END_TERRACE | structure | ✗ flagged |

> **Known limitation (by design):** on a combined drawing holding several variants the
> model cannot say WHICH gable is the party wall — the drawing does not state it per
> plot. It returns `null`, the engine falls back to the length heuristic and flags it.
> That is Phase 4 / Part A territory, not a bug.



## B1. The headline finding ✅ EVIDENCED

**The configuration is explicitly printed on the drawings.** We are not reading it.

`25. L255_Delmont_Combined Working Drawings.pdf` is 23 pages and contains pages
titled, in the text layer:

```
p1   MID TERRACE
p2   END TERRACE
p8   END TERRACE  ·  GROUND FLOOR PLAN  ·  MID TERRACE
p9   END TERRACE  ·  FIRST FLOOR PLAN   ·  MID TERRACE
p15  END TERRACE  ·  GROUND FLOOR PLAN  ·  FIRST FLOOR PLAN
p23  GROUND FLOOR PLAN · FIRST FLOOR PLAN
```

**Three ground-floor plans in one house type** — one per configuration variant. The
words MID TERRACE / END TERRACE / SEMI are in the text layer, not just the linework.

## B2. The three signals, ranked

### Signal 1 — the explicit variant label (strongest)
The drawing states it. Sources, all seen in real packs:
- **Page title block**: `MID TERRACE`, `END TERRACE` (Miller Delmont)
- **Filename**: `L358_Whitton_Semi Detached Variant_Working Drawings.pdf`;
  `9. 250813 Charford (L356 DT).pdf` (**DT = detached**); `NB - Finstall (L201 DT)`
- **Timber-frame packs** (Stewart Milne / SGP): `Block Plan_356 Semi`,
  `232 Ground Floor Terrace End Wall Variant`, `Kingfisher-GA Plan - Roof Plan - Semi`
  vs `- Detached`

### Signal 2 — the party-wall legend (detached vs attached, binary) ✅ EVIDENCED
A working drawing's WALL LEGEND carries `<NNN>MM THICK PARTY WALL` **only if the house
is attached**. Measured across every Bromsgrove house type:

| House type | party-wall legend | ⇒ | corroboration |
|---|---|---|---|
| Chesterwood | — | detached | — |
| Hampton | — | detached | — |
| Braxton | — | detached | — |
| Cherrywood | — | detached | — |
| Whitton | `300` | attached | filename says *"Semi Detached Variant"* |
| Delmont | `300` / `350` | attached | block plan: terrace of 4 (plots 17–20) |
| Hayton, Taywood | `300` / `350` | attached | |
| Millfield (bungalow) | `300` / `370` | attached | |

Use the **legend entry** (`NNNMM THICK PARTY WALL`), not a keyword count — bare
"party wall" mentions are noisy (Allamont has 4 mentions and no legend entry).

### Signal 3 — party wall per gable (distinguishes semi from mid) — the geometric one
`0` party gables → **DETACHED** · `1` → **SEMI_DETACHED / END_TERRACE** · `2` →
**MID_TERRACE**. This is the only signal that separates semi from mid, and it needs the
plan geometry — i.e. the extractor.

**The prompt already half-knows this.** `prompt.ts:63` tells the model gable walls
"become PARTY WALLS in a semi or terrace", and `prompt.ts:153` has an end-of-terrace
worked example (`328 | 4600 | 215` — external gable one side, party wall the other).
The model distinguishes them **for wall thickness** but never **reports which is which**.

## B3. What this breaks today — two real defects

### 🔧 Defect 1 — the exposed gable is picked by SIZE, not by structure
`engine.ts:341`:
```ts
walls = front + rear + Math.max(gableLeft, gableRight) + other;
```
and the same heuristic in `takeoff-editor.tsx:377`. For a semi/end we keep the **larger**
gable and drop the smaller, *assuming* the party wall is the shorter one. That is a guess
standing in for a fact that is printed on the drawing. On an asymmetric footprint it picks
the wrong wall and the perimeter is wrong.

### 🔧 Defect 2 — one house type is assumed to have one configuration
`Takeoff.configuration` is a single value per house type. Delmont has **three** variants
with **different floor plans**. The engine derives every config from one set of wall
segments by adding/removing whole walls, which is right for the *perimeter*.

✅ **RESOLVED — the birdcage must NOT be config-aware** (checked against Colin's bank,
2026-09-23; an earlier note in this doc claimed the opposite and was wrong).
**104 of 108** house types with more than one config in the bank carry an **identical**
birdcage across all of them; the 4 that differ are duplicate rows from two sheets with
different rounding, not config differences. The cleanest case — `AL22 Shermont`, one
sheet, three configs — reads perimeter `21 / 21 / 9` while the birdcage stays
`36 / 36 / 36`.

The physics agrees: the only difference is a 300 mm party wall in place of a 328 mm
cavity wall, i.e. **28 mm on a ~8.8 m width — 0.32%**, well inside the read tolerance.
Colin measures a house type's internal footprint ONCE and reuses it for every position.
Making the birdcage config-aware would add complexity, add risk, and make our numbers
DIVERGE from the bank we validate against. **Do not do it.** (Delmont's separate MID/END
plans exist for construction detail — wall build-ups — not for the scaffolder's deck area.)

### Counter-evidence worth keeping: adjacency is NOT a config signal ✅ EVIDENCED
An earlier hypothesis — consecutive plots of the same type with mirrored handing
(`As`/`Opp`) form a semi pair — **fails**. Miller plots 10 (`Opp`) + 11 (`As`) are both
Chesterwood, consecutive and mirrored, but Chesterwood's drawing has **zero party walls**
= detached. Handing is mirrored for street appearance, not only for pairing.
**Read config from the drawing, never from plot adjacency.**

## B4. The plan

### Phase 1 — page-level variant detection (deterministic, no AI) 🔧
`classify.ts` already reads every page's title block. Tag each page with a `variant`
(`MID_TERRACE` / `END_TERRACE` / `SEMI` / `DETACHED` / null) from the title text and the
filename. `segment.ts` already groups pages by house type — extend it to **sub-group by
variant**. Acceptance: Delmont's 23 pages resolve to its three variants; Chesterwood to one.

### Phase 2 — `isPartyWall` on every wall segment 🔧 (**highest value**)
Add a per-wall-segment boolean to the extraction schema + prompt: *is this wall a party /
separating wall?* The model already reasons about it for thickness; make it report it.

This single field:
- **fixes Defect 1** — the engine drops the wall that IS the party wall, not the shorter one
- **derives the config** deterministically: count party gables → 0/1/2
- gives the party-wall **count** for the `partyWalls()` spec item, instead of a config lookup
- costs almost nothing — `WallSegment` already exists with `position` and a `sourceDimension`

### Phase 3 — derive + reconcile (Layer 2, pure code)
```
configFromDrawing = f(party gable count)      // 0 → DETACHED, 1 → SEMI/END, 2 → MID
```
Reconcile against Signal 1 (the page's variant label) and Signal 2 (legend present?).
Agreement → high confidence. Disagreement → **flag, never pick silently** — the same
"read two ways → reconcile → flag" doctrine as height-vs-storey and the birdcage wall.

Feed the result into `configFromStructure`'s `{ config, certain, reason }` (added
2026-09-23) so the review screen already displays it correctly with no UI work.

### Phase 4 — configuration per variant 🔧 (schema, bigger)
Let one house type carry several variants, each with its own floor areas, and let a plot
point at a variant. **Do NOT start here** — Phases 1–3 deliver most of the value and this
one needs Colin's answer on the birdcage question in B3 first.

## B5. Part B TODOs

- [ ] **Phase 2 first**: `isPartyWall` per wall segment (schema + prompt + persist).
      Validate on Bromsgrove: Chesterwood 0, Whitton 1, Delmont mid-variant 2.
- [ ] Fix `engine.ts:341` + `takeoff-editor.tsx:377` to drop the **party** gable, falling
      back to the current size heuristic only when `isPartyWall` is unknown (and flagging).
- [ ] Phase 1 variant tagging in `classify.ts` / `segment.ts`.
- [ ] Phase 3 reconcile + flag; wire into `configFromStructure`.
- [x] ~~Colin: mid-terrace birdcage — read from the mid variant's own plan, or scaled?~~ **Answered by his own bank: NEITHER — one birdcage per house type, identical across configs (104/108). Leave it config-blind.**
- [ ] ⚠️ Colin: does a mid-terrace ever carry TWO party-wall spec items? (`engine.ts:472`
      currently returns exactly 1 for every non-detached — his stated rule, but the
      handwritten sheets show semi ×1 *and* ×2, and mid ×2: `docs/11 §8 #5`.)
- [ ] Phase 4 variants (blocked on the birdcage answer).

---

*Evidence: `data/816125 Whitford Road, Bromsgrove…` (Miller, 120 plots),
`data/first-ones-sent/TILIA HAWKESBURY` (110 plots), `data/Colin_pack1` (Bellway, 147
units), `data/timber-frames/…` (Stewart Milne). All gitignored client PII — never commit
or publish. Cross-refs: `docs/11 §4`, `docs/13 §3.10`, `docs/15 §2`.*
