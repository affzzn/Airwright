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

## The review / browse UI

- **Project page** (`src/app/projects/[id]`): the pack overview — House types (status +
  Review link), a Plots table (plot / house type / configuration / render, naturally
  sorted), and Documents (page-kind + relevant-page counts, needs-review flag).
  `AutoRefresh` polls while uploads/classification/extraction are in progress.
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
| `src/lib/extract/classify.ts` | **Free page classifier (worker-only, imports pdfjs)** |
| `src/lib/extract/segment.ts` | Group a document's pages into house types by code |
| `src/lib/extract/claude.ts` | **Shared Claude tool-use call** (both extractors) |
| `src/lib/extract/schema.ts` | Zod contract — drawing extraction |
| `src/lib/extract/extractDrawing.ts` | Drawing extractor (uses `claude.ts`) |
| `src/lib/extract/persist.ts` | Drawing result → HouseType/Takeoff/measurements |
| `src/lib/extract/plotSchema.ts` | Zod contract — plot-list extraction |
| `src/lib/extract/extractPlotList.ts` | Plot-list extractor (uses `claude.ts`) |
| `src/lib/extract/persistPlots.ts` | Plot-list result → matched `Plot` rows |
| `src/server/actions/` | auth, projects, upload (signed URLs + finalize) |
| `src/worker/processPack.ts` | Ingest ZIP/PDFs → classify → segment → fan out |
| `src/worker/index.ts` | Worker entrypoint: 3 job handlers |
| `src/app/` | Pages: home, projects/[id], extractions/[id], login |
| `src/components/` | Shell, upload form, PDF viewer, auto-refresh, ui primitives |
