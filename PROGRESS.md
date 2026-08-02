# PROGRESS.md

Running log. Update this at the END of a session (before running out of context).
New session: "Read CLAUDE.md and PROGRESS.md before we start."

---

## Status: Week 1 DONE (verified on a real pack). Week 2 DONE (built + unit-tested;
## two items unverified for lack of real test data — see below).

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
