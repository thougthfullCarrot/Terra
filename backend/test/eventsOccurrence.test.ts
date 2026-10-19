// Fixture tests for the Events page fixes: courses ordered by the session they show, CREW pages whose time is
// TBD, and calendar exports. Real-source checks are separate (the PR lists what was read from the live pages).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMicrodataEvent } from '../src/events/events.js';
import { eventIcs, eventWhen, filterEvents, googleCalendarUrl, groupByMonth, monthGrid, occurrenceStart, type EventsFile, type SiteEvent } from '../../site/events.js';

const now = new Date('2026-10-19T15:00:00Z');
const base = { end: null, city: 'Austin', venue: null, cost: null, timezone: 'America/Chicago' };
const course: SiteEvent = {
  ...base,
  id: 'boma',
  title: 'BOMA course',
  url: 'https://example.org/boma',
  organizer: 'BOMA',
  start: '2026-10-14T13:00:00-05:00',
  end: '2026-11-13T17:00:00-06:00',
  enrollment: 'in-progress',
  sessions: [
    { start: '2026-10-14T13:00:00-05:00', end: '2026-10-14T17:00:00-05:00' },
    { start: '2026-10-30T13:00:00-05:00', end: '2026-10-30T17:00:00-05:00' },
    { start: '2026-11-13T13:00:00-06:00', end: '2026-11-13T17:00:00-06:00' }
  ]
};
const one = (id: string, start: string): SiteEvent => ({ ...base, id, title: id, url: `https://example.org/${id}`, organizer: 'X', start });
const file: EventsFile = { generatedAt: now.toISOString(), sources: [], cities: [{ city: 'Austin', events: [course, one('oct19', '2026-10-19T18:00:00-05:00'), one('oct28', '2026-10-28T11:30:00-05:00'), one('nov2', '2026-11-02T09:00:00-06:00')] }] };

describe('occurrence-based ordering', () => {
  it('sorts a course by its next session, the date its card shows', () => {
    expect(occurrenceStart(course, now)).toBe('2026-10-30T13:00:00-05:00');
    expect(filterEvents(file, {}, now).map((e) => e.id)).toEqual(['oct19', 'oct28', 'boma', 'nov2']);
  });

  it('puts a course under the month of its next session', () => {
    const late = { ...course, sessions: [course.sessions![0]!, { start: '2026-11-04T13:00:00-06:00', end: null }] };
    expect(groupByMonth([late], now).map((g) => g.month)).toEqual(['November 2026']);
  });

  it('marks the mini calendar on the next session, not the first', () => {
    const days = monthGrid('2026-10', [course], now).filter((c) => c?.has).map((c) => c!.ymd);
    expect(days).toEqual(['2026-10-30']);
  });

  it('still exports every session separately', () => {
    const ics = eventIcs(course, now)!;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('DTSTART:20261014T180000Z');
    expect(ics).toContain('DTSTART:20261030T180000Z');
    expect(ics).toContain('DTSTART:20261113T190000Z');
    expect(new URL(googleCalendarUrl(course, now)!).searchParams.get('dates')).toBe('20261030T180000Z/20261030T220000Z');
  });
});

describe('time parsing: CREW pages with no confirmed time', () => {
  const html = readFileSync(new URL('./fixtures/crew-austin-holiday-tbd.html', import.meta.url), 'utf8');

  it('drops the startDate stamp when the page says TBD', () => {
    expect(parseMicrodataEvent(html)).toEqual({ title: 'Holiday Party', start: '2026-12-03T00:00:00-06:00', venue: 'Urbanspace Interiors', dateOnly: true, timeUnconfirmed: true });
  });

  it('keeps a real clock time when the page prints one', () => {
    const timed = html.replace('>TBD<', '>6:00 PM<!-- --> <span class="sr-only">to</span> - <!-- -->9:00 PM CST<').replace('10:50:00.000', '18:00:00.000');
    expect(parseMicrodataEvent(timed)).toMatchObject({ start: '2026-12-03T18:00:00-06:00' });
    expect(parseMicrodataEvent(timed)).not.toHaveProperty('timeUnconfirmed');
  });

  it('shows "Time not confirmed" and exports a date-only entry', () => {
    const party: SiteEvent = { ...one('party', '2026-12-03T00:00:00-06:00'), dateOnly: true, timeUnconfirmed: true };
    expect(eventWhen(party, now)).toBe('Time not confirmed');
    const ics = eventIcs(party, now)!;
    expect(ics).toContain('DTSTART;VALUE=DATE:20261203');
    expect(ics).toContain('DTEND;VALUE=DATE:20261204');
    expect(ics).toContain('Time not confirmed');
    const google = new URL(googleCalendarUrl(party, now)!);
    expect(google.searchParams.get('dates')).toBe('20261203/20261204');
    expect(google.searchParams.get('details')).toContain('Time not confirmed');
  });
});

describe('rescheduling: a time that turns out to be TBD', () => {
  it('is not marked "Moved from" when only the unconfirmed clock time goes away', async () => {
    const { buildEventsFile, EVENT_SOURCES } = await import('../src/events/events.js');
    const src = EVENT_SOURCES.find((s) => s.key === 'crew-austin')!;
    const html = readFileSync(new URL('./fixtures/crew-austin-holiday-tbd.html', import.meta.url), 'utf8');
    const url = 'https://austin.crewnetwork.org/events/2026/holiday-party';
    const fetcher = (page: string) => ({ json: async () => ({}), text: async (u: string) => (u.endsWith('sitemap.xml') ? `<urlset><url><loc>${url}</loc></url></urlset>` : page) });
    const at = new Date('2026-10-19T12:00:00Z');
    const build = (page: string, prev: Awaited<ReturnType<typeof buildEventsFile>> | null) => buildEventsFile(at, prev, { sources: [src], fetcher: fetcher(page), log: () => {} });
    const party = (f: Awaited<ReturnType<typeof buildEventsFile>>) => f.cities.flatMap((c) => c.events).find((e) => e.title === 'Holiday Party')!;
    // The old parser kept the 10:50 AM stamp; the same page read now keeps only the date.
    const old = await build(html.replace('>TBD<', '>10:50 AM<'), null);
    expect(party(old).start).toBe('2026-12-03T10:50:00-06:00');
    const now = party(await build(html, old));
    expect(now.start).toBe('2026-12-03T00:00:00-06:00');
    expect(now.timeUnconfirmed).toBe(true);
    expect(now.rescheduledFrom).toBeUndefined();
    expect(now.status).toBeUndefined();
  });
});
