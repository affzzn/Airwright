# TODO.md

Task list / next steps. Keep it current. Depth for each week is in `docs/02-prd-build1.md`.

## Now / small

- [ ] **Decide the Render deploy path** (Background Workers have NO free tier — $7/mo
      minimum; Web Services do). Options: (a) pay $7/mo Starter for a proper always-on
      worker — `render.yaml` already has this two-service setup, just deploy it; or
      (b) combine web+worker into one free Web Service (`concurrently`) + an external
      uptime pinger (e.g. UptimeRobot) to fight the 15-min sleep. (a) is cleaner/more
      reliable; (b) is $0 but extractions stall while asleep. **User to choose.**
- [x] Unit-test the plot/segmentation logic (`segment.test.ts`, `persistPlots.test.ts`).
      `classify.ts`'s title-parsing itself still has no direct unit tests (only tested
      indirectly via `segment.test.ts`'s `extractHouseTypeRef` cases) — could add more.
- [~] File-level relevance (in progress — see "File relevance" below).
- [ ] Broaden the classifier + house-type-code + plot-list parsing across builders (not
      just Miller-style title blocks) — needs real packs from other builders first.

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
- [ ] Verify on a REAL full pack (many consultant files) end-to-end. Unit-tested against the
      Travis Baker sample sheets; live AI run on a big pack still unproven.
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

- [ ] Read elevations into quantities: perimeter (from wall lengths, each traceable),
      height to soffit, roof pitch, storeys, gables, render length, birdcage m², foot/low-level.
- [ ] Derive number of lifts from height — **Colin's exact rule (get it, don't infer)**.
- [ ] Build the staged operation list per house type (component × erect/dismantle × lift);
      garages as their own staged set.
- [ ] Detached/semi/terraced wall-scaffold splits; split shared scaffold across a terrace run.
- [ ] **Book the Colin session** to confirm the lift rule + the percentage splits.

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

## Later phases (NOT Build 1)

- Build 2: one-rate gang pay + self-bill (staged model + `payPercent` hook feed it).
- Build 3: cross-project house-type bank + repeat matcher.
- Later: WhatsApp handover, applications for payment, payroll, Sage, scaffolder profiles.
