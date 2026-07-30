# 01 · Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | **Next.js 15** (App Router, TS) | Server Actions + Route Handlers |
| UI | **Tailwind v3** + minimal shadcn-style primitives | Monochrome, light mode only |
| Font | **Manrope** (`next/font`) | Single family, tight tracking on headings |
| Forms | React Hook Form + **Zod** | Zod validates every boundary |
| PDF render | **PDF.js** via `react-pdf` | Client-only, worker bundled locally |
| ORM | **Prisma 6** | Owns the schema + migrations |
| DB | **Supabase Postgres** (EU/UK) | Prisma connects; not the Supabase data API |
| Auth | **Supabase Auth** (magic link) | `@supabase/ssr`, gated in middleware |
| Storage | **Supabase Storage** (private bucket) | Signed URLs only |
| Queue | **pg-boss** | On `DIRECT_URL` (not PgBouncer) |
| AI | **Claude** (Anthropic API), Opus for extraction | Tool-use + prompt caching |
| Export | ExcelJS (Week 4) | Client-format quote export |
| Hosting | **Render** — web service + worker | Same region as Supabase |
| CI | GitHub Actions | typecheck, lint, test |
| Errors | Sentry | Fast-follow (env var present) |

## The two connection strings (important)

Supabase gives two Postgres URLs and this app needs **both**:

- **`DATABASE_URL`** — pooled (PgBouncer, port 6543, `?pgbouncer=true`). Used by
  the Next.js app via Prisma.
- **`DIRECT_URL`** — direct (port 5432). Used by **Prisma migrations** AND the
  **pg-boss worker** (pg-boss needs `LISTEN/NOTIFY` + advisory locks, which do
  not work through PgBouncer).

## Two processes

1. **Web** (`npm run start`) — the Next.js app.
2. **Worker** (`npm run worker`) — a separate Node process running pg-boss that
   does the Claude extraction. On Render these are two services.

## Design principle

Prisma owns the schema; Supabase is used purely for **Postgres + Auth + Storage**,
not its auto-generated REST/data API — so there is one source of truth.
