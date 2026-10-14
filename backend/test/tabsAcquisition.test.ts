import { describe, expect, it } from 'vitest';
import { addAliases, fetchCityPermitProjects, permitProjects, sanAntonioPermit, type PermitRow } from '../src/market/cityPermits.js';
import { developerLink } from '../src/market/developers.js';
import {
  currentDevelopments,
  fetchDevelopments,
  searchBudget,
  searchCounty,
  searchMetroAll,
  statusLabel,
  tabsCoverageLine,
  type Development,
  type TabsRow
} from '../src/market/developments.js';

/**
 * The Merc (Rod's report, 2026-10-14): Bexar's two-year search returned 100 of
 * 3,006 filings, the biggest, and a second page repeated the first. These
 * tests stand in a TDLR that behaves the same way.
 */

const NOW = new Date('2026-10-14T12:00:00Z');

/** The two official Merc filings, as the search returns them. */
const MERC: TabsRow[] = [
  {
    ProjectNumber: 'TABS2025017471',
    ProjectName: 'The Merc - Buildings 1 & 2',
    ProjectCreatedOn: '2025-04-24T09:00:00',
    ProjectStatus: 3009,
    FacilityName: 'The Merc',
    City: 1537,
    County: 2015,
    TypeOfWork: 9001,
    EstimatedCost: 5_840_000,
    EstimatedStartDate: '2025-07-01T00:00:00',
    EstimatedEndDate: '2026-10-30T00:00:00'
  },
  {
    ProjectNumber: 'TABS2025017477',
    ProjectName: 'The Merc - Building 3',
    ProjectCreatedOn: '2025-04-24T09:30:00',
    ProjectStatus: 3009,
    FacilityName: 'The Merc',
    City: 1537,
    County: 2015,
    TypeOfWork: 9001,
    EstimatedCost: 3_721_000,
    EstimatedStartDate: '2025-07-01T00:00:00',
    EstimatedEndDate: '2026-10-30T00:00:00'
  }
];

/** `count` filler filings spread over the two years, mostly bigger than the Merc. */
function filler(count: number, county = 2015, prefix = 'TABSX'): TabsRow[] {
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(NOW.getTime() - ((i * 7) % 728) * 86_400_000 - 86_400_000);
    return {
      ProjectNumber: `${prefix}${String(i).padStart(6, '0')}`,
      ProjectName: `Filing ${i}`,
      ProjectCreatedOn: `${day.toISOString().slice(0, 10)}T10:00:00`,
      ProjectStatus: 3005,
      FacilityName: null,
      City: 1537,
      County: county,
      TypeOfWork: i % 3 ? 9001 : 9002,
      EstimatedCost: 1e6 + ((i * 7919) % 200) * 2.5e5,
      EstimatedStartDate: null,
      EstimatedEndDate: '2027-06-01T00:00:00'
    };
  });
}

const us = (s: string) => {
  const [m, d, y] = s.split('/');
  return `${y}-${m}-${d}`;
};

/**
 * A TABS search that serves at most 100 rows, biggest first, ignores the page
 * offset, and reports the true count. Registration dates are inclusive.
 */
function fakeTabs(byCounty: Record<string, TabsRow[]>, log: { forms: URLSearchParams[] }, options: { noTotal?: boolean; failCounty?: string } = {}): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/SearchProjects')) {
      const form = new URLSearchParams(String(init?.body));
      log.forms.push(form);
      const county = form.get('LocationCounty') ?? '';
      if (county === options.failCounty) return new Response('down', { status: 503 });
      const from = us(form.get('RegistrationDateBegin')!);
      const to = us(form.get('RegistrationDateEnd')!);
      const all = (byCounty[county] ?? []).filter((r) => r.ProjectCreatedOn.slice(0, 10) >= from && r.ProjectCreatedOn.slice(0, 10) <= to);
      const data = [...all].sort((a, b) => b.EstimatedCost - a.EstimatedCost).slice(0, Math.min(100, Number(form.get('length'))));
      return new Response(JSON.stringify(options.noTotal ? { data } : { data, recordsFiltered: all.length, recordsTotal: 999999 }));
    }
    if (url.includes('/Search/Project/')) return new Response('<h4>PROJECT</h4><dl><dt>Location Address:</dt><dd><span>5734 UTSA Blvd</span><br/><span>San Antonio, TX 78243</span></dd></dl>');
    if (url.includes('geocoding')) return new Response(JSON.stringify({ result: { addressMatches: [] } }));
    if (url.endsWith('/TABS/Search')) return new Response('');
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

const BEXAR = [...filler(3004), ...MERC];

describe('the Merc filings themselves', () => {
  it('count as current San Antonio developments, Plans reviewed, kept apart', () => {
    expect(currentDevelopments(MERC, NOW).map((r) => r.ProjectNumber)).toEqual(['TABS2025017471', 'TABS2025017477']);
    expect(statusLabel(3009)).toBe('Plans reviewed');
  });
});

describe('reading a county TABS caps at 100 rows', () => {
  it('splits date windows until every one of 3,006 Bexar filings is read', async () => {
    const log = { forms: [] as URLSearchParams[] };
    const result = await searchCounty('Bexar', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR }, log), retries: 0 });
    expect(result.reported).toBe(3006);
    expect(result.rows).toHaveLength(3006);
    expect(result.complete).toBe(true);
    expect(result.rows.map((r) => r.ProjectNumber)).toEqual(expect.arrayContaining(['TABS2025017471', 'TABS2025017477']));
    // Never paged (the offset is ignored), never more than 100 asked, and bounded.
    expect(log.forms.every((f) => f.get('start') === '0' && f.get('length') === '100')).toBe(true);
    expect(result.searches).toBe(log.forms.length);
    expect(result.searches).toBeLessThan(80);
  });

  it('finds both Merc ids in the April 24-25, 2025 window alone', async () => {
    const log = { forms: [] as URLSearchParams[] };
    const result = await searchCounty('Bexar', new Date('2025-04-25T12:00:00Z'), { fetchImpl: fakeTabs({ '2015': MERC }, log) });
    expect(result.rows.map((r) => r.ProjectNumber).sort()).toEqual(['TABS2025017471', 'TABS2025017477']);
    expect(log.forms).toHaveLength(1);
  });

  it('reports a single day above 100 rows as incomplete instead of looping', async () => {
    const busy = Array.from({ length: 140 }, (_, i) => ({ ...MERC[0]!, ProjectNumber: `TABSD${i}`, ProjectCreatedOn: '2026-03-03T10:00:00', EstimatedCost: 1e6 + i }));
    const log = { forms: [] as URLSearchParams[] };
    const result = await searchCounty('Bexar', NOW, { fetchImpl: fakeTabs({ '2015': [...busy, ...MERC] }, log) });
    expect(result.complete).toBe(false);
    expect(result.short.join(' ')).toMatch(/03\/0[23]\/2026 \(100 of 140\)/);
    expect(result.rows.map((r) => r.ProjectNumber)).toEqual(expect.arrayContaining(['TABS2025017471', 'TABS2025017477']));
    expect(log.forms.length).toBeLessThan(60);
  });

  it('splits a full page even when TABS reports no total', async () => {
    const log = { forms: [] as URLSearchParams[] };
    const result = await searchCounty('Bexar', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR }, log, { noTotal: true }) });
    expect(result.rows).toHaveLength(3006);
    expect(result.complete).toBe(true);
    expect(result.reported).toBeNull();
  });

  it('stops at the search budget and says the read is short', async () => {
    const log = { forms: [] as URLSearchParams[] };
    const budget = searchBudget(0, 5);
    const result = await searchCounty('Bexar', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR }, log), budget });
    expect(log.forms).toHaveLength(5);
    expect(result.complete).toBe(false);
    expect(result.short.some((s) => s.includes('search budget used up'))).toBe(true);
  });

  it('keeps sparse windows and windows overlapping at their edges to one row each', async () => {
    const sparse = [MERC[0]!, { ...MERC[1]!, ProjectCreatedOn: '2024-10-15T10:00:00' }];
    const log = { forms: [] as URLSearchParams[] };
    const result = await searchCounty('Bexar', NOW, { fetchImpl: fakeTabs({ '2015': [...filler(250), ...sparse] }, log) });
    expect(result.complete).toBe(true);
    expect(new Set(result.rows.map((r) => r.ProjectNumber)).size).toBe(result.rows.length);
    expect(result.rows).toHaveLength(252);
  });

  it('ranks the Merc in the whole San Antonio metro and reports coverage per county', async () => {
    const log = { forms: [] as URLSearchParams[] };
    const { rows, coverage } = await searchMetroAll('San Antonio', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR, '2094': filler(40, 2094, 'TABSG') }, log) });
    const rank = (id: string) => rows.findIndex((r) => r.ProjectNumber === id) + 1;
    expect(rank('TABS2025017471')).toBeGreaterThan(0);
    expect(rank('TABS2025017477')).toBeGreaterThan(rank('TABS2025017471'));
    expect(coverage.map((c) => [c.county, c.complete])).toEqual([
      ['Bexar', true],
      ['Guadalupe', true],
      ['Medina', true],
      ['Kendall', true],
      ['Wilson', true]
    ]);
    expect(tabsCoverageLine(coverage)).toMatch(/^Bexar 3,006 of 3,006 in \d+ searches; Guadalupe 40 of 40 in 1 search;/);
  });
});

describe('reading only what the map can use', () => {
  it('leaves windows unsplit once all they hold is below the cap cutoff, and stays correct', async () => {
    const full = await searchMetroAll('San Antonio', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR }, { forms: [] }), cap: 1e9 });
    const log = { forms: [] as URLSearchParams[] };
    const { rows, coverage } = await searchMetroAll('San Antonio', NOW, { fetchImpl: fakeTabs({ '2015': BEXAR }, log), cap: 50 });
    const bexar = coverage[0]!;
    expect(bexar.complete).toBe(true);
    expect(bexar.skipped).toBeGreaterThan(0);
    expect(bexar.read).toBeLessThan(3006);
    expect(bexar.searches).toBeLessThan(full.coverage[0]!.searches);
    // The biggest 50 are exactly the ones a full read finds.
    expect(rows.slice(0, 50).map((r) => r.EstimatedCost)).toEqual(full.rows.slice(0, 50).map((r) => r.EstimatedCost));
    expect(tabsCoverageLine(coverage)).toMatch(/below the map's cutoff left unsplit/);
  });
});

describe('building the map from a short read', () => {
  it('keeps earlier projects when a county could not be read, and says so', async () => {
    const lines: string[] = [];
    const earlier = { id: 'TABSKEEP', city: 'San Antonio', source: 'tabs', name: 'Earlier filing', cost: 9e6, end: '2027-01-01', lat: 29.5, lng: -98.5, approximate: false } as Development;
    const ended = { ...earlier, id: 'TABSDONE', end: '2025-01-01' } as Development;
    const result = await fetchDevelopments(['San Antonio'], {
      now: NOW,
      pauseMs: 0,
      retries: 0,
      previous: [earlier, ended],
      log: (l) => lines.push(l),
      fetchImpl: fakeTabs({ '2015': MERC }, { forms: [] }, { failCounty: '2094' })
    });
    expect(result.coverage?.find((c) => c.county === 'Guadalupe')).toMatchObject({ complete: false });
    expect(result.coverage?.find((c) => c.county === 'Bexar')).toMatchObject({ complete: true, read: 2 });
    const ids = result.projects.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['TABS2025017471', 'TABS2025017477', 'TABSKEEP']));
    expect(ids).not.toContain('TABSDONE');
    expect(lines.join('\n')).toMatch(/Guadalupe not read/);
    expect(lines.join('\n')).toMatch(/1 kept from the last build because the read was incomplete/);
  });

  it('does not keep earlier projects when every county read is complete', async () => {
    const earlier = { id: 'TABSGONE', city: 'San Antonio', source: 'tabs', name: 'Closed since', cost: 9e6, end: '2027-01-01' } as Development;
    const result = await fetchDevelopments(['San Antonio'], { now: NOW, pauseMs: 0, previous: [earlier], fetchImpl: fakeTabs({ '2015': MERC }, { forms: [] }) });
    expect(result.projects.map((p) => p.id)).not.toContain('TABSGONE');
  });
});

/** A San Antonio permit row, as the city's datastore returns it. */
const permitRow = (over: Partial<PermitRow>): PermitRow => ({
  'PERMIT TYPE': 'Comm Shell Permit',
  'PERMIT #': 'COM-SHL-PMT25-40400053',
  'PROJECT NAME': 'Building No: 1; Unit No: 100',
  'WORK TYPE': 'New',
  ADDRESS: '5734 UTSA BLVD, City of San Antonio, TX 78249',
  X_COORD: null,
  Y_COORD: null,
  'DATE SUBMITTED': '2025-05-01',
  'DATE ISSUED': '2025-06-13',
  'DECLARED VALUATION': '5841002',
  'AREA (SF)': '42484',
  'PRIMARY CONTACT': null,
  ...over
});

const SHELLS = [
  permitRow({}),
  permitRow({ 'PERMIT #': 'COM-SHL-PMT25-40400054', 'PROJECT NAME': 'Building No: 2; Unit No: 200' }),
  permitRow({ 'PERMIT #': 'COM-SHL-PMT25-40400055', ADDRESS: '5730 UTSA BLVD, City of San Antinio, TX 78249', 'DECLARED VALUATION': '3723500' })
].map((r) => sanAntonioPermit(r)!);

/** The related permits at the same addresses: excluded from the map, but they carry the site's point and name. */
const RELATED: PermitRow[] = [
  permitRow({ 'PERMIT TYPE': 'Comm Retaining Wall', 'PERMIT #': 'COM-RW-PMT26-41100026', ADDRESS: '5730 UTSA BLVD, San Antonio, TX 78243', 'PROJECT NAME': 'Merc Retail Development', X_COORD: '-98.599389', Y_COORD: '29.574234', 'DATE ISSUED': '2026-04-20' }),
  permitRow({ 'PERMIT TYPE': 'Comm Interior Finish-Out', 'PERMIT #': 'COM-IFO-PMT26-40500099', ADDRESS: '5734 UTSA BLVD, San Antonio, TX 78249', 'PROJECT NAME': 'Suite 100 Coffee', X_COORD: '-98.600688', Y_COORD: '29.574564', 'DATE ISSUED': '2026-05-02' }),
  permitRow({ 'PERMIT TYPE': 'Comm Interior Finish-Out', 'PERMIT #': 'OTHER', ADDRESS: '5734 BABCOCK RD, San Antonio, TX 78240', X_COORD: '-98.6', Y_COORD: '29.5' })
];

/** The city's datastore answering the site-point lookup with RELATED. */
const fakeCkan = (asked: string[]): typeof fetch =>
  (async (input: string | URL) => {
    const url = decodeURIComponent(String(input));
    asked.push(url);
    return new Response(JSON.stringify({ success: true, result: { records: RELATED } }));
  }) as typeof fetch;

const tabsMerc = (): Development[] =>
  MERC.map(
    (r) =>
      ({
        id: r.ProjectNumber,
        city: 'San Antonio',
        name: r.ProjectName,
        address: r.ProjectNumber.endsWith('71') ? '5734 UTSA Blvd, San Antonio, TX 78243' : '5730 UTSA Blvd, San Antonio, TX 78243',
        cost: r.EstimatedCost,
        lat: null,
        lng: null,
        approximate: false
      }) as Development
  );

describe('city permits at the Merc', () => {
  it('without the filings, shows the two address entries, private, with no UTSA developer', () => {
    const projects = permitProjects(SHELLS, NOW);
    expect(projects.map((p) => [p.name, p.cost, p.facility])).toEqual([
      ['5734 Utsa Blvd', 5841002, '2 building permits'],
      ['5730 Utsa Blvd', 3723500, null]
    ]);
    for (const p of projects) {
      expect(p.isPublic).toBe(false);
      expect(p.developerDirect).toBe(false);
    }
    expect(projects[0]!.aliases).toEqual(expect.arrayContaining(['COM-SHL-PMT25-40400053', 'COM-SHL-PMT25-40400054']));
    // A named UTSA project still matches UTSA.
    expect(developerLink(null, 'UTSA Science Building', 'San Antonio').direct).toBe(true);
    expect(developerLink(null, '5734 Utsa Blvd', 'San Antonio').direct).toBe(false);
  });

  it('with the filings, keeps TABS, drops the city duplicates, and carries their numbers and site points', async () => {
    const tabs = tabsMerc();
    const asked: string[] = [];
    const lines: string[] = [];
    const extra = await fetchCityPermitProjects(['San Antonio'], NOW, tabs, {
      log: (l) => lines.push(l),
      fetchImpl: fakeCkan(asked),
      sources: [{ name: 'San Antonio', market: 'San Antonio', fetch: async () => SHELLS, locate: (await import('../src/market/cityPermits.js')).locateSanAntonio }],
      inMetro: () => true
    });
    expect(extra).toEqual([]);
    const [b12, b3] = tabs;
    // Distinct sites, distinct points, TABS costs untouched (never summed with the city's).
    expect(b12).toMatchObject({ id: 'TABS2025017471', cost: 5_840_000, lat: 29.574564, lng: -98.600688, approximate: false, locatedFrom: 'City permit COM-IFO-PMT26-40500099 at this address' });
    expect(b3).toMatchObject({ id: 'TABS2025017477', cost: 3_721_000, lat: 29.574234, lng: -98.599389, approximate: false, locatedFrom: 'City permit COM-RW-PMT26-41100026 at this address' });
    expect(b12!.aliases).toEqual(expect.arrayContaining(['COM-SHL-PMT25-40400053', 'COM-SHL-PMT25-40400054', 'Suite 100 Coffee']));
    expect(b3!.aliases).toEqual(expect.arrayContaining(['COM-SHL-PMT25-40400055', 'Merc Retail Development']));
    // One lookup for both street numbers, limited to the permit window.
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/"ADDRESS" LIKE '5734 %' OR "ADDRESS" LIKE '5730 %'|"ADDRESS" LIKE '5730 %' OR "ADDRESS" LIKE '5734 %'/);
    expect(lines).toContain('San Antonio site points: 2 of 2 unplaced projects placed from other permits at their address');
  });

  it('places the city entries themselves when there is no filing, and makes "Merc" searchable', async () => {
    const extra = await fetchCityPermitProjects(['San Antonio'], NOW, [], {
      fetchImpl: fakeCkan([]),
      sources: [{ name: 'San Antonio', market: 'San Antonio', fetch: async () => SHELLS, locate: (await import('../src/market/cityPermits.js')).locateSanAntonio }]
    });
    const at5730 = extra.find((p) => p.name === '5730 Utsa Blvd')!;
    expect(at5730).toMatchObject({ lat: 29.574234, approximate: false });
    expect(at5730.aliases).toContain('Merc Retail Development');
    const { filterProjects } = await import('../../site/market.js');
    const found = (q: string) => filterProjects(extra, { query: q }, NOW.toISOString()).map((p: Development) => p.name);
    expect(found('merc')).toEqual(['5730 Utsa Blvd']);
    expect(found('COM-SHL-PMT25-40400054')).toEqual(['5734 Utsa Blvd']);
  });

  it('rejects a site point outside the metro and leaves the pin for the ZIP fallback', async () => {
    const tabs = tabsMerc();
    await fetchCityPermitProjects(['San Antonio'], NOW, tabs, {
      fetchImpl: fakeCkan([]),
      sources: [{ name: 'San Antonio', market: 'San Antonio', fetch: async () => [], locate: (await import('../src/market/cityPermits.js')).locateSanAntonio }],
      inMetro: () => false
    });
    expect(tabs.every((p) => p.lat == null && !p.locatedFrom)).toBe(true);
    // The name evidence still helps search.
    expect(tabs[1]!.aliases).toContain('Merc Retail Development');
  });

  it('survives a failed site lookup', async () => {
    const tabs = tabsMerc();
    const lines: string[] = [];
    const broken = (async () => new Response('bad gateway', { status: 502 })) as typeof fetch;
    await fetchCityPermitProjects(['San Antonio'], NOW, tabs, {
      log: (l) => lines.push(l),
      fetchImpl: broken,
      retries: 0,
      sources: [{ name: 'San Antonio', market: 'San Antonio', fetch: async () => [], locate: (await import('../src/market/cityPermits.js')).locateSanAntonio }]
    });
    expect(lines.some((l) => l.startsWith('San Antonio site points: not read'))).toBe(true);
    expect(tabs.every((p) => p.lat == null)).toBe(true);
  });

  it('adds aliases once, never repeating the name', () => {
    const p = { name: 'The Merc - Building 3' } as Development;
    addAliases(p, ['The Merc - Building 3', 'X', 'x', null, ' ']);
    expect(p.aliases).toEqual(['X']);
  });
});
