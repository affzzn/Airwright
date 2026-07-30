# 06 · Setup Guide

Everything you need to stand this up locally and on Render.

---

## 1. Supabase (Database + Auth + Storage)

1. Create a Supabase project in an **EU/UK region** (data residency — pay and
   client data is sensitive). Note the project ref.
2. **Database → Connect** and copy **both** connection strings:
   - **Pooled** (Transaction, port **6543**) → `DATABASE_URL` (append
     `?pgbouncer=true`).
   - **Direct** (Session, port **5432**) → `DIRECT_URL`.
3. **Project Settings → API**: copy the **Project URL**, the **anon** key, and
   the **service_role** key.
4. **Storage → Create bucket** named `tender-packs`, **Private**. (Keep it
   private — the app serves files via short-lived signed URLs.)
5. **Authentication → Providers → Email**: enable it (magic link is fine).
   Under **URL Configuration**, add your redirect URLs:
   `http://localhost:3000/auth/callback` and the Render URL's
   `/auth/callback`.

## 2. Anthropic

Create an API key at console.anthropic.com → `ANTHROPIC_API_KEY`. Pin the model
id in `ANTHROPIC_EXTRACTION_MODEL` (default `claude-opus-4-8`).

## 3. Local env

Copy `.env.example` → `.env.local` and fill every value from steps 1–2.

## 4. Local run

```bash
npm install
npx prisma migrate dev --name init   # creates tables in Supabase
npm run db:seed                       # optional: demo client + rate card
# two terminals:
npm run dev            # web  → http://localhost:3000
npm run worker:dev     # extraction worker
```

Sign in with your email (magic link), create a project, upload a tender PDF.

## 5. Render (deployment)

Two services live in `render.yaml`, both in **Frankfurt** (match your Supabase
region):

- **`airwright-web`** — web service, `npm run build` / `npm run start`.
- **`airwright-worker`** — background worker, `npm run worker`.

Steps:

1. Push the repo to GitHub.
2. Render → **New → Blueprint** → point at the repo (`render.yaml` is detected).
3. Create an **Env Group** called `airwright-secrets` with **all** the env vars
   from `.env.example` (both services reference it). Set `NEXT_PUBLIC_SITE_URL`
   to the web service's URL.
4. Run the migration against production once:
   `npm run db:deploy` (locally with prod `DATABASE_URL`, or a Render job).
5. Enable **PR preview environments** in the Render dashboard.

## 6. Environment variables (complete list)

| Var | Where from | Used by |
|-----|-----------|---------|
| `DATABASE_URL` | Supabase pooled (6543) | app (Prisma) |
| `DIRECT_URL` | Supabase direct (5432) | migrations + worker (pg-boss) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API | auth (browser + server) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API | auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API | Storage (server only) |
| `SUPABASE_STORAGE_BUCKET` | `tender-packs` | Storage |
| `ANTHROPIC_API_KEY` | Anthropic | extraction |
| `ANTHROPIC_EXTRACTION_MODEL` | e.g. `claude-opus-4-8` | extraction |
| `NEXT_PUBLIC_SITE_URL` | your URL | auth redirect |
| `SENTRY_DSN` | Sentry (optional) | errors (fast-follow) |

## 7. Fast-follow (not blocking Week 1)

- **Sentry** — run `npx @sentry/wizard@latest -i nextjs` and add the worker init.
- **Uptime check** (Better Stack) on the web `/login` health path.
- **RLS** — enable Row-Level Security on the Postgres tables as defence-in-depth
  (the app uses Prisma with the service role, but RLS protects against any future
  direct data-API access).
