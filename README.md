# Airwright Platform

Scaffold estimating for **Airwright Midland** — Innate AI, Phase 1 · Build 1:
the **Quote & Take-off Engine**.

Read a house-builder's tender drawings, extract the scaffold measurements with
AI (human-in-the-loop), and produce a priced, reconcilable quote.

> **New here?** Start with [`docs/`](./docs/README.md) — project context, the
> PRD, the data model, the glossary and the full setup guide. This README is
> just the quickstart.

## Stack

Next.js 15 · TypeScript · Tailwind (monochrome) · Prisma · Supabase
(Postgres / Auth / Storage) · pg-boss worker · Claude (tool-use) · Render.
Details in [`docs/01-tech-stack.md`](./docs/01-tech-stack.md).

## Quickstart

```bash
npm install
cp .env.example .env.local          # fill in Supabase + Anthropic — see docs/06-setup.md
npx prisma migrate dev --name init
npm run db:seed                      # optional demo data

npm run dev                          # web  → http://localhost:3000
npm run worker:dev                   # extraction worker (separate terminal)
```

## Scripts

| Command | Does |
|---------|------|
| `npm run dev` | Next.js dev server |
| `npm run worker:dev` | pg-boss extraction worker (watch) |
| `npm run build` | `prisma generate` + `next build` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest |
| `npm run lint` | ESLint |
| `npm run db:migrate` | Prisma migrate (dev) |
| `npm run db:studio` | Prisma Studio |
| `npm run db:seed` | Seed demo client + rate card |

## Architecture (one line)

Upload → Supabase Storage + `Document` row → pg-boss job → worker runs
`extractDrawing()` (Claude tool-use, Zod-validated) → `Extraction` +
`Takeoff`/measurements → read-only review view (PDF.js + fields).

## Status

**Whole pipeline built & deployed on Render** — drawing → AI extract → editable review
(with provenance page links) → **confirm/lock** → per-plot pricing matrix → **immutable
quote** → Excel/print outputs. Runs on **placeholder rates** (Colin's rate sheet is the
one thing gating correct pricing). See [`PROGRESS.md`](./PROGRESS.md) and the canonical
specs: [`docs/11`](./docs/11-takeoff-engine-spec.md) (take-off),
[`docs/13`](./docs/13-extraction-playbook.md) (extraction playbook),
[`docs/14`](./docs/14-pricing-and-quote.md) (pricing & quote).
