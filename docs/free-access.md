# Free access rollout

TERRA is free for everyone: any account with a **confirmed** email gets the
whole app. Sign-in (the emailed 6-digit code) is still required, and it is
what confirms the address. An unconfirmed account gets nothing, even with an
active or trialing subscription.

## The pieces

| Piece | File | Takes effect |
| --- | --- | --- |
| Landing, welcome screen, tour, sign-up form | `site/` | When site.yml deploys, and only if the free-access gate passes |
| Database rule | `backend/supabase/pending/0021_free_access.sql` | Only when moved to `backend/supabase/migrations/` and merged (migrate.yml runs files a push adds there) |
| Free-access gate | `.github/scripts/free-access-gate.sh`, a step in site.yml's `deploy` job | Every deploy |
| Undo | `backend/supabase/rollback/0021_free_access_rollback.sql` | Run by hand in the Supabase SQL editor |

## Enforced sequencing

The migration must succeed before the free-access site deploys. This is
enforced, not assumed:

- 0021 creates `public.free_access_version()`, which answers `21`.
- Before publishing, site.yml's deploy job runs the gate. It calls that function
  anonymously on the live project. Any other answer fails the job and nothing
  publishes: the migration failed, was skipped, hasn't run yet, or the call
  errored.
- So merging PR #98 before the migration is safe but stops every deploy,
  including the two-hourly job refresh, until the migration lands. The live site
  keeps its last published version until then.
- Missing or incomplete account settings fail closed. TERRA never falls back
  to an open, no-sign-in site in production:
  - site.yml's "Write account settings" step fails a non-pull-request build
    when `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` is
    missing.
  - `.github/scripts/production-site-check.sh` runs on the built folder before
    packaging. It fails unless `config.js` names a Supabase project and anon
    key, and no members-only file (`postings.json`, `market.json`,
    `developments/`) is in it.
  - The free-access gate fails when either setting is missing.
- Pull-request builds and local or fixture previews (`npm run build:site`, the
  browser checks) don't run these production checks and are never deployed.
- `backend/test/deployGates.test.ts` covers every case: missing, partial or
  empty settings, migration not applied, database unreachable, open-site
  config, and members-only files present.

## Exact sequence (each production step waits for Rod's approval)

1. **Read-only checks:** run the billing audit below and record the results.
   Confirm `select count(*) from pg_proc where proname = 'free_access_version'`
   returns 0, so 0021 isn't already applied.
2. **Backup:** export `profiles`, `tracked_jobs`, `watchlist_items` and
   `subscriptions` as CSV from the Supabase table editor. Supabase Free has no
   automatic backups. Keep the files off GitHub.
3. **Apply the migration:** open a one-file PR that moves
   `pending/0021_free_access.sql` to `migrations/` and nothing else. When Rod
   merges it, migrate.yml applies exactly that file. Check the run's summary
   says `0021_free_access.sql: applied`. If it failed, stop: the gate keeps the
   old site live.
4. **Verify the database** (SQL editor, read-only):
   - `select public.free_access_version();` returns `21`.
   - `select pg_get_functiondef('public.access_level()'::regprocedure);` shows
     the `email_confirmed_at is null then 'none'` line first.
5. **Merge PR #98.** The site build runs, the gate passes, and Pages deploys.
6. **Verify the site** with a gmail test account: sign up with "Create free
   account", enter the code, land on the welcome screen, see jobs, save one to
   the tracker. Signed out, the landing page shows and no jobs load.

If PR #98 is merged first, the step-3 push also starts a Website build, because
site.yml watches `backend/**`. That build may reach the gate before migrate.yml
finishes and stop without deploying, which is harmless. After step 4, run the
"Website" workflow by hand or wait for the next scheduled build.

## Which migrations will run

migrate.yml runs only files that a push **adds** under
`backend/supabase/migrations/` (`.github/scripts/new-migrations.sh`):

- PR #98 adds no file there. Checked with
  `new-migrations.sh origin/claude/new-session-6xvm0u HEAD backend/supabase/migrations`,
  which printed nothing.
- The step-3 PR adds only `0021_free_access.sql`.
- `pending/0019_development_reports.sql` stays in `pending/` and isn't touched.

## Rollback

1. Revert PR #98's site (a revert PR on the default branch) **first**, so the
   site stops promising free access.
2. Run `rollback/0021_free_access_rollback.sql` in the SQL editor. It restores
   the 0005/0007/0008/0017 definitions: college email or active subscription.
   It also drops `free_access_version()`, which re-arms the gate.
   Note: the original 0005 rule let an unconfirmed account with an active
   subscription in; rolling back restores that.
3. Check `select public.free_access_version();` now errors (function does not
   exist).

Rolling back keeps accounts, saved jobs, tracker rows, profiles and
subscriptions as they are. Only who can read changes.

## Billing: leaving Stripe untouched does NOT stop charges

This PR and migration don't touch Stripe, the webhook or `subscriptions`.
That means **any active subscription keeps renewing and charging** at its next
period. Making TERRA free doesn't cancel anything. The site no longer shows a
Subscribe button, and current subscribers keep their "Manage subscription"
link (if `STRIPE_BILLING_PORTAL_LINK` is set) so they can cancel themselves.

Read-only audit status: **not run yet.** The cloud session that built this PR
wasn't allowed to read production Stripe or Supabase. Rod (or a session he
authorizes) should check, read-only:

- Stripe Dashboard → Developers → API keys: is the account in test or live
  mode? (As of 2026-10-05 it was test mode, with Rod's own test subscription.)
- Stripe Dashboard → Subscriptions, filter **Active**, **Trialing** and
  **Past due**: the count, whether each is live mode, its next invoice date and
  amount, and whether it's set to cancel.
- Stripe Dashboard → Payment Links: whether the $10/month link is still active.
  Anyone holding the URL could still subscribe.
- Supabase SQL editor:
  `select status, count(*) from public.subscriptions group by 1;`

Stopping future charges (cancel at period end, refunds, deactivating the
payment link, unsetting `STRIPE_PAYMENT_LINK`/`PRICE_LABEL`) is a separate
billing decision for Rod. This PR doesn't do it.

## What doesn't change

- Signed-out visitors and unconfirmed accounts still see no protected data
  (`site_snapshots`, tracker, watchlists).
- Every per-user table keeps its own-rows-only policies. Service-role and admin
  access are unchanged.
- Alert and watch-digest emails still need a confirmed address and the member's
  own opt-in. More members could mean more emails through the Gmail SMTP limit
  (100/hour).
