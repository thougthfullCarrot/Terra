// Regression checks for the October 14, 2026 website review (findings 1-9).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { titleFamily } from '../src/market/salaries.js';
import { filterJobs, readQuery } from '../../site/feed.js';
import { parseIcs, withDetailTimes, type EventSource, type Fetcher } from '../src/events/events.js';
import { eventIcs, googleCalendarUrl } from '../../site/events.js';
import { aboutElsewhere, buildNewsFile } from '../src/news/googleNews.js';
import { sameFirm } from '../../site/growth.js';
import { CAMPUSES, nearCampus, titleJobsHref, titleRows } from '../../site/career.js';
import { auctionsWithin, filterSales, isScheduled } from '../../site/property.js';

const nb: EventSource = { key: 'nb-chamber', organizer: 'New Braunfels Chamber', city: 'New Braunfels', kind: 'growthzone', base: 'https://newbraunfelschamber.growthzoneapp.com', relevantOnly: true } as EventSource;
const MIXER_URL = 'https://newbraunfelschamber.growthzoneapp.com/events/Details/membership-mixer-veramendi-the-ledge-1744886';

function ics(dtstart: string, dtend: string, title = 'Membership Mixer: Veramendi - The Ledge', url = MIXER_URL) {
  return ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${title}`, `SUMMARY:${title}`, `URL:${url}`, dtstart, dtend, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
const googleDates = (e: object) => new URL(googleCalendarUrl(e as Parameters<typeof googleCalendarUrl>[0])).searchParams.get('dates');

describe('1. event times and calendar ranges', () => {
  // The chamber feed lists the mixer as an all-day date (exclusive end Oct 16); the page says 5:30-7:30 PM.
  const feed = ics('DTSTART;VALUE=DATE:20261015', 'DTEND;VALUE=DATE:20261016');
  const page = `<script type="application/ld+json">{"@type":"Event","name":"Membership Mixer","startDate":"2026-10-15T17:30:00-05:00","endDate":"2026-10-15T19:30:00-05:00"}</script>`;

  it('a single-day iCal date no longer becomes a two-day calendar entry', () => {
    const [e] = parseIcs(feed, nb);
    expect(e!.end).toBeNull();
    expect(e!.dateOnly).toBe(true);
    expect(googleDates(e!)).toBe('20261015/20261016');
    expect(eventIcs(e!)).toContain('DTEND;VALUE=DATE:20261016');
  });

  it('a multi-day iCal date range keeps its real last day (League City forum, Oct 14-15)', () => {
    const [e] = parseIcs(ics('DTSTART;VALUE=DATE:20261014', 'DTEND;VALUE=DATE:20261016', 'Candidate Forum', 'https://x.example/f'), nb);
    expect(e!.end!.slice(0, 10)).toBe('2026-10-15');
    expect(googleDates(e!)).toBe('20261014/20261016');
  });

  it("a date-only listing takes the event page's clock times", async () => {
    const fetcher = { text: async () => page, json: async () => ({}) } as unknown as Fetcher;
    const [e] = await withDetailTimes(parseIcs(feed, nb), fetcher, () => {});
    expect(e!.start).toBe('2026-10-15T17:30:00-05:00');
    expect(e!.dateOnly).toBeUndefined();
    expect(googleDates(e!)).toBe('20261015T223000Z/20261016T003000Z');
  });

  it('keeps a date-only event as date-only when the page has no time', async () => {
    const fetcher = { text: async () => '<html></html>', json: async () => ({}) } as unknown as Fetcher;
    const [e] = await withDetailTimes(parseIcs(feed, nb), fetcher, () => {});
    expect(e!.dateOnly).toBe(true);
  });

  it('a timed iCal event is untouched', () => {
    const [e] = parseIcs(ics('DTSTART:20261015T223000Z', 'DTEND:20261016T003000Z'), nb);
    expect(e!.dateOnly).toBeUndefined();
    expect(googleDates(e!)).toBe('20261015T223000Z/20261016T003000Z');
  });
});

describe('2. distress auction counts', () => {
  // Generated Oct 14, 07:54 UTC: 152 sales dated Oct 6 (past) and 243 dated Nov 3.
  const now = new Date('2026-10-14T07:54:00Z');
  const sales: Array<{ city: string; saleDate: string | null; value: number | null }> = [
    ...Array.from({ length: 152 }, (_, i) => ({ city: 'Houston', saleDate: '2026-10-06', value: i, status: 'Waiting for a sale date' })),
    ...Array.from({ length: 243 }, (_, i) => ({ city: 'Houston', saleDate: '2026-11-03', value: i }))
  ];

  it('counts only auctions that have not passed', () => {
    expect(auctionsWithin(sales, 45, now)).toHaveLength(243);
  });

  it('uses the Texas day: yesterday out, today and the last window day in, beyond out', () => {
    // 2026-10-14 03:00 UTC is still Oct 13 in Texas.
    const late = new Date('2026-10-14T03:00:00Z');
    const rows = ['2026-10-12', '2026-10-13', '2026-11-27', '2026-11-28'].map((saleDate) => ({ saleDate }));
    expect(auctionsWithin(rows, 45, late).map((s: { saleDate: string }) => s.saleDate)).toEqual(['2026-10-13', '2026-11-27']);
    expect(isScheduled({ saleDate: '2026-10-13' }, now)).toBe(false);
    expect(isScheduled({ saleDate: null }, now)).toBe(false);
  });

  it('past-dated rows no longer lead the scheduled table', () => {
    expect(filterSales(sales, { scheduledOnly: true, now })).toHaveLength(243);
    expect(filterSales(sales, { now })[0]!.saleDate).toBe('2026-11-03');
  });
});

describe('3. news outside Texas', () => {
  const item = (title: string, source: string, summary = '') => ({ title, source, summary, link: `https://x.example/${encodeURIComponent(title)}`, sourceUrl: null, publishedAt: '2026-10-13T12:00:00Z' });
  const bucees = item("Buc-ee's submits site development plan to El Paso County staff", 'KOAA');

  it('drops the Colorado El Paso County story from El Paso', () => {
    expect(aboutElsewhere(bucees, 'El Paso')).toBe(true);
    expect(aboutElsewhere(item("Buc-ee's plan near County Line Road and I-25 moves ahead", 'Local Paper'), 'El Paso')).toBe(true);
  });

  it('drops out-of-state stories that a city search turned up', () => {
    expect(aboutElsewhere(item('Fairfax County housing authority buys apartment complex', 'Patch'), 'Fort Worth')).toBe(true);
    expect(aboutElsewhere(item('Opinion: Affordable housing needs more than tax credits', 'Pittsburgh Post-Gazette'), 'Austin')).toBe(true);
    expect(aboutElsewhere(item('Midland, Michigan approves new apartment development', 'MLive', 'Michigan'), 'Midland')).toBe(true);
  });

  it('keeps Texas stories, suburbs and statewide stories', () => {
    expect(aboutElsewhere(item('El Paso developer plans mixed-use project on the Westside', 'El Paso Times'), 'El Paso')).toBe(false);
    expect(aboutElsewhere(item('Frisco office campus breaks ground', 'Dallas Business Journal'), 'Dallas')).toBe(false);
    expect(aboutElsewhere(item('Texas housing tax credits awarded across the state', 'Texas Tribune'), 'Austin')).toBe(false);
    expect(aboutElsewhere(item('California investor buys Dallas office tower', 'Dallas Morning News'), 'Dallas')).toBe(false);
  });

  it('buildNewsFile leaves the Colorado story out of El Paso', async () => {
    const file = await buildNewsFile(new Date('2026-10-14T12:00:00Z'), null, {
      fetchCity: async (city) => (city === 'El Paso' ? [bucees, item('El Paso warehouse development breaks ground', 'El Paso Inc.')] : []),
      fetchAffordable: async () => [],
      fetchShared: async () => [],
      log: () => {}
    });
    const titles = file.cities.find((c) => c.city === 'El Paso')?.headlines.map((h) => h.title) ?? [];
    expect(titles.some((t) => /Buc-ee/.test(t))).toBe(false);
    expect(titles.some((t) => /warehouse/.test(t))).toBe(true);
  });
});

describe('5. Ryan is not Ryan A+E', () => {
  it('the tax firm Ryan does not match the architect Ryan A+E, Inc.', () => {
    expect(sameFirm('Ryan', 'Ryan A+E, Inc.')).toBe(false);
    expect(sameFirm('Ryan, LLC', 'Ryan A+E, Inc.')).toBe(false);
    expect(sameFirm('Ryan', 'Ryan Companies US, Inc.')).toBe(false);
  });

  it('Ryan Companies still matches its architecture arm, and one-word firms still match', () => {
    expect(sameFirm('Ryan Companies', 'Ryan A+E, Inc.')).toBe(true);
    expect(sameFirm('Ryan Companies', 'Ryan Companies US, Inc.')).toBe(true);
    expect(sameFirm('Hines', 'Hines Interests LP')).toBe(true);
    expect(sameFirm('Ryan', 'Ryan, LLC')).toBe(true);
  });
});

describe('4. near campus and approximate pins', () => {
  const utsa = CAMPUSES.find((c) => c.key === 'utsa')!;
  // Cottages at Nolte Farms: 745 Harry Miller Pass, Seguin, filed with ZIP 78249 and pinned at that ZIP's center.
  const nolte = { city: 'San Antonio', name: 'Cottages at Nolte Farms', address: '745 Harry Miller Pass, Seguin', lat: utsa.lat + 0.012, lng: utsa.lng + 0.012, approximate: true, isPublic: false, owner: 'Nolte Farms LLC', cost: 1_000_000 };
  const real = { city: 'San Antonio', name: 'Real project', lat: utsa.lat + 0.05, lng: utsa.lng, isPublic: false, owner: 'Real Owner LLC', cost: 2_000_000 };
  const edge = { city: 'San Antonio', cost: 0, name: 'Edge approx', lat: utsa.lat + 0.144, lng: utsa.lng, approximate: true, isPublic: false, owner: 'Edge LLC' };

  it('does not rank a ZIP-center pin as 1.2 miles away', () => {
    const near = nearCampus([nolte, real, edge], [], utsa, 10);
    expect(near.projects.map((p) => p.name)).toEqual(['Real project']);
    expect(near.firms.map((f) => f.name)).toEqual(['Real Owner LLC']);
    expect(near.approximateLeftOut).toBe(2);
  });
});

describe('6. Title Decoder links land on the jobs they count', () => {
  const jobs: Array<{ id: string; role: string; firm: string; city: string; sector: string; kind: string; desc: string; reqs: string[] }> = [
    { id: '1', role: 'Appraisal Trainee', firm: 'A', city: 'Dallas', sector: 'Property Tax', kind: 'Full-time', desc: '', reqs: [] },
    { id: '2', role: 'Project Coordinator', firm: 'B', city: 'Dallas', sector: 'Construction', kind: 'Full-time', desc: '', reqs: [] },
    { id: '3', role: 'Construction Coordinator', firm: 'C', city: 'Houston', sector: 'Development', kind: 'Full-time', desc: '', reqs: [] },
    { id: '4', role: 'Development Analyst', firm: 'D', city: 'Houston', sector: 'Development', kind: 'Full-time', desc: '', reqs: [] },
    { id: '5', role: 'Leasing Associate', firm: 'E', city: 'Austin', sector: 'Brokerage', kind: 'Full-time', desc: '', reqs: [] }
  ];

  for (const city of ['', 'Dallas', 'Houston']) {
    it(`every card's link shows exactly its counted jobs${city ? ` in ${city}` : ''}`, () => {
      for (const row of titleRows(jobs as unknown as Parameters<typeof titleRows>[0], null, city).filter((r) => r.jobs.length)) {
        const href = titleJobsHref(row, city, '/Terra/');
        const shown = filterJobs(jobs as unknown as Parameters<typeof filterJobs>[0], readQuery(href.slice(href.indexOf('?'))));
        expect(shown.map((j) => j.id).sort(), row.title).toEqual(row.jobs.map((j) => String(j.id)).sort());
      }
    });
  }

  it('an unknown role key is ignored rather than trusted', () => {
    expect(readQuery('?role=nope').role).toBe('');
  });
});

describe('8. software jobs are not construction', () => {
  it('classifies software and IT titles as Technology', () => {
    expect(titleFamily('Senior Software Engineer')).toBe('Technology');
    expect(titleFamily('Principal Software Engineer')).toBe('Technology');
    expect(titleFamily('Systems Integration Engineer')).toBe('Technology');
    expect(titleFamily('Data Engineer')).toBe('Technology');
  });

  it('keeps construction engineers in Project / construction', () => {
    expect(titleFamily('Civil Engineer')).toBe('Project / construction');
    expect(titleFamily('Construction Project Engineer')).toBe('Project / construction');
    expect(titleFamily('Assistant Project Manager')).toBe('Project / construction');
    expect(titleFamily('Real Estate Developer')).not.toBe('Technology');
  });
});

describe('9. profile back button', () => {
  it('says Back, since it returns to the section the profile was opened from', () => {
    const html = readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8');
    expect(/id="profile-close">([^<]*)</.exec(html)?.[1]).toBe('Back');
  });
});
