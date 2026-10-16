---
name: migration-number
description: Pick the next Supabase migration number and place the file correctly. Use before creating any new SQL migration.
---

# Picking a migration number

Migrations live in two folders, and numbers are shared across both:

- `backend/supabase/migrations/` holds applied (or auto-applied) migrations. Anything pushed here is run against production by `.github/workflows/migrate.yml`.
- `backend/supabase/pending/` holds migrations waiting for Rod's approval.

Steps:

1. List both folders and take the highest number from either:
   ```bash
   ls backend/supabase/migrations backend/supabase/pending | grep -oE '^[0-9]{4}' | sort -n | tail -1
   ```
   The next migration is that number plus one, zero-padded to four digits.
2. Also check open PRs and other branches for a migration using the same number before committing.
3. New migrations go in `pending/` unless Rod approved applying them. Moving a file into `migrations/` applies it to production on merge, so that needs Rod's explicit OK.
4. Add a matching rollback in `backend/supabase/rollback/` when the change is not trivially reversible.
5. Run `npm run test:db` in `backend/` (throwaway local Postgres, never Supabase) to check RLS and limits.
