# Handoff: Terra — Texas CRE Job Tracker

## Overview
A mobile app that aggregates **commercial real estate internships and entry-level roles in Texas only**, tracks the user's applications through a pipeline, highlights postings that match their resume, and gives a per-city view of Texas CRE market conditions.

Two things to build:
1. **Backend** — a collector that pulls real Texas CRE postings on a schedule, normalizes them, scores them against the user's resume, and serves them over an API with realtime updates.
2. **Front end** — recreate the five screens in the prototype in a real mobile environment.

## About the design files
`Terra - Texas CRE Job Tracker.dc.html` is a **design reference built in HTML**, not production code. It shows intended layout, copy, interaction, and states. Recreate it in the target environment (React Native / Expo is the recommended choice for an iPhone app; a React web app also works) using that environment's patterns — do not port the HTML.

`data-source.js` is the exception: it is the **data contract**, and its shape should survive into production. Every screen reads through it. All data currently in it is placeholder seed data.

## Fidelity
**High fidelity.** Colors, type, spacing, and copy in the prototype are final. Match them.

---

# Part 1 — Backend (the real work)

## Data model

```sql
create table postings (
  id            text primary key,        -- sha1(firm + role + city)
  role          text not null,
  firm          text not null,
  city          text not null,           -- Dallas | Fort Worth | Houston | Austin | San Antonio | El Paso
  sector        text not null,           -- Investment | Brokerage | Development | Property Mgmt | Asset Mgmt | Appraisal | Capital Markets
  kind          text not null,           -- 'Internship' | 'Entry-level'
  pay           text,                    -- display string: '$24/hr' or '$62-70k'
  deadline      date,
  posted_at     timestamptz not null,
  description   text,
  reqs          text[],                  -- bullet list shown on the detail screen
  apply_url     text not null,
  source        text,                    -- display provenance: 'Posted on the firm careers page'
  first_seen    timestamptz default now(),
  active        boolean default true
);
create index on postings (city, kind, active);

create table profiles (
  id uuid primary key references auth.users,
  name text, school text, grad_year int, home_city text,
  skills text[], sectors text[], relocation_open boolean,
  resume_url text
);

create table matches (
  profile_id uuid references profiles, posting_id text references postings,
  score int, note text, lines text[],    -- 'lines' are the bullet reasons shown in the detail sheet
  primary key (profile_id, posting_id)
);

create table applications (
  profile_id uuid references profiles, posting_id text references postings,
  stage text,                            -- 'Applied' | 'Interview' | 'Offer'
  note text, updated_at timestamptz default now(),
  primary key (profile_id, posting_id)
);

create table saved (
  profile_id uuid references profiles, posting_id text references postings,
  primary key (profile_id, posting_id)
);
```

## Collector

Scheduled function, every 2 hours (Supabase Edge Function + pg_cron, or Vercel Cron).

**Sources, in priority order:**
1. **ATS APIs (free, reliable, primary).** Maintain a `firms` table: firm name, ats ('greenhouse'|'lever'|'workday'|'icims'), ats_slug.
   - Greenhouse: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
   - Lever: `GET https://api.lever.co/v0/postings/{slug}?mode=json`
   - Workday and iCIMS need per-tenant endpoints; handle them after the first two.
2. **Aggregator API (paid, breadth).** Adzuna or JSearch via RapidAPI, query scoped to Texas CRE keywords. Roughly $30/mo.
3. **Do not scrape LinkedIn or Indeed.** Against their terms, and it breaks constantly.

**Pipeline per run:** fetch → filter to Texas locations → filter to intern/entry seniority (title contains intern, analyst I, associate, coordinator, trainee, or explicit seniority field) → classify sector from title and description keywords → normalize to the `postings` schema → dedupe on `id` → upsert → mark rows not seen in 14 days `active = false` → for each new row, score against every profile and insert into `matches` → fire push for profiles whose alert prefs opt in.

**Start with 30 firms.** Coverage beats sophistication; the collector is worthless without a good firm list.

## Match scoring
Runs server side on insert. A posting is shown as a **strong match at score >= 92** — that threshold drives the UI highlight.

Weighted overlap, v1:
- Required skills present on resume — 40%
- Location (home city exact, or relocation_open and in-state) — 20%
- Class year / graduation matches the stated requirement — 20%
- Sector matches a declared interest — 20%

Also produce `note` (a short three-part string like `Austin · modeling · rising senior`) and `lines` (3-4 full sentences explaining the match), both rendered verbatim in the UI.

## Realtime
```js
db.channel('new-postings')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'postings' },
      p => onNewPosting(p.new))
  .subscribe();
```
Push notifications on insert via Expo Push or FCM, gated by the profile's alert preferences (daily digest, deadline reminders 3 days out, internships-only filter, weekly market note).

## Market data
No affordable API exists for an individual (CoStar, Crexi, Placer all enterprise). Plan: a `markets` JSON table updated **quarterly by hand** from free brokerage research PDFs, plus FRED/Census for the economic layer. Schema per city: `{ trend, dir:'up'|'down'|'flat', summary, stats:[label,value,delta,dir][], sectors:[name,note,pct][], news:[tag,head,body][], hiring }`. A `Texas` key holds the statewide roll-up shown when no city is selected.

## The contract the UI expects
`data-source.js` exports:
```js
SOURCE = { name, endpoint, poll, transport }     // rendered on the Profile screen
fetchFeed({ state })  -> { jobs, match, markets, syncedAt:Date }   // throws Error on failure
fetchMarkets()        -> markets
simulateFailure()     // dev only, drop in production
```
Keep these signatures and the front end needs no changes.

---

# Part 2 — Front end

## Design tokens

Colors
- Page / app background `#F4F2EE`
- Surface (cards, sheet headers) `#FFFFFF`
- Ink `#17191A` · secondary `#3A3A35` · muted `#6B6B63` · faint `#8A867C` · disabled `#9A968C`
- Hairline `rgba(23,25,26,.10)` · lighter divider `rgba(23,25,26,.07)`
- Chip / inactive fill `#F0EEE8`, `#ECEAE3` · segmented track `#E4E1D9` · toggle off `#D9D6CE`
- **Accent navy `#2B4A8B`**, tint `#E3E8F3`, on-tint text `#26314A`
- Alert red `#B8442E` (urgent deadlines, errors), error surface `#FAEDE9`, error ink `#5A2F25`
- Amber `#B8722E` (soon-due deadlines, Interview stage dot)
- Dark panel `#17191A` with body text `#B9B6AE` (market header card)
- Pipeline stage dots: Applied `#9A968C`, Interview `#B8722E`, Offer `#2B4A8B`

Typography — **Archivo** (UI) and **JetBrains Mono** (labels, numbers, metadata), both Google Fonts.
- Screen title: Archivo 700 / 28px / 1.1 / -.02em
- Eyebrow above title: JetBrains Mono 500 / 9.5px / .2em tracking / uppercase / `#8A867C`
- Card title: Archivo 600 / 16px / 1.25
- Card subtitle: Archivo 400 / 13px / 1.3 / `#6B6B63`
- Body: Archivo 400 / 13.5-14px / 1.5-1.6
- Meta chips: JetBrains Mono 500 / 9.5px / .08em / uppercase
- Section label: JetBrains Mono 500 / 10px / .16em / uppercase / `#8A867C`
- Big stat: JetBrains Mono 700 / 19-20px
- Tab label: Archivo 500-600 / 10px

Geometry — radii: card 14, inner card 12-13, button 9-11, chip/pill 20, meta tag 5-6. Card padding 15-16. Gap between cards 11. Screen side padding 18. Header top padding 60 (clears the status bar). Scroll padding-bottom 108 (clears the tab bar). Card shadow `0 1px 2px rgba(23,25,26,.04)`; strong-match card `0 2px 0 #2B4A8B, 0 3px 10px rgba(43,74,139,.14)` with a `#2B4A8B` border.

## Screens

**1. Feed** — eyebrow "TEXAS · CRE", title "Open roles", live match count top right in navy mono.
Segmented control (All roles / Internship / Entry-level) on a `#E4E1D9` track; active pill is white with a soft shadow. Below it, a horizontally scrolling city chip row (All Texas, Dallas, Fort Worth, Houston, Austin, San Antonio) — chips bleed past the 18px screen padding, scroll by swipe and by wheel, and **re-tapping an active chip clears it** back to All Texas / All roles.
Under the filters, a navy tinted bar: "N roles match your resume almost exactly" with a "Show only" / "Show all" toggle.
Job cards, sorted by match score descending. Each: optional strong-match header line ("RESUME MATCH 96%" in navy mono plus a short reason), role, firm, an INTERN or ENTRY badge, three meta tags (city / sector / pay), then a footer rule with "Posted N days ago · closes in Nd" and a Save toggle.
Footer button: "Synced 7:42 AM CT · tap to refresh".
Empty state when filters match nothing: dashed card, "No postings match".

**2. Market** — eyebrow "Q3 2026 · TEXAS", title "Market pulse", scrolling city chips (Austin, Dallas, Houston, San Antonio, Fort Worth, El Paso). No selection = statewide Texas roll-up; re-tapping the active city returns to statewide.
Content: dark `#17191A` summary card with a trend badge; a 2x2 grid of stat tiles (label, value, delta colored by direction); a sector activity card with labeled progress bars; "What moved this week" list of three tagged items; a navy tinted "Hiring read" card whose button jumps to the Feed pre-filtered to that city.

**3. Pipeline** — title "Pipeline", four counters across the top (Saved, Applied, Interview, Offer). Below, sections grouped by stage with a colored dot, uppercase stage label, a hairline, and a count. Each application card shows role, firm · city, a status note, and a button advancing it to the next stage.

**4. Saved** — title "Saved & deadlines". Cards carry a 3px left border colored by urgency (red <= 15 days, amber <= 25, navy beyond) and a days-left badge. Two actions: "Mark applied" (moves it to the pipeline as Applied and clears it from Saved) and "Remove". Dashed empty state.

**5. Profile** — avatar initials, name, school and grad year. Alert preferences card with four toggles (daily Texas digest, deadline reminders, internships only, weekly market note). Resume card. Data source card showing source name, endpoint, poll interval, last sync, plus "Sync now" and "Test failure".

**Detail sheet** — pushes over the screen (`z-index: 5`, **below** the device status bar; the tab bar hides while it is open). Back button, role, firm · city, three meta tags. Body: deadline and posted tiles, navy match-breakdown panel when the score is >= 92, description, "What they want" bullets, source provenance. Fixed bottom bar: Save and "Apply with saved resume" — after applying it reads "In pipeline · Applied" and is disabled.

## States
- **Loading** — feed header renders immediately with a pulsing dot and "Pulling Texas postings…", four shimmering skeleton cards (opacity 1 → .45, 1.3s, staggered 150ms).
- **Error** — red-tinted card, "FEED UNAVAILABLE", the thrown message, a note that cached Saved and Pipeline data is still available, "Try again".
- **Ready** — normal content plus the sync timestamp.
- Detail sheet entry animation: translateY(18px) + fade, 220ms ease-out.

## Client state
`status` (loading|ready|error), `error`, `jobs`, `matchIndex`, `markets`, `lastSync`, `source`, `tab`, `city`, `type`, `matchOnly`, `mktCity`, `detail` (posting id or null), `saved` (set), `apps` (id → {stage, note}), `prefs` (4 booleans). In production, `saved`, `apps`, and `prefs` persist per profile in Postgres.

## Assets
None. No images, no icon set — all indicators are CSS shapes. If the production app adds firm logos, reserve a 30px square at the card's leading edge.

## Files in this bundle
- `Terra - Texas CRE Job Tracker.dc.html` — the prototype (all five screens, all states, interactive)
- `data-source.js` — the data contract plus placeholder seed data
- `ios-frame.jsx` — device bezel used by the prototype only; not part of the app

## Suggested first prompt for Claude Code
> Build a Supabase backend for a Texas commercial real estate job aggregator. The schema, collector spec, and data contract are in README.md. Start with the Greenhouse and Lever fetchers plus the normalizer, with tests, then the cron function and the realtime subscription. Do not scrape LinkedIn or Indeed.
