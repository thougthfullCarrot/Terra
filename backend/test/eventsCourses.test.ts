import { describe, expect, it } from 'vitest';
import { fetchSource, parseLiveWhale, finalize, type EventSource, type Fetcher, type TerraEvent, EVENT_SOURCES } from '../src/events/events.js';
import { courseSessions } from '../src/events/enrich.js';
import { canExport, eventBadges, eventIcs, eventWhen, googleCalendarUrl } from '../../site/events.js';

// Wording copied from BOMA Dallas's own page for this course (members.bomadallas.org, read 2026-10-18).
const BOMA_PAGE = `<html><body><h1>Designation Course: Energy Management Systems &amp; Controls</h1>
<p>10/2/2026 - 11/6/2026</p>
<div class="description"><p>This is a 4-Day Course of four Full Days from 8:00 am to 5:00 pm.</p>
<p>Fridays: 10/2, 10/9, 10/16, 10/30, 11/6</p>
<p>10/2 - 10/16 and 10/30 will be course study and 11/6 will be review and test prep</p>
<p>Greenhill Towers 1st floor Conference Room 14131 Midway Rd. Addison Tx 75001</p>
<p>BOMA Greater Dallas Member: $800. Non-member: $950.</p></div>
<div class="additional">Fridays: 10/2, 10/9, 10/16, 10/30 and 11/6</div>
<span>Registration Closed</span></body></html>`;

// The iCal feed lists the course as one all-day block from Oct 2 to Nov 6.
const BOMA_ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:1597469', 'SUMMARY:Designation Course: Energy Management Systems & Controls', 'DTSTART;VALUE=DATE:20261002', 'DTEND;VALUE=DATE:20261107', 'LOCATION:Greenhill Towers', 'URL:https://members.bomadallas.org/events/Details/designation-course-energy-management-systems-controls-1597469', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

const boma: EventSource = { key: 'boma-dallas', organizer: 'BOMA Dallas', city: 'Dallas', kind: 'growthzone', base: 'https://members.bomadallas.org' };
const fetcher = (page: string): Fetcher => ({
  json: async () => {
    throw new Error('no json');
  },
  text: async (url) => (/\.ics|icalendar|ical/i.test(url) ? BOMA_ICS : page)
});

describe('a course listed as one long date range', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('reads the five Friday sessions, 8 AM to 5 PM, and flags the "4-Day" wording', () => {
    const found = courseSessions(BOMA_PAGE, '2026-10-02', '2026-11-06')!;
    expect(found.sessions.map((s) => s.start)).toEqual(['2026-10-02 08:00', '2026-10-09 08:00', '2026-10-16 08:00', '2026-10-30 08:00', '2026-11-06 08:00']);
    expect(found.sessions[0]!.end).toBe('2026-10-02 17:00');
    expect(found.conflicts).toEqual(['The page says "4-Day Course" but lists 5 dates.']);
    expect(found.registrationClosed).toBe(true);
  });

  it('becomes one course with sessions, marked in progress, end to end through the collector', async () => {
    const [course] = await fetchSource(boma, now, fetcher(BOMA_PAGE), () => {});
    expect(course!.sessions).toHaveLength(5);
    expect(course!.start).toBe('2026-10-02T08:00:00-05:00');
    expect(course!.sessions![4]).toEqual({ start: '2026-11-06T08:00:00-06:00', end: '2026-11-06T17:00:00-06:00' });
    expect(course!.enrollment).toBe('in-progress');
    expect(course!.conflicts?.[0]).toMatch(/4-Day Course/);
    expect(course!.dateOnly).toBeUndefined();
  });

  it('exports each session, never one block over five weeks', async () => {
    const [course] = await fetchSource(boma, now, fetcher(BOMA_PAGE), () => {});
    const ics = eventIcs(course!, now)!;
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(5);
    expect(ics).toContain('DTSTART:20261009T130000Z\r\nDTEND:20261009T220000Z');
    expect(ics).toContain('DTSTART:20261106T140000Z\r\nDTEND:20261106T230000Z');
    expect(ics).not.toMatch(/VALUE=DATE/);
    expect(ics).toContain('session 5 of 5');
    // Google takes one entry: the next session after Oct 18 is Oct 30.
    const google = new URL(googleCalendarUrl(course!, now)!);
    expect(google.searchParams.get('dates')).toBe('20261030T130000Z/20261030T220000Z');
    expect(google.searchParams.get('text')).toMatch(/session 4 of 5/);
  });

  it('reads as an ongoing course, not one open for registration', async () => {
    const [course] = await fetchSource(boma, now, fetcher(BOMA_PAGE), () => {});
    expect(eventWhen(course!, now)).toBe('5 sessions, Oct 2 – Nov 6 · 8:00 AM – 5:00 PM CT · next: session 4, Oct 30');
    expect(eventBadges(course!).map((b) => b.text)).toContain('Course in progress');
    const before = await fetchSource(boma, new Date('2026-09-20T12:00:00Z'), fetcher(BOMA_PAGE.replace('Registration Closed', 'Register Now')), () => {});
    expect(before[0]!.enrollment).toBe('open');
    const closed = await fetchSource(boma, new Date('2026-09-20T12:00:00Z'), fetcher(BOMA_PAGE), () => {});
    expect(closed[0]!.enrollment).toBe('closed');
  });

  it('a long range whose page lists no session dates is flagged and not exported', async () => {
    const [e] = await fetchSource(boma, now, fetcher('<p>Join us this fall.</p>'), () => {});
    expect(e!.spanUnverified).toBe(true);
    expect(e!.sessions).toBeUndefined();
    expect(canExport(e!)).toBe(false);
    expect(eventIcs(e!, now)).toBeNull();
    expect(googleCalendarUrl(e!, now)).toBeNull();
  });

  it('a short multi-day conference is left as one event', () => {
    expect(courseSessions('Dec 1 - 3. Sessions 12/1 and 12/2', '2026-12-01', '2026-12-03')!.sessions).toHaveLength(2);
    // Only listings of a week or more are read as courses; a three-day summit keeps its range.
  });
});

describe('campus calendars put events at the venue, not the main campus', () => {
  const tamu = EVENT_SOURCES.find((s) => s.key === 'tamu')!;
  const now = new Date('2026-10-18T12:00:00Z');
  // Rows as calendar.tamu.edu's LiveWhale JSON returned them on 2026-10-18.
  const rows = [
    { id: 1, title: 'Journal of Property Law Symposium - Forever: A Legal Sci-Fi Story', url: 'https://calendar.tamu.edu/live/events/1', date_iso: '2026-11-06T08:30:00-06:00', date2_iso: '2026-11-06T13:30:00-06:00', location: 'LEB: 8th Floor Multi-Purpose Room 804', group_title: 'Law' },
    { id: 2, title: 'Ranchers Leasing Workshop', url: 'https://calendar.tamu.edu/live/events/2', date_iso: '2026-12-08T09:00:00-06:00', location: 'AgriLife Extension office, Brazos County, 4153 County Park Court, Bryan', group_title: 'Texas A&amp;M AgriLife' }
  ];

  it('Texas A&M law events are in Fort Worth; Bryan stays in College Station', () => {
    const [law, ranch] = parseLiveWhale(rows, tamu).map((e) => finalize(e, tamu, now));
    expect(law!.city).toBe('Fort Worth');
    expect(law!.timezone).toBe('America/Chicago');
    expect(ranch!.city).toBe('College Station');
  });

  it('"Law and Education Building" and a Galveston campus are recognized too', () => {
    const at = (venue: string, organizer = 'Texas A&M') => finalize({ id: 'x', title: 'Panel', url: 'https://x.org/e', start: '2026-11-06T08:30:00-06:00', end: null, city: 'College Station', organizer, venue, cost: null }, tamu, now).city;
    expect(at('Law and Education Building, Room 804')).toBe('Fort Worth');
    expect(at('Room 120', 'Texas A&M · Law')).toBe('Fort Worth');
    expect(at('TAMUG Ocean and Coastal Studies Building')).toBe('Galveston');
    expect(at('Mays Business School, Wehner 113')).toBe('College Station');
  });

  it('a venue written with its city at the end goes to that market for any source', () => {
    const uta = EVENT_SOURCES.find((s) => s.key === 'ut-austin')!;
    const e: TerraEvent = { id: 'x', title: 'Real Estate Alumni Mixer', url: 'https://x.org/e', start: '2026-11-06T18:00:00-06:00', end: null, city: 'Austin', organizer: 'UT Austin', venue: 'Hotel ZaZa, Houston', cost: null };
    expect(finalize(e, uta, now).city).toBe('Houston');
    expect(finalize({ ...e, venue: 'Virtual', format: 'virtual' }, uta, now).city).toBe('Austin');
  });
});
