# TODO.md

Task list / next steps. Keep it current. Depth for each week is in `docs/02-prd-build1.md`.

## Now / small

- [ ] Unit-test the page classifier (`src/lib/extract/classify.ts`) with sample title strings.
- [ ] Broaden the classifier across builders (not just Miller-style title blocks).
- [ ] Deploy to Render (web + worker) — steps in `docs/06-setup.md`. Then set
      `NEXT_PUBLIC_SITE_URL` + Supabase redirect URLs.
- [ ] Wire Sentry SDK (currently env-var only).

## Week 2 — Full tender packs & sheet classification

- [x] Multi-file / large-file upload (direct-to-Storage signed URLs) + ZIP support.
- [x] Persist per-page classification (`DocumentPage`, +PLOT_LAYOUT/SPEC); segment a
      pack into house types by builder+code (one Extraction per house type).
- [x] Detect embedded-raster PDFs (no text layer) and flag for a human (`needsReview`).
- [ ] Plot-list ingestion: read the PLOT_LAYOUT sheet → map each plot → house-type code
      + configuration (detached / semi / end-terrace / mid-terrace) → create Plot rows.
- [ ] Pack browse / detail view: list all house types + plots + statuses in one place.
- [ ] Broaden classifier + house-type-code parsing beyond the Miller-style title block.
- [ ] Verify end-to-end on a REAL multi-house-type pack (only have single-type Chesterwood).

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
