# Watchlists (TERRA Pro MVP)

Members can follow a market's figures, new project filings in a metro, or a single project, and get a daily or weekly email of what changed. College (.edu) members get it free, like the rest of the site; anyone else needs the existing subscription. Billing is unchanged.

**Everything is off until launch.** Nothing is visible or sent, and nothing new is written to Supabase, until both launch steps below are done.

## Launch steps (Rod's approval needed for each)

1. **Apply the migration.** Move `backend/supabase/pending/0016_watchlists.sql` to `backend/supabase/migrations/` and merge. On that push, migrate.yml applies it to the production database. It only adds tables, columns (with defaults), and functions. It drops and renames nothing.
2. **Switch it on.** Set the repository variable `WATCHLISTS_ENABLED` to `true`. That:
   - shows the Follow buttons and the profile's Watchlist section (site.yml writes `watchlists: true` into config.js);
   - stores a compact copy of each day's market figures in `market_history` (site.yml, default branch only, never on pull requests);
   - sends watchlist digests and adds an unsubscribe link to job alerts (alerts.yml).

To switch it off again, set the variable to anything else. The tables stay and can be dropped later, as a separate step.

No new secret is needed. The unsubscribe key is generated inside the database by the migration and read only by the service role.

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
