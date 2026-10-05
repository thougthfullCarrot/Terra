import { describe, expect, it } from 'vitest';
import {
  buildEventsFile,
  centralIso,
  EVENT_SOURCES,
  fetchSource,
  growthZoneLinks,
  parseGrowthZoneDetail,
  parseIcs,
  parseTribe,
  slugTitle,
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
    expect(parseGrowthZoneDetail(DETAIL_LD)).toEqual({ title: 'Fall Trade Show & Expo', start: '2026-10-28T13:00:00.000Z', end: '2026-10-28T19:00:00.000Z', venue: 'Fair Park' });
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
    const file = await buildEventsFile(now, previous, { fetcher, log: () => {} });
    expect(file.cities.map((c) => c.city)).toEqual(['Dallas', 'Fort Worth', 'Houston', 'Austin', 'San Antonio', 'El Paso']);
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
