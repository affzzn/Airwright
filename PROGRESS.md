# PROGRESS.md

Running log. Update this at the END of a session (before running out of context).
New session: "Read CLAUDE.md and PROGRESS.md before we start."

---

## Status: WHOLE PIPELINE BUILT + DEPLOYED ON RENDER. Drawing → extract → editable
## review (provenance-on-hover with page links) → CONFIRM/LOCK → per-plot pricing
## matrix → immutable quote → Excel/print outputs. Runs on PLACEHOLDER rates — Colin's
## rate sheet + the 16 open questions (docs/11 §8) are the one thing gating correct
## pricing. Canonical docs: 11 (take-off), 13 (extraction playbook), 14 (pricing/quote).

Last updated: 2026-09-01

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
