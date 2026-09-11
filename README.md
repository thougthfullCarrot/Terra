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
