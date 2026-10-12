import { describe, expect, it } from 'vitest';
import { HISTORY_DAYS, addDays, digestOf, pruneBefore, texasDay, type HistoryDay, type HistoryRegistration } from '../src/alerts/history.js';
import { EMAIL_EVENT_LIMIT, TABS_COVERAGE_NOTE, renderWatchEmail, watchEvents, type WatchItem } from '../src/alerts/watch.js';
import type { MarketSnapshot } from '../src/market/snapshot.js';

/** A history day with just what a test sets. */
export function day(d: string, over: Partial<HistoryDay> = {}): HistoryDay {
  return {
    v: 1,
    day: d,
    generatedAt: `${d}T12:00:00Z`,
    metricInfo: { aptRent: ['Apartment rent', 'usd'], aptVacancy: ['Apartment vacancy', 'rate'], permits: ['Permits', 'count'] },
    metrics: {},
    behind: [],
    projects: {},
    registrations: { days: 10, items: [], coverage: [] },
    ...over
  };
}

const item = (over: Partial<WatchItem>): WatchItem => ({ id: 'i1', kind: 'market', city: 'Austin', ref: '', filters: {}, ...over });

const reg = (id: string, over: Partial<HistoryRegistration> = {}): HistoryRegistration => ({
  id,
  cities: ['Austin'],
  county: 'Travis',
  n: `Project ${id}`,
  w: 'New construction',
  cost: 2_000_000,
  reg: '2026-10-08',
  st: 'Registered',
  url: `https://www.tdlr.texas.gov/TABS/Projects/${id}`,
  ...over
});

describe('market history rows', () => {
  it('keeps every figure with its period, status and shared metro, and each project and filing', () => {
    const snapshot = {
      generatedAt: '2026-10-10T12:00:00Z',
      metrics: [{ key: 'aptRent', label: 'Apartment rent', unit: 'usd' }],
      groups: [],
      sources: [],
      behind: [{ source: 'Redfin', latest: 'May 2026', days: 132, maxLagDays: 90 }],
      markets: [
        {
          city: 'New Braunfels',
          metro: 'San Antonio metro',
          values: { aptRent: 1400 },
          periods: { aptRent: 'Sep 2026' },
          status: { aptRent: 'retained' },
          shared: { aptRent: 'San Antonio' }
        }
      ],
      developments: {
        asOf: '2026-10-10',
        projects: [{ id: 'TABS1', city: 'Austin', name: 'Tower', status: 'Registered', cost: 5e7, end: '2027-06-01', url: 'u', source: 'tabs' }]
      },
      registrations: {
        asOf: '2026-10-10',
        days: 10,
        registrations: [{ id: 'TABS2', cities: ['Austin'], county: 'Travis', name: 'Clinic', status: 'Registered', work: 'Addition', cost: 9e5, registered: '2026-10-09', url: 'v' }],
        coverage: [{ county: 'Travis', cities: ['Austin'], reported: 1, read: 1, complete: true }]
      }
    } as unknown as MarketSnapshot;
    const row = digestOf(snapshot, new Date('2026-10-10T03:00:00Z'));
    expect(row.day).toBe('2026-10-09'); // 10 p.m. the evening before in Texas
    expect(row.metrics['New Braunfels']?.aptRent).toEqual({ v: 1400, p: 'Sep 2026', s: 'retained', sh: 'San Antonio' });
    expect(row.metricInfo.aptRent).toEqual(['Apartment rent', 'usd']);
    expect(row.projects.TABS1).toEqual({ c: 'Austin', n: 'Tower', st: 'Registered', cost: 5e7, end: '2027-06-01', src: 'tabs', url: 'u' });
    expect(row.registrations?.items[0]).toMatchObject({ id: 'TABS2', w: 'Addition', reg: '2026-10-09' });
    expect(row.behind).toEqual([{ source: 'Redfin', latest: 'May 2026' }]);
  });

  it('records a missing registrations search as unknown, not empty', () => {
    const row = digestOf({ generatedAt: 'x', metrics: [], groups: [], sources: [], markets: [] } as unknown as MarketSnapshot);
    expect(row.registrations).toBeNull();
  });

  it('keeps 90 days', () => {
    expect(HISTORY_DAYS).toBe(90);
    expect(pruneBefore('2026-10-10')).toBe('2026-07-12');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(texasDay(new Date('2026-07-01T04:59:00Z'))).toBe('2026-06-30');
  });

  it('stays small enough for 90 days on the free database', () => {
    const projects = Array.from({ length: 3000 }, (_, i) => ({
      id: `TABS${i}`,
      city: 'Houston',
      name: `A fairly long project name number ${i}`,
      status: 'Plan review',
      cost: 12_345_678,
      end: '2027-01-01',
      url: `https://www.tdlr.texas.gov/TABS/Projects/TABS2026${i}`,
      source: 'tabs'
    }));
    const markets = Array.from({ length: 11 }, (_, i) => ({
      city: `City ${i}`,
      metro: '',
      values: Object.fromEntries(Array.from({ length: 90 }, (_, k) => [`m${k}`, k * 1.5])),
      periods: Object.fromEntries(Array.from({ length: 90 }, (_, k) => [`m${k}`, 'Aug 2026'])),
      status: Object.fromEntries(Array.from({ length: 90 }, (_, k) => [`m${k}`, 'fresh']))
    }));
    const row = digestOf({ generatedAt: 'x', metrics: [], groups: [], sources: [], markets, developments: { asOf: 'x', projects } } as unknown as MarketSnapshot);
    const kb = Buffer.byteLength(JSON.stringify(row)) / 1024;
    // 90 days at this size is well under the 500 MB free database.
    expect(kb).toBeLessThan(700);
    expect((kb * HISTORY_DAYS) / 1024).toBeLessThan(65);
  });
});

describe('watchlist changes', () => {
  const before = day('2026-10-03', {
    metrics: { Austin: { aptRent: { v: 1500, p: 'Aug 2026', s: 'fresh' }, aptVacancy: { v: 7.5, p: 'Aug 2026' } } },
    projects: { TABS9: { c: 'Austin', n: 'Tower', st: 'Plan review', cost: 5e7, end: '2027-06-01', src: 'tabs', url: 'u9' } },
    registrations: { days: 10, items: [reg('OLD1')], coverage: [] }
  });

  it('needs two days to compare', () => {
    const result = watchEvents([item({})], [before]);
    expect(result.events).toEqual([]);
    expect(result.notes[0]).toMatch(/first digest/);
  });

  it('reports a figure that moved, once, under the market it comes from', () => {
    const today = day('2026-10-10', {
      metrics: {
        Austin: { aptRent: { v: 1520, p: 'Sep 2026', s: 'fresh' }, aptVacancy: { v: 7.5, p: 'Aug 2026' } },
        'San Antonio': { aptRent: { v: 1300, p: 'Sep 2026' } },
        'New Braunfels': { aptRent: { v: 1300, p: 'Sep 2026', sh: 'San Antonio' } }
      }
    });
    const was = day('2026-10-03', {
      metrics: { ...before.metrics, 'San Antonio': { aptRent: { v: 1290, p: 'Aug 2026' } }, 'New Braunfels': { aptRent: { v: 1290, p: 'Aug 2026', sh: 'San Antonio' } } }
    });
    const { events } = watchEvents(
      [item({}), item({ id: 'i2', city: 'San Antonio' }), item({ id: 'i3', city: 'New Braunfels' })],
      [was, today]
    );
    expect(events.map((e) => e.id)).toEqual(['market:Austin:aptRent:Sep 2026:1520', 'market:San Antonio:aptRent:Sep 2026:1300']);
    expect(events[0]).toMatchObject({ title: 'Austin: Apartment rent rose', detail: '$1,520 (Sep 2026), was $1,500 (Aug 2026).' });
  });

  it('reports a threshold when crossed, and not again while it stays crossed', () => {
    const watch = item({ ref: 'aptVacancy', filters: { above: 8 } });
    const crossed = day('2026-10-10', { metrics: { Austin: { aptVacancy: { v: 8.4, p: 'Sep 2026' } } } });
    const still = day('2026-10-17', { metrics: { Austin: { aptVacancy: { v: 8.9, p: 'Oct 2026' } } } });
    expect(watchEvents([watch], [before, crossed]).events).toEqual([
      expect.objectContaining({ id: 'market:Austin:aptVacancy:above:8:Sep 2026', title: 'Austin: Apartment vacancy is above 8.0%' })
    ]);
    expect(watchEvents([watch], [crossed, still]).events).toEqual([]);
    // A plain move inside the line is not reported for a threshold item.
    expect(watchEvents([item({ ref: 'aptRent', filters: { above: 2000 } })], [before, crossed]).events).toEqual([]);
  });

  it('says when a figure stops being published, rather than reporting a change', () => {
    const today = day('2026-10-10', { metrics: { Austin: { aptRent: { v: 1500, p: 'Aug 2026', s: 'expired' } } } });
    expect(watchEvents([item({})], [before, today]).events).toEqual([
      expect.objectContaining({ id: 'market:Austin:aptRent:expired:Aug 2026', title: 'Austin: Apartment rent is no longer published' })
    ]);
  });

  it('flags a source that newly fell behind, once', () => {
    const today = day('2026-10-10', { behind: [{ source: 'Redfin', latest: 'May 2026' }] });
    const result = watchEvents([item({}), item({ id: 'i2', city: 'Dallas' })], [before, today]);
    expect(result.events.filter((e) => e.id.startsWith('behind:'))).toHaveLength(1);
    expect(watchEvents([item({})], [today, day('2026-10-17', { behind: today.behind })]).events).toEqual([]);
  });

  it('reports new filings in a followed area, with filters, across every stored day', () => {
    const mid = day('2026-10-06', { registrations: { days: 10, items: [reg('OLD1'), reg('NEW1', { cost: 50_000 })], coverage: [] } });
    const today = day('2026-10-10', {
      registrations: {
        days: 10,
        items: [reg('OLD1'), reg('NEW2', { w: 'Addition' }), reg('HOU1', { cities: ['Houston'], county: 'Harris' })],
        coverage: [{ county: 'Travis', cities: ['Austin'], reported: 3, read: 3, complete: true }]
      }
    });
    const all = watchEvents([item({ kind: 'area' })], [before, mid, today]);
    expect(all.events.map((e) => e.id).sort()).toEqual(['tabs:NEW1', 'tabs:NEW2']);
    expect(all.notes).toContain(TABS_COVERAGE_NOTE);
    const filtered = watchEvents([item({ kind: 'area', filters: { work: ['New construction'], minCost: 100_000 } })], [before, mid, today]);
    expect(filtered.events).toEqual([]);
  });

  it('passes on coverage gaps instead of implying every filing was read', () => {
    const today = day('2026-10-10', {
      registrations: {
        days: 10,
        items: [],
        coverage: [
          { county: 'Travis', cities: ['Austin'], reported: 900, read: 500, complete: false },
          { county: 'Williamson', cities: ['Austin'], reported: null, read: 30, complete: null },
          { county: 'Hays', cities: ['Austin'], reported: null, read: 0, complete: false, error: 'HTTP 503' },
          { county: 'Harris', cities: ['Houston'], reported: null, read: 0, complete: false, error: 'HTTP 503' }
        ]
      }
    });
    const { notes } = watchEvents([item({ kind: 'area' })], [before, today]);
    expect(notes).toEqual(
      expect.arrayContaining([
        'Only 500 of 900 recent Travis County filings could be read, so some may be missing.',
        'TABS did not report a total for Williamson County, so Terra could not confirm every filing was read.',
        "Hays County's filings could not be read on the latest build, so some may be missing."
      ])
    );
    expect(notes.join(' ')).not.toMatch(/Harris/);
    const failedDay = watchEvents([item({ kind: 'area' })], [before, day('2026-10-10', { registrations: null })]);
    expect(failedDay.notes[0]).toMatch(/could not be read on 2026-10-10/);
  });

  it('reports a followed project changing status, finish date or cost, and stays quiet when it only leaves the map', () => {
    const watch = item({ kind: 'project', ref: 'TABS9' });
    const today = day('2026-10-10', {
      projects: { TABS9: { c: 'Austin', n: 'Tower', st: 'Inspection under way', cost: 6e7, end: '2027-09-01', src: 'tabs', url: 'u9' } }
    });
    expect(watchEvents([watch], [before, today]).events.map((e) => e.id)).toEqual([
      'project:TABS9:status:2026-10-10:f1b691dbd6',
      'project:TABS9:cost:2026-10-10:60000000',
      'project:TABS9:end:2026-10-10:2027-09-01'
    ]);
    // Off the map is not a fact about the project: no event (followed.ts checks it on its own).
    expect(watchEvents([watch], [before, day('2026-10-10')]).events).toEqual([]);
    expect(watchEvents([watch], [before, before]).events).toEqual([]);
  });

  it('reports new city permits in a followed area', () => {
    const today = day('2026-10-10', { projects: { ...before.projects, P1: { c: 'Austin', n: 'Shop', st: 'Issued', cost: 4e5, end: null, src: 'city', url: 'p' } } });
    expect(watchEvents([item({ kind: 'area' })], [before, today]).events.map((e) => e.id)).toEqual(['permit:P1']);
  });
});

describe('watchlist email', () => {
  const link = 'https://example.org/Terra/?unsubscribe=watch&u=x&t=y';

  it('escapes names from the filings and carries the unsubscribe link', () => {
    const email = renderWatchEmail(
      { events: [{ id: 'a', kind: 'area', city: 'Austin', title: 'New filing: <script>alert(1)</script>', detail: 'A & B', url: 'https://x.test/?a="b"' }], notes: ['Note <b>'] },
      { siteUrl: 'https://example.org/Terra', unsubscribeLink: link, frequency: 'weekly' }
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; B');
    expect(email.html).toContain('Note &lt;b&gt;');
    expect(email.html).toContain(link.replace(/&/g, '&amp;'));
    expect(email.text).toContain(`Unsubscribe from watchlist emails: ${link}`);
    expect(email.subject).toBe('Terra watchlist: New filing: <script>alert(1)</script>');
  });

  it('lists a limited number and counts the rest', () => {
    const events = Array.from({ length: EMAIL_EVENT_LIMIT + 5 }, (_, i) => ({ id: `e${i}`, kind: 'market' as const, city: 'Austin', title: `T${i}`, detail: 'd' }));
    const email = renderWatchEmail({ events, notes: [] }, { siteUrl: 'https://example.org/', unsubscribeLink: link, frequency: 'daily' });
    expect(email.subject).toBe(`Terra watchlist: ${EMAIL_EVENT_LIMIT + 5} changes today`);
    expect(email.text).toContain('And 5 more.');
  });
});
