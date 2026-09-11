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
| fetch | `collector/sources/*` | Greenhouse, Lever, Workday. Timeouts, bounded retries; a 404 is not retried because a wrong slug will not fix itself. |
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

## Deploying to Vercel

The API is one function: `vercel.json` rewrites every path to `api/index.ts`
and the handler routes internally.

1. **Import the repo** and set **Root Directory to `backend`** — the project is
   a subdirectory, and Vercel defaults to the repo root.
2. **Environment variables** (Project Settings → Environment Variables):

   | | |
   | --- | --- |
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | service role key — server only, never in the app |
   | `CRON_SECRET` | any long random string; Vercel Cron sends it as a bearer token |
   | `COLLECTOR_SECRET` | only if pg_cron will also call the endpoint |
   | `EXPO_ACCESS_TOKEN` | optional |

3. **Deploy**, then check `https://<deployment>/health`.

   Deploying before the Supabase project exists is fine and is the normal
   order. Health answers either way, and says which state you are in:

   ```jsonc
   {"ok": true}                                   // configured and live
   {"ok": true, "configured": false, "error": …}  // deployed, Supabase not set yet
   ```

   Every other route answers 503 until the variables are set, rather than
   returning something misleading.
4. Point the app at it: set `EXPO_PUBLIC_API_BASE` to the deployment URL, and
   update `SOURCE.endpoint` in `client/data-source.js`.

The Node runtime is used deliberately rather than Edge: posting ids are hashed
with `node:crypto`, which Edge does not provide.

### Two limits worth knowing before you deploy

- **Cron frequency is a plan limit.** `vercel.json` schedules `0 */2 * * *`, per
  the spec. On the **Hobby plan Vercel runs cron jobs once a day** regardless of
  the expression, so the two-hour cadence needs Pro — or use the pg_cron path
  below instead, which has no such limit.
- **`maxDuration` is 60s** in `vercel.json`. A pass over 30 Greenhouse and
  Lever boards fits comfortably; a large Workday tenant may not, since it
  fetches a detail document per surviving posting. If collects start timing
  out, that is the cause — run the collector from a scheduler without a wall
  clock (GitHub Actions, a small worker) rather than raising the limit.

## Scheduling

`supabase/migrations/0004_cron.sql` schedules `0 */2 * * *` through pg_cron,
calling `POST /v1/collect` over pg_net. The endpoint and secret live in
Supabase Vault, so nothing sensitive is in the repo:

```sql
select vault.create_secret('https://api.yourapp.dev/v1/collect', 'collector_url');
select vault.create_secret('<COLLECTOR_SECRET>', 'collector_secret');
```

Any other scheduler works too — `npm run collect` is a self-contained pass.

## Workday

Workday has no shared board host — every tenant serves its own — so a Workday
firm row needs both columns:

```sql
insert into firms (name, ats, ats_host, ats_slug) values
  ('CBRE', 'workday', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers');
```

`ats_host` is the tenant host (the `wd1` / `wd3` / `wd5` digit varies per
tenant) and `ats_slug` is `<tenant>/<site>`. To find both for a firm: open its
careers page with devtools on the network tab and look for the `/wday/cxs/`
request. Its URL is `https://<ats_host>/wday/cxs/<tenant>/<site>/jobs`. A firm
row missing `ats_host` throws by name rather than quietly collecting nothing.

Two things differ from the other boards and are worth knowing before you touch
`sources/workday.ts`:

- **The list endpoint carries no description**, so classifying a posting needs
  a second request for it. The fetcher applies the title and location filters
  to the list payload first and only then spends detail requests — on a large
  enterprise board that is ~15 requests instead of ~600. If you relax those
  filters, you are buying hundreds of requests per firm per run.
- **`postedOn` is prose** (`Posted 3 Days Ago`), parsed in `parsePostedOn`.
  Unreadable values return undefined and the normalizer falls back to the run
  time rather than inventing a date.

The CXS endpoints are Workday's public career-site API, not a documented
product surface, and they do change. The tests pin the shape against fixtures;
if a tenant starts behaving oddly, check the live payload in devtools first.

## Not built yet

- **The iCIMS fetcher.** Needs a per-tenant endpoint and, on most tenants, an
  auth handshake. `defaultFetcher` throws a named error for now, and the run
  report records it per firm.
- **The aggregator source** (Adzuna or JSearch, ~$30/mo). `RawJob.ats` already
  has an `'aggregator'` case and the provenance copy for it.
- **Market data.** `0003_markets_seed.sql` creates the rows with empty payloads.
  They are filled by hand each quarter from free brokerage research plus
  FRED/Census — no affordable API exists for an individual.
- **Resume parsing.** `profiles.skills` is populated by the app today; the
  scorer maps free text onto its own vocabulary (`matching/skills.ts`).

LinkedIn and Indeed are not scraped, per the spec.
