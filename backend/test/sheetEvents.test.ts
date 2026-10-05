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
