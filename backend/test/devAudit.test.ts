import { describe, expect, it } from 'vitest';
import { permitProjects, type CityPermit, type PermitSource } from '../src/market/cityPermits.js';
import { auditBudget, auditCounty, auditMarket, exclusionReason, marketReport, memoryCache, traceLines } from '../src/market/devAudit.js';
import { currentDevelopments, type TabsRow } from '../src/market/developments.js';

/**
 * The development audit (Rod, 2026-10-16) against a TDLR that behaves like the
 * real one: at most 100 rows a search, the page offset ignored, the sort order
 * honored, the true count in recordsFiltered.
 */

const NOW = new Date('2026-10-16T12:00:00Z');

const row = (id: string, cost: number, created: string, over: Partial<TabsRow> = {}): TabsRow => ({
  ProjectNumber: id,
  ProjectName: id,
  ProjectCreatedOn: `${created}T10:00:00`,
  ProjectStatus: 3005,
  FacilityName: null,
  City: 1537,
  TypeOfWork: 9001,
  EstimatedCost: cost,
  EstimatedStartDate: null,
  EstimatedEndDate: '2027-06-01T00:00:00',
  ...over
});

const MERC = [
  row('TABS2025017471', 5_840_000, '2025-04-24', { ProjectName: 'The Merc - Buildings 1 & 2', ProjectStatus: 3009 }),
  row('TABS2025017477', 3_721_000, '2025-04-24', { ProjectName: 'The Merc - Building 3', ProjectStatus: 3009 })
];
const PDL = row('TABS2026006871', 120_000, '2026-04-02', { ProjectName: 'PDL Club ' });

/** `count` filings spread over two years, all bigger than PDL Club. */
function filler(count: number, prefix = 'TABSX'): TabsRow[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(NOW.getTime() - ((i * 7) % 728) * 86_400_000 - 86_400_000).toISOString().slice(0, 10);
    return row(`${prefix}${String(i).padStart(6, '0')}`, 1e6 + ((i * 7919) % 200) * 2.5e5, d, { TypeOfWork: i % 5 ? 9001 : 9002 });
  });
}

const us = (s: string) => {
  const [m, d, y] = s.split('/');
  return `${y}-${m}-${d}`;
};

interface FakeOptions {
  addresses?: Record<string, string>;
  geocodes?: Record<string, [number, number]>;
  down?: boolean;
}

function fakeTdlr(byCounty: Record<string, TabsRow[]>, log: { forms: URLSearchParams[]; pages: string[]; geocodes: string[] }, o: FakeOptions = {}): typeof fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/SearchProjects')) {
      if (o.down) return new Response('down', { status: 503 });
      const form = new URLSearchParams(String(init?.body));
      log.forms.push(form);
      const from = us(form.get('RegistrationDateBegin')!);
      const to = us(form.get('RegistrationDateEnd')!);
      const all = (byCounty[form.get('LocationCounty') ?? ''] ?? []).filter((r) => r.ProjectCreatedOn.slice(0, 10) >= from && r.ProjectCreatedOn.slice(0, 10) <= to);
      const dir = form.get('order[0][dir]') === 'asc' ? 1 : -1;
      const data = [...all].sort((a, b) => dir * (a.EstimatedCost - b.EstimatedCost)).slice(0, Math.min(100, Number(form.get('length'))));
      return new Response(JSON.stringify({ data, recordsFiltered: all.length }));
    }
    const page = /\/Search\/Project\/(\w+)/.exec(url)?.[1];
    if (page) {
      log.pages.push(page);
      const address = o.addresses?.[page];
      return new Response(`<h4>PROJECT</h4><dl><dt>Location Address:</dt><dd>${address ? address.split(', ').map((l) => `<span>${l}</span>`).join('<br/>') : ''}</dd></dl>`);
    }
    if (url.includes('geocoding')) {
      const address = decodeURIComponent(/address=([^&]+)/.exec(url)?.[1] ?? '');
      log.geocodes.push(address);
      const at = o.geocodes?.[address];
      return new Response(JSON.stringify({ result: { addressMatches: at ? [{ coordinates: { x: at[1], y: at[0] } }] : [] } }));
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

const newLog = () => ({ forms: [] as URLSearchParams[], pages: [] as string[], geocodes: [] as string[] });

describe('eligibility', () => {
  it('gives a reason for exactly the rows currentDevelopments drops', () => {
    const rows = [
      ...MERC,
      PDL,
      row('A', 5e5, '2026-01-01', { TypeOfWork: 9002 }),
      row('B', 5e5, '2026-01-01', { ProjectStatus: 3007 }),
      row('C', 5e5, '2024-12-01', { EstimatedEndDate: '2025-01-01T00:00:00' }),
      row('D', 0, '2026-01-01'),
      row('E', 6e9, '2026-01-01'),
      row('F', 9e8, '2026-01-01', { ProjectName: 'Smith Elementary' }),
      row('G', 5e6, '2026-01-01', { ProjectName: 'CSJ 0072-01-033 IH 10' })
    ];
    const kept = new Set(currentDevelopments(rows, NOW).map((r) => r.ProjectNumber));
    for (const r of rows) expect(exclusionReason(r, NOW) == null).toBe(kept.has(r.ProjectNumber));
    expect(rows.map((r) => exclusionReason(r, NOW)).filter(Boolean)).toEqual([
      'not new construction or addition',
      'closed or inspection complete',
      'estimated end over 120 days past',
      'no cost filed',
      'implausible cost (typo)',
      'implausible cost (typo)',
      'highway segment (CSJ)'
    ]);
  });
});

describe('collecting a county with no cost cut', () => {
  it('reads every Bexar filing, including PDL Club at the bottom of a busy window', async () => {
    const log = newLog();
    const rows = [...filler(3003), ...MERC, PDL];
    const read = await auditCounty('Bexar', 'San Antonio', NOW, { http: { fetchImpl: fakeTdlr({ '2015': rows }, log), retries: 0 }, cache: memoryCache(), budget: auditBudget({ pauseMs: 0 }) });
    expect(read.reported).toBe(3006);
    expect(read.rows).toHaveLength(3006);
    expect(read.complete).toBe(true);
    expect(read.missing).toBe(0);
    expect(read.foundIn.get('TABS2026006871')).toMatch(/^\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/);
    expect(log.forms.every((f) => f.get('start') === '0' && f.get('length') === '100')).toBe(true);
  });

  it('reads a day of 150 filings from both ends, and counts a day of 250 as 50 missing', async () => {
    const busy = (n: number) => Array.from({ length: n }, (_, i) => row(`TABSD${i}`, 1e5 + i * 1000, '2026-03-03'));
    const run = async (rows: TabsRow[]) =>
      auditCounty('Bexar', 'San Antonio', NOW, { http: { fetchImpl: fakeTdlr({ '2015': rows }, newLog()), retries: 0 }, cache: memoryCache(), budget: auditBudget({ pauseMs: 0 }) });
    const ok = await run([...busy(150), ...MERC]);
    expect(ok.complete).toBe(true);
    expect(ok.rows).toHaveLength(152);
    expect(ok.windows.some((w) => w.how === 'both ends' && w.whole)).toBe(true);
    const over = await run(busy(250));
    expect(over.complete).toBe(false);
    expect(over.missing).toBe(50);
    expect(over.rows).toHaveLength(200);
  });

  it('resumes from the cache after running out of searches, without repeating any', async () => {
    const rows = [...filler(1500), ...MERC];
    const cache = memoryCache();
    const log = newLog();
    const http = { fetchImpl: fakeTdlr({ '2015': rows }, log), retries: 0 };
    const first = await auditCounty('Bexar', 'San Antonio', NOW, { http, cache, budget: auditBudget({ pauseMs: 0, searches: 6 }) });
    expect(first.complete).toBe(false);
    expect(first.windows.some((w) => w.how === 'budget')).toBe(true);
    expect(log.forms).toHaveLength(6);
    const second = await auditCounty('Bexar', 'San Antonio', NOW, { http, cache, budget: auditBudget({ pauseMs: 0 }) });
    expect(second.complete).toBe(true);
    expect(second.rows).toHaveLength(1502);
    // Each window was asked once across both runs.
    const asked = log.forms.map((f) => `${f.get('RegistrationDateBegin')}|${f.get('RegistrationDateEnd')}|${f.get('order[0][dir]')}`);
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('keeps what it read and reports the county incomplete when TDLR is down', async () => {
    const read = await auditCounty('Bexar', 'San Antonio', NOW, { http: { fetchImpl: fakeTdlr({}, newLog(), { down: true }), retries: 0 }, cache: memoryCache(), budget: auditBudget({ pauseMs: 0 }) });
    expect(read.complete).toBe(false);
    expect(read.error).toBeTruthy();
  });
});

describe('a market: merge, locate, report', () => {
  const SA_ADDRESSES: Record<string, string> = {
    TABS2025017471: '5734 UTSA Blvd, San Antonio, TX 78249',
    TABS2025017477: '5730 UTSA Blvd, San Antonio, TX 78249',
    TABS2026006871: '13735 IH-10 W, San Antonio, TX 78249',
    TABSFAR: '100 Main St, El Paso, TX 79901',
    TABSROAD: 'From: FM 1560 To: Loop 1604, San Antonio, TX',
    TABSDUP1: '200 Commerce St, San Antonio, TX 78205',
    TABSDUP2: '200 Commerce St, San Antonio, TX 78205'
  };
  const MERC_PERMIT_POINT: [number, number] = [29.5855, -98.6182];
  const cityPermit = (over: Partial<CityPermit>): CityPermit => ({
    market: 'San Antonio',
    place: 'San Antonio',
    permit: 'P',
    group: '',
    name: null,
    text: '',
    address: null,
    lat: null,
    lng: null,
    issued: '2026-02-01',
    value: 2e6,
    squareFeet: 0,
    work: 'New construction',
    owner: null,
    contact: null,
    contractor: null,
    scope: null,
    url: 'https://data.sanantonio.gov/dataset/building-permits',
    ...over
  });
  const source: PermitSource = {
    name: 'San Antonio',
    market: 'San Antonio',
    fetch: async (_now, options) => {
      expect(options.minValue).toBe(50_000);
      return [
        cityPermit({ permit: 'COM-PRJ-25-1', group: '5734 UTSA BLVD', address: '5734 Utsa Blvd, San Antonio, TX 78249', lat: MERC_PERMIT_POINT[0], lng: MERC_PERMIT_POINT[1], name: 'Merc Retail Development' }),
        cityPermit({ permit: 'COM-PRJ-26-9', group: '900 BROADWAY', address: '900 Broadway, San Antonio, TX 78215', lat: 29.44, lng: -98.48, value: 300_000, name: 'Small Cafe' })
      ];
    }
  };

  async function run(extra: TabsRow[] = []) {
    const rows = [
      ...filler(1200),
      ...MERC,
      PDL,
      row('TABSFAR', 900_000, '2026-02-02'),
      row('TABSROAD', 800_000, '2026-02-02'),
      row('TABSNOPAGE', 600_000, '2026-02-02'),
      row('TABSDUP1', 650_000, '2026-02-03'),
      row('TABSDUP2', 650_000, '2026-02-04'),
      ...extra
    ];
    const log = newLog();
    const http = {
      fetchImpl: fakeTdlr({ '2015': rows }, log, {
        addresses: SA_ADDRESSES,
        geocodes: {
          // PDL's address matches; the Merc's brand-new addresses don't; a wrong match lands in El Paso.
          '13735 IH-10 W, San Antonio, TX 78249': [29.5641, -98.5857],
          '100 Main St, El Paso, TX 79901': [31.7587, -106.4869],
          '200 Commerce St, San Antonio, TX 78205': [29.4246, -98.4896]
        }
      }),
      retries: 0
    };
    // Every filler filing already has a page from the last build, so the page budget reaches the traced ids.
    const previous = { projects: [], smaller: filler(1200).map((r) => ({ id: r.ProjectNumber, city: 'San Antonio' as const, place: null, name: r.ProjectName, status: '', work: '', cost: r.EstimatedCost, registered: '', end: null, url: '', address: null, paged: true })) };
    const audit = await auditMarket('San Antonio', {
      now: NOW,
      cache: memoryCache(),
      budget: auditBudget({ pauseMs: 0, pages: 7 }),
      http,
      sources: [source],
      previous,
      trace: ['TABS2025017471', 'TABS2025017477', 'TABS2026006871'],
      zipCenters: new Map([['78249', [29.5755, -98.6227] as [number, number]]])
    });
    return { audit, log };
  }

  it('lists PDL Club, which today\'s caps leave off the map and out of the smaller list', async () => {
    const { audit } = await run();
    const pdl = audit.records.find((r) => r.key === 'TABS2026006871')!;
    expect(pdl.current).toBe('not shown');
    expect(pdl.rank).toBeGreaterThan(300 + 600);
    expect(pdl.location).toBe('exact-geocode');
    expect(pdl.lat).toBeCloseTo(29.5641);
  });

  it('reads traced pages first, even with a small page budget', async () => {
    const { log } = await run();
    expect(log.pages.slice(0, 3).sort()).toEqual(['TABS2025017471', 'TABS2025017477', 'TABS2026006871']);
  });

  it('merges the city permit at the Merc\'s address, keeps both ids and links, and labels the borrowed point', async () => {
    const { audit } = await run();
    const merc = audit.records.find((r) => r.key === 'TABS2025017471')!;
    expect(merc.sources.map((s) => s.id)).toEqual(['TABS2025017471', 'CITY-SanAntonio-COM-PRJ-25-1']);
    expect(merc.sources.map((s) => s.url)).toEqual(['https://www.tdlr.texas.gov/TABS/Projects/TABS2025017471', 'https://data.sanantonio.gov/dataset/building-permits']);
    expect(merc.location).toBe('site');
    expect(merc.locatedBy).toBe('Borrowed from city permit COM-PRJ-25-1 at the same address');
    expect([merc.lat, merc.lng]).toEqual(MERC_PERMIT_POINT);
    // Not counted twice: no separate city record at 5734 UTSA Blvd.
    expect(audit.records.filter((r) => /5734 utsa/i.test(r.address ?? ''))).toHaveLength(1);
    expect(audit.duplicates.filter((d) => d.kind === 'city permit matched a TABS filing (merged)')).toHaveLength(1);
  });

  it('places the second Merc filing at its ZIP center, marked approximate', async () => {
    const { audit } = await run();
    const b3 = audit.records.find((r) => r.key === 'TABS2025017477')!;
    expect(b3.location).toBe('approximate');
    expect(b3.locatedBy).toBe('ZIP 78249 center (approximate)');
    // The true center, not a spread or jittered point.
    expect([b3.lat, b3.lng]).toEqual([29.5755, -98.6227]);
  });

  it('keeps a city permit below $1 million as its own record with the permit\'s point', async () => {
    const { audit } = await run();
    const cafe = audit.records.find((r) => r.name === 'Small Cafe')!;
    expect(cafe.location).toBe('exact-permit');
    expect(cafe.current).toBe('not shown');
    expect(cafe.sources[0]!.kind).toBe('city');
  });

  it('never invents a point: wrong-metro matches, road segments and unread pages stay listed without coordinates', async () => {
    const { audit } = await run();
    const get = (id: string) => audit.records.find((r) => r.key === id)!;
    expect(get('TABSFAR')).toMatchObject({ lat: null, lng: null, location: 'none', noPointReason: 'geocode landed outside the metro' });
    expect(get('TABSROAD')).toMatchObject({ lat: null, location: 'none' });
    expect(get('TABSNOPAGE')).toMatchObject({ lat: null, location: 'none', noPointReason: 'project page not read yet', pageRead: 'not read' });
    expect(audit.rejectedPoints.some((p) => p.startsWith('TABSFAR'))).toBe(true);
    expect(audit.pages.waiting).toBeGreaterThan(0);
  });

  it('flags two filings at one address with one cost as a possible duplicate without merging them', async () => {
    const { audit } = await run();
    const possible = audit.duplicates.filter((d) => d.kind === 'possible duplicate (kept separate)');
    expect(possible.map((d) => d.ids.sort())).toContainEqual(['TABSDUP1', 'TABSDUP2']);
    expect(audit.records.filter((r) => r.key.startsWith('TABSDUP'))).toHaveLength(2);
  });

  it('counts exclusions by reason and writes a report with completeness, locations and traces', async () => {
    const { audit } = await run();
    expect(audit.exclusions['not new construction or addition']).toBe(240);
    const md = marketReport(audit, { asOf: '2026-10-16', now: NOW, traces: ['TABS2026006871'] });
    expect(md).toMatch(/\*\*Complete\*\*/);
    expect(md).toMatch(/No coordinates \(listed and searchable, not on the map\) \| \d+/);
    expect(md).toMatch(/### TABS2026006871/);
    const trace = traceLines('TABS2026006871', [audit], NOW).join('\n');
    for (const stage of ['Collected', 'Eligibility', "Today's production rules", 'Project page', 'City permits', 'Location', 'Proposed list and map']) expect(trace).toContain(stage);
    expect(trace).toMatch(/not shown/);
  });
});

describe('city permits below the map\'s $1 million floor', () => {
  it('are kept when an audit asks for a lower floor, and dropped by default', () => {
    const p: CityPermit = {
      market: 'Austin', place: 'Austin', permit: 'BP-1', group: 'G1', name: 'Coffee shop', text: '', address: '1 Oak St, Austin, TX', lat: 30.27, lng: -97.74,
      issued: '2026-05-01', value: 250_000, squareFeet: 0, work: 'New construction', owner: null, contact: null, contractor: null, scope: null, url: 'u'
    };
    expect(permitProjects([p], NOW)).toHaveLength(0);
    expect(permitProjects([p], NOW, Number.POSITIVE_INFINITY, 50_000)).toHaveLength(1);
  });
});
