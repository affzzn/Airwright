# CLAUDE.md

Read this first, every session. Then read **`docs/11-takeoff-engine-spec.md`** (the
canonical take-off spec — Colin's confirmed rules, the extractor field set, the
validation results, the open questions that must NOT be guessed) and
**`docs/13-extraction-playbook.md`** (how the model reads each measurement — the
single source the prompt is generated from). For the priced side, **`docs/15-pricing-spec.md`** (the canonical house-build
pricing structure, decoded from Colin's real matrices in `data/pricing-data/` —
per-lift columns, table+rails, birdcage per floor, stage splits, garages,
Traditional vs Timber-Frame; supersedes the provisional `docs/14-pricing-and-quote.md`).
For how packs are ingested (the **smart upload + cross-file grouping** layer — upload any
folder tree of loose single-page PDFs, group pages into house types per a builder profile,
assemble one combined PDF per type), see **`docs/17-smart-upload-and-grouping.md`**.
For status + next steps: `PROGRESS.md` and `TODO.md`. For depth: `docs/02-prd-build1.md`,
`docs/04-data-model.md`. (Docs 09/10 were pre-call drafts and were deleted — superseded
by 11 + the call checklist `docs/Airwright-Estimator-Build-Checklist_from_call.docx`.)

## What this is

Airwright Midland's estimating platform — **Phase 1 · Build 1: the Quote & Take-off
Engine**. It reads a house-builder's tender-pack PDFs, uses AI to extract the scaffold
take-off measurements (human-in-the-loop), and produces a priced, reconcilable quote.
Client is a UK new-build scaffolding contractor; the estimator (Colin) is the primary
user. Nothing is ever auto-priced — a person **confirms** every take-off before it's priced.

**Status (2026-08-20): the whole pipeline is built and DEPLOYED on Render** — drawing →
extract → editable review + provenance → **confirm/lock** → per-plot pricing matrix →
**immutable quote** → Excel/print outputs. It runs on **placeholder rates**; the real
rate sheet (owed by Colin/Laura) is the one thing gating correct pricing. See
`docs/14-pricing-and-quote.md` and `PROGRESS.md`.

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
2. **Worker** — `npm run worker:dev` (runs 2 pg-boss job handlers: `process-pack`
   ingests/classifies/segments a pack, `extract-drawing` calls Claude). The AI
   plot-list extractor was removed (2026-08-26) — plots now come from confirming a
   take-off (`src/server/plots.ts`), or are added by hand. Nothing gets read/extracted
   unless the worker is running.

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

## House bank (v2 BUILT 2026-10-02 — docs/20)

House-build only. Nothing enters the bank on confirm — only the **Save to house bank** button
(beside Confirm) with an explicit choice (new type / new version / already saved); versions
are never edited. On upload every house type is checked against the WHOLE bank (any builder,
same build type, not strict on names) BEFORE reading: a repeat's read is `HELD` (never
queued) until a person picks a version (**Use vN** → take-off confirmed, read `SKIPPED`, no AI)
or "Not this house — read the drawing". Labels: "From house bank · Denton v1". Never add a
path that queues a read without `holdBankRepeats`. Ship new enum values WITH the code that
reads them — old deployed code crashes on unknown enum values in the shared DB.

## Construction pack reading (BUILT 2026-09-30 — docs/22 + docs/23)

A SEPARATE path from house-build. An enquiry is a folder: `construction-ingest` (worker,
`src/server/constructionPack.ts`) unzips, drops junk / duplicates, builds the drawing
register (`src/lib/construction/pack/`), groups by building; the SCENARIO comes from the three
upload boxes (below); `construction-read` (`src/server/constructionRead.ts`) reads every
switched-on sheet with the typed readers (`src/lib/construction/readers/`) and writes the
per-building measurement sheet (`src/lib/construction/model/`). Doctrine: the model names
the shape, code measures it; placeholders (`params.ts`) are flagged wherever used.
- Test offline (no DB, no queue): `npx tsx scripts/construction-offline.mts "<folder>" [--ai]`.
  Real-DB e2e in-process: `npx tsx scripts/e2e-construction.mts "<folder>" [--cache …]`.
- **Local worker: `WORKER_QUEUES=construction`** — never run a full local worker (it would take
  live house-build jobs). The deployed worker only knows the new queues once pushed.
- Bluebeam / Acrobat mark-ups are PDF ANNOTATIONS — flatten (`pack/flattenAnnots.ts`) before
  tiling or they vanish. Keep model outputs as flat string lists on dense sheets (a long list of
  objects breaks the tool call); readers retry a malformed call once.

**Simplified 2026-10-02 — reliable numbers only.** Automatic = printed + read by code, and for
shape-dependent values TWO drawings must agree (heights → lifts; a rectangle's perimeter the roof
plan confirms; gables roof plan = elevations). Everything else is the estimator's, on the SECTION
CARDS (`cards.ts`, `section-cards.tsx`, `constructionCards.ts`; lines carry `cardKey`) with the
MEASURING TOOL (`measure-dialog.tsx`) and ticked ADD-ONS. Trust levels + plain-words hover cards
(`trust-badge.tsx`). Never re-add an extraction that cannot be confirmed by a second source.

**Three upload boxes → three scenarios (2026-10-02, docs/22 "As built 2026-10-02 b").** Scope ·
Drawings · Email, all optional; the box IS the file's label (`ConstructionAttachment.kind` =
SCOPE | DRAWINGS | EMAIL; zip contents inherit it; files without one get it from their type —
`boxOf` in `pack/files.ts`). Scenario from the boxes only (`scenarioFromBoxes`, stored as
`mode`): a scope → **A = Scenario 1** — read the scope (+ email for EXTRA lines) ONLY, the client's
numbers as given (`scopeOnly.ts`), no drawing reads / buildings / cards / cross-checks /
confidence; drawings, no scope → **B = Scenario 2** — drawings for the sure things, cards, email
reference only; else **C = Scenario 3** — nothing read, cards by hand. No auto-detect, no switch.

**Scope mode + output (BUILT 2026-10-01, docs/22 "As built — M3 + M4"):** a spreadsheet scope's
structure is read by CODE (`scopeTable.ts`); the scope reader maps rows (`rowRef`) and the row's
cells win (`attachScopeTables`); `bindScope.ts` (pure) binds each item ROLE to the building model
→ draft lines with formula / provenance / status (MEASURED · STATED · AGREES · DIFFERS ·
MEASURE_BY_HAND · UNKNOWN_BASIS · NEEDS_ITEM), the INFORMATION list, empty sections, accounting.
Output: `sections.ts` (Airwright's lump-sum sections) · itemised schedule · `clientTemplateExcel.ts`
(the client's own workbook). Job settings P1–P19 (`params.ts`; P18 = hire in the price, P19 =
"lifts at each level"). Test: `npx tsx scripts/e2e-scope.mts --job <id>` (re-runs a kept job for
$0) · `scripts/scope-offline.mts "<scope file>"` · `scripts/construction-eval.mts --job <id> --key
cband|ke|wren|murray`. A scope prompt change = bump `SCOPE_PROMPT_VERSION` (the cached scope read
is keyed on it). A server action called from a script throws "static generation store missing"
AFTER its writes (revalidatePath) — the e2e script tolerates exactly that.

## The pricing & quote layer (BUILT — full detail in `docs/14-pricing-and-quote.md`)

Layer 3, after Colin **confirms** a take-off (`Takeoff.status = CONFIRMED`, locks the
review screen). Priced **per plot at quote time**: for each plot, run `buildTakeoff`
with that plot's config + render, then `priceTakeoffLine` (`src/lib/pricing/engine.ts`,
pure, tested) = quantity × rate per operation, integer pence, reconciles to the penny.
`priceProject.ts` does the whole development → the pricing matrix (`/projects/[id]/pricing`).
`generateQuote` freezes it into an immutable `Quote` + `QuoteLineItems`; the quote view
(`/quotes/[id]`) is print-ready (= the client quotation) and has an ExcelJS export
(`/quotes/[id]/export`, formula-injection sanitised). Rates live on `/rates` (versioned).

- **True item cost vs presented stage split are kept SEPARATE** (checklist trap): the
  matrix's stage columns are `subtotal × stage%`, not the real line costs. The quote
  freezes both.
- **⚠ Rates + the operation→component mapping are PLACEHOLDERS** — every mapping choice
  is flagged in `engine.ts`. Confirm against Colin's rate sheet, then validate the engine
  reproduces the Oadby matrix to the penny (the golden set in `data/`).
- Not yet applied (flagged in the matrix): shared-item apportionment across a block,
  garages, construction mode, builder-profile "extras". Client-specific matrix template
  is a **later** TODO (the fixed Airwright Excel matrix works for now).

## ⚠ Correctness rules that must come from Colin, never inferred

**The full open-questions table (with owners) is `docs/11 §8`** — apartment
birdcage basis, the render lift table, the rate sheet, 4-plot apportionment,
sign-off tolerances… (Resolved: **corner allowance = 1 m per external corner**;
height datum = soffit; birdcage wall read per-drawing.)
Build hooks, flag in review, do not assume. Stage splits 50/25/25 (bungalow
65/10/25) are CONFIRMED from his matrices. **Birdcage wall thickness is RESOLVED
(2026-08-25):** read the structural (blockwork) wall off each drawing — prefer a
printed internal span, else `overall − 2·wall`, legend value as a flagged
fallback, no default; unresolved → flag, never guess (`birdcage.ts`, docs/13 §3.10).

Colin's data: `docs/08-colin-data.md` (matrices), `colin-data/` (handwritten
take-off sheets + 4 matched drawings), `data/` (Oadby/Bloor golden set incl. a
real client quote; Wetherspoon pub = construction mode). All gitignored PII.
