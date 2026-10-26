# Free access rollout

TERRA is free for everyone: any account with a confirmed email gets the whole
app. Sign-in (the emailed 6-digit code) is still required, and it is what
confirms the address.

## What ships where

| Piece | File | Takes effect |
| --- | --- | --- |
| Landing, welcome screen, tour, sign-up form | `site/` | When the PR merges (site.yml deploys on push) |
| Database rule: any confirmed email is a member | `backend/supabase/pending/0021_free_access.sql` | Only when moved to `supabase/migrations/` (migrate.yml applies new files there) |
| Undo | `backend/supabase/rollback/0021_free_access_rollback.sql` | Run by hand in the Supabase SQL editor |

The site and the database rule must go live together. If the site deploys
first, a non-.edu visitor can create an account but sees "Your account isn't
open yet" until the migration runs.

## Rollout

1. Take a table export of `profiles`, `tracked_jobs`, `watchlist_items` and `subscriptions` (Supabase Free has no automatic backups).
2. In the same merge, move `pending/0021_free_access.sql` to `migrations/` so migrate.yml applies it as the site deploys.
3. Check with a gmail test account: sign up, enter the code, land on the welcome screen, see jobs, save one to the tracker.

## What does not change

- Stripe, the webhook and existing `subscriptions` rows are untouched. Current subscribers keep their "Manage subscription" link so they can cancel themselves; nothing is cancelled automatically.
- Signed-out visitors and unconfirmed accounts still see no protected data (`site_snapshots`, tracker, watchlists).
- Every per-user table keeps its own-rows-only policies; admin and service-role access is unchanged.
- Alert and watch-digest emails still need the member's own opt-in. More members could mean more emails through the Gmail SMTP limit (100/hour).
