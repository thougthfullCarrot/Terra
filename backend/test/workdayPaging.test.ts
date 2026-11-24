import { describe, expect, it, vi } from 'vitest';
import { fetchWorkday, listAll, parseTenant, texasFacetFilters, WORKDAY_TOTAL_CAP, type WorkdayStats } from '../src/collector/sources/workday.js';
import { IncompleteBoardError } from '../src/collector/sources/incomplete.js';

const tenant = parseTenant('cw.wd1.myworkdayjobs.com', 'cw/External');
const posting = (i: number, loc = 'Chicago, IL') => ({ title: `Role ${i}`, externalPath: `/job/x/Role_R${i}`, locationsText: loc });

interface Opts {
  reportTotal?: number;
  failAt?: number;
  /** From this offset on, every page repeats page 0 (Workday ignoring the offset). */
  repeatFrom?: number;
  facets?: unknown[];
  byFacet?: (applied: Record<string, string[]>) => ReturnType<typeof posting>[];
}

function fake(all: ReturnType<typeof posting>[], o: Opts = {}) {
  const offsets: number[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { offset: number; appliedFacets: Record<string, string[]> };
    offsets.push(body.offset);
    if (o.failAt !== undefined && body.offset >= o.failAt) return new Response('bad', { status: 400 });
    const list = Object.keys(body.appliedFacets).length && o.byFacet ? o.byFacet(body.appliedFacets) : all;
    const off = o.repeatFrom !== undefined && body.offset >= o.repeatFrom ? 0 : body.offset;
    const total = Object.keys(body.appliedFacets).length ? list.length : (o.reportTotal ?? list.length);
    return new Response(JSON.stringify({ total: body.offset === 0 ? total : 0, jobPostings: list.slice(off, off + 20), facets: body.offset === 0 ? o.facets : undefined }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, offsets };
}
const opts = (f: ReturnType<typeof fake>) => ({ fetchImpl: f.fetchImpl, retries: 0 });

describe('Workday list completion', () => {
  it('reads past a capped total of 2,000 until a short page (C&W serves about 2,169)', async () => {
    const all = Array.from({ length: 2169 }, (_, i) => posting(i));
    const f = fake(all, { reportTotal: WORKDAY_TOTAL_CAP });
    const read = await listAll(tenant, opts(f), 250, {});
    expect(read.listings).toHaveLength(2169);
    expect(read.end).toBe('end');
    expect(read.gap).toBeUndefined();
  });

  it('stops at a real total under the cap without an extra request', async () => {
    const all = Array.from({ length: 1000 }, (_, i) => posting(i));
    const f = fake(all);
    const read = await listAll(tenant, opts(f), 250, {});
    expect(read.listings).toHaveLength(1000);
    expect(read.end).toBe('total');
    expect(f.offsets).toHaveLength(50);
  });

  it('marks a read partial when pages start repeating earlier postings', async () => {
    const all = Array.from({ length: 2169 }, (_, i) => posting(i));
    const f = fake(all, { reportTotal: 2000, repeatFrom: 2000 });
    const read = await listAll(tenant, opts(f), 250, {});
    expect(read.listings).toHaveLength(2000);
    expect(read.end).toBe('repeated');
    expect(read.gap).toMatch(/repeated/);
  });

  it('drops a duplicated posting within an otherwise new page and counts it', async () => {
    const all = Array.from({ length: 45 }, (_, i) => posting(i));
    all[25] = posting(3);
    const read = await listAll(tenant, opts(fake(all, { reportTotal: 2000 })), 250, {});
    expect(read.listings).toHaveLength(44);
    expect(read.duplicates).toBe(1);
    expect(read.end).toBe('end');
  });

  it('marks a read partial when a later page fails, keeping what was listed', async () => {
    const read = await listAll(tenant, opts(fake(Array.from({ length: 2169 }, (_, i) => posting(i)), { reportTotal: 2000, failAt: 2000 })), 250, {});
    expect(read.listings).toHaveLength(2000);
    expect(read.end).toBe('failed');
  });

  it('marks a read partial when it ends well short of a real total', async () => {
    const all = Array.from({ length: 900 }, (_, i) => posting(i));
    const read = await listAll(tenant, opts(fake(all, { reportTotal: 1000 })), 250, {});
    expect(read.end).toBe('short');
  });

  it('marks the page cap as partial', async () => {
    const read = await listAll(tenant, opts(fake(Array.from({ length: 300 }, (_, i) => posting(i)), { reportTotal: 2000 })), 5, {});
    expect(read.end).toBe('page-cap');
  });

  it('fetchWorkday raises IncompleteBoardError for a repeated-page read and records the end', async () => {
    const all = Array.from({ length: 2169 }, (_, i) => posting(i));
    const stats: WorkdayStats = { listed: 0, considered: 0, fetched: 0 };
    await expect(fetchWorkday('C&W', tenant.host, 'cw/External', { ...opts(fake(all, { reportTotal: 2000, repeatFrom: 2000 })), stats, cache: null })).rejects.toBeInstanceOf(IncompleteBoardError);
    expect(stats.listEnd).toBe('repeated');
    expect(stats.listed).toBe(2000);
  });
});

const facets = [
  { facetParameter: 'locationCountry', values: [{ descriptor: 'United States of America', id: 'us', count: 2000 }] },
  { facetParameter: 'locationRegionStateProvince', values: [{ descriptor: 'Texas', id: 'tx', count: 3 }, { descriptor: 'Illinois', id: 'il', count: 50 }] },
  { facetParameter: 'locations', values: [{ descriptor: 'Remote, United States', id: 'rus', count: 1 }, { descriptor: 'Bangkok, Thailand', id: 'bkk', count: 4 }, { descriptor: 'Remote, Canada', id: 'rca', count: 2 }] }
];

describe('Texas facet listing', () => {
  it('picks the Texas state value and US-remote values, not other countries', () => {
    const filters = texasFacetFilters(facets);
    expect(filters.map((f) => f.label)).toEqual(['Texas', 'US remote']);
    expect(filters[0]!.applied).toEqual({ locationRegionStateProvince: ['tx'] });
    expect(filters[1]!.applied).toEqual({ locations: ['rus'] });
  });

  it('falls back to Texas city values when the board has no state facet (Greystar)', () => {
    const filters = texasFacetFilters([{ facetParameter: 'locations', values: [{ descriptor: 'Big Valley, Manchaca, TX', id: 'a', count: 1 }, { descriptor: 'Houston', id: 'b', count: 2 }, { descriptor: 'Atlanta, GA', id: 'c', count: 9 }] }]);
    expect(filters[0]!.applied).toEqual({ locations: ['a', 'b'] });
  });

  it('lists Texas (multi-location included) and US remote, merged, and only when asked', async () => {
    const tx = [posting(1, 'Dallas, TX'), posting(2, '3 Locations')];
    const remote = [posting(9, 'Remote, United States'), posting(2, '3 Locations')];
    const all = [...tx, posting(5), ...remote];
    const make = () => fake(all, { reportTotal: 2000, facets, byFacet: (a) => (a.locationRegionStateProvince ? tx : remote) });
    const stats: WorkdayStats = { listed: 0, considered: 0, fetched: 0 };
    await fetchWorkday('C&W', tenant.host, 'cw/External', { ...opts(make()), stats, cache: null, facets: true }).catch(() => []);
    expect(stats.listMode).toBe('facet');
    expect(stats.listed).toBe(3);
    expect(stats.listEnd).toBe('end');
    const plain: WorkdayStats = { listed: 0, considered: 0, fetched: 0 };
    await fetchWorkday('C&W', tenant.host, 'cw/External', { ...opts(make()), stats: plain, cache: null }).catch(() => []);
    expect(plain.listMode).toBe('nationwide');
    expect(plain.listed).toBe(5);
  });

  it('a failed facet list leaves the board partial', async () => {
    const f = fake([], { facets, failAt: 20, byFacet: () => Array.from({ length: 40 }, (_, i) => posting(i, 'Dallas, TX')) });
    const stats: WorkdayStats = { listed: 0, considered: 0, fetched: 0 };
    await expect(fetchWorkday('C&W', tenant.host, 'cw/External', { ...opts(f), stats, cache: null, facets: true })).rejects.toBeInstanceOf(IncompleteBoardError);
    expect(stats.listEnd).toBe('failed');
  });
});
