# Terra backend

Collector, match scoring, and feed API for the Texas CRE job tracker. Built
against the spec in [`docs/handoff/README.md`](../docs/handoff/README.md).

```
src/
  collector/        fetch -> filter -> classify -> normalize -> dedupe
    sources/        Greenhouse and Lever clients
    run.ts          the pipeline, one pass
  matching/         resume scoring, the note and lines the UI renders
  api/              feed reader, serializers, the HTTP handler
  db/               Store interface, Supabase and in-memory implementations
  notify/           Expo push
supabase/
  migrations/       schema, firm seed, market seed, pg_cron schedule
test/               102 tests, no network and no database required
```

## Getting it running

```bash
npm install
cp .env.example .env          # fill in SUPABASE_URL and the service role key

# apply migrations
supabase db push              # or paste supabase/migrations/*.sql in the SQL editor

npm test                      # everything below is covered here
npm run collect -- --dry      # poll the real boards, write nothing
npm run collect               # a real pass
npx tsx src/bin/serve.ts      # the API on :8787
```

**Before the first real run, verify the firm slugs.** `0002_seed_firms.sql`
ships 30 firms with *guessed* ATS slugs, and a clever collector pointed at 30
wrong slugs produces an empty feed that looks like a clean run.

```bash
npm run verify:firms            # check the seed, no database or credentials needed
npm run verify:firms -- --sql   # also print fix-up SQL for the misses
npm run verify:firms -- --from-db
```

It reports three outcomes, because they need different fixes:

| | meaning | what to do |
| --- | --- | --- |
| `OK` | board answered, has Texas entry-level roles | nothing |
| `EMPTY` | board answered, nothing in the funnel today | nothing — the slug is right |
| `FAIL` | board did not answer | fix the slug, or deactivate the firm |

Needs outbound access to `boards-api.greenhouse.io` and `api.lever.co`. If
every firm fails identically the script says so rather than blaming the slugs —
that is an egress problem, not a firm list problem.

After a real collector pass the same information is in the table:

```sql
select name, ats, ats_slug, slug_verified, last_error from firms order by slug_verified, name;
```

## The pipeline

One pass, exactly the order in the spec:

| Stage | Where | Notes |
| --- | --- | --- |
| fetch | `collector/sources/*` | Greenhouse and Lever. Timeouts, bounded retries; a 404 is not retried because a wrong slug will not fix itself. |
| Texas filter | `collector/texas.ts` | Six tracked cities plus suburb roll-up (Plano → Dallas, Arlington → Fort Worth). Rejects `Austin, MN`. |
| seniority filter | `collector/seniority.ts` | Intern / entry titles; an explicit board level field overrides the title in both directions. `Analyst I` in, `Analyst II` out. |
| sector | `collector/sector.ts` | Keyword scoring, title weighted 3×. Reports "no match" rather than guessing; the run counts how often that happens. |
| normalize | `collector/normalize.ts` | Pay, deadline, requirement bullets, provenance. |
| dedupe | `collector/id.ts` | `sha1(firm + role + city)`, case- and whitespace-insensitive, so the same seat on two boards collapses. |
| upsert | `db/*` | `first_seen` survives; `last_seen` bumps. |
| expire | `Store.deactivateStale` | `active = false` after 14 days unseen. |
| score | `matching/score.ts` | New rows only, against every profile. |
| push | `notify/expo.ts` | Strong matches only, gated by the profile's alert prefs. |

Every stage's drop count lands in the run report. A run that keeps zero
postings exits non-zero — a quiet empty feed is the failure that matters.

## Match scoring

`matching/score.ts`, weights straight from the spec: skills 40%, location 20%,
class year 20%, sector 20%. At **92 or above** a posting is a strong match and
the UI highlights it.

Two judgement calls worth knowing about:

- **Silence is not zero.** A posting that states no class requirement scores
  0.7 on that component rather than 0. Scoring silence as a failure would bury
  a good posting under a worse one that merely listed its requirements.
- **The note and lines are evidence-driven.** `note` is `city · skill · class
  standing`, and each of the three parts is dropped when there is nothing real
  behind it. `lines` never claims a skill overlap the resume does not have.

## The API

Web-standard `(Request) => Response` in `api/handler.ts`, so it runs on Node,
Deno, Bun, Vercel, or a Supabase Edge Function unchanged.

| Route | Returns |
| --- | --- |
| `GET /v1/postings?state=TX&city=Austin&level=intern,entry` | `{ jobs, match, markets, syncedAt }` — the `fetchFeed()` contract |
| `GET /v1/markets` | the Market screen's dataset |
| `POST /v1/collect` | runs one pass; requires `x-collector-secret` |
| `GET /health` | `{ ok: true }` |

`GET /v1/postings` reads the caller's Supabase JWT to attach their match
scores. Without one the feed still loads, just unscored: postings are public,
scoring is personal.

Dates go over the wire resolved. The DB stores `posted_at` and `deadline`; the
API sends `posted: 1` and `days: 22`, so every client agrees on the day count
and none of them do timezone math. Same for provenance — `source` is stored as
a stem and the ", verified 2 days ago" half is appended from `last_seen` at
read time, because stored text would be wrong within a day.

## Scheduling

`supabase/migrations/0004_cron.sql` schedules `0 */2 * * *` through pg_cron,
calling `POST /v1/collect` over pg_net. The endpoint and secret live in
Supabase Vault, so nothing sensitive is in the repo:

```sql
select vault.create_secret('https://api.yourapp.dev/v1/collect', 'collector_url');
select vault.create_secret('<COLLECTOR_SECRET>', 'collector_secret');
```

Any other scheduler works too — `npm run collect` is a self-contained pass.

## Not built yet

- **Workday and iCIMS fetchers.** Both need per-tenant endpoints; `firms.ats_host`
  is in the schema for them. `defaultFetcher` throws a named error for now, and
  the run report records it per firm.
- **The aggregator source** (Adzuna or JSearch, ~$30/mo). `RawJob.ats` already
  has an `'aggregator'` case and the provenance copy for it.
- **Market data.** `0003_markets_seed.sql` creates the rows with empty payloads.
  They are filled by hand each quarter from free brokerage research plus
  FRED/Census — no affordable API exists for an individual.
- **Resume parsing.** `profiles.skills` is populated by the app today; the
  scorer maps free text onto its own vocabulary (`matching/skills.ts`).

LinkedIn and Indeed are not scraped, per the spec.
