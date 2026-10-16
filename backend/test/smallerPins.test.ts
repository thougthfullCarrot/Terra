import { describe, expect, it } from 'vitest';
import { fetchDevelopments, MAX_NEW_PAGES, pinSmaller, SMALLER_PAGE_MS, type SmallerFiling, type TabsRow } from '../src/market/developments.js';

const NOW = new Date('2026-10-15T12:00:00Z');
const PDL_PAGE =
  '<h4>PROJECT</h4><dl><dt>Location Address:</dt><dd><span>13735 IH-10 W</span><br/><span>San Antonio, TX 78249</span></dd></dl><h4>OWNER</h4><dl><dt>Owner Name:</dt><dd><span>PDL Partners LLC</span></dd></dl>';

const filing = (id: string, city: 'San Antonio' | 'Austin', cost: number): SmallerFiling => ({
  id,
  city,
  place: city,
  name: `Filing ${id}`,
  status: 'Registered',
  work: 'New construction',
  cost,
  registered: '2026-01-01',
  end: null,
  url: `https://www.tdlr.texas.gov/TABS/Projects/${id}`
});

/** TDLR pages and the Census geocoder: every address lands near San Antonio unless it says "nowhere". */
function fakeWeb(pages: string[]): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (url.includes('/Search/Project/')) {
      pages.push(url.split('/').pop()!);
      return new Response(url.endsWith('NOWHERE') ? '<h4>PROJECT</h4><dl><dt>Location Address:</dt><dd><span>1 Nowhere Rd</span><br/><span>San Antonio, TX 78249</span></dd></dl>' : PDL_PAGE);
    }
    if (url.includes('geocoding')) {
      const hit = !decodeURIComponent(url).includes('Nowhere');
      return new Response(JSON.stringify({ result: { addressMatches: hit ? [{ coordinates: { x: -98.62, y: 29.58 } }] : [] } }));
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

describe('pins for smaller filings', () => {
  it('reads pages only up to the spare budget, biggest first, taking turns across metros', async () => {
    const list = [filing('SA1', 'San Antonio', 2e6), filing('SA2', 'San Antonio', 1.9e6), filing('SA3', 'San Antonio', 1e6), filing('AU1', 'Austin', 1.5e6)];
    const pages: string[] = [];
    const out = await pinSmaller(list, [], 3, { http: { fetchImpl: fakeWeb(pages) }, pauseMs: 0 });
    expect(pages).toEqual(['SA1', 'AU1', 'SA2']);
    expect(out.read).toBe(3);
    expect(list.find((s) => s.id === 'SA1')).toMatchObject({ address: expect.stringContaining('13735 IH-10 W'), owner: 'PDL Partners LLC', lat: 29.58, lng: -98.62, paged: true });
    expect(list.find((s) => s.id === 'SA3')).not.toHaveProperty('paged');
  });

  it('reads nothing with no spare budget', async () => {
    const pages: string[] = [];
    const list = [filing('SA1', 'San Antonio', 2e6)];
    await pinSmaller(list, [], 0, { http: { fetchImpl: fakeWeb(pages) }, pauseMs: 0 });
    expect(pages).toEqual([]);
    expect(list[0]!.lat).toBeUndefined();
  });

  it('reuses an earlier build’s page and pin instead of reading it again', async () => {
    const before = { ...filing('TABS2026006871', 'San Antonio', 1.2e6), address: '13735 IH-10 W, San Antonio, TX 78249', lat: 29.58, lng: -98.62, approximate: false, paged: true };
    const list = [filing('TABS2026006871', 'San Antonio', 1.2e6)];
    const pages: string[] = [];
    const out = await pinSmaller(list, [before], 10, { http: { fetchImpl: fakeWeb(pages) }, pauseMs: 0 });
    expect(pages).toEqual([]);
    expect(out.reused).toBe(1);
    expect(list[0]).toMatchObject({ address: before.address, lat: 29.58, paged: true });
  });

  it('stops at the time limit', async () => {
    let t = 0;
    const list = [filing('SA1', 'San Antonio', 3e6), filing('SA2', 'San Antonio', 2e6)];
    const pages: string[] = [];
    const lines: string[] = [];
    await pinSmaller(list, [], 10, { http: { fetchImpl: fakeWeb(pages) }, pauseMs: 0, clock: () => (t += SMALLER_PAGE_MS), log: (l) => lines.push(l) });
    expect(pages.length).toBeLessThan(2);
    expect(lines.join('\n')).toMatch(/time limit reached/);
  });

  it('keeps a page whose address the geocoder misses, unpinned without a ZIP center', async () => {
    const list = [filing('NOWHERE', 'San Antonio', 2e6)];
    await pinSmaller(list, [], 5, { http: { fetchImpl: fakeWeb([]) }, pauseMs: 0 });
    expect(list[0]).toMatchObject({ paged: true, lat: null });
  });
});

const row = (i: number, cost: number, over: Partial<TabsRow> = {}): TabsRow => ({
  ProjectNumber: `TABSS${String(i).padStart(6, '0')}`,
  ProjectName: `Filing ${i}`,
  ProjectCreatedOn: '2026-03-01T10:00:00',
  ProjectStatus: 3005,
  FacilityName: null,
  City: 1537,
  County: 2015,
  TypeOfWork: 9001,
  EstimatedCost: cost,
  EstimatedStartDate: '2026-04-01T00:00:00',
  EstimatedEndDate: '2027-06-01T00:00:00',
  ...over
});

function fakeTabs(rows: TabsRow[], pages: string[]): typeof fetch {
  const web = fakeWeb(pages);
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/SearchProjects')) {
      const form = new URLSearchParams(String(init?.body));
      const data = form.get('LocationCounty') === '2015' ? rows : [];
      return new Response(JSON.stringify({ data, recordsFiltered: data.length }));
    }
    return web(input, init);
  }) as typeof fetch;
}

describe('the build', () => {
  const PDL = row(9999, 1_200_000, { ProjectNumber: 'TABS2026006871', ProjectName: 'PDL Club' });
  const ROWS = [...Array.from({ length: 300 }, (_, i) => row(i, 3e6 + i)), PDL];

  it('pins smaller filings only after every project inside the cap has its page, and keeps them out of projects', async () => {
    const pages: string[] = [];
    const result = await fetchDevelopments(['San Antonio'], { now: NOW, pauseMs: 0, retries: 0, fetchImpl: fakeTabs(ROWS, pages) });
    expect(pages.filter((p) => p !== 'TABS2026006871')).toHaveLength(300);
    expect(pages).toContain('TABS2026006871');
    expect(pages.length).toBeLessThanOrEqual(MAX_NEW_PAGES);
    expect(result.projects.map((p) => p.id)).not.toContain('TABS2026006871');
    expect(result.smaller?.find((s) => s.id === 'TABS2026006871')).toMatchObject({ lat: 29.58, paged: true });
  });

  it('reads no smaller page while a project inside the cap still waits for its page', async () => {
    const pages: string[] = [];
    const big = [...Array.from({ length: 300 }, (_, i) => row(i, 3e6 + i)), ...Array.from({ length: 300 }, (_, i) => row(1000 + i, 4e6 + i, { County: 2015 })), PDL];
    // Two metros' worth in one: Houston gets the same rows so the 400 pages run out.
    const result = await fetchDevelopments(['San Antonio', 'Austin'], {
      now: NOW,
      pauseMs: 0,
      retries: 0,
      fetchImpl: (async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/SearchProjects')) {
          const form = new URLSearchParams(String(init?.body));
          const county = form.get('LocationCounty');
          const data = county === '2015' ? big : county === '2227' ? big.map((r) => ({ ...r, ProjectNumber: `AU${r.ProjectNumber}`, County: 2227 })) : [];
          return new Response(JSON.stringify({ data, recordsFiltered: data.length }));
        }
        return fakeWeb(pages)(input, init);
      }) as typeof fetch
    });
    expect(result.waiting).toBeGreaterThan(0);
    expect(pages).not.toContain('TABS2026006871');
    expect(result.smaller?.every((s) => !s.paged)).toBe(true);
  });
});
