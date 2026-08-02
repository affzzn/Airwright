# ARCHITECTURE.md

How the pieces fit together. For the data model in detail see `docs/04-data-model.md`;
for the full schema see `prisma/schema.prisma`.

## The one-line flow

```
Upload PDF → Supabase Storage + Document row → pg-boss job
   → Worker: classify pages (free) → slice relevant pages → Claude (tool-use)
   → Zod-validate → Extraction + HouseType/Takeoff/measurements
   → Review screen (PDF.js drawing beside extracted fields)
```

## The two processes

- **Web app** (Next.js, `src/app`, `src/server`): auth, projects, upload, review UI.
  On upload it stores the file and **enqueues** an extraction job. It never calls Claude
  itself — so uploads stay instant and the UI never blocks.
- **Worker** (`src/worker/index.ts`, plain Node via tsx): the only thing that calls Claude.
  It watches the pg-boss queue and processes one job at a time.

They share one Postgres DB (Supabase). The queue lives in that DB (pg-boss's own schema).

## The extraction pipeline, step by step

1. **Upload** (`src/server/actions/upload.ts`): file → Supabase Storage; create a
   `Document`; create one `Extraction` (status PENDING); `boss.send(...)` a job.
2. **Queue** (`src/lib/queue/`): pg-boss on `DIRECT_URL`. Job payload = `{documentId,
   extractionId, pageRange}` (validated by Zod).
3. **Worker picks up the job** (`src/worker/index.ts`):
   - Downloads the PDF from Storage.
   - **Classifies pages for free** (`src/lib/extract/classify.ts`) by reading the PDF
     text layer's title block — keeps only elevations / floor plans / section, discards
     electrical / wet-area / schedules / foundations. (~74% fewer pages on the sample pack.)
   - Slices out just those pages (`slicePages` in `src/lib/pdf.ts`).
   - Calls **`extractDrawing()`** (`src/lib/extract/extractDrawing.ts`) — the single
     Claude interface: forced tool-use for structured JSON, prompt caching on the fixed
     system prompt + tool schema, returns data + token/cost telemetry.
   - **Zod-validates** against `src/lib/extract/schema.ts` (the extraction contract).
   - Stores everything: `Extraction.rawOutput` (raw AI output, the eval baseline) + model
     / latency / tokens / cost, then `persistExtraction()` writes the HouseType, Takeoff,
     measurements and wall segments.
4. **Review** (`src/app/extractions/[id]`): server component loads the Takeoff, makes a
   signed URL for the PDF, renders PDF.js (`src/components/pdf-viewer*.tsx`) beside the
   fields. `AutoRefresh` polls while status is PENDING/PROCESSING so it goes
   Queued → Reading → Ready live.

## Data model layers (why it's shaped this way)

- **Document ≠ HouseType.** One PDF can hold several house types; one house type can span
  several files. Linked by `Extraction.pageRange`.
- **Measurements + WallSegments** = the review/provenance layer. Every field has
  confidence + source dimension + an `ambiguous` flag. Perimeter is *assembled* from wall
  segments, never a single opaque number.
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
| `src/lib/supabase/` | Auth server client + Storage (service role) |
| `src/lib/queue/` | pg-boss singleton + job types |
| `src/lib/pdf.ts` | Page count / slice / range strings |
| `src/lib/extract/classify.ts` | **Free page classifier (worker-only)** |
| `src/lib/extract/schema.ts` | **Zod extraction contract** |
| `src/lib/extract/extractDrawing.ts` | **The single Claude interface** |
| `src/lib/extract/persist.ts` | Result → HouseType/Takeoff/measurements |
| `src/server/actions/` | auth, projects, upload |
| `src/worker/index.ts` | Worker entrypoint |
| `src/app/` | Pages: home, projects/[id], extractions/[id], login |
| `src/components/` | Shell, upload, PDF viewer, ui primitives |
