# Watchlists (TERRA Pro MVP)

Members can follow a market's figures, new project filings in a metro, or a single project, and get a daily or weekly email of what changed. College (.edu) members get it free, like the rest of the site; anyone else needs the existing subscription. Billing is unchanged.

**Everything is off until launch.** Nothing is visible or sent, and nothing new is written to Supabase, until the migration is applied and `WATCHLISTS_ENABLED` is set. Even then, only listed testers can use it until the private beta is switched off.

## Private beta (on by default)

Migration 0017 starts in **private beta**. Only accounts listed in `private.watch_testers` can read, add or change watchlist items, and only they get digests. The database enforces this in four places:

- every row policy on `watchlist_items` and `watch_sends`;
- `watch_recipients()`, which lists who gets a digest;
- `watch_beta_access()`, which the site calls to decide whether to show the watchlist. It answers only for the signed-in member, and visitors can't call it.

The tester list and the switch sit in the `private` schema, which members, visitors and the website can't read. No tester id goes in the repository, a variable or a site file.

Testers are added in the Supabase SQL editor, by email:

```sql
insert into private.watch_testers (user_id)
select id from auth.users where email = 'you@example.edu'
on conflict do nothing;
```

To remove a tester, delete their row. Deleting the account removes it too.

To open watchlists to every eligible member at launch, after Rod approves:

```sql
update private.watch_settings set private_beta = false;
```

## Launch steps (Rod's approval needed for each)

1. **Apply the migration.** Move `backend/supabase/pending/0017_watchlists.sql` to `backend/supabase/migrations/` and merge. On that push, migrate.yml applies it to the production database. It only adds tables, columns (with defaults), and functions. It drops and renames nothing, and the private beta starts on with no testers, so nobody can use watchlists yet.
2. **Add testers.** Use the SQL above.
3. **Switch it on.** Set the repository variable `WATCHLISTS_ENABLED` to `true`. That:
   - shows the Follow buttons and the profile's Watchlist section, to testers only during the beta (site.yml writes `watchlists: true` into config.js);
   - stores a compact copy of each day's market figures in `market_history` (site.yml, default branch only, never on pull requests);
   - sends watchlist digests (to testers only during the beta) and adds an unsubscribe link to every job alert (alerts.yml).
4. **End the beta.** Set `private_beta` to false, as above.

To switch it off again, set the variable to anything else. The tables stay.

## Rollback

From least to most drastic:

1. **Stop everything.** Set `WATCHLISTS_ENABLED` to `false`. On the next build the UI is hidden and digests stop. Nothing is deleted.
2. **Back to testers only.** In the SQL editor, run `update private.watch_settings set private_beta = true;`.
3. **Remove 0017 completely.** Run `backend/supabase/rollback/0017_watchlists_rollback.sql` in the SQL editor, after step 1 and with Rod's approval.
   - It deletes every watchlist, the send log, the history and the tester list.
   - It doesn't touch accounts, profiles' other columns, subscriptions, job alerts, the tracker or the snapshots.
   - Job alert unsubscribe links that were already sent stop working; members can still turn alerts off in their profile.
   - `npm run test:db` runs this rollback on a throwaway database. It checks that accounts, billing rows and job-alert settings are unchanged, and that 0017 can be applied again afterwards.

## Backups (checked 2026-10-11)

The Supabase docs say daily backups are automatic for "Pro, Team, and Enterprise Plan projects". Point-in-time recovery is a paid add-on. For free projects, Supabase recommends exporting data regularly with the Supabase CLI ([docs](https://supabase.com/docs/guides/platform/backups)). So on the Free plan, do not count on a dashboard restore.

Before applying the migration, export a copy yourself. Two free ways:

- the Supabase CLI: `supabase db dump`, with the database password;
- the SQL editor's CSV export of `profiles` and `subscriptions`.

Keep the copy off GitHub. Artifacts from this public repository can be downloaded by other people. 0017 only adds objects, so the rollback script, not a restore, is the normal way back.

## What members can follow

| Item | Emails about |
|---|---|
| A market (city page, "Follow this market") | Each figure that changed since the last digest, a figure no longer published, and sources that fell behind schedule |
| One figure (city page, "Follow one figure") | Any change, or only when it rises above or falls below a value the member sets |
| New filings in a metro (development map) | New TDLR TABS registrations in the metro's counties, and new city building permits where the city publishes them |
| A project (map pin) | Status, estimated finish date and cost changes, and leaving the map |

The limit is 25 items per member, enforced by the database trigger `watchlist_limit()`. Digests default to weekly, and members can pick daily.

## How to describe the data

TDLR TABS is **the public record of projects registered under the Texas Architectural Barriers Act**. Projects with an estimated cost of $50,000 or more must register, and private residences are outside the law ([TDLR: EAB at a glance](https://tdlr.texas.gov/media/pdf/eab-at-a-glance.pdf)). Do not call it all commercial construction in Texas. Every digest that includes filings says so.

### Coverage checks

The map's TABS read is capped: it keeps only the biggest projects per metro. Alerts use a separate read (`backend/src/market/registrations.ts`):

- It reads the last 10 days of filings per county, 500 rows a page, up to 10 pages, with no cost cut.
- It compares the rows read with the total TABS reports (`recordsFiltered`). A county is complete only when the two match.
- It catches a search that ignores the page offset, since that returns repeated rows.
- Each county's result is stored in `registrations.coverage` and logged as "TDLR TABS new registrations: … N of M counties complete; …". It also shows as `partial` in the Sources line, and digests name any county that was incomplete, unverified (TABS gave no total) or not read.

TDLR's robots.txt could not be read from the development sandbox. The site already reads TABS for the map, with pauses between requests. The new read adds about 40 search requests a day, with no page reads.

## Email delivery and duplicates

`backend/src/alerts/sendWatch.ts` documents the order of operations. In short:

1. Changes the send log (`watch_sends`) already marks `sent` or `failed` are skipped.
2. Before sending, the run claims the rest as `pending` and adds one to their attempt count. If the claim can't be written, nothing is sent to that member.
3. A refused send leaves the rows `pending`, and the next run retries them. After 3 attempts they are marked `failed` and dropped.
4. A `pending` row left by a run that stopped is **not** assumed delivered. The digest day only moves forward after a confirmed send, so the next run rebuilds the same changes and retries them. In the rare case where the run died right after Gmail accepted the email, this can repeat that email once, bounded by the attempt limit.
5. Changes that Gmail accepted but the run couldn't mark `sent` are counted as "sent but not confirmed". The digest day still moves on, so those changes are not rebuilt.

The run log reports counts only, never an address. Manual runs of alerts.yml are dry runs by default and send nothing.

Unsubscribe links carry an HMAC of the member's id and the kind of email (`jobs` or `watch`). The site page calls `unsubscribe_alerts()`, which checks the signature in the database and can only turn emails off. Emails also carry a `List-Unsubscribe` header pointing at the same link. Gmail's one-click POST form (RFC 8058) is not supported, because the site is static. That form is required only of senders of 5,000 or more messages a day.

## Free-tier limits (checked 2026-10-10)

| Service | Limit | Use with watchlists |
|---|---|---|
| Gmail (personal account) | 500 emails a day ([Gmail help](https://support.google.com/mail/answer/22839)), shared with sign-in codes | Job alerts and digests share `ALERT_MAX_EMAILS` (300). About 300 daily-digest members, or about 2,000 weekly. Past the cap, digests wait a day. |
| Supabase Free | 500 MB database, 5 GB egress a month, 50,000 monthly users, 500,000 edge function calls; paused after 1 week inactive ([pricing](https://supabase.com/pricing)) | `market_history` is about 300–700 KB a day, so roughly 30–60 MB for 90 days. Digest runs read about 8–15 days of history per distinct baseline. The site writes every 2 hours, so the project never goes inactive. |
| GitHub Actions | Free for public repositories | About 1 extra minute per Website run for the registrations read |

These are not unlimited. If Gmail or Supabase usage nears its limit, the next step is a free tier elsewhere (Resend, Brevo) or a paid plan, which needs Rod's approval.

## Tests

- `npm test`: the rules, events, email, send log logic, coverage checks and site helpers.
- `npm run test:db`: starts a throwaway local Postgres, loads every migration plus `pending/`, and checks the following on a real database. Nothing touches Supabase.
  - row-level security for members, non-members, lapsed subscribers and visitors;
  - the 25-item limit, including two adds racing for the last place;
  - that only the service role can reach the history, send log and secret;
  - `watch_recipients()`;
  - the unsubscribe signature;
  - that the migration can run twice.
