# Terra — Texas CRE Job Tracker

A mobile app that aggregates commercial real estate internships and entry-level
roles **in Texas only**, tracks applications through a pipeline, highlights
postings that match the user's resume, and gives a per-city view of Texas CRE
market conditions.

## Repository

```
backend/            collector, match scoring, feed API   ← built
mobile/             the five screens, React Native / Expo ← built
site/               the public website (static, GitHub Pages)
client/
  data-source.js    production implementation of the UI's data contract
docs/handoff/       the design handoff: prototype, contract, spec
```

## Status

**Backend: built.** Schema, Greenhouse, Lever, Workday and iCIMS fetchers, the
normalizer and its filters, match scoring, the collector pass, the feed API, and
the pg_cron schedule — with 228 tests that need neither network nor a database.
See [`backend/README.md`](backend/README.md) for how to run it and what is
deliberately still open (the paid aggregator, quarterly market data).

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
| The website | GitHub Pages, built by `site.yml` | every 2 hours, and every push to the default branch |
| Tests and typecheck | GitHub Actions (`ci.yml`) | every push and pull request |
| Deployment check | GitHub Actions (`check-deployment.yml`) | every push to the default branch, daily |
| Job alert emails | GitHub Actions (`alerts.yml`) | daily at 13:00 UTC, or the Actions tab |
| Database migrations | GitHub Actions (`migrate.yml`) | a push to the default branch that adds a migration |

**The collector runs on Actions rather than Vercel Cron on purpose.** A Hobby
plan *rejects the deploy* for any schedule more frequent than daily, and the
spec calls for every two hours — so `vercel.json` carries no `crons` block at
all. Vercel also caps a function at 60 seconds, which a large Workday tenant
will outgrow. A runner has neither limit. To move the schedule to Vercel on a
Pro plan, see [`backend/README.md`](backend/README.md#vercel-serves-the-api-not-the-collector)
— and disable the workflow if you do, or two collectors will race.

### The website

`site/` is a static page that lists the current postings with search and
filters for city, firm, role type and sector. Filtered views live in the URL,
so a search can be sent as a link.

It needs no database and no secrets. `site.yml` runs a collector pass against
the live boards with the firm list from the seed migration
(`npm run export:site` in `backend/`), writes `site/postings.json`, and
publishes the folder to GitHub Pages. A run where no board answers fails
instead of publishing, so an outage never replaces the live site with an empty
one.

**One-time setup:** Settings → Pages → Build and deployment → Source:
**GitHub Actions**. Until then the workflow builds the site and skips the
publish with a notice. The site is then at
`https://thougthfullcarrot.github.io/Terra/`.

To look at it locally: `cd backend && npm run build:site && npm run export:site`,
then serve `site/` with any static server (`npx serve site`).

**Market data.** A second section, Market data, compares the six Texas
markets (Dallas and Fort Worth as their own metro divisions) by property type:
office, industrial and retail hiring, apartment vacancy and rents, population,
income and unemployment, sortable by any figure or opened one city at a time.
The figures come from the Bureau of Labor Statistics and the Census Bureau's
American Community Survey, plus city-level home values and asking rents from
Zillow Research, apartment rents and vacancy from Apartment List, and new homes
permitted from the Census Building Permits Survey, all free and public
(`npm run export:market` writes `site/market.json`). `site.yml` asks them once a day and caches the file; a
source that fails keeps its last figures, and figures no market has are hidden.
BLS needs no key. The Census needs `CENSUS_API_KEY` as an Actions secret (free,
instant: https://api.census.gov/data/key_signup.html); without it the
population, income, rent and vacancy figures are left out. `BLS_API_KEY`
(also free) is optional. Brokerage vacancy and asking-rent figures are licensed
and not shown.

**Property.** A third section has five tools built on free public records
(`npm run export:property` writes `site/property/`, cached by `site.yml`):
*Who owns this* searches the Harris, Dallas, Tarrant, Bexar and Travis
appraisal districts by address or owner (with All markets picked, any full Texas address, via the state's StratMap parcel map and the OpenStreetMap geocoder), then looks the owner up in the state
franchise-tax list and shows its other parcels. *Lease radar* lists recent
tenant build-outs of 10,000 sq ft or more from state accessibility filings
(TDLR TABS); lease end dates in 10-K filings appear when the `SEC_USER_AGENT`
Actions variable names a contact, e.g. `Terra you@example.com`, as the SEC
requires. *Distress tracker* lists property-tax auctions (Linebarger) and
Harris County's biggest delinquent commercial accounts. *Drive time* draws
10/20/30-minute drive areas (public Valhalla server) and counts the people
(Census ACS, needs `CENSUS_API_KEY`) and jobs (LODES) inside them. *Deal of
the week* picks the largest priced Texas sale in the news and walks through
cap rate and leverage; `backend/data/deal-of-week.json` overrides the pick.
County lease records and foreclosure postings aren't public in a readable form,
so they're not included.

**Accounts (optional).** With Supabase and Stripe settings in the repository,
the site requires sign-in: college (.edu) emails get it free, other emails
subscribe through Stripe, and everyone gets a profile with a picture and resume
that highlights their best-matching jobs. Without them it stays open. Setup,
click by click: [docs/accounts-setup.md](docs/accounts-setup.md).

**Google Sheet (optional).** With a free Google service account, the firm list
is edited in a sheet's Firms tab (the seed list is the fallback), and every run
copies the jobs, market data and sign-ups into the same sheet. Setup:
[docs/sheets-setup.md](docs/sheets-setup.md).

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

And one repository **variable** (same page, Variables tab — it is a public URL,
not a secret):

| Variable | Needed by |
| --- | --- |
| `DEPLOYMENT_URL` | `check-deployment.yml`, e.g. `https://terra-api.vercel.app` |

`check-deployment.yml` waits until the deployment reports the commit being
checked before going green. Vercel serves the previous deployment while a new
one builds, so a plain health poll can pass against old code; the API reports
its `VERCEL_GIT_COMMIT_SHA` at `/health` to make the difference visible. Without
the variable set the workflow skips with a warning rather than failing.

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
