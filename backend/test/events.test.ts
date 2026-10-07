import { describe, expect, it } from 'vitest';
import {
  applyDatePrefix,
  buildEventsFile,
  datePrefix,
  isClosure,
  centralIso,
  EVENT_SOURCES,
  fetchSource,
  growthZoneLinks,
  parseGrowthZoneDetail,
  parseIcs,
  parseTribe,
  dedupe,
  sameEvent,
  slugTitle,
  cityIn,
  icalLink,
  parseMicrodataEvent,
  sitemapEventUrls,
  parseLocalist,
  tribeUrl,
  upcoming,
  type EventsFile,
  type Fetcher,
  type TerraEvent
} from '../src/events/events.js';
import { eventCounts, eventDate, filterEvents, groupByMonth, readEventsHash, writeEventsHash } from '../../site/events.js';

const now = new Date('2026-10-05T12:00:00Z');
const creda = EVENT_SOURCES.find((s) => s.key === 'creda-houston')!;
const boma = EVENT_SOURCES.find((s) => s.key === 'boma-dallas')!;

const TRIBE = {
  events: [
    {
      id: 4512,
      title: 'Developers&#8217; Breakfast &amp; Market Outlook',
      url: 'https://credahouston.org/event/developers-breakfast/',
      start_date: '2026-10-14 07:30:00',
      end_date: '2026-10-14 09:30:00',
      utc_start_date: '2026-10-14 12:30:00',
      utc_end_date: '2026-10-14 14:30:00',
      cost: '$65 &ndash; $95',
      venue: { venue: 'Houstonian Hotel', address: '111 N Post Oak Ln', city: 'Houston' }
    },
    { id: 4513, title: 'Holiday Social', url: 'https://credahouston.org/event/holiday-social/', start_date: '2026-12-04 17:00:00', end_date: '2026-12-04 20:00:00', cost: '', venue: [] },
    { id: 4514, title: 'Bad link', url: 'javascript:alert(1)', start_date: '2026-10-20 08:00:00' }
  ]
};

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//GrowthZone//Events//EN',
  'BEGIN:VEVENT',
  'UID:gz-1234',
  'SUMMARY:BOMA Dallas Monthly Luncheon\\, October',
  'DTSTART;TZID=Central Standard Time:20261021T113000',
  'DTEND;TZID=Central Standard Time:20261021T130000',
  'LOCATION:Belo Mansion\\, 2101 Ross Ave\\, Dallas',
  'URL:https://members.bomadallas.org/events/Details/monthly-luncheon-',
  ' october-1234',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:gz-1300',
  'SUMMARY:Golf Tournament',
  'DTSTART:20261110T140000Z',
  'URL:https://members.bomadallas.org/events/Details/golf-tournament-1300',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

const LISTING = `<html><body>
<div class="gz-events-card"><a href="/events/Details/fall-trade-show-and-expo-987654?sourceTypeId=Website" class="gz-card-title">Fall Trade Show &amp; Expo</a></div>
<div class="gz-events-card"><a href="https://members.bomadallas.org/events/Details/young-professionals-happy-hour-987700"><img src="x.png"></a></div>
<a href="/events/Details/fall-trade-show-and-expo-987654">Fall Trade Show &amp; Expo</a>
<a href="/events/calendar">Calendar</a>
</body></html>`;

const DETAIL_LD = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Fall Trade Show &amp; Expo","startDate":"2026-10-28T08:00:00-05:00","endDate":"2026-10-28T14:00:00-05:00","location":{"@type":"Place","name":"Fair Park"}}</script>`;
const DETAIL_MICRO = `<div itemscope itemtype="http://schema.org/Event"><meta itemprop="startDate" content="2026-11-06T17:30"><div itemprop="location" itemscope><span itemprop="name">The Rustic</span></div></div>`;

function ev(start: string, extra: Partial<TerraEvent> = {}): TerraEvent {
  return { id: start, title: 'E', url: `https://x.org/${start}`, start, end: null, city: 'Dallas', organizer: 'BOMA Dallas', venue: null, cost: null, ...extra };
}

describe('Central time', () => {
  it('uses CDT in summer and CST in winter', () => {
    expect(centralIso('2026-10-14 07:30:00')).toBe('2026-10-14T07:30:00-05:00');
    expect(centralIso('2026-12-04 17:00:00')).toBe('2026-12-04T17:00:00-06:00');
    expect(centralIso('2026-11-01 10:00')).toBe('2026-11-01T10:00:00-06:00');
    expect(centralIso('2026-03-08 10:00')).toBe('2026-03-08T10:00:00-05:00');
    expect(centralIso('nope')).toBeNull();
  });
});

describe('The Events Calendar (CREDA Houston)', () => {
  it('asks for upcoming events from today', () => {
    const url = new URL(tribeUrl(creda.base, now));
    expect(url.pathname).toBe('/wp-json/tribe/events/v1/events');
    expect(url.searchParams.get('start_date')).toBe('2026-10-05');
    expect(url.searchParams.get('per_page')).toBe('50');
  });

  it('parses events, decoding entities and skipping bad links', () => {
    const events = parseTribe(TRIBE, creda);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 'creda-houston-4512',
      title: 'Developers’ Breakfast & Market Outlook',
      start: '2026-10-14T12:30:00Z',
      city: 'Houston',
      organizer: 'CREDA Houston',
      venue: 'Houstonian Hotel, Houston',
      cost: '$65 – $95'
    });
    expect(events[1]).toMatchObject({ start: '2026-12-04T17:00:00-06:00', venue: null, cost: null });
  });
});

describe('GrowthZone (BOMA Dallas)', () => {
  it('parses an iCal feed with folded lines and escapes', () => {
    const events = parseIcs(ICS, boma);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: 'BOMA Dallas Monthly Luncheon, October',
      url: 'https://members.bomadallas.org/events/Details/monthly-luncheon-october-1234',
      start: '2026-10-21T11:30:00-05:00',
      venue: 'Belo Mansion, 2101 Ross Ave, Dallas',
      city: 'Dallas'
    });
    expect(events[1]!.start).toBe('2026-11-10T14:00:00Z');
    expect(parseIcs('<html>login</html>', boma)).toEqual([]);
  });

  it('finds event links on the listing page, once each', () => {
    const links = growthZoneLinks(LISTING, boma.base);
    expect(links).toEqual([
      { url: 'https://members.bomadallas.org/events/Details/fall-trade-show-and-expo-987654', title: 'Fall Trade Show & Expo' },
      { url: 'https://members.bomadallas.org/events/Details/young-professionals-happy-hour-987700', title: 'Young Professionals Happy Hour' }
    ]);
    expect(slugTitle('https://x.org/events/Details/golf-day-12')).toBe('Golf Day');
  });

  it('reads dates from JSON-LD or microdata', () => {
    expect(parseGrowthZoneDetail(DETAIL_LD)).toEqual({ title: 'Fall Trade Show & Expo', start: '2026-10-28T08:00:00-05:00', end: '2026-10-28T14:00:00-05:00', venue: 'Fair Park' });
    expect(parseGrowthZoneDetail(DETAIL_MICRO)).toMatchObject({ start: '2026-11-06T17:30:00-06:00', venue: 'The Rustic' });
    expect(parseGrowthZoneDetail('<p>nothing</p>').start).toBeNull();
  });

  it('falls back to the listing when no calendar feed answers', async () => {
    const pages: Record<string, string> = {
      [`${boma.base}/events`]: LISTING,
      'https://members.bomadallas.org/events/Details/fall-trade-show-and-expo-987654': DETAIL_LD,
      'https://members.bomadallas.org/events/Details/young-professionals-happy-hour-987700': DETAIL_MICRO
    };
    const fetcher: Fetcher = {
      json: async () => ({}),
      text: async (url) => {
        if (url in pages) return pages[url]!;
        throw new Error('404');
      }
    };
    const events = await fetchSource(boma, now, fetcher, () => {});
    expect(events.map((e) => [e.id, e.title])).toEqual([
      ['boma-dallas-987654', 'Fall Trade Show & Expo'],
      ['boma-dallas-987700', 'Young Professionals Happy Hour']
    ]);
  });
});

describe('upcoming', () => {
  it('keeps events that have not ended within the window, by start, once per url', () => {
    const list = upcoming(
      [ev('2026-11-01T10:00:00Z'), ev('2026-10-01T10:00:00Z'), ev('2026-10-05T08:00:00Z'), ev('2027-06-01T10:00:00Z'), ev('2026-10-10T10:00:00Z'), ev('2026-10-10T10:00:00Z')],
      now
    );
    expect(list.map((e) => e.start)).toEqual(['2026-10-05T08:00:00Z', '2026-10-10T10:00:00Z', '2026-11-01T10:00:00Z']);
  });
});

describe('buildEventsFile', () => {
  it('collects every source and keeps earlier events when one fails', async () => {
    const previous: EventsFile = {
      generatedAt: '2026-10-04T12:00:00Z',
      sources: [{ organizer: 'BOMA Dallas', city: 'Dallas', url: '', fetchedAt: '2026-10-04T12:00:00Z', count: 2 }],
      cities: [{ city: 'Dallas', events: [ev('2026-10-20T16:00:00Z'), ev('2026-09-01T16:00:00Z')] }]
    };
    const fetcher: Fetcher = {
      json: async () => TRIBE,
      text: async () => {
        throw new Error('HTTP 503');
      }
    };
    // University calendars answer JSON too; this fake only speaks The Events Calendar's.
    const sources = EVENT_SOURCES.filter((s) => s.kind !== 'localist');
    const file = await buildEventsFile(now, previous, { sources, fetcher, log: () => {} });
    expect(file.cities.map((c) => c.city)).toEqual(['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland']);
    expect(file.cities.find((c) => c.city === 'Houston')!.events).toHaveLength(2);
    expect(file.cities.find((c) => c.city === 'Dallas')!.events.map((e) => e.start)).toEqual(['2026-10-20T16:00:00Z']);
    expect(file.sources.map((s) => [s.organizer, s.count])).toEqual([
      ['CREDA Houston', 2],
      ['BOMA Dallas', 1]
    ]);
  });
});

describe('site events.js', () => {
  const file = {
    generatedAt: now.toISOString(),
    sources: [],
    cities: [
      { city: 'Dallas', events: [ev('2026-11-03T17:00:00Z'), ev('2026-10-01T17:00:00Z')] },
      { city: 'Houston', events: [ev('2026-10-14T12:30:00Z', { city: 'Houston' })] },
      { city: 'Austin', events: [] }
    ]
  };

  it('reads and writes the hash', () => {
    expect(readEventsHash('#events&city=Houston', file)).toEqual({ open: true, city: 'Houston' });
    expect(readEventsHash('#events&city=Nowhere', file)).toEqual({ open: true, city: '' });
    expect(readEventsHash('#news', file).open).toBe(false);
    expect(writeEventsHash({ city: 'El Paso' })).toBe('#events&city=El+Paso');
    expect(writeEventsHash({ city: '' })).toBe('#events');
  });

  it('filters, counts and groups by month', () => {
    const all = filterEvents(file, {}, now);
    expect(all.map((e) => e.start)).toEqual(['2026-10-14T12:30:00Z', '2026-11-03T17:00:00Z']);
    expect(filterEvents(file, { city: 'Austin' }, now)).toEqual([]);
    expect([...eventCounts(file, now)]).toEqual([
      ['Dallas', 1],
      ['Houston', 1],
      ['Austin', 0]
    ]);
    expect(groupByMonth(all).map((g) => [g.month, g.events.length])).toEqual([
      ['October 2026', 1],
      ['November 2026', 1]
    ]);
  });

  it('formats dates in Texas time', () => {
    expect(eventDate('2026-10-14T12:30:00Z')).toBe('Wed, Oct 14 · 7:30 AM');
    expect(eventDate('2026-10-14T00:00:00-05:00')).toBe('Wed, Oct 14');
    expect(eventDate('bad')).toBe('');
  });
});

describe('event fixes', () => {
  it('falls back to the tribe iCal export when REST 404s', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:10012-1760000000-1760003600@credahouston.org',
      'DTSTART;TZID=America/Chicago:20261014T073000',
      'DTEND;TZID=America/Chicago:20261014T093000',
      'SUMMARY:Developers\\, Lenders &',
      '  Brokers Breakfast',
      'URL:https://credahouston.org/event/breakfast/',
      'LOCATION:Houstonian Hotel\\, 111 N Post Oak Ln\\, Houston',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:10013',
      'DTSTART;VALUE=DATE:20261120',
      'DTEND;VALUE=DATE:20261121',
      'SUMMARY:Golf Tournament',
      'URL:https://credahouston.org/event/golf/',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    const tried: string[] = [];
    const fetcher: Fetcher = {
      json: async () => { throw new Error('HTTP 404'); },
      text: async (url) => { tried.push(url); if (url.includes('/events/?ical=1')) throw new Error('HTTP 404'); return ics; }
    };
    const events = await fetchSource(creda, now, fetcher, () => {});
    expect(tried[0]).toBe('https://credahouston.org/events/?ical=1');
    expect(tried[1]).toBe('https://credahouston.org/events/list/?ical=1');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ title: 'Developers, Lenders & Brokers Breakfast', start: '2026-10-14T07:30:00-05:00', venue: 'Houstonian Hotel, 111 N Post Oak Ln, Houston' });
    expect(events[1]!.start).toBe('2026-11-20T00:00:00-06:00');
  });

  it('throws when neither REST nor iCal works', async () => {
    const fetcher: Fetcher = { json: async () => { throw new Error('HTTP 404'); }, text: async () => '<html></html>' };
    await expect(fetchSource(creda, now, fetcher, () => {})).rejects.toThrow('HTTP 404');
  });

  it('flags closures', () => {
    expect(isClosure('BOMA CLOSED - Thanksgiving')).toBe(true);
    expect(isClosure('Closed - Labor Day')).toBe(true);
    expect(isClosure('BOMA Offices Closed for Christmas')).toBe(true);
    expect(isClosure('Foundation Gala')).toBe(false);
    expect(isClosure('Closed-Door Leasing Roundtable')).toBe(false);
  });

  it('reads MM.DD.YY title prefixes', () => {
    expect(datePrefix('10.24.26 Foundation Gala')).toEqual({ date: '2026-10-24', title: 'Foundation Gala' });
    expect(datePrefix('Gala 2026')).toEqual({ date: null, title: 'Gala 2026' });
    const base: TerraEvent = { id: 'x', title: '12.09.26 Annual Leadership Orientation', url: 'https://a/b', start: '2026-10-22T08:00:00-05:00', end: '2026-10-22T10:00:00-05:00', city: 'Dallas', organizer: 'BOMA Dallas', venue: null, cost: null };
    expect(applyDatePrefix(base)).toMatchObject({ title: 'Annual Leadership Orientation', start: '2026-12-09T00:00:00-06:00', end: null });
    const same = { ...base, title: '10.22.26 Lunch' };
    expect(applyDatePrefix(same)).toMatchObject({ title: 'Lunch', start: '2026-10-22T08:00:00-05:00' });
  });

  it('keeps Central dates from GrowthZone detail pages', () => {
    const ld = (start: string) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'Gala', startDate: start })}</script>`;
    expect(parseGrowthZoneDetail(ld('2026-10-24T19:00:00-05:00')).start).toBe('2026-10-24T19:00:00-05:00');
    expect(parseGrowthZoneDetail(ld('2026-10-24T00:00:00Z')).start).toBe('2026-10-24T00:00:00-05:00');
    expect(parseGrowthZoneDetail(ld('2026-10-24')).start).toBe('2026-10-24T00:00:00-05:00');
  });

  it('drops closures and fixes prefixed BOMA events end to end', async () => {
    const list = '<a href="/events/Details/boma-closed-thanksgiving-111">BOMA CLOSED - Thanksgiving</a><a href="/events/Details/foundation-gala-222">10.24.26 Foundation Gala</a>';
    const pages: Record<string, string> = {
      'https://members.bomadallas.org/events/Details/boma-closed-thanksgiving-111': '<span itemprop="startDate" content="2026-11-26"></span>',
      'https://members.bomadallas.org/events/Details/foundation-gala-222': `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: '10.24.26 Foundation Gala', startDate: '2026-10-24T18:00:00-05:00' })}</script>`
    };
    const fetcher: Fetcher = { json: async () => ({}), text: async (url) => { if (url.endsWith('/events')) return list; if (pages[url]) return pages[url]!; throw new Error('404'); } };
    const events = await fetchSource(boma, now, fetcher, () => {});
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ title: 'Foundation Gala', start: '2026-10-24T18:00:00-05:00' });
  });
});

describe('auto-filled sources for every market', () => {
  const unt = EVENT_SOURCES.find((s) => s.key === 'unt')!;
  const aia = EVENT_SOURCES.find((s) => s.key === 'aia-sa')!;
  const trec = EVENT_SOURCES.find((s) => s.key === 'trec-dallas')!;
  const sa = (title: string, start: string, url: string, source?: string): TerraEvent => ({ id: url, title, url, start, end: null, city: 'San Antonio', organizer: 'x', venue: null, cost: null, ...(source ? { source } : {}) });

  it('lists a calendar for every market', () => {
    const cities = new Set(EVENT_SOURCES.map((s) => s.city));
    expect(['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso', 'New Braunfels', 'College Station', 'Galveston', 'Lubbock', 'Midland'].filter((c) => !cities.has(c as TerraEvent['city']))).toEqual([]);
    expect(new Set(EVENT_SOURCES.map((s) => s.key)).size).toBe(EVENT_SOURCES.length);
  });

  it('reads university events from the Localist API', async () => {
    const body = {
      events: [
        { event: { id: 5412, title: 'Tonti Properties x North Texas Real Estate Collective', localist_url: 'https://calendar.unt.edu/event/tonti-properties', location_name: 'University Union', ticket_cost: '', event_instances: [{ event_instance: { start: '2026-10-14T17:30:00-05:00', end: '2026-10-14T19:00:00-05:00' } }] } },
        { event: { id: 5413, title: 'No date', localist_url: 'https://calendar.unt.edu/event/x', event_instances: [] } }
      ]
    };
    let asked = '';
    const fetcher: Fetcher = { json: async (url) => ((asked = url), body), text: async () => '' };
    const events = await fetchSource(unt, now, fetcher, () => {});
    expect(asked).toBe('https://calendar.unt.edu/api/2/events?days=120&pp=100&keyword=real+estate');
    expect(events).toEqual([
      { id: 'unt-5412', title: 'Tonti Properties x North Texas Real Estate Collective', url: 'https://calendar.unt.edu/event/tonti-properties', start: '2026-10-14T17:30:00-05:00', end: '2026-10-14T19:00:00-05:00', city: 'Dallas', organizer: 'UNT', venue: 'University Union', cost: null }
    ]);
    expect(parseLocalist(null, unt)).toEqual([]);
  });

  it("falls back to an event page's own iCal export", async () => {
    const page = '<script type="application/ld+json">{"@type":"Event","name":"Bad\nJSON"}</script><a class="mec" href="https://aiasa.org/?method=ical&#038;id=63704">+ iCal / Outlook export</a>';
    expect(icalLink(page, 'https://aiasa.org/events/x/')).toBe('https://aiasa.org/?method=ical&id=63704');
    const files: Record<string, string> = {
      'https://aiasa.org/events/': '<a href="/events/aia-centro-joint-luncheon/">Luncheon</a>',
      'https://aiasa.org/events/aia-centro-joint-luncheon/': page,
      'https://aiasa.org/?method=ical&id=63704': ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'SUMMARY:AIA Centro Joint Luncheon', 'DTSTART:20261020T160000Z', 'LOCATION:Centre Club', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    };
    const fetcher: Fetcher = { json: async () => ({}), text: async (url) => files[url] ?? Promise.reject(new Error('404')) };
    const events = await fetchSource(aia, now, fetcher, () => {});
    expect(events.map((e) => [e.title, e.start, e.url, e.venue])).toEqual([['AIA Centro Joint Luncheon', '2026-10-20T16:00:00Z', 'https://aiasa.org/events/aia-centro-joint-luncheon/', 'Centre Club']]);
  });

  it('treats the same event from two listings as one, keeping the first', () => {
    const hand = sa('Tech Breakfast Club', '2026-10-01T08:00:00-05:00', 'https://members.metrosa.com/events/details/a-1', 'Added by hand');
    const feed = sa('2026 Tech Breakfast Club - Oct', '2026-10-01T08:00:00-05:00', 'https://members.metrosa.com/events/Details/b-2');
    expect(sameEvent(hand, feed)).toBe(true);
    expect(sameEvent(hand, { ...feed, start: '2026-10-02T08:00:00-05:00' })).toBe(false);
    expect(sameEvent(sa('October General Meeting', '2026-10-07', 'u1'), sa('October Board Meeting', '2026-10-07', 'u2'))).toBe(false);
    expect(sameEvent(sa('CCIM Symposium', '2026-10-21', 'u1'), sa('San Antonio/ South Texas CCIM Symposium', '2026-10-21', 'u2'))).toBe(true);
    expect(dedupe([hand, feed]).map((e) => e.source)).toEqual(['Added by hand']);
  });

  it('keeps the hand-entered copy when a calendar lists the same event', async () => {
    const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: { '@type': 'Event', name: 'CRE Networking Breakfast', url: 'https://calendar.example.org/e/9', startDate: '2026-10-15T07:30:00-05:00', location: { name: 'Pearl' } } }] })}</script>`;
    const source = { ...trec, key: 'cal', organizer: 'Calendar', city: 'San Antonio' as const, exclude: undefined };
    const fetcher: Fetcher = { json: async () => ({}), text: async () => page };
    const manual = [sa('CRE Networking Breakfast', '2026-10-15T07:30:00-05:00', 'https://example.org/breakfast')];
    const file = await buildEventsFile(now, null, { sources: [source], fetcher, log: () => {}, manual });
    const events = file.cities.find((c) => c.city === 'San Antonio')!.events;
    expect(events.map((e) => [e.url, e.source])).toEqual([['https://example.org/breakfast', 'Added by hand']]);
  });
});

describe('YCRAN and CREW (sitemap sources)', () => {
  const ycran = EVENT_SOURCES.find((s) => s.key === 'ycran')!;
  const crewHouston = EVENT_SOURCES.find((s) => s.key === 'crew-houston')!;

  it('picks this year\'s event pages, or recently changed ones when urls carry no year', () => {
    const crewXml = '<urlset><url><loc>houston.crewnetwork.org/events/2026/coffee-with-crew</loc><lastmod>2026-10-07T23:14:30.568Z</lastmod></url><url><loc>houston.crewnetwork.org/events/2025/holiday-party</loc></url><url><loc>houston.crewnetwork.org/about</loc></url></urlset>';
    expect(sitemapEventUrls(crewXml, 'https://houston.crewnetwork.org', '/events/', now)).toEqual(['https://houston.crewnetwork.org/events/2026/coffee-with-crew']);
    const wixXml = '<urlset><url><loc>https://www.ycran.org/event-details/a-night-at-camp</loc><lastmod>2024-07-17</lastmod></url><url><loc>https://www.ycran.org/event-details/anatomy-of-a-deal-1</loc><lastmod>2026-09-11</lastmod></url><url><loc>https://www.ycran.org/event-details/austin-mixer</loc><lastmod>2026-10-01</lastmod></url></urlset>';
    expect(sitemapEventUrls(wixXml, 'https://www.ycran.org', '/event-details/', now)).toEqual(['https://www.ycran.org/event-details/austin-mixer', 'https://www.ycran.org/event-details/anatomy-of-a-deal-1']);
  });

  it('reads CREW event pages from their startDate microdata', () => {
    const html = '<title>Coffee CREW Houston</title><meta property="og:title" content="The Business of Relationships " data-next-head=""/><h1 class="mb-3">The Business of Relationships</h1><div class="event--meta mb-3"><span class="event--meta-item"><time itemProp="startDate" dateTime="2026-10-22T16:00:00.000-05:00">Oct 22, 2026</time></span><span class="sr-only">from</span><span class="event--meta-item">4:00 PM<!-- --> <span class="sr-only">to</span> - <!-- -->6:00 PM<!-- --> <!-- -->CDT</span><span class="event--meta-item">Camden Property Trust</span><span>2800 Post Oak Boulevard</span></div>';
    expect(parseMicrodataEvent(html)).toEqual({ title: 'The Business of Relationships', start: '2026-10-22T16:00:00-05:00', venue: 'Camden Property Trust' });
    expect(parseMicrodataEvent('<h1>No date</h1>')).toBeNull();
  });

  it('places YCRAN events in the market their address names', async () => {
    const ld = (name: string, address: string, start: string) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Event', name, startDate: start, location: { '@type': 'Place', name: 'Venue', address } })}</script>`;
    const files: Record<string, string> = {
      'https://www.ycran.org/event-pages-sitemap.xml': '<urlset><url><loc>https://www.ycran.org/event-details/austin-mixer</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://www.ycran.org/event-details/anatomy</loc><lastmod>2026-09-30</lastmod></url></urlset>',
      'https://www.ycran.org/event-details/austin-mixer': ld('Austin Mixer', '1017 Springdale Rd, Austin, TX 78702, USA', '2026-10-15T17:30:00-05:00'),
      'https://www.ycran.org/event-details/anatomy': ld('Anatomy of A Deal', '10127 Morocco St #195, San Antonio, TX 78216, USA', '2026-10-16T16:00:00-05:00')
    };
    const fetcher: Fetcher = { json: async () => ({}), text: async (url) => files[url] ?? Promise.reject(new Error('404')) };
    const events = await fetchSource(ycran, now, fetcher, () => {});
    expect(events.map((e) => [e.title, e.city, e.url])).toEqual([
      ['Austin Mixer', 'Austin', 'https://www.ycran.org/event-details/austin-mixer'],
      ['Anatomy of A Deal', 'San Antonio', 'https://www.ycran.org/event-details/anatomy']
    ]);
    expect(cityIn('Camp 1604, Fort Worth Ave')).toBe('Fort Worth');
    expect(crewHouston.page).toBe('https://houston.crewnetwork.org/sitemap.xml');
  });
});
