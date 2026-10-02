# PROGRESS.md

Running log. Update this at the END of a session (before running out of context).
New session: "Read CLAUDE.md and PROGRESS.md before we start."

---

## Status: WHOLE PIPELINE BUILT + DEPLOYED ON RENDER. Drawing → extract → editable
## review (provenance-on-hover with page links) → CONFIRM/LOCK → per-plot pricing
## matrix → immutable quote → Excel/print outputs. Runs on PLACEHOLDER rates — Colin's
## rate sheet + the 16 open questions (docs/11 §8) are the one thing gating correct
## pricing. Canonical docs: 11 (take-off), 13 (extraction playbook), 14 (pricing/quote).

Last updated: 2026-10-02

### 2026-10-02 (b) — Construction: three upload boxes, three scenarios, Scenario 1 made simple

Upload is now three boxes — **Scope · Drawings · Email**, all optional (new-job form + step 1,
`enquiry-boxes.tsx`); the box is saved on `ConstructionAttachment.kind` and is the file's label
(no guessing; zip contents inherit it; old files get one from their type, `boxOf`). The
scenario comes from the boxes only (`scenarioFromBoxes`): a scope → **Scenario 1**; drawings and
no scope → **2**; else **3**. Auto-detect and the A/B/C switch removed (`setConstructionMode`
deleted). **Scenario 1** reads ONLY the scope + email (email = extra lines; lines the schedule
already has are not repeated) and uses the client's numbers as given (`scopeOnly.ts`) — no
drawing reads, buildings, cards, cross-checks, information list, confidence or job settings; a
line with no number is blank for Colin. Kept: per-line hire, "2nr" / "1600hrs" / sizes,
`scopeFixes` (two-in-one-row, temporary stairs, the "× 2" note), empty sections, full hire
priced. Scenarios 2 and 3 unchanged (email = reference in 2; nothing read in 3). Evals re-run
for $0: KE 9/9, Wren 11/11 (new Scenario 1 keys), CBAND 11/11, Murray 3/3. 733 tests, lint,
typecheck, build green; the new form + step 1 + items checked in the browser (a real upload
saved each file's box; the test job was deleted). Detail: docs/22 "As built 2026-10-02 b".

### 2026-10-02 (later) — Ben's corrections from the 9 Sep call, applied by code

`scopeFixes.ts` (pure, tested, runs after every scope read — fresh or cached): stair sets /
up-and-over steps → the new "Temporary Stair Set" item, never a Haki; a row asking for two
items ("perimeter access scaffolding AND roof edge protection") → two lines with the row's
measurement; "Allow 1600hrs" → 1600; a length with "× 2" (LV pits) flagged "in total or each?"
(number unchanged). Prompt `SCOPE_PROMPT_VERSION 2026-10-02.1` says the same. **P18**: a scope
job now prices the whole hire the client asks for by default (Ben: 40 weeks asked = 40 weeks
priced); other jobs keep extra hire as terms — still a placeholder for Colin to confirm.
Verified on the National Grid (Stanmore) schedule itself; evals unchanged (KE 13/13, Wren 9/9,
Murray 3/3, CBAND 11/11); 716 tests, lint, typecheck, build green.

### 2026-10-02 — Construction made simple: only reliable numbers, section cards, measuring tool

The automatic reading was doing too much, and too much of it was not reliable. Now a number is
filled in automatically ONLY when it is printed on the drawings and read by code — and, for the
shape-dependent ones, when TWO drawings agree. Everything else is the estimator's: typed, or
measured on the drawing with the new tool. Quotes are built on section cards that match
Airwright's real quotes (Quote-1350 / 1375).

- **Kept automatic** (`model/buildingModel.ts`, rewritten): heights of each part (printed soffit
  / parapet → lifts + band); the external perimeter + corners ONLY for a plain rectangle the roof
  plan or another floor confirms; main gables ONLY when roof plan and elevations agree; printed
  clear heights and room areas as sources to pick from; numbers written on a client mark-up.
  Anything weaker is a HINT (shown, one click to use, never filled). **Removed:** slab / void /
  leading edges, risers, lift entrances, cores / shafts, doors, roof access / edges, pitch,
  internal footprint, colour-mark-up coverage, traced non-rectangular outlines. Readers unchanged
  (saved reads still reused). Settings trimmed to the ones still used (P5, P5b, P10–P14 gone).
- **Trust, explained** (`cards.ts`, `trust-badge.tsx`): Checked (two drawings agree) · Printed
  (one drawing) · Measured by you · Entered by you · Client's figure · Not set. Hover: what it
  means, how it was worked out in plain words, and the sheets it came from (links to the page).
- **Section cards** (`section-cards.tsx`, `constructionCards.ts`, migration
  `20261002120000_construction_section_cards` adds `ConstructionQuoteLine.cardKey`): per building
  External (perimeter, corners → run; height → lifts; gables), Internal (run, clear height,
  lifts), Birdcage (tick printed rooms → area, or measure; clear height; lifts), each with its
  hire weeks; the job's weekly inspections. Every number editable; yours beats the drawings';
  "back to the drawings' value". The cards write their lines and keep them in step; a line
  edited by hand is pinned. Scope jobs keep the scope's lines (cards hold the numbers only).
- **Add-ons — Colin's call** (ticked, never by the AI): Haki, loading bay, ladder tower, table
  lifts + apex handrails (= gables), low-level independent, raised first lift, netting (run ×
  height), brick guards, triple / A-frame handrail, beams over a canopy, rakers, foam, scaffold
  mat, carry time; internal ladder towers. 8 new DEV placeholder items in `library.ts`.
- **Measuring tool** (`measure-dialog.tsx`, `measureGeometry.ts`): click corners on the drawing;
  scale from the title block, or checked / set from a printed dimension (photo-only plans too);
  lines square up; a closed outline gives perimeter + outside corners + area.
- **Scope binding simplified** (`bindScope.ts`): only the reliable numbers fill a line; edges,
  blockwork, risers, cores (unless the scope names one), roof edges/access stay blank. The
  estimator's own measurements feed a re-read.
- **Graded on the real packs** (`construction-eval.mts`, new rule "right or blank"): CBAND 11/11
  (Pavilion perimeter checked by plan + roof plan; Hall perimeter and gables left blank — they
  can't be confirmed), KE 13/13, Wren 9/9, Murray Park 3/3. Measuring tool + cards + add-ons
  clicked through in the browser. 711 tests, typecheck, lint, build green.

### 2026-10-01 — Construction scope mode + output: Milestones 3 + 4 BUILT (docs/22, docs/23)

A client's scope now becomes DRAFT LINES whose quantities come from the drawings, each with its
visible working; a measure-only job turns any measurement into a line with "Use this"; and the
quote prints in Airwright's real lump-sum section layout or fills the client's own schedule.

- **M3 · scope mode.** `scopeTable.ts` reads a spreadsheet scope's STRUCTURE by code (header
  rows, column roles, sections, EMPTY sections, items, total; a duplicate sheet skipped). The
  scope reader (`SCOPE_PROMPT_VERSION 2026-10-01.2`) is given the table row by row and returns a
  `rowRef`; `attachScopeTables` takes section / hire / lifts / quantity / dimensions from the ROW,
  adds back missed rows; counts in the wording ("2nr", "x2") parsed by code; headings must be
  printed (no invented "Email scope"); the scope read is cached on the job (re-runs $0; scope
  files read in a fixed order so the key is stable); output cap 20k + a clear "cut off" error.
  `bindScope.ts` (pure, 28 tests): one rule per item ROLE over the building model (scaffold run,
  boarded lifts "at each level" ⚠P19, guardrail, counts from the scope, slab edge ⚠P12, opening
  edges, lift gates, risers ⚠P13b, named cores / shafts, roof edge, inspections), client number vs
  drawing → AGREES / DIFFERS (drawing kept), leading edge (P14) + blockwork (P5b) blank with an
  unknown basis, a non-closing outline never prices, features not asked for → INFORMATION list,
  empty sections → "confirm none required", every scope line accounted for; a numbered mark-up
  (Wren) pairs each schedule row with ONE mark-up line. `applyDrawingDraft` saves section,
  building, formula, provenance, params, flags, `clientRef`, per-line hire; replace-on-reapply;
  **alias learning restored**.
- **Engine fixes found on real packs.** Several unprinted walls running the same way are solved
  as a TOTAL by closure (KE 1F → 96.036 m, low + flagged); a printed OVERALL chain beats a
  partly-scaled grid (D4) — the grid still beats a misread window chain; opening-edge perimeters
  (printed sizes only); lift shafts and stair cores counted apart; every measurement keyed and
  linked to its source sheets; level names normalised ("01-First Floor" → 1F).
- **M4 · screens + output.** Shared measurement sheet (per building: heights / runs / roof /
  internal / features; source sheets open the drawing at its page; ⚠ codes; **Use this**).
  Scope review panel. Draft review grouped by building × section with formula, status, the
  client's figure, per-line hire. Site facts: "From the drawings" + the **job settings panel**
  (P1–P19, confirm / reset, re-measure for $0). Items grouped by building × section with the
  working on every line + editable hire. Quote: new checks (blank lines, placeholders, empty
  sections) + **three outputs**: SECTIONS (Airwright's Quote-1350 layout, `sections.ts`),
  SCHEDULE (itemised), CLIENT (the client's own workbook filled, `clientTemplateExcel.ts`).
  Pricing uses each line's own hire weeks; ⚠ **P18** decides whether the price covers the whole
  stated hire (default: today's behaviour, terms). Migration `20261001120000_construction_scope_mode`
  (additive, applied).
- **Validated on the real DB, in-process** (`scripts/e2e-scope.mts`, `scripts/construction-eval.mts`):
  **KE 15/15**, **Wren 8/8**, **Murray Park 2/2**, **CBAND 9/11** (Hall gables = P9; a stored Hall
  read that does not close — never priced), Stanmore 37/37 rows accounted. Reads paid this session:
  KE $4.79, Wren $2.33, Murray $0.63, scope reads ≈ $1.5; every re-run since $0. UI clicked through
  locally (pack view, Use this, scope review, settings, items, quote formats, print view).
- **Kept test jobs** (delete when done): KE `cmupoijhb0000it0hlvpqyuiq`, Wren
  `cmupp1gc40000itk5lmba4cfm`, Murray Park `cmuppc12p0000itioepwxide3`, CBAND `cmuo3evr00000itl06aamfkvz`.
- Checks: typecheck, lint, **698 tests** (3 obsolete `scopeOnlyLines` tests removed with the function), production build — all green.

### 2026-09-30 — Construction pack reading: Milestones 1 + 2 BUILT (docs/22, docs/23)

A construction enquiry is now a PACK: drop the whole folder (or a zip), the worker sorts it
into a drawing register, and one button reads every switched-on sheet in the background into
a per-building MEASUREMENT SHEET. Spec: docs/22 (pipeline) + docs/23 (extraction playbook).

- **M1 · no AI.** Dev picking list (34 items, every rate banded + bracketed + hire terms,
  badged "DEV placeholder"; `library.ts`, `restore-seed-library.mts`); `params.ts` (P1–P17
  job settings, placeholders flagged wherever used); rules: lifts = ceil(h ÷ 2.0 m), Haki
  lifts follow the height, 24–30 m band. Migration `construction_pack_reading` (additive:
  `ConstructionBuilding`, `ConstructionSheet`, `ConstructionReadRun`, pack fields on quote /
  attachment / line / measurement). Folder upload (5 at a time, byte progress, retries, batch
  register, resume). `construction-ingest` job: zips unpacked, junk + duplicates, title-block
  register (`pack/titleBlock.ts`), latest revision, buildings by drawing code / folder,
  mode A/B/C. `pack/sheetGeometry.ts`: scale, levels, printed heights, pitch, dimension
  chains, grid (KE A→F 28,910 measured vs 28,903 printed), room areas, spot levels, legend.
  `.pptx` mark-ups redrawn to PDF (shapes + theme colours) with a shape-fact summary.
  Offline runner `scripts/construction-offline.mts` (+ `--ai`).
- **M2 · AI.** `construction-read` job (`src/server/constructionRead.ts`): typed readers per
  sheet kind (`readers/`: plan, elevation, section, roof, mark-up; the Wren numbered mark-up
  keeps the docs/20 reader), plans first then the rest then mark-ups, 3 at a time, reads saved
  per sheet and reused when unchanged (hash + page + per-reader version), run progress + cost.
  `model/outline.ts` (the model names the walls, code measures: printed strings verified,
  grid spacings, closure, one missing wall solved, corners, sides, inset area) and
  `model/buildingModel.ts` (heights → suggested lifts + band, perimeter + scaffold run, roof,
  gables main vs porch, internal footprint, clear heights, cores / risers / openings / lift
  entrances, what a mark-up covers). Status probe `/api/construction/[id]/status` + auto
  refresh. Enquiry step rebuilt as the PACK view (register by building, switches, mode banner,
  read panel, measurement sheet, draft-line review).
- **Two real bugs found and fixed on the way.** (1) Tiling (added 24 Sep) copied pages with
  `embedPage`, which drops PDF ANNOTATIONS — Wren's Bluebeam mark-up (25 annotations) vanished
  from every crop and the docs/20 reader returned nothing. `pack/flattenAnnots.ts` draws
  annotations into the page first; Wren's values are back exactly. (2) On dense A1 plans the
  model's tool call broke (a list serialised as markup text, the rest of the answer lost):
  outlines are now one-line strings and every reader detects a broken call and retries once.
- **Validated on the real packs** (offline + real DB, in-process, cleaned up):
  CBAND Pavilion 20.793 × 8.965 → 59.516 m, 4 corners, 2 lifts, gables 2 main + 1 porch (quote:
  apex ×2), internal lift 1 (quote 1), crash deck = whole interior 168.74 m²; CBAND Hall
  L-shape traced from print (6965 + 1463 on the left) → 62.288 m, 5 + 1 corners, 2 lifts;
  Hall gables flagged (roof 2 vs elevations 3 — the quote says 3; Colin's P9 call). KE levels
  exact, 11.925 m to parapet → 6 lifts, 6–12 m band, parapet 1.85 m → temporary edge; rooms,
  risers, cores, openings, lift entrances. Wren full pipeline → the 9 validated lines.
  Murray Park degrades to flags (no invented numbers). Cost: CBAND ~$4.6, KE ~$4.7 first read.
- **Honest limit:** KE's stepped A1 plan outline is NOT traced reliably (3 prompt revisions);
  the engine refuses or marks it low (floors disagree with each other / the roof plan) — no
  wrong perimeter is shown as trustworthy. Next: read the wall line from the vector geometry.
- **Green:** typecheck, lint, **651 tests**, production build. In-browser click-through still
  needs a logged-in session (a kept CBAND test job exists for it).

### 2026-09-29 — Review "Summary" replaces AI notes + Review flags

- **Summary panel** at the top of the review, collapsed to one line: what the house is,
  built by CODE from the take-off ("Single-storey semi-detached bungalow · one house of a
  pair drawn · party wall on the left") + "N to check". Expanded: the facts line (roof,
  render, chimney, build system), **Check these** (engine flags + uncertain house type +
  low-confidence reads + the AI's assumptions/unclear/unread, with page links) and **From the
  drawing** (spec notes printed on the drawing; legacy notes). The bottom "Review flags"
  list is merged into it. `src/lib/review-summary.ts` (pure, tested).
- **Structured AI notes:** schema `reviewNotes[{kind, text, sourcePage}]` (max 4, <20 words,
  ASSUMPTION / UNCLEAR / UNREAD / SPEC_NOTE); prompt `2026-09-29.3` forbids how-it-was-read
  noise. Old `notes` kept for legacy reads. Millfield re-read: 3 tight notes, incl. the
  model itself flagging "confirm front apex needs a table lift".

### 2026-09-29 — Millfield end-to-end + a clearer review screen

- **End-to-end (local, real pipeline):** Miller Millfield uploaded like the app does →
  processPack (single file → one house type, 8 of 17 pages) → read. The first read (prompt
  `2026-09-29.1`) still called the 11.138 m side the front: the classifier's page set has
  no dimensioned elevations, so "front = front elevation's width" had nothing to check.
  **Prompt `2026-09-29.2`:** find the FRONT DOOR on the ground-floor plan first (its wall is
  the front), the party wall must be perpendicular to it, then read the lengths. Re-read →
  front 5.957, party side 11.138 → **semi 25.05 vs Colin 25**, birdcage 57.44 vs 57.
  ⚠ Apex priced 2 (side gable + a small brick gable over the entrance) vs Colin's 1 —
  open: does Colin count small entrance gables?
- **The deployed Render worker shares the DB + queue:** a re-queued read was taken by it and
  read with the OLD prompt. Local reads of uncommitted code: `scripts/extract-local.mts`
  (the worker handler in-process); end-to-end driver: `scripts/e2e-millfield.mts`.
- **Review screen made unambiguous** (numbers straight from the engine's own working):
  removed the header "measured total" (it summed every wall incl. the party wall); the
  Perimeter row shows "X m per lift", the exact sum under it ("front 5.957 + rear 5.957 +
  gable R 11.138 + 2 corners × 1 m") and "× N lifts = total" on its own line; apexes are
  now two rows — "Apexes on the drawing" (editable, per face) and "Apexes priced" (with
  why any are dropped, e.g. "gable L not priced — party wall"). Engine: `PerimeterResult.parts`,
  `ApexResult.faces`. Fixed a React key warning on the review page (the bank strip element
  handed from the server page) and "1 floors". 582 tests.

### 2026-09-29 — Attached houses: one house vs the whole block (docs/21 §B6)

The question: semis/terraces are sometimes drawn ONE house per sheet and sometimes as the
WHOLE pair with dimensions across both — which walls count, how is the configuration
identified, does the birdcage change with it? **Measured first** (the engine on every
stored attached read vs Colin's bank), which reordered the priorities:

- **The real damage was the perimeter, not the birdcage.** Five bank types (TW Avonsford,
  Eynsford, Harrton; Vistry Jackdaw, Curlew) were ~25% under (mid ~50%): the prompt
  hard-coded "PAIR_SEMI → dwellingsWide 2" and C3 flagged a pair read as 1, so on a sheet
  that draws ONE house of a semi the engine halved a one-house frontage (4.265 → 2.13 m).
  An instruction bug. Miller Millfield + Delmont were ~22% over: front and side swapped
  (roles by length, not by the party wall).
- **The birdcage does not change with the configuration** (Colin's bank: one per house type
  across semi/end/mid). What changes is how one house is cut out of a whole-pair drawing.

**Built:** `resolveFrontage` (per-house frontage < 3 m is impossible → one house, flagged;
the birdcage width + a mirrored pair's `(frontage − 3·wall) ÷ 2` only CROSS-CHECK — never
re-frame, because a whole-pair birdcage looks identical to a correct one-house frontage);
`normalizeWallRoles` (a front/rear read as the party wall → axes renamed; never on shape —
4/73 bank types are genuinely wide); whole-block drawings (`blockDrawn`: gables = the
block's outer ends, config from the building type, `gableBasis: "block-end"` — no more false
"DETACHED"/"longer gable" flags); whole-pair birdcage split (`widthCoversDwellings` +
`partyWallThicknessMm` → SM1 52.03 m², not 109); C3 rewritten; persist stores the applied
divisor + `frontageResolution` / `houseInternalWidth` / `wallRolesSwapped`; the bank snapshot
keeps `isPartyWall`; the review editor greys exactly the engine's dropped wall and shows
"Applied: N"; prompt `2026-09-29.1` (dwellingsWide = what YOUR length spans + frontageReason;
party wall first, front = front-elevation width; walls never a "finished dim"; one-house
frontage to the party-wall centreline; apexes per house; width from the frontage chain);
`/docs` + docs 03/11/13/21/doubts synced. New tool: `scripts/validate-attached.mts`.

**Validated live** (12 attached drawings, both conventions, graded vs the bank): every semi
±1.3%, every mid within Colin's 0.5 m rounding, every birdcage ±3.3% (Dekker 20.56 / 10.66 /
35.60 vs his 20.5 / 10.6 / 35.6; Millfield 25.05 vs 25, was 30.23; Avonsford 19.78 / 7.92
vs 20 / 8, was 15.21 / 4.26). Green: typecheck, lint, tests, build.

### 2026-09-23 — Configuration derivation made honest (the silent DETACHED fallback)

`Takeoff.configuration` (the plot's POSITION — detached / semi / end / mid) is the
highest-leverage single field in the take-off: it swings the perimeter ~50% (Dekker
20.56 semi vs 10.66 mid), the apex count 2→1→0, and the party wall. It is derived from
the model's `structure.form` read at extraction time — but the derivation had two holes.

- **The silent guess.** `structure` carries its own confidence and defaults to
  `{ form: null, confidence: "unknown" }`. The old code did
  `result.structure.form ? MAP[...] : "DETACHED"` — so an unreadable building type
  silently became DETACHED, with **no warning**, and the confidence was never consulted.
  That broke the project's own doctrine ("unreadable → flag, never guess") on the one
  field least able to afford it.
- **A default presented as an answer.** THREE_BLOCK / TERRACE map to END_TERRACE, but
  those blocks contain MID positions too — the map can't know which. It was stored
  identically to a determined read.
- **A duplicated mapping.** The same table was copy-pasted in `persist.ts` and
  `server/plots.ts`, while `structure.ts` exists precisely to stop that drift.

**Fixed:** one `configFromStructure(form, confidence)` in `src/lib/structure.ts` returns
`{ config, certain, reason }`. Only DETACHED and PAIR_SEMI are `certain` (a pair's two
homes are BOTH semis); a three-block/terrace, an unreadable form, or any form read at
low/unknown confidence returns the same safe config but `certain: false` + a reason.
`persist.ts` and `plots.ts` both call it. The extractor now writes
`warnings.configurationBasis` (+ `configurationUncertain` when not certain).

**Surfaced:** the review screen's House type control now has the same provenance hover +
confidence dot as every measured field (`configurationProvenance`), stating whether the
value was *determined* or *defaulted*, recording a human override, and flagging an
uncertain derivation in Review flags. `configurationBasisFrom` resolves the basis (raw
model output → stored warnings → no claim) as a pure, tested function.

**Config VALUES are unchanged** — a regression test pins all five forms to the legacy
map, so nothing reprices. Green: typecheck, lint, **431 tests** (+17), production build.

⚠ **Not fixed — the structural gap.** Configuration is a property of a plot's position
in a block but is stored on the house type, and `ensureDefaultPlot` creates exactly ONE
plot. A terrace of 5 still yields one END_TERRACE plot; the mid plots must be added by
hand. The site-layout/plot-schedule reader that would fill this was removed 2026-08-26.
The flag now makes it visible; it does not make it automatic. See TODO.

### 2026-09-24 — Airwright's REAL rate sheet imported; hire maths corrected (P1–P5)

They sent the picking list, a real client scope of works and an example drawing (`cons-data/`,
gitignored PII). All five planned tracks done in one pass.

- **P1 · The rate sheet is in.** `picking list.xlsm` sheet "Excel Import" is Airwright's whole
  master list, 493 rows, one list for the whole business, with the model encoded in the item
  TITLE: `(A) Con Ind Scaff (6-12m max) M` = current · Construction · family · bracket · band.
  New pure parser `rateSheet.ts` (23 tests) + `scripts/import-rate-sheet.mts` (re-runnable,
  retires rather than deletes). Imported **165 elements / 653 rates**: 32 Construction, 60
  Traditional, 16 Timber frame, 58 General. The 13 placeholder seeds are retired.
  Schema: `BusinessLine` enum, `HeightBracket += H24_30M`, `ConstructionElement.line/sourceTitle`,
  and the hire terms on `ConstructionRate` (migration `construction_real_rate_sheet`).
- **P2 · Extra hire was wrong by ~33x.** The 0.05%-of-job placeholder came from a verbal note;
  the sheet says extra hire is **per unit per week × a band percentage, beyond the hire period
  the RATE already includes** (4 weeks for construction, 12 for TF). `price.ts` rewritten:
  `lineExtraHirePerWeek`, `weeksBeyondBase`, and a result that separates the quoted total from
  what the duration implies. Verified live: 66 m at Competitive = £39.60 a week, where the old
  rule said £1.18. Extra hire stays OUT of the headline total, as Airwright quote it.
- **P3 · Rates → Construction is a matrix.** Items down, brackets across, band switcher,
  business-line switcher, hire terms per row. 33 items x 20 cells was never a flat list.
- **P4 · Scope reader tuned to a real scope of works** (`50172_Scaffold Scope_Rev.1.xlsx`,
  Project Stanmore, 37 rows). New `scopeDimension.ts` (20 tests) parses "20lin.m", "2.4x5.4m",
  "25x20m", "12m (top working platform level)", "20wks". The model now copies those cells
  VERBATIM and the arithmetic happens in tested code. **Hire duration is per line** and is
  carried onto the quote line.
- **P5 · Tiled drawing reading.** Airwright's example drawing is an A3 with no text layer
  (150 dpi raster + 300 dpi stencils), so whole-sheet vision cannot read its dimensions.
  `drawingTiles.ts` (10 tests) crops via pdf-lib MediaBox, sharing one embedded page: every
  tiled sheet reaches ~1.86 px/pt (A1 2.8x better), and the Wren A1 packs into 2.4 MB not
  16.7 MB. Verified a tile carries 98% of the text strings its region should hold.
- **Green:** typecheck, lint, **546 tests** (+76), production build. Driven in the browser
  against the real DB: the matrix shows Airwright's real ladders (Ind Scaff 35.78/42.02/45.13/
  51.38), the picking list resolves per band + bracket, and adding 66 m priced to £2,361.48
  with £39.60/week extra hire and £79.20 for the 2 weeks past base. Test data removed.
- ⚠️ For Colin/Laura: is the `%age to charge` difference between bands deliberate (Competitive
  loading bay 25% vs High 75%)? And which inspection item applies, per week or as a lump?

### 2026-09-24 — The client's scope spreadsheet is READ (a docs correction, not just code)

**User correction: `Wren - Scaffolding Schedule.xlsx` came FROM Stepnell.** Both docs/19 §2
and docs/20 §1.1 had it recorded as Airwright's own answer file, and `looksLikeAnswerFile`
hard-blocked anything matching `/schedule/i` from ever being read. That was wrong: opening
the real file shows items, lift counts, quantities and 7 weeks with the **Rate and Total
Cost columns left blank for us to fill in**. It is the "scope of works (Excel)" enquiry
shape docs/19 §1.2 #2 describes, and docs/20 §17 was still asking for an example of one.

- `looksLikeAnswerFile` → **`looksLikeOurOwnQuote`**, now only our numbered quote output
  (`Quote-1375-1-1.pdf`). A client schedule is read like any other scope document.
- **Uploads default to being read** (`registerConstructionAttachments`): on for anything the
  readers understand (drawing, email, scope/schedule spreadsheet), off for our own quote and
  for what they cannot parse. Dropping the enquiry in is now the whole job.
- The read no longer filters by filename — **the tick is the only decision**; a ticked file
  is always read. The combined scope text is saved to `enquiryText` for the audit trail.
- **Removed the "Scope of works" paste panel** from step 1 as redundant (the user's call):
  the client's scope arrives as a file and is read with everything else.
- New `fileKinds.test.ts` (10 tests) locks the correction in so it cannot regress.
- Verified on the REAL `data/construction/eg-01` files: the schedule flattens to 612 chars
  of items/quantities and the .eml to 2,270 chars of the client's request, both routed to
  the scope reader; and in the browser, 5 of 7 files default to "Reading" with `Quote-1375`
  off and the .pptx marked reference only.
- ⚠️ Noted in passing: the client's schedule says **7 weeks**, while docs/19 §2 records the
  Wren hire as 10. Worth confirming which is right before the example is used as a fixture.

### 2026-09-23 — Construction UI rebuilt as a four-step job workspace (docs/19 §8a)

The construction screens were the weakest part of the product: one builder rendering six
panels at once, the highest-value action ("Read enquiry") hidden as a small secondary
button inside a card header, a cryptic "AI" badge you had to tick first, the enquiry
review (the key human checkpoint) crammed into a modal, site facts with no UI at all, and
a 7-column input table that was unusable on a phone. Rebuilt from mockups the client
approved. **No pricing, rules or engine logic changed.**

- **One job, four steps** (`?step=enquiry|facts|items|quote`), held by a persistent rail
  that is a STATUS display, not a wizard — every step stays reachable, each shows a short
  hint ("4 files, not read", "11 items, 1 unpriced", "2 to clear").
- **Step logic is pure + tested:** `src/lib/construction/jobState.ts` — `factsFromQuote`,
  `jobSteps`, `issueChecks`, `nextAction`, `defaultStep` (22 tests). The jobs list uses
  `nextAction` so every row states what the job is waiting on.
- **Step 1 Enquiry:** files with an explicit **Reading / Not read** control (the AI badge is
  gone), the answer file shown as "Never read", an optional pasted scope, a drawing preview
  beside the list, and the **read panel** — full width, directly under the files it acts on.
  The review of what was read now renders **in the page** (the modal is deleted).
- **Step 2 Site facts:** the panel docs/19 §8 specified and the code never had — job details,
  site-type tiles, height → band readout, hire + extra hire, access points, and a plain list
  of the rules that will apply.
- **Step 3 Items:** lines grouped by category, each showing **the sum behind it**
  (`42.199 m × 3 lifts × £11.50`), unpriced lines flagged inline with a link to the rates,
  and the picking list / measurements / drawing in one tabbed side pane (no modals).
- **Step 4 Quote:** the pre-issue checks as a gate (each links to its fix) plus a live
  preview of the REAL client document — extracted to `construction-quote-document.tsx` and
  shared with the print page, so the preview can never drift from what the client gets.
- **Never blank:** every empty state states the next move. **Responsive:** rail → chip
  scroller, item table → cards, sticky total, and the app header now scrolls instead of
  wrapping on a phone.
- **Removed:** `construction-builder.tsx`, `read-drawings.tsx` (modal),
  `construction-attachments.tsx`. **Added:** `construction-job.tsx`, `steps/*`, `parts.tsx`,
  `upload.ts`, `construction-quote-document.tsx`, `jobState.ts`.
- **Green:** typecheck + lint + **414 tests** (+22) + production build. **Verified in the
  browser against the real DB**: picking-list add (rate resolved £45), inline edit (1 nr ×
  2 lifts × £45 = £90, persisted), site-type change (extra hire recomputed to £6.49/wk),
  confirm → locked + Reopen, create-a-job from the form landing on a guided empty step 1,
  and the phone layout. Test data created for the run was deleted afterwards.
- ⚠ Known loose end (pre-existing, unchanged): `draftConstructionLinesFromScope` /
  `applyConstructionDraftLines` in `actions/constructionDraft.ts` are now unreachable from
  the UI, so the **alias learning on correction** (docs/19 §15) is dormant. Decide whether
  to port it into `applyDrawingDraft` when Laura's terminology list lands.

### 2026-09-23 — House-Type Bank BUILT end-to-end (docs/20) — branch `feat/house-type-bank`

The 8th feature idea, built: turn Laura's personal Excel bank into shared, company-owned
software so repeat house types are reused, not rebuilt. **House-build only** (Traditional
+ Timber-Frame); Construction never touches it. Full spec + build notes in
**`docs/20-house-type-bank.md`**. The load-bearing idea: **identity is GEOMETRY, the name
is only a hint** — so slightly-different names (Denton vs "Denton XYZ") are resolved by
the measurements + a human, and the confirmed alias makes it an exact hit next time.

- **P0 — schema + pure matcher.** Migration `house_type_bank` (purely additive, verified
  no DROP/ALTER on existing tables: enum `BankMatchState`, models `HouseTypeBankEntry` +
  `HouseTypeBankVersion` (frozen JSON snapshot + geometry fingerprint), `HouseType.bankEntryId`
  + `bankMatchState`). Pure lib `src/lib/bank/{snapshot,normalize,match}.ts` (IO-free):
  snapshot mirrors `takeoffInputFromStored` so reuse plugs into the take-off seam and
  pricing is untouched; two-signal match (name/code candidate → geometry verdict
  IDENTICAL/CHANGED/DIFFERENT with a field diff); tolerances flagged provisional (docs/11
  §8 #11). 18 unit tests.
- **P1 — write path.** `saveTakeoffToBank` (src/server/bank.ts) — **automatic on confirm**
  (hooked into `confirmTakeoff`, best-effort so it can never break a confirm),
  **idempotent on the fingerprint** (no dup version on reuse/re-confirm), **learns the
  name/code as an alias**, guards the unique code (code = authoritative identity → always
  attaches).
- **P2 — match + reuse.** Review-screen **Bank strip** (`bank-match-panel.tsx` via new
  `ReviewWorkspace.bankPanel`): shows linked / proposal+diff / new, with link · it's-new ·
  detach. **Skip-read reuse** (decided default): `materializeBankEntry` + `ReuseFromBank`
  on the project page → a confirmed take-off + auto plot in seconds, flagged
  `bankReusedUnverified` ("Verify against drawing" safeguard).
- **P3 — browse.** `/bank` list (grouped by client, build filter, archived toggle) +
  `/bank/[id]` detail (take-off readout, version history w/ per-version diff, where-used) +
  admin (rename, aliases, merge duplicates, archive, make-current). New nav "Bank" tab.
- **Green:** typecheck + lint clean, **373 tests** (+18), production build clean (both
  `/bank` routes). **Verified on the real DB** (throwaway round-trip, asserted + cleaned
  up): new entry → "Denton XYZ" attaches + alias learned + no dup version → moved wall →
  v2 CHANGED → matchTakeoff surfaces it → skip-read reuse materialises take-off+plot+flag
  → timber-frame Denton is a SEPARATE entry. ⚠ P4 (Excel seed of Laura's bank) pending her
  file; change-detection tolerance still an open Colin number.

### 2026-09-17 — Construction estimator BUILT end-to-end (docs/19) — a separate manual path

From the 9 Sep + 16 Sep Colin/Laura/Ben construction calls + the Wren Park example
(`data/construction/eg-01/`). Construction is the OPPOSITE of house-build: **no AI, no
drawing reading, no Google-Earth automation** — Colin measures by hand and builds a quote
off a configurable **picking list** with **per-lift + per-height-bracket** pricing + hire.
Full spec + build plan in **`docs/19-construction-spec.md`** (§14a coverage matrix maps the
9 skeleton points). Completely parallel to Traditional/Timber-Frame — nothing shared, nothing
existing touched.

- **Track A — data model.** Migration `construction_estimator` (purely additive: 6 models +
  3 enums `ConstructionUnit`/`HeightBracket`/`SiteType`; verified no DROP/ALTER on old tables).
  `ConstructionElement` + per-(band,bracket) `ConstructionRate` = the picking list;
  standalone `ConstructionQuote` + `ConstructionMeasurement` (kept separate) +
  `ConstructionQuoteLine` + `ConstructionAttachment` (stored/shown, NEVER parsed). Seeded 13
  elements (`src/lib/construction/library.ts`) with placeholder rates (25.61 / 7.75 / 33 seen
  on the recording).
- **Track B — pure engine (tested first).** `price.ts` (per-lift × per-bracket resolve ladder,
  Σ lines to the penny, extra hire = total × %) + `rules.ts` (Haki=3, height→bracket, mat for
  school/public, foam count, inspections/week, validation). 19 tests reproduce the Wren
  schedule structure + reconciliation.
- **Track C — Rates tab split into 3.** `/rates` is now Traditional · Timber frame ·
  Construction (`rates-tabs.tsx`); Traditional/Timber are filtered views over the house-build
  cards (`RatesManager` `view` prop); Construction = the element-library editor
  (`construction-rates-manager.tsx` + `actions/constructionRates.ts`).
- **Track D/E/F — the `/construction` area.** Workspace list → new-quote form → the 5-panel
  builder (`construction-builder.tsx`: Enquiry review, Measurements, Line builder with
  per-lift duplicates + custom add + rule-suggestion chips, live totals, Attachments upload,
  Assumptions) → print-ready quote + Excel in the Wren schedule layout (`quoteExcel.ts`).
  New nav tab "Construction". Attachments view via a signed-URL route.
- **Green:** typecheck + lint + **333 tests** (+19) + production build clean (all 6
  `/construction*` routes). Verified a full create→price→delete round-trip on the real DB
  (external 42.2 × 3 lifts × £13 @6-12m = £1645.80). ⚠ Rates placeholders until Colin's
  construction rate sheet; open items in docs/19 §13 (extra-hire %, brackets, terminology list).
  In-browser click-through still needs a logged-in session (auth-gated).

### 2026-09-17 — Review screen reordered around the house type — branch `feat/review-page-house-type`

Corrected model (was wrong before): each drawing IS a fixed house type (a semi is a
separate drawing); the type is not a per-plot preview. Plot numbers are QUANTITY (a
pricing-stage field), not a type variation. Nothing on the review page is a separate
"answer" — it's all one take-off.

- **New `Takeoff.configuration` column** (migration `20260917095357_add_takeoff_configuration`,
  additive, `@default(DETACHED)`) + `Takeoff.includePartyWall`. The house-type build form now
  lives on the take-off, set on review, and cascades. `persist.ts` seeds it from the read
  structure on CREATE only (a re-run never overwrites the estimator's choice). `saveTakeoffEdits`
  persists both (validated). `ensureDefaultPlot` — new plots INHERIT the take-off's configuration +
  includePartyWall (a legacy row falls back to the structure-derived default).
- **`takeoff-editor.tsx` rebuilt to the agreed order:** AI notes first → a single **House type**
  selector (Detached / Semi / End / Mid; hidden → "whole building" for apartments) → **one unified
  take-off list** (measured + computed interleaved, each with the same provenance hover) → "Also
  read from the drawing" (roof / room-in-roof / rendered / chimney). The old 3-config preview
  dropdown and the separate "Computed take-off" box are gone.
- **Cascade is visible:** picking Semi/End greys the shared gable ("shared — not scaffolded") and
  drops it from the perimeter; Mid greys both. The **Building/Structure dropdown was removed** and
  replaced by a small "Front/rear measurement covers N house(s)" helper (= dwellingsWide) that
  only shows for attached types. **Party wall is its own line item** (£165 unit, include/remove
  toggle, "— none (detached)"), never grouped with apex.
- **Timber frame** kept its distinct rows (adaption lifts, LM adaptions + apex units, explicit
  "no birdcage", access note) but now follows the same top-down order; no birdcage/party-wall rows.
- **Docs tab (dev-spec) synced:** fixed a real bug (party-wall mid-terrace said 2 → now 1),
  reframed the Configuration glossary (house-type-level, not plot-level), and the pipeline
  "Take-off"/"Confirm" stages. New provenance builders `partyWallProvenance` + `birdcageTotalProvenance`.
- **Green:** typecheck + lint clean, **313 tests** (+3 provenance), production build clean. Migration
  applied to the DB. Not yet driven in-browser here (auth-gated).

### 2026-09-03 — Timber-frame support (project-level build type) — branch `feat/timber-frame`

Full plan: **`docs/18-timber-frame-implementation-plan.md`** (from the 1 Sep Colin/Laura
"Introduction to Timber Frames" call + Laura's email). Build system is now a **project-level**
choice; **Construction retired** from the new-tender form (enum/dead code left in place).

- **Track A — UI/model.** New `Project.buildType` (migration `add_timber_frame_support`,
  default TRADITIONAL). The "Estimating mode" dropdown → **Build type: Traditional / Timber
  frame**; `createProject` always writes `HOUSE_BUILD` + the chosen build type; the project
  page + tenders list show the build type.
- **Track B — the take-off engine (correctness core).** `buildTakeoff` is now
  build-system-aware: **timber-frame lifts** (`computeLiftsTimberFrame` — storey table 2→3,
  2.5→4, 3→4, with the 450 mm + 2 m height method as a flagged cross-check), **no birdcage**,
  and **two LM adaptions** (`computeAdaptions` — inside-board = all lifts + apex×4; hop-up =
  lifts−1 + apex×4). Validated to **Laura's Aspen semi: 66.49 / 45.66 LM** and the lift table.
- **Track C — pricing + matrix + rates + display.** `priceTimberFrameLine` reworked to the
  real line (flat per-lift external, apex scaffold + apex rails, the two LM adaptions, render,
  dismantle — **no birdcage, no party wall**, 80/20 split). `buildType` threaded project-level
  through `priceProject` / `loadProjectPricing` / `quoteExcel`. Matrix TF columns/cells reworked;
  two new components `ADAPTION_INSIDE_BOARD` / `ADAPTION_HOP_UP` (+ seed / fill-placeholder /
  rates screen). Review editor shows the TF line (no birdcage, adaptions).
- **Green:** typecheck + lint + build clean, **288 tests** (engine TF + matrix TF + priceProject
  TF). Docs synced (15 §7, dev-spec, persist note). ⚠️ Rates are placeholders; the docs/18 §7
  Colin questions (party wall, 80/20 placement, real rate sheet) remain open. Migration applies
  on the next `db:deploy`.

### 2026-09-01 — birdcage internal↔overall role reconciliation (dimension double-strip fix)

The model sometimes filed an INTERNAL span into the `overall` field, so the engine stripped
walls off an already-internal number and the birdcage came out too small (Tilia Thurlwood:
`327 | 8111 | 327 = 8765` — read 8111 as overall → `8111 − 654` → wrong; should read 8111
directly). Same family as the pair-scope issues (model mis-identifies a number's role).

- **Two layers.** (1) **Prompt `2026-09-01.1`** teaches `internal + 2·wall = overall` — the
  middle of `[wall|span|wall]` is ALREADY internal, never strip it; the overall is the
  outermost/largest. (2) **Deterministic guard** (`reconcileRectRoles` in `dimensions.ts`,
  run in `persist.ts`): reconciles internal↔overall against the printed dimension tokens
  (`makeTokenMatcher`) — if `overall + 2·wall` IS printed but `overall − 2·wall` is NOT, the
  "overall" is really the internal → auto-corrected (+ reverse). Two-sided so a genuine
  overall/internal is untouched. Flagged in `warnings.birdcageRoleReclassified`.
- **Validated live** (Thurlwood): the model now reads `internalWidth 8.111` directly →
  footprint **45.714 m²** ✓ (was double-stripped). +6 dimension tests, 251 total green,
  typecheck + lint + build clean.
- **Surfaced a SEPARATE issue** (parked in `docs/doubts.md`): the model also read the
  whole-house GIA total (91.42, both floors) as the per-floor stated area → "stated wins"
  kept 91.42 and flagged the 50% divergence vs the correct footprint. A stated-area *scope*
  bug (per-floor vs whole-house total), distinct from the dimension fix — not yet actioned.

### 2026-08-25 (d) — UI/UX pass: warm paper palette, nav underline, one-scroll review

A design refresh inside the strict monochrome / light-mode system. **No feature
logic touched — 168 tests green, typecheck + lint clean.** UNCOMMITTED.

- **Warm off-white ground (tokens).** Split the double-duty `--canvas`: new
  **`--page` #f7f6f3** is the page ground (body / shell / login); `--canvas`
  stays pure white for cards / inputs / modals / badges, so cards now LIFT off
  the warm page instead of sinking. Ink + surface + hairline ramp nudged warm.
  `page` added to Tailwind. Verified on login (only ~4 ground spots changed; all
  30 `bg-canvas` surface usages untouched → nothing else moved).
- **Active-nav underline.** Header extracted to a client `app-header.tsx`
  (`usePathname`, hydration-safe) — the live section gets a flush 2px ink
  underline; `/rates` now highlights correctly. `signOut` still works as the
  form action. Quote "Summary by house type" got its missing count.
- **Review screen — one scroll, not two.** `AppShell variant="workspace"`
  (opt-in; every other page byte-identical): desktop main = `100vh − header`,
  no page scroll. `ReviewWorkspace` rewritten to a slim toolbar (back · title ·
  status chip) + two panes: **drawing fixed** (new PDF viewer `fit="contain"` —
  render width from pane height × page aspect, no inner scrollbar) and
  **take-off pane the only scroll** (`TakeoffEditor` card fills height, body
  `overflow-y-auto`, confirm bar pinned at top). Flags + AI notes moved into the
  take-off pane. Below `lg` → stacks + page-scrolls (mobile unaffected).
- **Tooltip fix (the risk).** `Provenance` tooltip now **portals to `<body>`**
  with fixed positioning (was `absolute`) so the scrolling take-off pane can't
  clip it; repositions on scroll/resize, closes on outside-click/Esc. `mounted`
  guard → no hydration mismatch.
- Docs/07 re-synced (the `--page` token + the one-scroll workspace pattern).
- **Still to eyeball (needs a logged-in session):** the review click-through —
  scroll the take-off, a provenance tooltip near the pane's top AND bottom edge,
  the lightbox, confirm/reopen, a mobile width, and the nav underline.

### 2026-08-25 (c) — segmentation by NAME (fix: one combined file was splitting into phantom house types)

A single "Combined Working Drawings" file was producing 2+ house types (Chesterwood
×2: pages 13-14 mis-parsed code 1337 vs 1377; Hampton ×2: section/plan/elevation pages
carried no portfolio code → a code-less phantom). Cause: `segmentByHouseType` keyed on
CODE first, so a misread digit or a code-less page peeled pages into a separate group.

- **Fix (`segment.ts`):** group by house-type **NAME** (the reliable identity). 1 distinct
  name → ONE group with all relevant pages (absorbs misread-code + code-less pages, code =
  majority vote); ≥2 names → group by name with code-less pages attached by code-match;
  0 names → legacy code grouping. Verified on the real files — Chesterwood & Hampton now
  1 house type each. 8 segment tests (+4), full suite 168 green, typecheck + lint clean.
- **Not the model/extraction** — this is the free text-layer classifier + grouping, before
  any AI call. Unrelated to the plot-list removal.
- ⚠ **Existing DB rows already split** — the fix prevents FUTURE splits; re-ingest the pack
  (or run `scripts/merge-duplicate-house-types.mts`) to collapse the duplicates already there.

### 2026-08-25 (b) — birdcage: internal-first, per-side walls, internal-vs-derived cross-check

Follow-up to the ladder below, after Charford read an overall and halved it while
its sibling Denton read the internal directly. Prompt `2026-08-25.3`.

- **Internal dims are priority #1** — prompt hardened so the model reads the printed
  internal span (the `[wall|span|wall]` middle number) and does NOT derive when it's
  there. Validated on **Millfield: 57.447 m² [high] vs Colin bank 57 (+0.8%)** — read
  internal 10.483 × 5.48 directly.
- **Per-side walls, never `2×wall`** — schema adds `wallWidthLeftMm/RightMm` +
  `wallDepthFrontMm/RearMm` (the two ends can differ: party wall vs gable, render vs
  brick); `wallThicknessMm` kept as the uniform convenience. `birdcage.ts`
  `resolveAxisWalls` subtracts each side; one side only → assume symmetric + flag.
- **Internal-vs-derived cross-check** — the `overall − walls` derivation is computed
  even when the internal is read, as an independent corroboration: internal ≈ derived
  within **5%** (single-dwelling only, to dodge the pair-division ambiguity) → HIGH;
  diverge → keep internal, flag. Millfield: internal 57.447 ✓ vs derived 55.565 (Δ3.3%).
- **164 tests green** (+4: asymmetric walls, one-side-symmetric, corroborated→high,
  diverge→low), typecheck + lint clean. Provenance/persist carry the cross-check +
  `assumedSymmetric`. Docs 13 §3.10 updated. Still open: pair-division, tolerances.

### 2026-08-25 — birdcage wall-thickness ladder (structural face, no default)

Reworked how the birdcage internal footprint is derived, after auditing real
drawings (Whitford Road + colin-data). Empirical finding: the wall thickness is
**printed on ~17/18 house types** and is **different on every drawing** (Miller
plan 328 / legend 353, NSS 302, Augusta 392) — the old `DEFAULT_WALL_MM = 302`
was only ever "right" by coincidence.

- **Decision (Colin to confirm at sign-off):** the birdcage is measured to the
  **structural / blockwork** face — the short wall zone printed on the plan's
  dimension chain (328), not the finished-face WALL LEGEND value (353).
- **New per-axis ladder** (`birdcage.ts`, `computeRect`): printed **internal span**
  wins → else `overall − 2·wallThicknessMm` (structural, plan) → else
  `overall − 2·legendWallThicknessMm` (finished, **flagged**, capped) → else
  **UNRESOLVED** (`m2 = null`, flagged for a human). **`DEFAULT_WALL_MM` removed** —
  nothing is guessed.
- **Schema** (`schema.ts` `birdcageRect`): split the wall field into
  `wallThicknessMm` (structural/plan, preferred) + new `legendWallThicknessMm`
  (finished/legend, fallback). Zod-only — **no Prisma migration**.
- **Prompt** (`prompt.ts` → `PROMPT_VERSION 2026-08-25.2`): teaches the model to
  identify each mark — outermost = overall; `[wall | span | wall]` inner line →
  middle = internal, ends = structural wall; WALL LEGEND = finished fallback;
  ignore the partition subdivision chain. Two worked examples (Whitton 328 /
  Dekker 302) so it sees the wall value change per drawing.
- **Provenance** shows the basis + the structural-face note; the finished-face
  fallback is flagged "confirm". `persist.ts` trail carries `usedLegendWall`.
- **Docs re-synced:** docs/13 §3.10 + §6, docs/11 §8 #3 (resolved) + field table +
  C11, docs/03 glossary, docs/15 §2, CLAUDE.md.
- **Tests:** `birdcage.test.ts` rewritten to the ladder (16 tests: internal-wins,
  structural-derive, legend-fallback+flag, **no-wall → unresolved**, pair divide,
  reconcile, NDSS band). **Full suite 160 green, typecheck clean.**
- **Still open:** the reconciliation **tolerance** (Colin sign-off); the **pair
  party-wall** division subtlety (middle wall not stripped) — noted, not changed.

### 2026-08-20 — deployed to Render; pricing + quote pipeline (Phases 0–5); UX + docs

**New canonical docs — read these:** `docs/13-extraction-playbook.md` (single source
the prompt is generated from), `docs/14-pricing-and-quote.md` (the priced side),
`docs/03-domain-glossary.md` (rebuilt from the call). Docs 09/10 were pre-call drafts,
now DELETED (superseded by 11 + the call checklist docx in `docs/`).

- **DEPLOYED to Render.** Web + worker, both Starter, Frankfurt, Node **22**. Repo
  `github.com/affzzn/Airwright` (private); push to `main` auto-deploys; web
  `preDeployCommand` runs `db:deploy`. **Key bug fixed:** `@supabase/supabase-js` needs
  the global WebSocket → Node 20 broke Storage reads in the worker (`render.yaml` was
  pinned to 20). Bumped to 22. Still TODO in Supabase: create Colin's login + set the
  redirect URLs (app runs without, but no sign-in).
- **Extraction knowledge base + prompt sync (accuracy).** Rebuilt the glossary; wrote the
  extraction playbook (`docs/13`); synced `prompt.ts` + `schema.ts` to it
  (`PROMPT_VERSION 2026-08-20.3`). Enrichments: sheet guide (where each value lives),
  read-AND-derive-then-reconcile doctrine, birdcage prefer-gross-internal + derive
  cross-check, explicit reading order, richer gable/apex/hipped + external-corner rules.
- **Provenance page links.** Extraction now returns `sourcePage` (1-based page WITHIN the
  attached PDF) for every read/derived value; the review screen links straight to that
  page (exact, not fuzzy sheet-title matching). Applies to NEW extractions.
- **Classifier fix:** "Setting Out Plan" sheets are now relevant (they carry the true
  gross-internal GIA, e.g. Dekker 35.60) — with a civils guard + tests.
- **Editable review + confirm/lock.** The review screen edits every measurement/wall/
  toggle inline (auto-save, audit-logged, provenance-on-hover). **Confirm take-off** locks
  it read-only (records who/when); **Re-open to edit** unlocks. Nothing is priced off an
  unconfirmed take-off. Sticky drawing + page-thumbnail strip; notes/flags beside it.
- **Tenders home redesigned** into a workspace: stat strip (Tenders / In progress /
  Awaiting review), search + status filters, per-row **archive + delete** (delete verified
  safe against the FK cascade), quiet monochrome status chips. Clears test junk self-serve.
- **Per-file reading progress bars** on the queue (time-based ETA vs median latency,
  asymptotic; new `Extraction.processingStartedAt`).
- **Pricing + quote pipeline (Phases 0–5) — full detail in `docs/14`:**
  - Data model: `BuilderProfile`, `ClientMatrixTemplate`, `StageSplit.scenario`
    (STANDARD/BUNGALOW/NO_BIRDCAGE). Seed adds confirmed splits + a placeholder profile.
  - **Rate-card screen** (`/rates`): versioned/effective-dated cards, inline-edit rates
    (£ per component×action×band), stage-split % per scenario.
  - **Pricing engine** (`src/lib/pricing/engine.ts`, pure, tested): quantity × rate per
    operation, integer pence, reconciles to the penny; keeps true item cost vs presented
    stage split separate; flags unpriced components.
  - **Per-plot development pricing** (`priceProject.ts`) + matrix (`/projects/[id]/pricing`);
    **priced per plot at quote time** with the plot's own config/render.
  - **Immutable quote** (`generateQuote`) → `/quotes/[id]` (print-ready client quotation) +
    **Excel export** (ExcelJS, sanitised).
  - ⚠ Rates + the operation→component mapping are PLACEHOLDERS (flagged in code). Not yet
    applied: shared-item apportionment, garages, construction mode, builder-profile extras.
    **Client-specific matrix template = a LATER TODO** (fixed Airwright Excel matrix works now).
- **All committed + pushed to `main`.** Build/typecheck/lint green; 100 tests.

### 2026-08-12 → 08-19 — Colin call digested, extractor v2 + engine built & validated, app hardened

**Read `docs/11-takeoff-engine-spec.md` FIRST — it is the canonical build spec**
(merges the 13 Aug Colin/Laura call, the build checklist docx, and Colin's handwritten
take-off sheets). The pre-call drafts (docs 09/10) were deleted as superseded; the
live prompt/contract/rules are `src/lib/extract/prompt.ts` + `schema.ts` +
`src/lib/takeoff/engine.ts`.

- **Colin call (13 Aug) + coverage checklist digested.** Key confirmations: lifts =
  ceil(height/1.5) round-up +1 for room-in-roof; storey templates (garage/bung 2,
  2-st 4, 2.5-st 5, 3-st 6); render = separate work type in 2m lifts; birdcage =
  INTERNAL area per floor (2.5-st = 3 floors); apex counted per elevation, hipped = 0;
  specs are per-HOUSEBUILDER (~20 builder profiles); +1m/corner (quantum ⚠ open).
  **16 open questions must NOT be guessed** — full table with owners in docs/11 §8.
- **Colin's data received** (`colin-data/`, gitignored): 3 handwritten take-off sheets
  (~20 house-type lines, fully transcribed in chat/docs) + 4 matched drawings
  (Rosewood, Dekker, Augusta, Tyard) = golden input↔answer pairs.
- **Extractor v2 wired in** (`prompt.ts` v2026-08-19.2 + `schema.ts`): per-elevation
  apex/render, internal floorAreas (prefers stated GIA), roomInRoof, structure
  (SINGLE / PAIR_OR_TERRACE / APARTMENT_BLOCK), dwellingsWide (model reports the
  printed pair frontage; the ENGINE halves it), chimney (drawn-only), smart-roof peak,
  corners. Model claude-opus-4-8, ~$0.7–1.7/house type. Migration `add_birdcage_sf`.
- **Deterministic take-off engine built** (`src/lib/takeoff/engine.ts` + `fromStored.ts`,
  pure, unit-tested): lifts (storey template wins on whole-storey disagreement, height
  on half-storeys, always flagged), perimeter by config (det 4 sides / semi 3 / mid 2)
  + corner allowance param, birdcage, render lifts, config-aware apex, party walls,
  apartment whole-block mode. Emits Colin's take-off line; shown on review screen per
  config. **Validated on real drawings via `scripts/offline-extract.mts`:** Dekker semi
  20.56 / mid 10.66 (Colin: 20.5 / 10.6), Rosewood 48.5 EXACT, Tyard 27.5 (28.5),
  Augusta apartment = right structure + 6 lifts but 3 flagged Colin questions.
- **Classifier fix (big):** Bloor/NSS-format drawings (Dekker etc.) classified as
  UNCERTAIN and never queued — title parser only knew Miller/Travis Baker. Added
  `classifyByText` fallback (drawing-type labels, internal-elevation + civils
  exclusions, drawing types win over incidental plot refs). All 4 colin-data +
  Miller Cherrywood now classify + extract correctly, live through the app.
- **App bugs found by driving the UI, all fixed & verified live:**
  1. *Frozen page / manual-refresh bug*: 2s `router.refresh()` poll vs ~3.2s render →
     refreshes aborted each other. Now: cheap `/api/projects/[id]/pack-status` probe,
     refresh only on state change, debounced, idle backoff.
  2. *Slow renders*: 13 SQL round-trips → Prisma `relationJoins` +
     `relationLoadStrategy: "join"` → ~700ms (floor = EU network RTT).
  3. *ZIP >50MB always failed*: bucket limit was 50MB (separate from the project
     global the user raised). Bucket now 250MB; >50MB verified working.
  4. *Nested zips silently dropped*: recursive unzip (`src/lib/zip.ts`, 3 levels,
     skipped files reported, tested). Oadby-shaped zip-of-zips now ingests fully.
  5. *No retry for FAILED extractions*: errorMessage now shown + Retry button
     (`actions/extractions.ts`); worker **reuses stored rawOutput** on retry (no
     re-billing — verified $0). Ingestion idempotent (deterministic paths).
  6. *Signed URL expiry*: review-page PDF URL now 4h (lightbox re-fetches it).
- **Earlier in the window:** real per-file upload progress bars (XHR); PDF viewer
  zoom/pan lightbox showing ONLY relevant pages; `data/` decoded (Oadby/Bloor golden
  set incl. real client quote Quote-1314; Wetherspoon pub = construction mode;
  155MB zip); docs 09/10/11 written (09/10 later deleted as superseded by 11).
- **76 tests green, build clean.** Test user `tester@airwright.test` + several
  "test"/"Live test" projects exist in the DB (deletable).
- **⚠ Everything is uncommitted on `main`** — branch + commit is the first bit of
  housekeeping for next session. `data/` + `colin-data/` are gitignored (PII).

### 2026-08-11 — client demo + Colin's data arrived (Week 3 unblocked)

- **Client progress-demo prepared** (talking points, slide outline, click-by-click demo
  flow). App health-checked green (typecheck/lint/38 tests/build/boot). Demo tips: run the
  worker, use a FRESH project, upload LOOSE files (not the 152MB zip — 50MB/file cap).
- **Running-cost estimate for the contract**: ~$10/pack LLM on Opus (~5× less on Sonnet),
  hosting ~$40/mo (Render web+worker + Supabase Pro) → **~£250/mo safe ceiling at 20 packs/mo**.
  We log real `costUsd` per extraction, so confirm from real runs.
- **Colin sent real data** (in `~/Downloads`, not committed): ~31 elevation PDFs + 3 pricing
  matrices. Fully decoded — see **`docs/08-colin-data.md`**. Highlights:
  - **Percentage splits CONFIRMED** (from the matrix header, reconciles to a real plot):
    Plot Erect **50%** / Birdcage **25%** / Dismantle **25%**; bungalow 65/10/25; no-bcage 75/…
    → one of the two "must-not-guess" rules is now in hand.
  - **Storey→lifts templates**: 1→2, 2→3 (Barratt) or 4 (Standard), 2.5/3→5/6, 4→8 (+ render/
    hipped/no-birdcage variants). Builder-specific.
  - Matrices are a **golden set** (~140 priced plots; one is Miller Whitford Road = same site
    as a pack we already have drawings for → matched input↔answer pair).
  - **New structural insight**: this builder splits elevations into **separate files per face**
    (Front/Rear/Side/Gable) per house type — NOT one combined PDF. Tool must group them by type.
  - **Classifier gap found**: "Kitchen Elevation" / "Cloak Plan Elevation" (internal) get treated
    as scaffolding elevations — needs an exclusion (same class of bug as "Long Sections").
- **Still needed from Colin**: his raw **take-off sheet** (LM/m² quantities per plot) and his
  **rate sheet** (£/m per component per band); confirm the exact **height→lifts** cut-off.

### (prior) Status

### 2026-08-04 session — real-pack hardening + fixes + UI

Tested on the actual 48-file Whitford Road pack (Miller + Travis Baker consultants).
Found and fixed real bugs; verified classification against the true files.

- **File-level relevance shipped**: generalised title extraction (Miller portfolio line
  FIRST, then consultant `TITLE … STATUS` anchor, then letter-spaced fallback; rejects
  label noise like "DRAWN BY"). Each FILE is categorised — House drawings / Site layout /
  Spec / Not used / **Uncertain** / Unreadable — and only relevant files are sent to the
  AI. Filename pre-filter skips clear junk (bar schedules, levels, drainage, materials,
  standard details, long-sections…). UI shows "Using N of M files", per-file category
  chips, and a **Use/Exclude** manual override (`categorise.ts`, `documents.ts` action).
- **Fixed a regression I introduced**: the TITLE-anchor was grabbing "DRAWN BY" on Miller
  sheets → Chesterwood + all Combined Working Drawings showed 0 relevant. Reordered so
  the Miller portfolio line wins. Verified: Chesterwood 7/27, Hampton 8/23, Cherrywood
  13/28, Allamont 12/24 → all HOUSE_TYPE_DRAWINGS.
- **Fixed false positive**: "Long Sections" (civils) matched SECTION → became a house
  type. Now a house type requires an ELEVATION or FLOOR PLAN (not a lone section); civils
  long-sections / signing-and-lining excluded.
- **Image-only drawings** with no text titles (e.g. "NB - Delamont (AL21)") → **UNCERTAIN**
  (flagged for review + "Use file"), not silently hidden.
- **Fixed the connection-pool crash**: denormalised `Document.relevantPages` (kills the
  heavy per-page query the project page ran every 2s), added connection_limit/pool_timeout
  to the pooled URL (`db.ts`), and the worker now runs jobs **one at a time** (batchSize 1)
  so it can't fan out dozens of concurrent Claude calls + DB txns.
- **Live pipeline progress stepper** (Uploaded → Unpacking → Classifying → Reading → Done),
  driven by real DB state (`pack-progress.ts`), + skeleton loading states.
- **UI**: nav tabs for the three features (Quote & Take-off active; Gang Pay & Viability
  and House-Type Bank as non-clickable placeholders). Removed dev metadata (model/latency
  badge) and week/phase wording from the review screen. Monochrome throughout.
- **Migrations**: `document_file_relevance`, `uncertain_and_relevant_pages`. 38 tests pass.
- **Running-cost estimate** (for the contract): ~$10/pack LLM on Opus (~5× less on Sonnet),
  hosting ~$40/mo (Render web+worker + Supabase Pro). ~£250/mo safe ceiling at 20 packs/mo.
  We log real `costUsd` per extraction, so confirm from real runs.

### Known issues / next

- **Stale data**: earlier test projects hold pre-fix classifications; for a clean demo,
  create a NEW project and upload the LOOSE files (not the 152MB zip — Supabase free tier
  caps uploads at 50MB per file; individual PDFs are fine).
- No "Delete project" button yet (offered; user hasn't taken it).
- Deploy to Render still pending (two-service $7/mo path in `render.yaml`).

---

## (Earlier) Status: Week 1 DONE (verified on a real pack). Week 2 DONE.

Last updated: 2026-08-02

### Week 1 — Foundation & first drawing intake (verified end to end)

- **Repo + toolchain**: Next.js 15, TS, Tailwind (monochrome), Manrope, Prisma, Vitest,
  ESLint, GitHub Actions CI, `render.yaml`. Build / typecheck / test / lint all green.
- **Schema v1** migrated to Supabase (EU): the full staged-operation model. Seed adds a
  demo client + placeholder rate card.
- **Auth**: email + password (Supabase). "Confirm email" turned OFF in Supabase for dev.
  Middleware gates the whole app.
- **Storage**: private `tender-packs` bucket (`npm run setup:bucket`). Files served
  through short-lived signed URLs.
- **Upload → extraction pipeline**: upload → Storage + Document row → pg-boss job →
  worker → `extractDrawing()` (Claude tool-use, prompt caching) → Zod-validated →
  Extraction stored with model / latency / tokens / **cost in $**.
- **Relevant-pages-only** (pulled forward from Week 2): `classify.ts` reads the PDF text
  layer's title block and sends Claude only elevations / floor plans / section. On the
  sample Chesterwood pack: 7 of 27 pages → ~74% fewer pages/cost. Falls back to first-N
  pages when a PDF is scanned/raster (no text layer).
- **Review screen (read-only)**: PDF.js drawing beside extracted fields; per-field
  **confidence as a subtle dot + hover tooltip** (no colour); wall segments → perimeter;
  concise AI notes; live auto-refresh Queued → Reading → Ready.
- **Verified**: a real 27-page tender pack (`L464_Chesterwood`) runs through end to end;
  classifier selects the correct 7 pages; extraction completes and shows in Review.

### Week 2 — Full tender packs & sheet classification (built, unit-tested)

All six items from the plan are done:

1. **Multi-file / large-file upload** — direct-to-Storage uploads via signed URLs (the
   browser uploads straight to Supabase, no server body-size limit) + **ZIP support**
   (unzipped in the worker with `fflate`). `upload-form.tsx`, `actions/upload.ts`.
2. **Per-sheet classification, persisted** — `classify.ts` reads each page's title-block
   text and tags it ELEVATION / FLOOR_PLAN / SECTION / PLOT_LAYOUT / SPEC / OTHER, stored
   as `DocumentPage` rows. Irrelevant sheets (electrical, bathroom, lintel, foundation,
   schedules) are set aside, not sent to Claude.
3. **Segment into house types (builder + code)** — house-type code/name is read from the
   title-block portfolio line; pages are grouped by code; **one HouseType + one
   Extraction per house type** (`segment.ts`, `processPack.ts`), so repeats across plots
   share one take-off instead of being re-measured.
4. **Raster/unreadable detection** — no text layer → `Document.needsReview = true`,
   skipped from extraction rather than guessed at.
5. **Plot-list ingestion** — `extract-plot-list` job sends PLOT_LAYOUT pages to Claude
   (`extractPlotList.ts`) → plot number → house-type code/name → configuration;
   `persistPlots.ts` matches each plot to its house type (by code, then name; creates a
   stub house type if that drawing wasn't in the pack) and upserts `Plot` rows.
6. **Pack browse view** — project page now shows House types (with plot counts + review
   links), a Plots table (plot / house type / configuration / render, natural-sorted),
   and Documents (with page-kind + relevant-page counts).

Shared `claude.ts` tool-call helper now backs both extractors (drawing + plot-list) —
one code path for prompt caching, telemetry, and tool-use.

**Schema**: `PageKind`, `DocumentPage`, `PackUpload`, `Document.needsReview/classifiedAt`.
Migration `20260802151150_pack_pages_and_uploads`.

**Tests** (16 passing, 3 files): `pdf.test.ts` (page-range planning/parsing — the
round-trip test caught a real bug where the section page was silently dropped),
`segment.test.ts` (house-type-ref parsing, page grouping), `persistPlots.test.ts`
(plot → house-type matching by code/name).

### Known gaps / assumptions (flagged, not silently swept under)

- **No real multi-house-type pack or plot list to test against yet.** Only have the
  single-type Chesterwood pack (no site plan). Segmentation and plot-matching logic are
  unit-tested with synthetic fixtures; the **AI extraction quality on a real plot list is
  unverified**.
- **Classifier + house-type-code parsing are tuned to one builder's (Miller-style) title
  block.** Will need broadening once packs from other builders are available.
- **Plot configuration often can't be read reliably from a site-plan drawing** — the
  right fix is a human review/edit step, which belongs in Week 4's editable review
  screen, not more AI guessing.
- **Extraction field set is still small** (house type, storeys, height, gables, wall
  segments) — the full staged take-off (every lift/gable/birdcage operation) is Week 3.
- **Not deployed to Render yet.** Researched Render's pricing: **Background Workers have
  no free tier** (Web Services do; Workers start at $7/mo Starter). Decision pending —
  see TODO. `render.yaml` already reflects the two-service $7/mo setup.
- **Sentry** is env-var only; SDK not wired.

### Gotchas resolved this project (don't re-discover)

- Prisma CLI loads `.env` not `.env.local` → `db:*` scripts use `node --env-file-if-exists`.
- pg-boss needs `DIRECT_URL`, not pooled.
- Supabase built-in email is rate-limited + magic links get consumed by scanners → moved
  to email+password with confirm-email off.
- Render skips devDeps under `NODE_ENV=production` → `npm ci --include=dev`.
- Hydration warning from a browser extension → `suppressHydrationWarning` on html/body.
- Render Background Workers have **no free tier** (confirmed on render.com/pricing);
  only Web Services do, and free Web Services sleep after 15 min idle.

### Next up

See `TODO.md`. Immediate: decide the Render deploy path (pay $7/mo for a proper worker,
or combine web+worker into one free service with an uptime pinger), then deploy. After
that: Week 3 (staged take-off + the Colin session for the lift rule and percentage splits).
