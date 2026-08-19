# TODO.md

Task list / next steps. Keep it current. Depth for each week is in `docs/02-prd-build1.md`;
the Week-3 rules + open questions live in **`docs/11-takeoff-engine-spec.md`** (canonical).

## Now / small

- [ ] **Commit the 2026-08-12→19 session work** (extractor v2, take-off engine,
      classifier fallback, polling/perf/ZIP/retry fixes) — all still uncommitted on
      `main`. Branch first. `data/` + `colin-data/` are gitignored (client PII).
- [ ] **Colin follow-up call** — the 16 open questions in `docs/11 §8` (corner quantum,
      height datum, birdcage cavity + apartment basis, render table, rate sheet…).
      Do NOT encode any of them as assumptions.
- [ ] Clean out test users/projects (tester@airwright.test, "Live test —…",
      "Nested zip test", "ZIP upload test", "Bug Test"…). A Delete-project button
      would make this self-serve (still not built).
- [ ] Resumable (TUS) uploads for 150MB+ zips — current single PUT works (bucket now
      250MB) but is slow/fragile on weak connections.

- [ ] **Decide the Render deploy path** (Background Workers have NO free tier — $7/mo
      minimum; Web Services do). Options: (a) pay $7/mo Starter for a proper always-on
      worker — `render.yaml` already has this two-service setup, just deploy it; or
      (b) combine web+worker into one free Web Service (`concurrently`) + an external
      uptime pinger (e.g. UptimeRobot) to fight the 15-min sleep. (a) is cleaner/more
      reliable; (b) is $0 but extractions stall while asleep. **User to choose.**
- [x] Unit tests for classifier/segmentation/categorisation (`segment.test.ts`,
      `persistPlots.test.ts`, `categorise.test.ts`, `pack-progress.test.ts` — 38 total),
      using the real Travis Baker sample sheets.
- [x] File-level relevance (done — see "File relevance"). Validated on the real 48-file pack.
- [x] Broaden classifier for other builders — **Bloor/NSS handled** via `classifyByText`
      text-scan fallback (drawing-type labels; internal-elevation + civils exclusions).
      Miller, Travis Baker, Bloor-NSS, Bloor-Oadby all verified. Image-only drawings
      (no text) still fall to UNCERTAIN + manual "Use file" (vision classification later).
- [ ] Add a "Delete project" button (to clear stale test data) — offered, not built.

## File relevance (which FILES in a pack matter, not just which pages)

Real packs have many files from many consultants; most are irrelevant (bar schedules,
levels, drainage, landscape, structural). We already filter pages within a file; this
does the same one level up, across files.

- [x] **Generalise title extraction** across title-block formats (consultant
      `TITLE … STATUS` anchor + Miller portfolio line + letter-spaced fallback). Site-layout
      now wins over the FOUNDATION exclusion, fixing plot-list detection on real sheets.
- [x] **Categorise + relevance-tag each file** (`category`/`categoryDetail`/`included` on
      Document via `categorise.ts`). Only relevant files get extracted.
- [x] **UI**: "Using N of M files" + per-file category label + Use/Exclude override; excluded
      files' house types are hidden; force-using a set-aside file extracts it.
- [x] **Filename pre-filter** for large packs (`filenamePrefilter`) — conservative skip.
- [x] Classification verified on the REAL 48-file pack (per-file categorise correct). Full
      live AI extraction run on the whole pack still worth watching end-to-end once.
- [ ] Force-use fallback treats a whole file as ONE house type (no segmentation) — fine for
      an override, but revisit if a mislabelled file actually holds several types.
- [ ] Deploy to Render — steps in `docs/06-setup.md` (written for the two-service path;
      update if going with the combined free-tier path instead). Then set
      `NEXT_PUBLIC_SITE_URL` + Supabase redirect URLs.
- [ ] Wire Sentry SDK (currently env-var only).

## Week 2 — Full tender packs & sheet classification

- [x] Multi-file / large-file upload (direct-to-Storage signed URLs) + ZIP support.
- [x] Persist per-page classification (`DocumentPage`, +PLOT_LAYOUT/SPEC); segment a
      pack into house types by builder+code (one Extraction per house type).
- [x] Detect embedded-raster PDFs (no text layer) and flag for a human (`needsReview`).
- [x] Plot-list ingestion: read the PLOT_LAYOUT sheet → map each plot → house-type code
      + configuration → create Plot rows (`extractPlotList` + `persistPlots`).
- [x] Pack browse view: house types + plots table (plot/type/config/render) on project page.
- [ ] Broaden classifier + house-type-code + plot-list parsing beyond Miller-style packs.
- [ ] Verify end-to-end on a REAL multi-house-type pack + a real plot list / site plan
      (only have single-type Chesterwood; plot ingestion is unit-tested but AI part unproven).
- [ ] Plot configuration often can't be read from a site plan — add a human review/edit step.

## Week 3 — Drawings + plot list → staged take-off

**Canonical spec + rules + validation results: `docs/11-takeoff-engine-spec.md`.**
Colin's handwritten take-off sheets + 4 matched drawings are in `colin-data/` (gitignored).

- [x] Read elevations into quantities — extractor v2 live (`prompt.ts` v2026-08-19.2):
      wall segments, height, storeys/room-in-roof, per-elevation apex + render, internal
      floorAreas (GIA-first), corners, chimney, structure, dwellingsWide.
- [x] Derive lifts — engine: ceil(height/1.5)+roomInRoof, storey template as cross-check
      with deterministic precedence (whole storeys → template; 2.5 → height) + flag.
      ⚠ height DATUM (soffit/eaves/wallplate) still to confirm with Colin.
- [x] Config→walls splits (det 4 / semi-end 3 / mid 2) + config-aware apex + party walls;
      semi-PAIR drawings split correctly (model reports printed frontage + dwellingsWide,
      engine divides). Apartment blocks = whole-building mode.
- [x] Rules configurable (`EngineParams`: lift height, corner allowance) — open values
      flagged, never guessed.
- [x] Validated against Colin's sheets: Dekker 20.56/10.66 (his 20.5/10.6), Rosewood
      48.5 exact, Tyard 27.5 (28.5). Runner: `scripts/offline-extract.mts`.
- [x] Classifier: internal "Kitchen/Cloak Elevation" excluded (in `classifyByText`).
- [ ] **Build the staged ScaffoldOperation rows** (component × erect/dismantle × lift)
      from the engine's take-off line — the engine emits the line but doesn't write
      `ScaffoldOperation` records yet. Garages as their own staged set.
- [ ] **Shared-item apportionment across a block** (loading bay / chute / access):
      needs a Block object grouping plots + the 4-plot rule from Laura (docs/11 §8).
- [ ] **Group separate per-face elevation files** (2522-style Front/Rear/Gable-per-file)
      into ONE house type — still each becomes its own house type today.
- [ ] Validate against Colin's PRICING matrices (Whitford Road golden set) once rates land.
- [ ] Add "Setting Out Plan" pages to the relevant set (they carry the true GIA, e.g.
      Dekker 35.60, and the "Run of Exterior Wall" figure).
- [ ] **Get from Colin**: rate sheet (£/component/band) + the docs/11 §8 answers
      (corner quantum, cavity, render table, apartment birdcage basis, Tyard/Whitgrove).

## Week 4 — Pricing (both modes), review screen, exports

- [ ] Deterministic pricing engine (pure, unit-tested), priced per operation + stage.
- [ ] Percentage-derived stages (erect / birdcage / dismantle) from configurable rules.
- [ ] Versioned, effective-dated rate cards; bands; `payPercent` hook for Build 2.
- [ ] House-build path + construction path (per-elevation, hire weeks/permits/access/ground).
- [ ] **Reconciliation enforced**: stages sum to plot; plots + garages sum to grand total.
- [ ] Editable review screen: per-field edit, low-confidence floated up, sanity warnings,
      confirm locks the take-off + generates the quote, every edit logged.
- [ ] Exports: Strike-ready summary + Excel (ExcelJS), formula-injection sanitised.

## Weeks 5-7

- [ ] W5: accuracy testing vs all real packs (golden set, correction-rate metric).
- [ ] W6: edge cases, hardening, security.
- [ ] W7: refine, polish, sign-off.

## Feature ideas (suggested 2026-08-19, not built — pick with the client)

Ranked for Colin-value: (1) editable review + Confirm-locks-takeoff (Week 4 anyway),
(2) take-off summary export in Colin's handwritten-sheet format + Strike totals,
(3) manual take-off fallback when extraction fails, (4) plot-schedule editor with
block grouping + auto-apportionment, (5) builder-profile screen (~20 builders:
Keepmoat=Haki, Bloor=beam-overs/smart-roofs…), (6) flag inbox (all low-confidence /
mismatch warnings in one queue), (7) house-type bank + duplicate-and-amend with
LM drift check, (8) golden-set comparison view (tool vs Colin, agreement %),
(9) per-pack AI-cost chip, (10) revision watch (re-check known type on new rev).

## Later phases (NOT Build 1)

- Build 2: one-rate gang pay + self-bill (staged model + `payPercent` hook feed it).
- Build 3: cross-project house-type bank + repeat matcher.
- Later: WhatsApp handover, applications for payment, payroll, Sage, scaffolder profiles.
