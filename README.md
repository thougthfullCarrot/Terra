# Terra — Texas CRE Job Tracker

A mobile app that aggregates commercial real estate internships and entry-level
roles **in Texas only**, tracks applications through a pipeline, highlights
postings that match the user's resume, and gives a per-city view of Texas CRE
market conditions.

## Repository

```
backend/            collector, match scoring, feed API   ← built
mobile/             the five screens, React Native / Expo ← built
client/
  data-source.js    production implementation of the UI's data contract
docs/handoff/       the design handoff: prototype, contract, spec
```

## Status

**Backend: built.** Schema, Greenhouse and Lever fetchers, the normalizer and
its filters, match scoring, the collector pass, the feed API, and the pg_cron
schedule — with 102 tests that need neither network nor a database. See
[`backend/README.md`](backend/README.md) for how to run it and what is
deliberately still open (Workday/iCIMS, the paid aggregator, quarterly market
data).

**Front end: built, unverified.** All five screens plus the detail sheet and
the loading and error states, in React Native / Expo — see
[`mobile/README.md`](mobile/README.md). It typechecks and bundles, and runs
against the prototype's seed data with no backend. It has not been run on a
device or simulator, so the layout has not been checked against the prototype
by eye.

The HTML prototype it was built from is
`docs/handoff/Terra - Texas CRE Job Tracker.dc.html` — a design reference, not
code that was ported. Tokens, screen specs and states are in
[`docs/handoff/README.md`](docs/handoff/README.md) and they are final.

## Running it without a local machine

Nothing in this project needs to run on your computer. The split:

| What | Where it runs | Trigger |
| --- | --- | --- |
| The read API | Vercel, deployed from this repo | every push to the default branch |
| The collector | GitHub Actions (`collect.yml`) | every 2 hours, or the Actions tab |
| Firm slug checks | GitHub Actions (`verify-firms.yml`) | weekly, or the Actions tab |
| Tests and typecheck | GitHub Actions (`ci.yml`) | every push and pull request |

**The collector runs on Actions rather than Vercel Cron on purpose.** A Hobby
plan *rejects the deploy* for any schedule more frequent than daily, and the
spec calls for every two hours — so `vercel.json` carries no `crons` block at
all. Vercel also caps a function at 60 seconds, which a large Workday tenant
will outgrow. A runner has neither limit. To move the schedule to Vercel on a
Pro plan, see [`backend/README.md`](backend/README.md#vercel-serves-the-api-not-the-collector)
— and disable the workflow if you do, or two collectors will race.

### Connecting the repo to Vercel

1. [vercel.com/new](https://vercel.com/new) → import this repository.
2. **Set Root Directory to `backend`.** The project is a subdirectory, and
   Vercel defaults to the repo root. This is the step that is easy to miss.
3. Add the environment variables from
   [`backend/README.md`](backend/README.md#deploying-to-vercel).
4. Deploy. Every later push to the default branch redeploys on its own; pull
   requests get their own preview URL.
5. Check `https://<deployment>/health` returns `{"ok":true}`.

### Repository secrets for the workflows

Settings → Secrets and variables → Actions:

| Secret | Needed by |
| --- | --- |
| `SUPABASE_URL` | `collect.yml` |
| `SUPABASE_SERVICE_ROLE_KEY` | `collect.yml` |
| `EXPO_ACCESS_TOKEN` | `collect.yml`, optional |

`verify-firms.yml` needs no secrets — it only reads public job boards, which is
why it is the one to run first.

Note that **scheduled workflows only fire from the repository's default
branch**, so the cron schedules follow whichever branch that is.

## The seam between the two halves

`client/data-source.js` is the app's only data layer, and its exports are the
contract:

```js
SOURCE = { name, endpoint, poll, transport }
fetchFeed({ state })  -> { jobs, match, markets, syncedAt: Date }   // throws Error on failure
fetchMarkets()        -> markets
simulateFailure()     // dev only
```

The version in `client/` implements those signatures against the real API. The
version in `docs/handoff/` is the same shape backed by seed data — useful for
building screens before pointing them at a live backend. Keep the signatures
and the two are interchangeable.

The server does the joining, the date math, and the match scoring, so screens
render what they are handed.
