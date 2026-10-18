# Events tab: sources and rules

The Events tab (`site/events.json`) is rebuilt by the Website workflow every two hours
(`npm run export:events`, `backend/src/events/events.ts`). Everything is free: public
calendar feeds and pages only, no paid APIs, no logins.

## How events are collected

1. Each source in `EVENT_SOURCES` is read by its kind: The Events Calendar REST/iCal
   (`tribe`), GrowthZone iCal and detail pages (`growthzone`), schema.org JSON-LD
   (`jsonld`, `pages`, `sitemap`), Localist and LiveWhale university APIs. One request at a
   time, a 15 s timeout and one retry (`lib/http.ts`); a site that refuses (403/405) is
   reported, never worked around.
2. Detail pages are read where the listing lacks times or details, and their schema.org
   `Event` data fills registration link (`offers.url`), price, sell-out
   (`offers.availability`), registration deadline (`offers.validThrough`), eligibility,
   format (`eventAttendanceMode`, `VirtualLocation`), status (`eventStatus`,
   `previousStartDate`), address and description.
3. `finalize()` then adds, only from the organizer's own words:
   - status from title markers ("CANCELLED -", "(Sold Out)") or iCal `STATUS:CANCELLED`;
   - virtual/hybrid from the venue ("Zoom", "Webinar") when the source has no mode;
   - the market of the venue's street address (", Dallas, TX"), not the organizer's
     office. Virtual events keep their organizer's market and are listed under **Online**;
   - topic (networking, tour, panel, career fair, conference, education...);
   - a registration deadline only when it is before the start (a later date is a
     publishing or series date, not a deadline);
   - `timezone` (`America/Chicago`, or `America/Denver` for El Paso) and `verifiedAt`.
4. Nothing missing is invented: no time shows "Time not listed", no venue shows
   "Venue not listed", and price, deadline and eligibility are simply absent.

## Times and calendar exports

- Times keep the venue's UTC offset. Floating times in an El Paso feed are read as
  Mountain time; the card shows "6:00 PM MT" / "CT".
- `.ics` downloads and Google Calendar links use UTC instants for timed events (correct
  in any calendar zone; Google also gets `ctz` = the venue's zone) and `VALUE=DATE`
  ranges for all-day and multi-day events (DTEND is the day after the last day).
- Repeating events: iCal `RRULE` (DAILY, WEEKLY with BYDAY, MONTHLY with BYDAY such as
  2TU or with a day of month; INTERVAL, COUNT, UNTIL), `EXDATE` skips and
  `RECURRENCE-ID` single-occurrence changes are expanded inside the 120-day window, one
  card per occurrence sharing a `seriesId`. Localist and LiveWhale instances are kept the
  same way.
- Multi-day: an event whose end is on a later day shows "Dec 1 – Dec 3". A calendar that
  lists one all-day row per day of the same page is joined into one event.
- Courses and series: a listing that spans 7 days or more is not treated as one continuous
  event. Terra reads its page; when the page lists session dates inside the range
  ("Fridays: 10/2, 10/9, 10/16, 10/30, 11/6", "8:00 am to 5:00 pm") the event carries those
  `sessions`. The card shows the session count and the next session, the .ics has one
  timed entry per session, and the Google link adds the next session. Page wording that
  disagrees with the dates ("4-Day Course" beside five dates) is kept in `conflicts` and
  shown on the card; Terra does not pick one. `enrollment` is `in-progress` once the first
  session has passed (no Register link; listed until the last session), `closed` when the
  page says registration is closed, otherwise `open`. A long range whose page lists no
  session dates is marked `spanUnverified`, shows a warning and offers no calendar export.

## Where an event is

- Physical events go to the market named by their street address (", TX"), then by a venue
  that ends in a market name ("Hotel ZaZa, Houston"), then by the source's `places` rules
  for campuses in other markets (Texas A&M School of Law / LEB is Fort Worth, TAMUG is
  Galveston; UT Austin's McCombs classes in Dallas, Houston, San Antonio), and only then
  the organizer's market. Virtual events stay with the organizer. The PR browser check
  prints a `PLACE CHECK` line for any event whose venue names a different market.

## Duplicates, changes and conflicts

- One event listed twice (several sources, or by hand and by a calendar) is the same city
  and day and nearly the same title words, or the same page and start. Occurrences of a
  repeating event share a page but not a day, so they are all kept.
- **Conflict rule:** hand-typed rows (the Sheet's Events tab and
  `backend/data/events-manual.json`) come first, and the first listing wins every field it
  fills. Later copies only fill its blanks (registration link, address, price...). Two
  exceptions, because the organizer's page is the newer word: a calendar's
  cancelled/postponed/sold-out status is shown on the hand row, and a calendar's real
  clock time replaces a hand row that only had a date (same day).
- A start that moved since the last build (same event id) is marked "Moved from <date>".
- Cancelled and sold-out events stay listed, marked, until they pass.

## Failed sources and the collection report

- A source that cannot be read keeps its events from the previous build, marked
  `stale` with their **old** `verifiedAt` (the card says "Calendar unreachable; last
  verified Oct 15"); they are never shown as freshly verified.
- `events.json` carries `report`: per market the sources checked, read and failed, upcoming
  events, virtual events, duplicates removed, stale events and the last successful
  verification. States: `events`, `none-found` (sources read, nothing upcoming),
  `unreadable` (every source failed), `no-sources` (nothing readable is configured).
  The tab says which ("Couldn't read the calendar for Midland..." vs "No upcoming events
  found for Lubbock. 1 of 1 calendars were read."), and the "Collection report" fold at
  the bottom lists every market. The same report is printed in the export log and the
  workflow's job summary.

## Hand-typed events

Required columns: Date, Title, City (Time, Organizer, Venue, Link optional). Optional
columns, read when present in the Sheet tab or as JSON keys (lowercase names, or
camelCase/snake_case): End date, End time, Address, Format (in-person, virtual,
hybrid), Cost, Registration link, Status (cancelled, postponed, sold out), Notes.

## Adding a source

Add a line to `EVENT_SOURCES` with the kind that matches its feed; set `relevantOnly`
for general calendars (chambers, AIA) so only networking, development and economic
events are kept, and `keyword` for university calendars. Check it from a GitHub runner
(the sandbox can't reach most hosts); the PR's Website run prints the collection
report and runs `test/browser/events-check.mjs` against the real file.
