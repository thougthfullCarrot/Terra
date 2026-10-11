import { describe, expect, it } from 'vitest';
import type { TabsRow } from '../src/market/developments.js';
import {
  RECENT_MAX_PAGES,
  RECENT_PAGE,
  countiesFor,
  coverageLine,
  fetchRegistrations,
  readCounty,
  recentForm,
  toRegistration
} from '../src/market/registrations.js';

const NOW = new Date('2026-10-10T12:00:00Z');

function row(n: number, over: Partial<TabsRow> = {}): TabsRow {
  return {
    ProjectNumber: `TABS2026${String(n).padStart(6, '0')}`,
    ProjectName: ` Project ${n} `,
    ProjectCreatedOn: '2026-10-05T09:00:00',
    ProjectStatus: 3008,
    FacilityName: null,
    City: 785,
    TypeOfWork: 9001,
    EstimatedCost: 250000.4,
    EstimatedStartDate: null,
    EstimatedEndDate: null,
    ...over
  };
}

/** A fake TABS search: `total` rows, served RECENT_PAGE at a time from the form's start. */
function tabs(total: number, { reportTotal = true, ignoreStart = false, pageCap = Infinity, fail = new Set<string>() } = {}) {
  const calls: Record<string, string>[] = [];
  const all = Array.from({ length: total }, (_, i) => row(i));
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const form = Object.fromEntries(new URLSearchParams(String(init.body)));
    calls.push(form);
    if (fail.has(form.LocationCounty!)) return new Response('busy', { status: 503 });
    const start = ignoreStart ? 0 : Number(form.start);
    const data = all.slice(start, start + Math.min(Number(form.length), pageCap));
    return Response.json(reportTotal ? { data, recordsFiltered: total, recordsTotal: total } : { data });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('recent TABS registrations', () => {
  it('asks for the last ten days, a page at a time', () => {
    const form = recentForm('Harris', NOW, 500);
    expect(form.start).toBe('500');
    expect(form.length).toBe(String(RECENT_PAGE));
    expect(form.LocationCounty).toBe('2101');
    expect(form.RegistrationDateBegin).toBe('09/30/2026');
    expect(form.RegistrationDateEnd).toBe('10/10/2026');
  });

  it('reads every page and calls the county complete when the count matches', async () => {
    const { fetchImpl, calls } = tabs(1234);
    const result = await readCounty('Harris', NOW, { fetchImpl, retries: 0 });
    expect(result).toMatchObject({ reported: 1234, complete: true });
    expect(result.rows).toHaveLength(1234);
    expect(calls.map((c) => c.start)).toEqual(['0', '500', '1000']);
  });

  it('calls a county incomplete when more rows match than it could read', async () => {
    const { fetchImpl } = tabs(RECENT_PAGE * RECENT_MAX_PAGES + 10);
    const result = await readCounty('Harris', NOW, { fetchImpl, retries: 0 });
    expect(result.complete).toBe(false);
    expect(result.rows).toHaveLength(RECENT_PAGE * RECENT_MAX_PAGES);
  });

  it('keeps reading when TABS serves fewer rows a page than asked', async () => {
    const { fetchImpl, calls } = tabs(124, { pageCap: 100 });
    const result = await readCounty('Harris', new Date('2026-10-11T12:00:00Z'), { fetchImpl, retries: 0 });
    expect(calls.map((c) => c.start)).toEqual(['0', '100']);
    expect(result).toMatchObject({ reported: 124, complete: true });
    expect(result.rows).toHaveLength(124);
  });

  it('reads day by day when TABS caps a search at 100 rows and ignores the offset', async () => {
    // 124 rows spread over the window, 12 or so a day; each search serves its first 100 matches.
    const all = Array.from({ length: 124 }, (_, i) => ({ r: row(i), day: `10/${String(1 + (i % 10)).padStart(2, '0')}/2026` }));
    const calls: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const form = Object.fromEntries(new URLSearchParams(String(init.body)));
      calls.push(form);
      const key = (d: string) => d.slice(6) + d.slice(0, 5);
      const hits = all.filter((x) => key(x.day) >= key(form.RegistrationDateBegin!) && key(x.day) <= key(form.RegistrationDateEnd!));
      return Response.json({ data: hits.slice(0, 100).map((x) => x.r), recordsFiltered: hits.length });
    }) as typeof fetch;
    const result = await readCounty('Harris', NOW, { fetchImpl, retries: 0 });
    expect(result).toMatchObject({ reported: 124, complete: true });
    expect(result.rows).toHaveLength(124);
    // Two pages for the whole window (the second repeats), then one per day.
    expect(calls).toHaveLength(2 + 11);
  });

  it('catches a search that ignores the page offset', async () => {
    const { fetchImpl, calls } = tabs(900, { ignoreStart: true });
    const result = await readCounty('Harris', NOW, { fetchImpl, retries: 0 });
    expect(result).toMatchObject({ reported: 900, complete: false });
    expect(result.rows).toHaveLength(500);
    // Two pages for the whole window, then two for each of the 11 days.
    expect(calls).toHaveLength(2 + 11 * 2);
  });

  it('marks a county unverified when TABS reports no total', async () => {
    const { fetchImpl } = tabs(120, { reportTotal: false });
    expect(await readCounty('Harris', NOW, { fetchImpl, retries: 0 })).toMatchObject({ reported: null, complete: null });
  });

  it('reads each county once, with every market that covers it', () => {
    const counties = countiesFor(['Houston', 'Galveston']);
    expect(counties.get('Galveston')).toEqual(['Houston', 'Galveston']);
    expect(counties.get('Harris')).toEqual(['Houston']);
  });

  it('keeps going past a county that fails, and reports it', async () => {
    const { fetchImpl } = tabs(3, { fail: new Set(['2084']) });
    const result = await fetchRegistrations(['Galveston', 'Lubbock'], { now: NOW, fetchImpl, retries: 0, pauseMs: 0 });
    expect(result.coverage).toEqual([
      expect.objectContaining({ county: 'Galveston', complete: false, read: 0, error: expect.stringContaining('503') }),
      expect.objectContaining({ county: 'Lubbock', complete: true, read: 3, reported: 3 })
    ]);
    expect(result.registrations).toHaveLength(3);
    expect(result.registrations[0]).toMatchObject({ cities: ['Lubbock'], county: 'Lubbock', work: 'New construction', cost: 250000 });
    expect(coverageLine(result.coverage)).toBe('1 of 2 counties complete; not read: Galveston');
  });

  it('names gaps in the coverage line', () => {
    expect(
      coverageLine([
        { county: 'Harris', cities: ['Houston'], reported: 6000, read: 5000, complete: false },
        { county: 'Bexar', cities: ['San Antonio'], reported: null, read: 40, complete: null },
        { county: 'Travis', cities: ['Austin'], reported: 80, read: 80, complete: true }
      ])
    ).toBe('1 of 3 counties complete; incomplete: Harris (5000 of 6000); no total reported, so unverified: Bexar');
  });

  it('labels work types it does not know', () => {
    expect(toRegistration(row(1, { TypeOfWork: 9002, ProjectStatus: 1 }), 'Harris', ['Houston'])).toMatchObject({
      work: 'Other work',
      status: 'Registered',
      registered: '2026-10-05',
      name: 'Project 1'
    });
  });
});
