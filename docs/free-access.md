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

The rollout is two pieces, both prepared and both unmerged:

- **PR #98** (`claude/project-thread-8f1v1x`): site, gates, tests. 0021 sits in
  `pending/`, so merging #98 alone applies no migration. Its deploy would fail
  at the free-access gate and the live site stays as it is.
- **Rollout PR** (`claude/free-access-rollout`, based on #98): one commit that
  moves `pending/0021_free_access.sql` to `migrations/`, unchanged. It targets
  #98's branch, so merging it touches no production.

Steps:

1. **Read-only checks:** billing audit (below; done for the sandbox account).
   In the SQL editor, `select count(*) from pg_proc where proname = 'free_access_version'`
   must return 0.
2. **Backup:** export `profiles`, `tracked_jobs`, `watchlist_items` and
   `subscriptions` as CSV from the Supabase table editor. Supabase Free has no
   automatic backups. Keep the files off GitHub.
3. **Approve the rollout:** merge the rollout PR into #98's branch.
4. **Merge PR #98** into `claude/new-session-6xvm0u`. That push starts two
   workflows:
   - **Database migrations** applies exactly `0021_free_access.sql`. Check its
     summary says `applied`. If it failed, stop: the gate keeps every deploy
     blocked and the old site stays live.
   - **Website** builds the new site. Its deploy job runs the production site
     check and the free-access gate. If it reached the gate before the
     migration finished, it stops without deploying. Run "Website" again by hand
     (or wait for the next 2-hourly build) once step 5 passes.
5. **Verify the database** (SQL editor, read-only):
   - `select public.free_access_version();` returns `21`.
   - `select pg_get_functiondef('public.access_level()'::regprocedure);` shows
     `when u.email_confirmed_at is null then 'none'` first.
6. **Verify the site** with a gmail test account: "Create free account", enter
   the code, land on the welcome screen, see jobs, save one to the tracker.
   Signed out, the landing page shows and no jobs load. An account that never
   entered its code sees nothing.

## Which migrations will run

migrate.yml runs only files that a push **adds** under
`backend/supabase/migrations/` (`.github/scripts/new-migrations.sh`):

- PR #98 adds no file there (checked with the command below), and the rollout PR adds only `0021_free_access.sql`. Checked with
  `new-migrations.sh origin/claude/new-session-6xvm0u HEAD backend/supabase/migrations`,
  which printed nothing.
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

Read-only audit (2026-10-26, checked by Rod in the Stripe Dashboard):

- The Stripe account behind TERRA's payment link is **sandbox-only**. It
  requires business verification before it can accept real payments, and
  that hasn't been done.
- The one visible $10 transaction is a **test payment**.
- **No live billing was found in this account.**
- Not independently checked: other Stripe accounts, and which keys the
  production configuration (`STRIPE_SECRET_KEY`, `STRIPE_PAYMENT_LINK`,
  webhook) points at. The cloud session couldn't read them.
- Rod's instruction: don't activate live payments or verify the business.

To re-check later, read-only: Stripe Dashboard → Subscriptions (Active,
Trialing, Past due) and Payment Links; Supabase SQL editor
`select status, count(*) from public.subscriptions group by 1;`.

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
