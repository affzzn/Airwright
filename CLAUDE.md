# CLAUDE.md

Read this first, every session. For depth, see `docs/` (esp. `docs/02-prd-build1.md`,
`docs/04-data-model.md`). For current status + next steps, read `PROGRESS.md` and `TODO.md`.

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

## ⚠ Correctness rules that must come from Colin, never inferred

1. The rule that maps **wall height → number of lifts**.
2. The exact **percentage splits** for erect / birdcage / dismantle.
Do NOT harden the pricing engine (Week 4) until these are confirmed with Colin.
