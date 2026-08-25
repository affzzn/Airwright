# ARCHITECTURE.md

How the pieces fit together. For the data model in detail see `docs/04-data-model.md`;
for the full schema see `prisma/schema.prisma`.

## The one-line flow

```
Browser uploads PDF/ZIP directly to Supabase Storage (signed URL)
   → finalize: PackUpload row(s) → pg-boss "process-pack" job
   → Worker: unzip if needed → classify every page (free, text layer) → persist
     DocumentPage rows → segment relevant pages by house-type code
       ├─ per house type → one HouseType + Extraction → "extract-drawing" job
       └─ per plot-layout sheet → "extract-plot-list" job
   → extract-drawing worker: Claude (tool-use) → Zod-validate → Extraction +
     HouseType/Takeoff/measurements/wall-segments
   → extract-plot-list worker: Claude (tool-use) → Zod-validate → match plots
     to house types → Plot rows
   → Project page: house types + plots table + documents (live-polling while
     anything is processing) → Review screen (PDF.js beside extracted fields)
```

## The two processes

- **Web app** (Next.js, `src/app`, `src/server`): auth, projects, upload, review UI.
  Uploads go **directly from the browser to Supabase Storage** via a signed URL (no
  server body-size limit, large packs upload fast); the server only mints that URL and,
  once uploaded, **enqueues** a `process-pack` job. The web app never calls Claude itself.
- **Worker** (`src/worker/index.ts`, plain Node via tsx): the only thing that calls
  Claude. Runs three pg-boss job handlers (below) and processes one job at a time per
  handler.

They share one Postgres DB (Supabase). The queue lives in that DB (pg-boss's own schema).

## The three background jobs

1. **`process-pack`** (`src/worker/processPack.ts`) — the pack-level orchestrator:
   - Ingests `PackUpload` rows: unzips any ZIP (`fflate`) into individual PDFs, uploads
     each to Storage, creates a `Document` row per PDF (page count, size, readability).
   - For each unclassified `Document`: downloads it, **classifies every page for free**
     (`classify.ts`, reads the PDF text layer's title block — no AI), persists
     `DocumentPage` rows (kind: ELEVATION / FLOOR_PLAN / SECTION / PLOT_LAYOUT / SPEC /
     OTHER + relevance + house-type code/name). No text layer → `needsReview = true`,
     skipped (flagged for a human, not extracted).
   - **Segments** the relevant (take-off) pages by house-type code (`segment.ts`) →
     creates one `HouseType` + one `Extraction` per code, enqueues an `extract-drawing`
     job per house type with its pre-selected (possibly non-contiguous) page range.
   - If a plot-layout sheet was found, enqueues one `extract-plot-list` job for it.
2. **`extract-drawing`** (`src/worker/index.ts` → `handleExtract`) — for one house type:
   slices its pages out of the PDF, calls **`extractDrawing()`**
   (`src/lib/extract/extractDrawing.ts`, built on the shared `claude.ts` tool-call
   helper — forced tool-use, prompt caching, token/cost telemetry), Zod-validates
   against `schema.ts`, stores `Extraction.rawOutput` + telemetry, then
   `persistExtraction()` writes the Takeoff, measurements and wall segments.
3. **`extract-plot-list`** (`src/worker/index.ts` → `handlePlotList`) — for the plot-
   layout sheet: calls **`extractPlotList()`** (`extractPlotList.ts`, same shared
   `claude.ts` helper), Zod-validates against `plotSchema.ts`, then `persistPlots()`
   matches each plot to its house type (by code, then name; creates a stub house type if
   that drawing wasn't in the pack) and upserts `Plot` rows.

## The take-off engine (Layer 2 — deterministic, post-extraction)

The model only extracts **observables**; `src/lib/takeoff/engine.ts` (pure,
unit-tested) turns them into Colin's take-off line: lifts (height rule + storey
cross-check with flags), perimeter by configuration + corner allowance, birdcage
per floor, render lifts, config-aware apex/table lifts, party walls, and an
apartment whole-block mode. `fromStored.ts` maps a persisted take-off to the
engine input; the review screen renders the computed line per configuration.
Open rule values (render table…) are `EngineParams` + flags —
see `docs/11-takeoff-engine-spec.md` §8. Offline validation runner:
`scripts/offline-extract.mts` (extractor + engine vs Colin's sheets).

## The pricing engine (Layer 3 — after a human confirms the take-off)

Full detail: `docs/14-pricing-and-quote.md`. After Colin **confirms** a take-off
(`Takeoff.status = CONFIRMED`), pricing runs **per plot at quote time**:

```
confirmed observables → buildTakeoff(observables, plot.config, plot.render)
  → priceTakeoffLine(line, rateResolver, stageSplits)   [src/lib/pricing/engine.ts]
      → priced line items (true cost) + subtotal + stage split (pence, reconciles)
  → priceProject(...) over all plots → pricing matrix + grand total
  → generateQuote(...) → immutable Quote + QuoteLineItems (frozen)
  → quote view (print → client PDF) + Excel export (ExcelJS, sanitised)
```

Pure + unit-tested (`engine.test.ts`, `priceProject.test.ts`). Rates live on
`/rates` (versioned/effective-dated). **True item cost and presented stage split
are kept separate** (checklist trap); the quote freezes both. ⚠ Rates + the
operation→component mapping are placeholders until Colin's rate sheet.

## The review / browse UI

- **Project page** (`src/app/projects/[id]`): the pack overview — House types (status +
  Review link, error message + Retry on failure), a Plots table (plot / house type /
  configuration / render, naturally sorted), and Documents (page-kind + relevant-page
  counts, needs-review flag). **Live updates**: `AutoRefresh` polls the cheap
  `/api/projects/[id]/pack-status` probe and calls `router.refresh()` only when the
  state signature changes (debounced, idle backoff) — never a raw interval refresh,
  which aborts itself on this ~700ms page.
- **Review screen** (`src/app/extractions/[id]`): PDF.js drawing beside the extracted
  fields for one house type, confidence as a subtle dot + hover tooltip, wall segments
  summed to a perimeter, concise AI notes. **Read-only** — editing is Week 4.

## Data model layers (why it's shaped this way)

- **Document ≠ HouseType.** One PDF can hold several house types; one house type can span
  several files. `DocumentPage` records the classification of every page; `Extraction`
  carries the `pageRange` actually sent to Claude for a given house type.
- **Measurements + WallSegments** = the review/provenance layer. Every field has
  confidence + source dimension + an `ambiguous` flag. Perimeter is *assembled* from wall
  segments, never a single opaque number.
- **Plot** = one plot's house type + configuration (+ render/access), from the plot list.
  Configuration often needs a human correction — that's a Week 4 UI concern, not a data
  model one.
- **ScaffoldOperation** = the pricing unit (erect/dismantle × component × lift level).
  Typed, so the deterministic pricing engine (Week 4) reads it directly.
- **RateCard + StageSplit** = versioned rates + the configurable erect/birdcage/dismantle
  percentages. Old quotes stay frozen on their rates.
- **Quote + QuoteLineItem** = immutable snapshot (quantity, rate, amount frozen).
- **Two modes**: `Project.estimatingMode` (HOUSE_BUILD / CONSTRUCTION), plus
  `ConstructionRateItem` + `ConstructionScope`.

## Key files map

| Path | Role |
|------|------|
| `prisma/schema.prisma` | Data model (source of truth) |
| `src/lib/db.ts` / `env.ts` | Prisma singleton / lazy env |
| `src/lib/supabase/server.ts` | Auth server client |
| `src/lib/supabase/client.ts` | Browser client (direct-to-Storage uploads) |
| `src/lib/supabase/storage.ts` | Signed upload/download URLs (service role) |
| `src/lib/queue/` | pg-boss singleton + job types (3 queues) |
| `src/lib/pdf.ts` | Page count / slice / range-string build+parse |
| `src/lib/zip.ts` | Recursive ZIP → PDF entries (zips-of-zips, skipped files reported) |
| `src/lib/takeoff/engine.ts` | **Deterministic take-off engine (Layer 2, pure)** |
| `src/lib/takeoff/fromStored.ts` | Persisted take-off → engine input |
| `src/lib/extract/classify.ts` | **Free page classifier (worker-only, imports pdfjs)** — title-block parse + `classifyByText` fallback for unknown builders |
| `src/lib/extract/segment.ts` | Group a document's pages into house types by code |
| `src/lib/extract/claude.ts` | **Shared Claude tool-use call** (both extractors) |
| `src/lib/extract/schema.ts` | Zod contract — drawing extraction |
| `src/lib/extract/extractDrawing.ts` | Drawing extractor (uses `claude.ts`) |
| `src/lib/extract/persist.ts` | Drawing result → HouseType/Takeoff/measurements |
| `src/lib/extract/plotSchema.ts` | Zod contract — plot-list extraction |
| `src/lib/extract/extractPlotList.ts` | Plot-list extractor (uses `claude.ts`) |
| `src/lib/extract/persistPlots.ts` | Plot-list result → matched `Plot` rows |
| `src/server/actions/` | auth, projects, upload (signed URLs + finalize), extraction retry |
| `src/worker/processPack.ts` | Ingest ZIP/PDFs (recursive, idempotent) → classify → segment → fan out |
| `src/worker/index.ts` | Worker entrypoint: 3 job handlers; retried extractions reuse stored rawOutput (no re-bill) |
| `src/app/api/projects/[id]/pack-status` | Cheap status probe for the live poller |
| `src/app/` | Pages: home, projects/[id], extractions/[id], login |
| `scripts/offline-extract.mts` | Offline extractor+engine runner vs Colin's data |
| `src/lib/pricing/engine.ts` | **Pricing engine (Layer 3, pure)** — quantity × rate → priced lines + stage split |
| `src/lib/pricing/priceProject.ts` | Prices a whole development per plot; reconciles to a grand total |
| `src/server/pricing.ts` | `loadProjectPricing()` — load project + active rate card, price it |
| `src/server/actions/quotes.ts` | `generateQuote()` — snapshot the priced development into an immutable Quote |
| `src/server/actions/rates.ts` | Rate-card admin actions |
| `src/app/rates/*`, `.../pricing/*`, `src/app/quotes/[id]/*` | Rate screen, pricing matrix, quote view + Excel export |
| `src/lib/provenance.ts` | Per-measurement "how was this derived" (page links via `sourcePage`) |
| `src/components/` | Shell, upload form, PDF viewer, take-off editor, tenders workspace, rates manager, ui primitives |
