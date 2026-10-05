import { describe, expect, it } from 'vitest';
import { buildEventsFile, MANUAL_SOURCE, type EventsFile } from '../src/events/events.js';
import { EVENT_HEADERS, loadSheetEvents, mergeManual, parseEventTab, parseManualFile, sheetDate, sheetTime } from '../src/events/sheetEvents.js';
import type { SheetsClient } from '../src/sheets/google.js';

const now = new Date('2026-10-05T12:00:00Z');
const header = [...EVENT_HEADERS];

describe('sheet events', () => {
  it('reads dates and times in both forms', () => {
    expect(sheetDate('2026-10-14')).toBe('2026-10-14');
    expect(sheetDate('10/14/2026')).toBe('2026-10-14');
    expect(sheetDate('1/2/27')).toBe('2027-01-02');
    expect(sheetDate('2/30/2026')).toBeNull();
    expect(sheetDate('next week')).toBeNull();
    expect(sheetTime('6:30 PM')).toBe('18:30');
    expect(sheetTime('7am')).toBe('07:00');
    expect(sheetTime('12:00 pm')).toBe('12:00');
    expect(sheetTime('18:15')).toBe('18:15');
    expect(sheetTime('')).toBeNull();
  });

  it('parses rows, skipping past, invalid and unknown-city rows', () => {
    const logs: string[] = [];
    const events = parseEventTab(
      [
        header,
        ['10/21/2026', '11:30 AM', 'YCRAN Austin Mixer', 'Austin', 'YCRAN Austin', 'Brazos Hall', 'ycran.org/austin'],
        ['2026-11-03', '', 'Market Outlook', 'ft worth', '', '', ''],
        ['2026-09-01', '', 'Old event', 'Dallas', 'X', '', ''],
        ['soon', '', 'No date', 'Dallas', 'X', '', ''],
        ['2026-10-30', '', 'Lubbock thing', 'Lubbock', 'X', '', ''],
        []
      ],
      now,
      (m) => logs.push(m)
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      title: 'YCRAN Austin Mixer',
      city: 'Austin',
      organizer: 'YCRAN Austin',
      venue: 'Brazos Hall',
      url: 'https://ycran.org/austin',
      start: '2026-10-21T11:30:00-05:00',
      source: MANUAL_SOURCE
    });
    expect(events[1]).toMatchObject({ city: 'Fort Worth', organizer: MANUAL_SOURCE, url: '', start: '2026-11-03T00:00:00-06:00' });
    expect(logs.some((l) => l.includes('Lubbock'))).toBe(true);
    expect(logs.some((l) => l.includes('row 5'))).toBe(true);
  });

  it('creates the tab with headers when missing and writing is allowed', async () => {
    const writes: unknown[] = [];
    const client = {
      ensureTabs: async () => ['Events'],
      write: async (_r: string, rows: unknown) => void writes.push(rows),
      read: async () => []
    } as unknown as SheetsClient;
    expect(await loadSheetEvents(client, now, { write: true, log: () => {} })).toEqual([]);
    expect(writes).toEqual([[header]]);
    expect(await loadSheetEvents(null, now, { write: true })).toBeNull();
  });

  it('returns null when the sheet fails, and the file keeps earlier hand rows', async () => {
    const client = { read: async () => Promise.reject(new Error('403')) } as unknown as SheetsClient;
    expect(await loadSheetEvents(client, now, { write: false, log: () => {} })).toBeNull();
    const manual = parseEventTab([header, ['2026-10-21', '', 'Mixer', 'San Antonio', 'CREW SA', '', '']], now, () => {});
    const first = await buildEventsFile(now, null, { sources: [], manual, log: () => {} });
    expect(first.cities.find((c) => c.city === 'San Antonio')!.events).toHaveLength(1);
    expect(first.sources).toEqual([expect.objectContaining({ organizer: MANUAL_SOURCE, count: 1 })]);
    const second: EventsFile = await buildEventsFile(now, first, { sources: [], manual: null, log: () => {} });
    expect(second.cities.find((c) => c.city === 'San Antonio')!.events[0]!.title).toBe('Mixer');
  });
});

describe('committed hand list', () => {
  it('parses data/events-manual.json and merges with sheet rows', async () => {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(new URL('../data/events-manual.json', import.meta.url), 'utf8'));
    const listed = parseManualFile(json, new Date('2026-09-30T12:00:00Z'), () => {});
    expect(listed).toHaveLength(24);
    expect(listed.filter((e) => e.city === 'New Braunfels')).toHaveLength(3);
    expect(listed.find((e) => e.title === 'Smart Women Series')!.start).toBe('2026-10-21T00:00:00-05:00');
    expect(listed.every((e) => e.url.startsWith('https://') && !/\s/.test(e.url))).toBe(true);
    const prev = [{ ...listed[0]!, id: 'manual-2-2026-10-30' }];
    expect(mergeManual(listed, null, prev)).toHaveLength(25);
    expect(mergeManual(listed, [], prev)).toHaveLength(24);
  });
});

describe('new event sources', async () => {
  const ev = await import('../src/events/events.js');
  const src = { key: 'x', organizer: 'X', city: 'San Antonio' as const, kind: 'pages' as const, base: 'https://x.org' };

  it('reads schema.org events from JSON-LD, including @graph', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Event","name":"Market &amp; Mixer","url":"/events/mixer","startDate":"2026-10-07T17:30:00-05:00","location":{"name":"Alamo Caf\\u00e9"}}]}</script>
      <script type="application/ld+json">[{"@type":"BusinessEvent","name":"No url","startDate":"2026-11-01"}]</script><script type="application/ld+json">{bad</script>`;
    const out = ev.parseJsonLdEvents(html, src, 'https://x.org/calendar/');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Market & Mixer', url: 'https://x.org/events/mixer', start: '2026-10-07T17:30:00-05:00', venue: 'Alamo Café' });
    expect(out[1]!.url).toBe('https://x.org/calendar/#2026-11-01-no-url');
  });

  it('finds detail links one level under the prefix', () => {
    const html = '<a href="/events/">all</a><a href="/events/gala-2026">g</a><a href="/events/gala-2026">g</a><a href="/events/?PastEvents=1">p</a><a href="https://other.org/events/x">o</a><a href="/events/a/b">d</a>';
    expect(ev.detailLinks(html, 'https://x.org/events/', '/events/')).toEqual(['https://x.org/events/gala-2026']);
  });

  it('fetches a pages source and keeps only relevant chamber events', async () => {
    const pages = { ...src };
    const fetcher = {
      json: async () => ({}),
      text: async (url: string) =>
        url.endsWith('/events')
          ? '<a href="/events/one">1</a>'
          : '<script type="application/ld+json">{"@type":"Event","name":"Fall Mixer","startDate":"2026-10-20T17:00:00-05:00"}</script>'
    };
    const got = await ev.fetchSource(pages, now, fetcher, () => {});
    expect(got).toMatchObject([{ title: 'Fall Mixer', url: 'https://x.org/events/one' }]);
    expect(ev.RELEVANT.test('Ribbon Cutting: Pest Control')).toBe(false);
    expect(ev.RELEVANT.test('Membership Mixer')).toBe(true);
    expect(ev.RELEVANT.test('State of the City Luncheon')).toBe(true);
  });

  it('merges hand rows with the same event from a feed', () => {
    const a = { id: 'a', title: 'A', url: 'https://members.metrosa.com/events/details/x-1?calendarMonth=2026-10-01', start: '2026-10-22T11:00:00-05:00', end: null, city: 'San Antonio' as const, organizer: 'M', venue: null, cost: null };
    const b = { ...a, id: 'b', url: 'https://members.metrosa.com/events/Details/x-1?sourceTypeId=Hub', source: MANUAL_SOURCE };
    expect(ev.upcoming([a, b], now)).toHaveLength(1);
  });
});

describe('Novi and JSON-LD without urls', async () => {
  const ev = await import('../src/events/events.js');
  it('reads a Novi event page', () => {
    const html = `<meta property="og:title" content="Annual Awards Extravaganza 2026" /><h1>x</h1>
      <span class="c-event-details__span c-event-details__start-date" role="listitem">Friday, December 4, 2026</span>
      <span class="c-event-details__span c-event-details__time">6:00 PM - 10:00 PM CST</span>`;
    expect(ev.parseNoviDetail(html)).toEqual({ title: 'Annual Awards Extravaganza 2026', start: '2026-12-04T18:00:00-06:00' });
    expect(ev.parseNoviDetail('<h1>No date</h1>')).toBeNull();
  });
  it('gives url-less JSON-LD events distinct fragment links', () => {
    const src = { key: 't', organizer: 'T', city: 'Dallas' as const, kind: 'jsonld' as const, base: 'https://t.org' };
    const html = `<script type="application/ld+json">[{"@type":"Event","name":"Policy Committee","startDate":"2026-10-06 08:30"},{"@type":"Event","name":"Golf","startDate":"2026-10-07 08:00"}]</script>`;
    const out = ev.parseJsonLdEvents(html, src, 'https://t.org/calendar/');
    expect(out.map((e) => e.url)).toEqual(['https://t.org/calendar/#2026-10-06-policy-committee', 'https://t.org/calendar/#2026-10-07-golf']);
    expect(ev.upcoming(out, now)).toHaveLength(2);
  });
});
