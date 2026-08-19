# CLAUDE.md

Read this first, every session. Then read **`docs/11-takeoff-engine-spec.md`** — the
canonical Week-3+ build spec (Colin's confirmed rules, the extractor field set, the
validation results, and the 16 open questions that must NOT be guessed). For status +
next steps: `PROGRESS.md` and `TODO.md`. For depth: `docs/02-prd-build1.md`,
`docs/04-data-model.md`.

## What this is

Airwright Midland's estimating platform — **Phase 1 · Build 1: the Quote & Take-off
Engine**. It reads a house-builder's tender-pack PDFs, uses AI to extract the scaffold
take-off measurements (human-in-the-loop), and will produce a priced quote. Client is a
UK new-build scaffolding contractor; the estimator (Colin) is the primary user. Nothing
is ever auto-priced — a person confirms every output.

## Tech stack

- **Next.js 15** (App Router, TypeScript) + **Tailwind v3** (monochrome) + **Manrope**
- **Prisma 6** → **Supabase Postgres** (EU/UK). Prisma owns the schema/migrations.
- **Supabase Auth** (email + password) and **Supabase Storage** (private `tender-packs` bucket)
- **pg-boss** queue + a **separate worker process** for AI extraction
- **Claude** (Anthropic API) via tool-use for structured JSON; **Zod** validates it
- **PDF.js** (react-pdf) for the review viewer
- Deploy: **Render** (web service + worker). CI: GitHub Actions.

## Two processes (important)

1. **Web** — `npm run dev` (the Next.js app; uploads go browser→Storage directly via a
   signed URL, then the app enqueues a `process-pack` job).
2. **Worker** — `npm run worker:dev` (runs 3 pg-boss job handlers: `process-pack`
   ingests/classifies/segments a pack, `extract-drawing` and `extract-plot-list` call
   Claude). Nothing gets read/extracted unless the worker is running.

See `ARCHITECTURE.md` for the full pipeline.

## Commands

```bash
npm run dev            # web app
npm run worker:dev     # extraction worker (watch)
npm run build          # prisma generate + next build
npm run typecheck      # tsc --noEmit
npm run test           # vitest
npm run lint           # eslint
npm run db:migrate     # prisma migrate dev  (after schema changes)
npm run db:studio      # browse the DB
npm run db:seed        # demo client + rate card
npm run setup:bucket   # create the private Storage bucket
```

## Gotchas that WILL bite (we already hit these)

- **Prisma CLI only loads `.env`, not `.env.local`.** The app (Next) loads `.env.local`.
  So the `db:*` scripts run Prisma via `node --env-file-if-exists=.env.local …`. Don't
  "simplify" them back to bare `prisma …` or migrations will run against an empty DB.
- **pg-boss must use `DIRECT_URL`** (port 5432), NOT the pooled `DATABASE_URL` — it needs
  LISTEN/NOTIFY + advisory locks, which PgBouncer breaks. Prisma uses pooled `DATABASE_URL`.
- **`src/lib/extract/classify.ts` is worker-only** (imports `pdfjs-dist`). Never import it
  into the Next.js app bundle.
- **Render Background Workers have NO free tier** (confirmed on render.com/pricing —
  $7/mo Starter minimum; Web Services do have a free tier but sleep after 15 min idle).
  This is an open decision before deploying — see `TODO.md`.
- **Auth**: email + password. For local dev, "Confirm email" is turned OFF in Supabase
  (its built-in email is rate-limited and links get consumed by scanners). Don't reintroduce
  magic-link / OTP.
- **Render**: `render.yaml` uses `npm ci --include=dev` because Render sets
  `NODE_ENV=production`, which would otherwise skip devDeps (tailwind, prisma, tsx).
- **Model id** comes from `ANTHROPIC_EXTRACTION_MODEL`; the worker reads env at startup —
  restart it after changing env.
- **Storage has TWO size limits**: the project-wide global (dashboard) AND a per-bucket
  limit. Both must be raised; a bucket can't exceed the global. Both are 250MB now —
  `npm run setup:bucket` keeps the bucket there.
- **Never `setInterval(router.refresh())` on heavy pages** — the project page render is
  ~700ms (EU DB RTT); a fast poll aborts its own refreshes and the page freezes. Use the
  cheap `/api/projects/[id]/pack-status` probe + refresh-on-change (see `auto-refresh.tsx`).
- **Prisma `relationJoins`** is on (preview feature) — pass
  `relationLoadStrategy: "join"` on heavy nested queries or they explode into ~13
  round-trips to the EU database (~250ms each).
- **The worker reuses stored `rawOutput` on retried extractions** (no second Claude
  bill). Old-schema rawOutput fails the Zod parse and falls through to a fresh call.
- **`data/` and `colin-data/` are gitignored client PII** (real drawings, Colin's
  handwritten take-off sheets, priced quotes). Never commit or publish them.

## Coding style / conventions

- **UI is strictly monochrome, light mode, no colour.** Manrope, hairline borders, no
  shadows. Depth = surface + border only. Confidence shows as a small dot with a hover
  tooltip, never coloured. Keep new UI primitives in `src/components/ui/`. See
  `docs/07-design-system.md`.
- **Validate at every boundary with Zod** (extraction output, job payloads).
- **Mutations via server actions** (`src/server/actions/`). DB-touching pages are
  `force-dynamic`.
- **Money is `Decimal`, never float.** Quotes are immutable snapshots.
- **The staged take-off is a list of operations, not totals.** Measurements (traceable,
  per-field confidence) → confirmed → ScaffoldOperations (typed) → priced QuoteLineItems.
- Match the surrounding code; keep comments purposeful (the "why", not the obvious).

## The two-layer take-off design (post-Colin, 13 Aug call)

- **Layer 1 — extractor** (`src/lib/extract/prompt.ts` + `schema.ts`, Opus 4.8):
  reads OBSERVABLES off the drawing (walls, height, apex per elevation, render,
  internal floor areas, structure, dwellingsWide…) with confidence + provenance.
  It NEVER computes lifts, perimeter totals or prices.
- **Layer 2 — deterministic engine** (`src/lib/takeoff/engine.ts`): applies Colin's
  confirmed rules (lifts = ceil(height/1.5)+roomInRoof with storey-template
  cross-check; perimeter by config; birdcage; render lifts; config-aware apex;
  apartment whole-block mode) and emits his take-off line. Open values are
  configurable params + flags, never guesses.
- Validated against Colin's handwritten sheets (`colin-data/`, gitignored):
  Dekker semi 20.56 / mid 10.66 (his 20.5 / 10.6), Rosewood 48.5 exact.
  Offline runner: `npx tsx scripts/offline-extract.mts <NAME>`.

## ⚠ Correctness rules that must come from Colin, never inferred

**The full open-questions table (16 items, with owners) is `docs/11 §8`** — corner
allowance quantum, height datum for the lift rule, birdcage cavity deduction +
apartment birdcage basis, the render lift table, the rate sheet, 4-plot
apportionment, sign-off tolerances… Build hooks, flag in review, do not assume.
Stage splits 50/25/25 (bungalow 65/10/25) are CONFIRMED from his matrices.

Colin's data: `docs/08-colin-data.md` (matrices), `colin-data/` (handwritten
take-off sheets + 4 matched drawings), `data/` (Oadby/Bloor golden set incl. a
real client quote; Wetherspoon pub = construction mode). All gitignored PII.
