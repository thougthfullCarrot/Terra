import { describe, expect, it } from 'vitest';
import {
  buildEventsFile,
  EVENT_SOURCES,
  fetchSource,
  INTERNAL,
  internalMeeting,
  parseGrowthZoneDetail,
  parseJsonLdEvents,
  parseLd,
  relevantEvent,
  reportMarkdown,
  type EventSource,
  type Fetcher
} from '../src/events/events.js';

const now = new Date('2026-10-22T01:00:00Z');
const source = (key: string): EventSource => {
  const s = EVENT_SOURCES.find((x) => x.key === key);
  if (!s) throw new Error(`no source ${key}`);
  return s;
};
const pages = (map: Record<string, string>, json: Record<string, unknown> = {}): Fetcher => ({
  text: async (url) => {
    if (url in map) return map[url]!;
    throw new Error(`HTTP 404 ${url}`);
  },
  json: async (url) => {
    if (url.split('?')[0]! in json) return json[url.split('?')[0]!];
    throw new Error(`HTTP 404 ${url}`);
  }
});

// The Austin Chamber's event page (Craft CMS, read 2026-10-22): one Event in an @graph, with a raw line break in the
// description, which JSON forbids.
const AUSTIN_PAGE = (slug: string, name: string, start: string, end: string) => `<html><head>
<script type="application/ld+json">{"@context":"http://schema.org","@graph":[{"@type":"Event","description":"Join fellow Austin business owners
and entrepreneurs.","endDate":"${end}","location":{"@type":"Place","address":"${name}","name":"${name}"},"mainEntityOfPage":"https://www.austinchamber.com/events/${slug}","name":"${name}","organizer":{"@id":"http://www.austinchamber.com#identity"},"startDate":"${start}","url":"https://www.austinchamber.com/events/${slug}"},{"@id":"http://www.austinchamber.com#identity","@type":"ProfessionalService","name":"Austin Chamber of Commerce"}]}</script>
</head><body></body></html>`;
const AUSTIN_LISTING = `<a href="/events/community">Community</a>
<a href="https://www.austinchamber.com/events/area-business-connections-oct-2026">Area Business Connections</a>
<a href="https://www.austinchamber.com/events/economic-outlook-2026">Economic Outlook</a>
<a href="https://www.austinchamber.com/events/healthcare-summit-2026">Healthcare</a>`;

describe('new sources (2026-10-22 expansion)', () => {
  it('reads JSON-LD with raw line breaks inside strings', () => {
    expect(parseLd('{"a":"one\ntwo"}')).toEqual({ a: 'one two' });
    expect(parseLd('{not json')).toBeUndefined();
  });

  it('Austin Chamber: keeps networking and economic events, judged by title or the page slug', async () => {
    const fetcher = pages({
      'https://www.austinchamber.com/events': AUSTIN_LISTING,
      'https://www.austinchamber.com/events/community': '<html></html>',
      'https://www.austinchamber.com/events/area-business-connections-oct-2026': AUSTIN_PAGE('area-business-connections-oct-2026', 'Area Business Connections, October Session', '2026-10-27T16:00:00-05:00', '2026-10-27T18:00:00-05:00'),
      // A slogan title; the slug says what it is.
      'https://www.austinchamber.com/events/economic-outlook-2026': AUSTIN_PAGE('economic-outlook-2026', 'Trends, Forecasts, & the Forces Behind Them', '2026-12-17T11:00:00-06:00', '2026-12-17T13:30:00-06:00'),
      'https://www.austinchamber.com/events/healthcare-summit-2026': AUSTIN_PAGE('healthcare-summit-2026', 'The Rising Cost of Healthcare', '2026-10-22T10:30:00-05:00', '2026-10-22T13:00:00-05:00')
    });
    const counts = { raw: 0 };
    const events = await fetchSource(source('austin-chamber'), now, fetcher, () => {}, counts);
    expect(counts.raw).toBe(3);
    expect(events.map((e) => [e.title, e.start, e.city, e.timezone])).toEqual([
      ['Area Business Connections, October Session', '2026-10-27T16:00:00-05:00', 'Austin', 'America/Chicago'],
      ['Trends, Forecasts, & the Forces Behind Them', '2026-12-17T11:00:00-06:00', 'Austin', 'America/Chicago']
    ]);
    // The page's "location" is the event's own name: no venue is shown rather than the title twice.
    expect(events[0]!.venue).toBeNull();
    expect(events[0]!.address).toBeUndefined();
    // The page states no price: nothing is invented.
    expect(events[0]!.free).toBeUndefined();
    expect(events[0]!.cost).toBeNull();
  });

  it('relevance words cover mixers, YP and tours but not personal-finance "planning"', () => {
    const t = (title: string, url = 'https://x.org/e/1') => relevantEvent({ title, url });
    expect(t('Young Professionals Happy Hour')).toBe(true);
    expect(t('Hard Hat Tour: Pearl Phase 2')).toBe(true);
    expect(t('Realtor Sneak Peek')).toBe(true);
    expect(t('Southwestern University 560 Groundbreaking Ceremony')).toBe(true);
    expect(t('Retirement Planning Seminar')).toBe(false);
    expect(t('Yoga in the Park')).toBe(false);
    // Seen in the 2026-10-22 pilot: an architecture walking tour is not a CRE event; a committee's own meeting is not public.
    expect(t('Urban Art Walking Tour')).toBe(false);
    expect(INTERNAL.test('Urban Design Committee Meeting')).toBe(true);
    expect(INTERNAL.test('TAA’s 2027 Winter Board of Directors Meeting')).toBe(true);
    expect(INTERNAL.test('Committee on the Environment (COTE) Happy Hour')).toBe(false);
    // Public government meetings about development stay: only an association's own governance is dropped.
    expect(internalMeeting('Urban Design Committee Meeting')).toBe(true);
    expect(internalMeeting('Chapter Council Meeting')).toBe(true);
    expect(internalMeeting('City Council Meeting')).toBe(false);
    expect(internalMeeting('Georgetown City Council Meeting: Zoning Cases')).toBe(false);
    expect(internalMeeting('Planning and Zoning Committee Meeting')).toBe(false);
    expect(internalMeeting('Land Use Committee Meeting')).toBe(false);
    expect(internalMeeting('Zoning Board of Adjustment Board Meeting')).toBe(false);
    expect(t('Planning & Zoning Commission Meeting')).toBe(true);
    expect(t('Celebrating Excellence', 'https://x.org/events/business-after-hours-oct')).toBe(true);
  });

  it('Cedar Park: a member bar promotion is not a networking event', async () => {
    const s = source('cedar-park-chamber');
    expect(s.exclude?.test('All Day Happy Hour - The All Good')).toBe(true);
    expect(s.exclude?.test('Business After Hours - Ally Medical ER')).toBe(false);
  });

  it('Texas Apartment Association: keeps events whose venue is in a market, drops the rest', async () => {
    const tribe = {
      events: [
        { id: 1, title: '2026 HAF Chili Fest', url: 'https://www.taa.org/event/2026-haf-chili-fest/', start_date: '2026-10-24 11:00:00', end_date: '2026-10-24 15:00:00', utc_start_date: '2026-10-24 16:00:00', utc_end_date: '2026-10-24 20:00:00', cost: '', venue: { venue: 'Humble Civic Center & Arena Complex', address: '8233 Will Clayton Pkwy', city: 'Humble' } },
        { id: 2, title: 'AAGD Executive’s Wine & Spirit Tasting', url: 'https://www.taa.org/event/aagd/', start_date: '2026-11-04 18:00:00', end_date: '2026-11-04 20:00:00', utc_start_date: '2026-11-05 00:00:00', utc_end_date: '2026-11-05 02:00:00', cost: '', venue: { venue: 'AMLI Fountain Place', city: 'Dallas' } },
        { id: 3, title: 'Panhandle AA Trade Show', url: 'https://www.taa.org/event/panhandle/', start_date: '2026-11-06 09:00:00', end_date: '2026-11-06 14:00:00', utc_start_date: '2026-11-06 15:00:00', utc_end_date: '2026-11-06 20:00:00', cost: '', venue: { venue: 'Amarillo Civic Center', city: 'Amarillo' } },
        { id: 5, title: 'TAA’s 2027 Winter Board of Directors Meeting', url: 'https://www.taa.org/event/board/', start_date: '2027-02-02 18:00:00', end_date: '2027-02-02 20:00:00', cost: '', venue: { venue: 'AT&T Hotel and Conference Center', city: 'Austin' } },
        { id: 4, title: 'Fair Housing Seminar (Virtual)-2026', url: 'https://www.taa.org/event/fair-housing/', start_date: '2026-11-19 09:00:00', end_date: '2026-11-19 12:00:00', utc_start_date: '2026-11-19 15:00:00', utc_end_date: '2026-11-19 18:00:00', cost: '', venue: { venue: 'AAA Office', city: 'Austin' } }
      ]
    };
    const fetcher = pages({}, { 'https://www.taa.org/wp-json/tribe/events/v1/events': tribe });
    const counts = { raw: 0 };
    const events = await fetchSource(source('taa'), now, fetcher, () => {}, counts);
    expect(counts.raw).toBe(5);
    expect(events.map((e) => [e.title, e.city, e.format ?? 'in-person'])).toEqual([
      ['2026 HAF Chili Fest', 'Houston', 'in-person'],
      ['AAGD Executive’s Wine & Spirit Tasting', 'Dallas', 'in-person'],
      ['Fair Housing Seminar (Virtual)-2026', 'Austin', 'virtual']
    ]);
  });

  it('Texas A&M student organizations: public iCal feed, member-only events not visible', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:getinvolved-485265',
      'SUMMARY:REDA General Meeting: Developer Panel',
      'DTSTART:20261104T001500Z',
      'DTEND:20261104T013000Z',
      'LOCATION:Wehner 113',
      'URL:https://getinvolved.tamu.edu/org/reda/events/18636/485265',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const reda = source('tamu-reda');
    const [e] = await fetchSource(reda, now, pages({ [reda.page!]: ics }), () => {});
    expect(e).toMatchObject({ title: 'REDA General Meeting: Developer Panel', city: 'College Station', start: '2026-11-04T00:15:00Z', timezone: 'America/Chicago' });
    // An empty feed (78 bytes, no events) is a successful read with nothing upcoming.
    expect(await fetchSource(reda, now, pages({ [reda.page!]: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR' }), () => {})).toEqual([]);
    // A sign-in page instead of a feed is a failure, never an empty calendar.
    await expect(fetchSource(reda, now, pages({ [reda.page!]: '<html>Sign in</html>' }), () => {})).rejects.toThrow('not an iCal feed');
  });

  it('report: raw listings per source and market, separate from displayed events; a failed source reads 0 and stays stale', async () => {
    const reda = source('tamu-reda');
    const real = source('tamu-real');
    const ics = (uid: string, title: string, day: string) =>
      ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, `DTSTART:${day}T230000Z`, `DTEND:${day}T235900Z`, `URL:https://getinvolved.tamu.edu/e/${uid}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const previous = {
      generatedAt: '2026-10-21T01:00:00Z',
      sources: [{ key: 'tamu-real', organizer: real.organizer, city: real.city, url: real.page!, fetchedAt: '2026-10-21T01:00:00Z', count: 1, ok: true, lastSuccessAt: '2026-10-21T01:00:00Z' }],
      cities: [{ city: 'College Station' as const, events: [{ id: 'tamu-real-x', title: 'Aggie Real Estate Club Mixer', url: 'https://getinvolved.tamu.edu/e/x', start: '2026-11-10T23:00:00Z', end: null, city: 'College Station' as const, organizer: real.organizer, venue: null, cost: null, sourceKey: 'tamu-real', verifiedAt: '2026-10-21T01:00:00Z' }] }]
    };
    const file = await buildEventsFile(now, previous, {
      sources: [reda, real],
      fetcher: pages({ [reda.page!]: ics('a', 'Developer Panel', '20261104') }),
      log: () => {}
    });
    const cs = file.report!.find((r) => r.city === 'College Station')!;
    expect(cs).toMatchObject({ sourcesChecked: 2, sourcesOk: 1, sourcesFailed: 1, raw: 1, displayed: 2, stale: 1 });
    const stale = file.cities.find((c) => c.city === 'College Station')!.events.find((e) => e.stale)!;
    // Not freshly checked: keeps its old verification time.
    expect(stale.verifiedAt).toBe('2026-10-21T01:00:00Z');
    expect(file.sources.find((s) => s.key === 'tamu-real')).toMatchObject({ ok: false, raw: 0, lastSuccessAt: '2026-10-21T01:00:00Z' });
    const md = reportMarkdown(file);
    expect(md).toContain('| Raw listings | Displayed |');
    expect(md).toMatch(/\| College Station \| Events listed \| 1\/2 \| 1 \| 1 \| 2 \|/);
    // Chronological order is kept.
    const starts = file.cities.find((c) => c.city === 'College Station')!.events.map((e) => e.start);
    expect([...starts].sort()).toEqual(starts);
  });

  it('two organizers listing the same mixer merge; two occurrences of a series do not', async () => {
    const { dedupe } = await import('../src/events/events.js');
    const base = { url: 'https://a.org/e/1', end: null, city: 'Austin' as const, venue: 'Hotel Ella', cost: null };
    const merged = dedupe([
      { ...base, id: 'a', title: 'Business After Hours: Ally Medical ER', organizer: 'Cedar Park Chamber', start: '2026-10-28T17:00:00-05:00' },
      { ...base, id: 'b', url: 'https://b.org/e/9', title: 'Business After Hours - Ally Medical ER', organizer: 'Austin Chamber', start: '2026-10-28T17:00:00-05:00' },
      { ...base, id: 'c', url: 'https://a.org/e/1#nov', title: 'Business After Hours: Ally Medical ER', organizer: 'Cedar Park Chamber', start: '2026-11-25T17:00:00-06:00' }
    ]);
    expect(merged.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('GrowthZone: an end at the next midnight after a timed start is a placeholder, not a two-day mixer', () => {
    // Seen on four chamber pages in the 2026-10-22 pilot (Cedar Park, Metro SA, B-CS, Lubbock): 5 PM start, "ends" 12 AM.
    const ld = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', name: 'Business After Hours - Ally Medical ER', startDate: '2026-10-28T17:00:00-05:00', endDate: '2026-10-29T00:00:00-05:00', location: { '@type': 'Place', name: '14016 North Highway 183' } })}</script>`;
    const withText = parseGrowthZoneDetail(`${ld}<p>October 28, 2026 (5:00 PM - 7:00 PM)</p>`);
    expect([withText.start, withText.end]).toEqual(['2026-10-28T17:00:00-05:00', '2026-10-28T19:00:00-05:00']);
    expect(parseGrowthZoneDetail(ld).end).toBeNull();
    // A real overnight end (a gala to 1 AM) is kept.
    const late = parseGrowthZoneDetail(ld.replace('2026-10-29T00:00:00-05:00', '2026-10-29T01:00:00-05:00'));
    expect(late.end).not.toBeNull();
  });

  it('GrowthZone: legitimate multi-day events and stated midnight endings keep their end', () => {
    const page = (start: string, end: string, text = '') =>
      parseGrowthZoneDetail(`<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'X', startDate: start, endDate: end })}</script>${text}`);
    // A two-day conference ending at midnight two days on is a real multi-day event.
    expect(page('2026-11-05T08:00:00-06:00', '2026-11-07T00:00:00-06:00').end).toBe('2026-11-07T00:00:00-06:00');
    // A three-day summit ending at a clock time is untouched.
    expect(page('2026-11-05T08:00:00-06:00', '2026-11-07T15:00:00-06:00').end).toBe('2026-11-07T15:00:00-06:00');
    // The page prints the midnight end itself: kept.
    expect(page('2026-10-31T20:00:00-05:00', '2026-11-01T00:00:00-05:00', '<p>October 31, 2026 8:00 PM - 12:00 AM</p>').end).toBe('2026-11-01T00:00:00-05:00');
    expect(page('2026-10-31T20:00:00-05:00', '2026-11-01T00:00:00-05:00', '<p>Gala runs until midnight.</p>').end).toBe('2026-11-01T00:00:00-05:00');
    // The mixer placeholder with a printed range still takes the printed end.
    expect(page('2026-10-28T17:00:00-05:00', '2026-10-29T00:00:00-05:00', '<p>October 28, 2026 5:00 PM - 7:00 PM</p>').end).toBe('2026-10-28T19:00:00-05:00');
  });

  it('every new source is configured with a real organizer page', () => {
    for (const key of ['georgetown-chamber', 'cedar-park-chamber', 'san-marcos-partnership', 'galveston-chamber', 'austin-chamber', 'taa', 'tamu-reda', 'tamu-real']) {
      const s = source(key);
      expect(s.base).toMatch(/^https:\/\//);
      expect(parseJsonLdEvents('', s, s.base)).toEqual([]);
    }
  });
});
