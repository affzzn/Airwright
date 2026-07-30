# 05 · Week 1 Scope — what this codebase delivers

## Definition of Done (all met)

1. **Repo + toolchain** — Next.js 15, TS, Tailwind, Manrope, Prisma, ESLint,
   Vitest, `render.yaml`, GitHub Actions CI, `.env.example`. Build + typecheck +
   tests + lint all green.
2. **Schema v1** — the full staged-operation model in `prisma/schema.prisma`.
3. **Upload flow** — file → Supabase Storage → `TenderPack` / `Document` rows.
4. **Extraction pipeline** — upload enqueues a pg-boss job → worker runs
   `extractDrawing()` (Claude tool-use + prompt caching) → Zod-validated →
   `Extraction` stored with model / latency / tokens / cost.
5. **Oversized packs split by page** (`src/lib/pdf.ts`, unit-tested).
6. **Read-only review view** — PDF.js drawing beside extracted fields, per-field
   confidence + source dimension, wall-segments → perimeter, AI notes.

## What is intentionally minimal / stubbed in Week 1

- **Extraction field set** is small (house type, storeys, height, gables, wall
  segments). The full staged operation extraction is **Week 3**. The
  `extractDrawing()` interface is the stable seam that deepens later.
- **Sheet classification** ("only elevations matter") is **Week 2**; Week 1 just
  splits oversized packs into fixed page windows.
- **Review is read-only.** Editing, confirm-locks-takeoff and quote generation
  are **Week 4**.
- **Sentry** is wired via env var only — actual SDK init is a fast-follow.
- **Pricing engine, rate UI, exports** — Week 4.

## Map of the code

| Path | Purpose |
|------|---------|
| `prisma/schema.prisma` | Data model |
| `src/lib/db.ts` | Prisma singleton |
| `src/lib/env.ts` | Lazy env accessors |
| `src/lib/supabase/*` | Auth server client + Storage (service role) |
| `src/lib/queue/*` | pg-boss singleton + job types |
| `src/lib/pdf.ts` | Page count / split / range planning (tested) |
| `src/lib/extract/schema.ts` | **The Zod extraction contract** |
| `src/lib/extract/extractDrawing.ts` | **The single Claude interface** |
| `src/lib/extract/persist.ts` | Result → HouseType/Takeoff/measurements |
| `src/server/actions/*` | Server actions (auth, projects, upload) |
| `src/worker/index.ts` | pg-boss worker entrypoint |
| `src/app/*` | Pages: home, project, review, login |
| `src/components/*` | UI (shell, upload, PDF viewer, primitives) |

## Try it end to end

1. Configure `.env.local` (see [setup](./06-setup.md)) and run migrations.
2. `npm run dev` (web) **and** `npm run worker:dev` (worker) in two terminals.
3. Create a project → upload a tender PDF → watch the extraction go
   Queued → Reading → Ready → click **Review**.
