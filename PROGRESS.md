# PROGRESS.md

Running log. Update this at the END of a session (before running out of context).
New session: "Read CLAUDE.md and PROGRESS.md before we start."

---

## Status: Week 1 DONE (verified). Week 2 steps 1-2 DONE (unit-tested; needs a real multi-type pack to verify end-to-end).

Last updated: 2026-08-02

### Week 2 progress (steps 1-2 + upload overhaul)

- **Direct-to-Storage uploads** via signed URLs — browser uploads PDFs/ZIPs
  straight to Supabase, no server body limit (handles large packs). Bucket
  per-file limit is 50MB (Supabase free-tier cap; raise plan / add resumable
  uploads for bigger). `src/components/upload-form.tsx`, `actions/upload.ts`.
- **ZIP support** — a ZIP is unzipped in the worker (fflate) into Document rows.
- **process-pack job** (`src/worker/processPack.ts`): ingest uploads → classify
  every page (free) → persist `DocumentPage` rows → segment by house-type code →
  create one HouseType + one Extraction per code → fan out extraction jobs.
- **Per-page classification persisted**; added `PLOT_LAYOUT` + `SPEC` page kinds;
  house-type **code + name** pulled from the title-block portfolio line.
- **Raster/unreadable PDFs flagged** (`Document.needsReview`), not extracted.
- **Extraction** now sends the pages segmentation chose (non-contiguous ranges).
- **Schema**: `PageKind`, `DocumentPage`, `PackUpload`, `Document.needsReview/classifiedAt`.
  Migration `20260802151150_pack_pages_and_uploads`.
- **Assumption (no real multi-type pack yet)**: each house type's pages live within
  one document; house-type code comes from the Miller-style portfolio line. Covered
  by unit tests with a synthetic 2-type fixture (`segment.test.ts`).
- **NOT yet**: plot-list ingestion (plot → type + config), pack browse/detail view.
  These are Week 2 steps 5-6.

### Done (working end to end, locally)

- **Repo + toolchain**: Next.js 15, TS, Tailwind (monochrome), Manrope, Prisma, Vitest,
  ESLint, GitHub Actions CI, `render.yaml`. Build / typecheck / test / lint all green.
- **Schema v1** migrated to Supabase (EU): the full staged-operation model. Seed adds a
  demo client + placeholder rate card.
- **Auth**: email + password (Supabase). "Confirm email" turned OFF in Supabase for dev.
  Middleware gates the whole app.
- **Storage**: private `tender-packs` bucket (created via `npm run setup:bucket`). Files
  served through short-lived signed URLs.
- **Upload → extraction pipeline**: upload → Storage + Document row → pg-boss job →
  worker → `extractDrawing()` (Claude tool-use, prompt caching) → Zod-validated →
  Extraction stored with model / latency / tokens / **cost in $**.
- **Relevant-pages-only (pulled forward from Week 2)**: `classify.ts` reads the PDF text
  layer's title block and sends Claude only elevations / floor plans / section. On the
  sample Chesterwood pack: **7 of 27 pages (1-4,10-11,13)** → ~74% fewer pages/cost.
  Safe fallback to first-N pages when a PDF is scanned/raster (no text layer).
- **Review screen (read-only)**: PDF.js drawing beside extracted fields; per-field
  **confidence as a subtle dot + hover tooltip** (no colour); wall segments → perimeter;
  concise AI notes; live auto-refresh Queued → Reading → Ready.

### Verified

- A real 27-page tender pack (`L464_Chesterwood`) runs through end to end; classifier
  selects the correct 7 pages; extraction completes and shows in Review.

### Half-done / rough edges

- **Extraction field set is intentionally small** (house type, storeys, height, gables,
  wall segments). NOT yet the full staged take-off — that's Week 3.
- **Classifier is tuned to this builder's title-block format** (Miller-style). Needs
  broadening across builders + no unit tests yet.
- **Not deployed to Render yet** (config is ready; user will do it later).
- **Sentry** is env-var only; SDK not wired.

### Gotchas resolved this project (don't re-discover)

- Prisma CLI loads `.env` not `.env.local` → `db:*` scripts use `node --env-file-if-exists`.
- pg-boss needs `DIRECT_URL`, not pooled.
- Supabase built-in email is rate-limited + magic links get consumed by scanners → moved
  to email+password with confirm-email off.
- Render skips devDeps under `NODE_ENV=production` → `npm ci --include=dev`.
- Hydration warning from a browser extension → `suppressHydrationWarning` on html/body.

### Next up

See `TODO.md`. Immediate candidates: unit-test the classifier; broaden it across builders;
then start Week 2 (multi-house-type packs, plot list → plot/config mapping).
