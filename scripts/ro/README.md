# scripts/ro — read-only database scripts

Scripts here are run by Claude to ANSWER QUESTIONS about the data. They are
bound, by construction, to a read-only path:

- They run with `--env-file-if-exists=.env.readonly`, which contains ONLY
  `READONLY_DATABASE_URL`. The service-role key, the Anthropic key and the
  writable `DATABASE_URL` are never in scope.
- `READONLY_DATABASE_URL` authenticates as the Postgres role `claude_ro`,
  which holds `SELECT` on `public` and nothing else (no INSERT/UPDATE/DELETE,
  no DDL, `rolbypassrls = false`, so RLS still applies).

So a script here cannot write even if it tries — the grant is missing at the
database, not just absent from the code.

Run one with:

    node --env-file-if-exists=.env.readonly ./node_modules/.bin/tsx scripts/ro/<name>.mts

Rules for anything added here:
1. SELECT only. No `create`/`update`/`delete`/`upsert`/`$executeRaw`.
2. Never print a secret, and never print more client PII than the question needs.
3. Keep them throwaway — they are diagnostics, not part of the app.

To revoke all of this: drop the role (`drop owned by claude_ro; drop role claude_ro;`),
delete `.env.readonly`, and remove the allow rule from `.claude/settings.local.json`.
