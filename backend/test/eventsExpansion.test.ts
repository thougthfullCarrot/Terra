import { describe, expect, it } from 'vitest';
import {
  buildEventsFile,
  centralIso,
  dedupeCounted,
  expandRrule,
  fetchSource,
  finalize,
  parseIcs,
  parseJsonLdEvents,
  parseTribe,
  reportMarkdown,
  type EventSource,
  type EventsFile,
  type Fetcher,
  type TerraEvent
} from '../src/events/events.js';
import { linkSeries } from '../src/events/events.js';
import { addressCity, joinDays, titleStatus, topicOf } from '../src/events/enrich.js';
import { parseManualFile } from '../src/events/sheetEvents.js';
import { eventBadges, eventIcs, eventWhen, filterEvents, googleCalendarUrl, marketNote } from '../../site/events.js';

const now = new Date('2026-10-18T12:00:00Z');
const src = (over: Partial<EventSource> = {}): EventSource => ({ key: 'test', organizer: 'Test Org', city: 'San Antonio', kind: 'jsonld', base: 'https://example.org', page: 'https://example.org/events', ...over });
const ev = (over: Partial<TerraEvent> = {}): TerraEvent => ({ id: 'x', title: 'Mixer', url: 'https://example.org/e/1', start: '2026-10-22T18:00:00-05:00', end: null, city: 'San Antonio', organizer: 'Test Org', venue: null, cost: null, ...over });
const ld = (node: object) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', ...node })}</script>`;

describe('event detail fields from schema.org', () => {
  it('reads registration, address, price, deadline, format and status', () => {
    const html = ld({
      name: 'ULI Young Leaders Property Tour',
      url: 'https://example.org/e/tour',
      startDate: '2026-11-05T17:30:00-06:00',
      endDate: '2026-11-05T19:30:00-06:00',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: 'The Pearl', address: { streetAddress: '303 Pearl Pkwy', addressLocality: 'San Antonio', addressRegion: 'TX', postalCode: '78215' } },
      offers: [
        { url: 'https://tickets.example.org/tour', price: 25, priceCurrency: 'USD', validThrough: '2026-11-03T23:59:00-06:00', availability: 'https://schema.org/InStock', name: 'Member' },
        { price: 0, name: 'Student' }
      ],
      description: 'Walk the newest phase with the developer. Students attend free with a .edu email.'
    });
    const [e] = parseJsonLdEvents(html, src(), 'https://example.org/events').map((x) => finalize(x, src(), now));
    expect(e).toMatchObject({
      title: 'ULI Young Leaders Property Tour',
      start: '2026-11-05T17:30:00-06:00',
      registrationUrl: 'https://tickets.example.org/tour',
      address: '303 Pearl Pkwy, San Antonio, TX 78215',
      venue: 'The Pearl',
      cost: '$25',
      registrationDeadline: '2026-11-03T23:59:00-06:00',
      format: 'in-person',
      topic: 'Property tour',
      timezone: 'America/Chicago',
      verifiedAt: now.toISOString()
    });
    expect(e!.eligibility).toMatch(/Student/);
    expect(e!.status).toBeUndefined();
  });

  it('marks cancelled, postponed, sold out and virtual events from the organizer', () => {
    const page = [
      ld({ name: 'Gala', url: 'https://example.org/e/a', startDate: '2026-11-01T18:00:00-05:00', eventStatus: 'EventCancelled' }),
      ld({ name: 'Lunch', url: 'https://example.org/e/b', startDate: '2026-11-02T11:30:00-06:00', offers: { availability: 'SoldOut', price: '45' } }),
      ld({ name: 'Market Webinar', url: 'https://example.org/e/c', startDate: '2026-11-03T12:00:00-06:00', eventAttendanceMode: 'OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation', url: 'https://zoom.us/j/1' } }),
      ld({ name: 'Forum', url: 'https://example.org/e/d', startDate: '2026-12-03T12:00:00-06:00', previousStartDate: '2026-11-04T12:00:00-06:00', eventStatus: 'EventRescheduled' })
    ].join('');
    const events = parseJsonLdEvents(page, src(), 'https://example.org/events').map((x) => finalize(x, src(), now));
    expect(events.map((e) => [e.title, e.status, e.format ?? null])).toEqual([
      ['Gala', 'cancelled', null],
      ['Lunch', 'sold-out', null],
      ['Market Webinar', undefined, 'virtual'],
      ['Forum', 'rescheduled', null]
    ]);
    expect(events[3]!.rescheduledFrom).toBe('2026-11-04T12:00:00-06:00');
  });

  it('reads status words in titles and never takes a publishing date for a deadline', () => {
    expect(titleStatus('CANCELLED - October Luncheon')).toEqual({ status: 'cancelled', title: 'October Luncheon' });
    expect(titleStatus('Holiday Mixer (Sold Out)')).toEqual({ status: 'sold-out', title: 'Holiday Mixer' });
    expect(titleStatus('Cancellation Policy Workshop')).toEqual({ title: 'Cancellation Policy Workshop' });
    // "Register by Nov 30" for an event on Nov 5 is not a deadline before the event: dropped.
    const e = finalize(ev({ start: '2026-11-05T18:00:00-06:00', description: 'Register by Nov 30 for the series.' }), src(), now);
    expect(e.registrationDeadline).toBeUndefined();
    const ok = finalize(ev({ start: '2026-11-05T18:00:00-06:00', description: 'RSVP by Nov 1, seats are limited.' }), src(), now);
    expect(ok.registrationDeadline).toBe('2026-11-01T00:00:00-05:00');
  });

  it('attributes a physical event to the venue market, a virtual one to nobody else', () => {
    expect(addressCity('2501 N Harwood St, Dallas, TX 75201')).toBe('Dallas');
    expect(addressCity('Worth Street Grill')).toBeNull();
    // A San Antonio chamber event held in New Braunfels goes to New Braunfels.
    expect(finalize(ev({ address: '390 S Seguin Ave, New Braunfels, TX 78130' }), src(), now).city).toBe('New Braunfels');
    // A virtual event hosted by a Houston group stays in Houston's feed and is marked virtual.
    const v = finalize(ev({ city: 'Houston', venue: 'Zoom', address: 'Dallas, TX' }), src({ city: 'Houston' }), now);
    expect([v.city, v.format]).toEqual(['Houston', 'virtual']);
  });

  it('classifies the kinds students look for', () => {
    expect(topicOf('Spring CRE Career Fair')).toBe('Career fair');
    expect(topicOf('Office Market Outlook 2027')).toBe('Conference');
    expect(topicOf('Developer Panel: Building the Pearl')).toBe('Panel');
    expect(topicOf('Young Professionals Mixer')).toBe('Networking');
  });
});

describe('time zones', () => {
  it('reads El Paso floating times as Mountain time', async () => {
    const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:ep-1', 'SUMMARY:Business After Hours Networking', 'DTSTART:20261029T173000', 'DTEND:20261029T193000', 'URL:https://members.elpaso.org/events/details/after-hours-1', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const fetcher: Fetcher = { json: async () => ({}), text: async () => ics };
    const [e] = await fetchSource(src({ key: 'ep', city: 'El Paso', kind: 'growthzone', base: 'https://members.elpaso.org' }), now, fetcher, () => {});
    expect(e).toMatchObject({ start: '2026-10-29T17:30:00-06:00', end: '2026-10-29T19:30:00-06:00', timezone: 'America/Denver' });
    expect(eventWhen(e!)).toBe('5:30 PM – 7:30 PM MT');
    // Winter: MST is -07:00.
    expect(centralIso('2026-12-10 18:00', 'America/Denver')).toBe('2026-12-10T18:00:00-07:00');
    // The calendar export carries the right instant (UTC) and Google opens it in Mountain time.
    expect(eventIcs(e!, now)).toContain('DTSTART:20261029T233000Z');
    expect(new URL(googleCalendarUrl(e!)).searchParams.get('ctz')).toBe('America/Denver');
  });
});

// The four shapes the Events tab must get right, end to end: collector → events.json → card text → calendar files.
describe('evening, all-day, recurring and multi-day events', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    // An evening event: 6:00-8:30 PM Central, which is the next day in UTC.
    'BEGIN:VEVENT',
    'UID:eve-1',
    'SUMMARY:CREW Networking Mixer',
    'DTSTART;TZID=America/Chicago:20261029T180000',
    'DTEND;TZID=America/Chicago:20261029T203000',
    'LOCATION:Bottling Department\\, 312 Pearl Pkwy\\, San Antonio\\, TX',
    'URL:https://example.org/e/mixer',
    'END:VEVENT',
    // An all-day event: one date, exclusive DTEND.
    'BEGIN:VEVENT',
    'UID:allday-1',
    'SUMMARY:Real Estate Development Workshop',
    'DTSTART;VALUE=DATE:20261105',
    'DTEND;VALUE=DATE:20261106',
    'URL:https://example.org/e/workshop',
    'END:VEVENT',
    // A recurring event: 2nd Tuesday of each month at 11:30, one occurrence skipped, one moved.
    'BEGIN:VEVENT',
    'UID:lunch-series',
    'SUMMARY:Monthly Membership Luncheon',
    'DTSTART;TZID=America/Chicago:20260908T113000',
    'DTEND;TZID=America/Chicago:20260908T130000',
    'RRULE:FREQ=MONTHLY;BYDAY=2TU',
    'EXDATE;TZID=America/Chicago:20261208T113000',
    'URL:https://example.org/e/luncheon',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:lunch-series',
    'RECURRENCE-ID;TZID=America/Chicago:20261110T113000',
    'SUMMARY:Monthly Membership Luncheon',
    'DTSTART;TZID=America/Chicago:20261112T113000',
    'DTEND;TZID=America/Chicago:20261112T130000',
    'URL:https://example.org/e/luncheon',
    'END:VEVENT',
    // A multi-day conference: three dates.
    'BEGIN:VEVENT',
    'UID:conf-1',
    'SUMMARY:Texas CRE Summit',
    'DTSTART;VALUE=DATE:20261201',
    'DTEND;VALUE=DATE:20261204',
    'URL:https://example.org/e/summit',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const fetcher: Fetcher = { json: async () => ({}), text: async () => ICS };
  const source = src({ key: 'gz', kind: 'growthzone', base: 'https://business.example.org' });

  it('collects each with the right times', async () => {
    const file = await buildEventsFile(now, null, { sources: [source], fetcher, log: () => {} });
    const events = file.cities.find((c) => c.city === 'San Antonio')!.events;
    const byTitle = (t: string) => events.filter((e) => e.title === t);

    const [mixer] = byTitle('CREW Networking Mixer');
    expect(mixer).toMatchObject({ start: '2026-10-29T18:00:00-05:00', end: '2026-10-29T20:30:00-05:00', topic: 'Networking' });
    expect(eventWhen(mixer!)).toBe('6:00 PM – 8:30 PM CT');
    // The calendar file keeps the evening on the 29th locally (23:00-01:30 UTC).
    expect(eventIcs(mixer!, now)).toContain('DTSTART:20261029T230000Z');
    expect(eventIcs(mixer!, now)).toContain('DTEND:20261030T013000Z');

    const [workshop] = byTitle('Real Estate Development Workshop');
    expect(workshop).toMatchObject({ start: '2026-11-05T00:00:00-06:00', end: null, dateOnly: true });
    expect(eventWhen(workshop!)).toBe('Time not listed');
    expect(eventIcs(workshop!, now)).toContain('DTSTART;VALUE=DATE:20261105');
    expect(eventIcs(workshop!, now)).toContain('DTEND;VALUE=DATE:20261106');

    const lunches = byTitle('Monthly Membership Luncheon');
    // Oct 13 is past; Nov 10 moved to Nov 12; Dec 8 skipped; Jan 12 and Feb 9 (inside the 120-day window).
    expect(lunches.map((e) => e.start)).toEqual(['2026-11-12T11:30:00-06:00', '2027-01-12T11:30:00-06:00', '2027-02-09T11:30:00-06:00']);
    expect(new Set(lunches.map((e) => e.seriesId))).toEqual(new Set(['gz-lunch-series']));
    expect(new Set(lunches.map((e) => e.id)).size).toBe(3);
    expect(lunches[0]!.rescheduledFrom).toBe('2026-11-10T11:30:00-06:00');
    expect(eventWhen(lunches[1]!)).toBe('11:30 AM – 1:00 PM CT');

    const [summit] = byTitle('Texas CRE Summit');
    expect(summit).toMatchObject({ start: '2026-12-01T00:00:00-06:00', end: '2026-12-03T00:00:00-06:00' });
    expect(eventWhen(summit!)).toBe('Dec 1 – Dec 3');
    expect(eventIcs(summit!, now)).toContain('DTEND;VALUE=DATE:20261204');
    expect(new URL(googleCalendarUrl(summit!)).searchParams.get('dates')).toBe('20261201/20261204');
  });

  it('expands weekly rules across the daylight-time change at the same local time', () => {
    expect(expandRrule('2026-10-27T07:30:00-05:00', 'FREQ=WEEKLY;BYDAY=TU;COUNT=3', now)).toEqual(['2026-10-27T07:30:00-05:00', '2026-11-03T07:30:00-06:00', '2026-11-10T07:30:00-06:00']);
  });

  it('joins a conference a calendar lists one day per row', () => {
    const day = (d: string) => ev({ title: 'Summit', url: 'https://example.org/s', start: `2026-12-0${d}T00:00:00-06:00`, dateOnly: true });
    expect(joinDays([day('2'), day('1'), day('3')]).map((e) => [e.start, e.end])).toEqual([['2026-12-01T00:00:00-06:00', '2026-12-03T00:00:00-06:00']]);
  });
});

describe('duplicates and hand-typed rows', () => {
  it('merges copies: the hand row wins its fields, the calendar fills blanks and its cancellation shows', () => {
    const hand = ev({ id: 'file-2', title: 'NAIOP Holiday Party', start: '2026-12-04T00:00:00-06:00', dateOnly: true, source: 'Added by hand', venue: 'Pearl Stable' });
    const cal = ev({ id: 'naiop-9', title: 'Holiday Party - NAIOP San Antonio', start: '2026-12-04T17:30:00-06:00', venue: 'The Stable at Pearl', registrationUrl: 'https://naiop.example/r', status: 'cancelled' });
    const other = ev({ id: 'crew-1', title: 'NAIOP Holiday Party', start: '2026-12-04T17:30:00-06:00', city: 'Austin' });
    const { events, removed } = dedupeCounted([hand, cal, other]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ venue: 'Pearl Stable', registrationUrl: 'https://naiop.example/r', status: 'cancelled', start: '2026-12-04T17:30:00-06:00', source: 'Added by hand' });
    expect(events[0]!.dateOnly).toBeUndefined();
    expect(removed.get('San Antonio')).toBe(1);
  });

  it('reads the optional columns of the hand list', () => {
    const [e] = parseManualFile(
      { events: [{ date: '2026-11-14', time: '9:00 AM', 'end date': '2026-11-15', 'end time': '4:00 PM', title: 'CCIM CI 101 Course', city: 'El Paso', organizer: 'CCIM', venue: 'UTEP Union', format: 'Hybrid', cost: '$450', 'registration link': 'ccim.example/ci101', status: 'Sold out' }] },
      now,
      () => {}
    );
    expect(e).toMatchObject({ start: '2026-11-14T09:00:00-07:00', end: '2026-11-15T16:00:00-07:00', timezone: 'America/Denver', format: 'hybrid', cost: '$450', registrationUrl: 'https://ccim.example/ci101', status: 'sold-out' });
  });
});

describe('collection report', () => {
  it('tells "no upcoming events found" from "sources could not be read"', async () => {
    const sources = [src({ key: 'a', city: 'Lubbock', kind: 'jsonld' }), src({ key: 'b', city: 'Midland', kind: 'jsonld' })];
    const fetcher: Fetcher = {
      json: async () => ({}),
      text: async (url) => {
        if (sources.length && url) {
          /* first source answers with an empty page, second refuses */
        }
        throw Object.assign(new Error('HTTP 403'), {});
      }
    };
    let calls = 0;
    const mixed: Fetcher = { json: fetcher.json, text: async () => (calls++ === 0 ? '<html></html>' : fetcher.text('')) };
    const file = await buildEventsFile(now, null, { sources, fetcher: mixed, log: () => {} });
    const r = (c: string) => file.report!.find((x) => x.city === c)!;
    expect(r('Lubbock')).toMatchObject({ state: 'none-found', sourcesOk: 1, sourcesFailed: 0 });
    expect(r('Midland')).toMatchObject({ state: 'unreadable', sourcesOk: 0, sourcesFailed: 1, lastVerifiedAt: null });
    expect(marketNote(file, 'Midland').empty).toMatch(/Couldn't read the calendar for Midland/);
    expect(marketNote(file, 'Lubbock').empty).toMatch(/No upcoming events found for Lubbock\. 1 of 1/);
    const md = reportMarkdown(file);
    expect(md).toContain('| Midland | Sources could not be read | 0/1 | 1 |');
    expect(md).toContain('HTTP 403');
  });

  it('keeps the last good read time of a failing source and counts duplicates', async () => {
    const previous: EventsFile = {
      generatedAt: '2026-10-17T12:00:00Z',
      sources: [{ key: 'a', organizer: 'Test Org', city: 'Austin', url: '', fetchedAt: '2026-10-16T12:00:00Z', count: 1, ok: false, lastSuccessAt: '2026-10-15T12:00:00Z' }],
      cities: [{ city: 'Austin', events: [ev({ id: 'a-1', city: 'Austin', sourceKey: 'a', verifiedAt: '2026-10-15T12:00:00Z' })] }]
    };
    const fetcher: Fetcher = { json: async () => ({}), text: async () => Promise.reject(new Error('timeout')) };
    const file = await buildEventsFile(now, previous, { sources: [src({ key: 'a', city: 'Austin' })], fetcher, log: () => {} });
    expect(file.report!.find((x) => x.city === 'Austin')).toMatchObject({ state: 'events', stale: 1, lastVerifiedAt: '2026-10-15T12:00:00Z' });
    expect(file.cities.find((c) => c.city === 'Austin')!.events[0]).toMatchObject({ stale: true, verifiedAt: '2026-10-15T12:00:00Z' });
  });
});

describe('Events tab rules', () => {
  const file = {
    generatedAt: now.toISOString(),
    sources: [],
    cities: [{ city: 'Houston', events: [ev({ id: 'v', city: 'Houston', format: 'virtual', title: 'Webinar' }), ev({ id: 'p', city: 'Houston', title: 'Tour' })] }]
  };
  it('lists virtual events under Online, not under the city', () => {
    expect(filterEvents(file, { city: 'Houston' }, now).map((e) => e.id)).toEqual(['p']);
    expect(filterEvents(file, { city: 'Online' }, now).map((e) => e.id)).toEqual(['v']);
    expect(filterEvents(file, {}, now)).toHaveLength(2);
  });
  it('shows status, format, price and student badges', () => {
    expect(eventBadges(ev({ status: 'sold-out', format: 'hybrid', free: true, eligibility: 'Students free' })).map((b) => b.text)).toEqual(['Sold out', 'Hybrid', 'Free', 'Student pricing']);
    expect(eventIcs(ev({ status: 'cancelled' }), now)).toContain('STATUS:CANCELLED');
  });
  it('parses tribe all-day events as local dates', () => {
    const [e] = parseTribe({ events: [{ id: 1, title: 'Expo', url: 'https://x.org/e', all_day: true, start_date: '2026-11-20 00:00:00', end_date: '2026-11-21 23:59:59', utc_start_date: '2026-11-20 06:00:00', website: 'https://x.org/register' }] } as never, src());
    expect(e).toMatchObject({ start: '2026-11-20T00:00:00-06:00', end: '2026-11-21T00:00:00-06:00', registrationUrl: 'https://x.org/register' });
    expect(parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:X\r\nSTATUS:CANCELLED\r\nDTSTART:20261120T120000\r\nURL:https://x.org/1\r\nEND:VEVENT\r\nEND:VCALENDAR', src())[0]!.status).toBe('cancelled');
  });
});

describe('LiveWhale university calendars', () => {
  it('reads the public JSON search (shape from calendar.tamu.edu)', async () => {
    const body = [
      { id: 388284, group_title: 'Law', title: 'Journal of Property Law Symposium', url: 'https://calendar.tamu.edu/law/event/388284-journal', date_iso: '2026-11-06T08:30:00-06:00', date2_iso: '2026-11-06T13:30:00-06:00', timezone: 'America/Chicago', location: 'Bush Academic Building', cost: 'Free' },
      { id: 1, title: 'Aggie Real Estate Society Meeting', url: 'https://calendar.tamu.edu/event/1-ares', date_iso: '2026-10-21T18:00:00-05:00', date2_iso: '2026-10-21T19:00:00-05:00', location: 'Wehner 113' },
      { id: 2, title: 'Aggie Real Estate Society Meeting', url: 'https://calendar.tamu.edu/event/1-ares', date_iso: '2026-11-04T18:00:00-06:00', location: 'Wehner 113' }
    ];
    let asked = '';
    const fetcher: Fetcher = { json: async (u) => ((asked = u), body), text: async () => '' };
    const source: EventSource = { key: 'tamu', organizer: 'Texas A&M', city: 'College Station', kind: 'livewhale', base: 'https://calendar.tamu.edu', keyword: 'real estate' };
    const events = await fetchSource(source, now, fetcher, () => {});
    expect(asked).toBe('https://calendar.tamu.edu/live/json/events/search/real%20estate/max/50');
    expect(events.find((e) => e.id.startsWith('tamu-388284'))).toMatchObject({ organizer: 'Texas A&M · Law', cost: 'Free', free: true, start: '2026-11-06T08:30:00-06:00', city: 'College Station', topic: 'Conference' });
    expect(events.filter((e) => e.seriesId).map((e) => e.start)).toEqual(['2026-10-21T18:00:00-05:00', '2026-11-04T18:00:00-06:00']);
  });
});

describe('repeats listed one entry per date', () => {
  it('links same-title entries of one source on different days into a series', () => {
    const a = ev({ id: 'gz-1', title: 'Coffee & Connections', start: '2026-10-21T07:30:00-05:00', sourceKey: 'gz' });
    const b = ev({ id: 'gz-2', title: 'Coffee & Connections', start: '2026-11-18T07:30:00-06:00', sourceKey: 'gz' });
    const c = ev({ id: 'gz-3', title: 'Annual Gala', start: '2026-11-20T18:00:00-06:00', sourceKey: 'gz' });
    const out = linkSeries([a, b, c]);
    expect(out[0]!.seriesId).toBeDefined();
    expect(out[0]!.seriesId).toBe(out[1]!.seriesId);
    expect(out[2]!.seriesId).toBeUndefined();
  });
});
