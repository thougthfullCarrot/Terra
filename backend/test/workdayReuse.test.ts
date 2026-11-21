import { afterEach, describe, expect, it } from 'vitest';
import { fetchWorkday, type DetailCache, type WorkdayStats } from '../src/collector/sources/workday.js';
import { fetchJson, hostGroup, resetHostGroups, throttleCounts } from '../src/lib/http.js';

const HOST = 'cbre.wd1.myworkdayjobs.com';
const BASE = `https://${HOST}/wday/cxs/cbre/CBRE_Careers`;
const listing = { title: 'Leasing Analyst', externalPath: '/job/Dallas-TX/Leasing-Analyst_R1', locationsText: 'Dallas, TX', postedOn: 'Posted 2 Days Ago' };
const detail = { jobPostingInfo: { title: 'Leasing Analyst', jobDescription: '<p>0-2 years</p>', location: 'Dallas, TX', jobRequisitionId: 'R1' } };

function tenant(listings: unknown[]) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith('/jobs')) return new Response(JSON.stringify({ total: listings.length, jobPostings: listings }), { status: 200 });
    return href.startsWith(BASE) ? new Response(JSON.stringify(detail), { status: 200 }) : new Response('', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

afterEach(() => resetHostGroups());

describe('Workday detail reuse', () => {
  it('reads a detail once, then reuses it while fresh, keeping the job id', async () => {
    const cache: DetailCache = new Map();
    const now = new Date('2026-11-21T12:00:00Z');
    const first = tenant([listing]);
    const a = await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: first.fetchImpl, cache, now });
    expect(first.calls).toHaveLength(2);

    const second = tenant([listing]);
    const stats: WorkdayStats = { listed: 0, considered: 0, fetched: 0 };
    const b = await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: second.fetchImpl, cache, now: new Date(now.getTime() + 3_600_000), stats });
    expect(second.calls).toHaveLength(1); // list only
    expect(stats.reused).toBe(1);
    expect(b[0]!.sourceId).toBe(a[0]!.sourceId);
    expect(b[0]!.description).toBe(a[0]!.description);
  });

  it('reads again once the cached detail is older than the cap', async () => {
    const cache: DetailCache = new Map();
    const now = new Date('2026-11-21T12:00:00Z');
    await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: tenant([listing]).fetchImpl, cache, now });
    const later = tenant([listing]);
    await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: later.fetchImpl, cache, now: new Date(now.getTime() + 80 * 3_600_000) });
    expect(later.calls).toHaveLength(2);
  });

  it('a posting no longer listed is not returned, cached or not', async () => {
    const cache: DetailCache = new Map();
    await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: tenant([listing]).fetchImpl, cache });
    const jobs = await fetchWorkday('CBRE', HOST, 'cbre/CBRE_Careers', { fetchImpl: tenant([]).fetchImpl, cache });
    expect(jobs).toEqual([]);
  });
});

describe('Workday host group', () => {
  it('groups every Workday tenant together and nothing else', () => {
    expect(hostGroup('https://jll.wd1.myworkdayjobs.com/x')).toBe('workday');
    expect(hostGroup('https://frostbank.wd5.myworkdayjobs.com/x')).toBe('workday');
    expect(hostGroup('https://boards-api.greenhouse.io/x')).toBeNull();
  });

  it('caps requests in flight and pauses the group after a 429', async () => {
    let inFlight = 0;
    let peak = 0;
    let first = true;
    const fetchImpl = (async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      if (first) {
        first = false;
        return new Response('', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const started = Date.now();
    await Promise.all(Array.from({ length: 8 }, (_, i) => fetchJson(`https://t${i}.wd1.myworkdayjobs.com/x`, { fetchImpl, baseDelayMs: 1 })));
    expect(peak).toBeLessThanOrEqual(3);
    expect(throttleCounts().workday).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900); // 3s minimum shared pause
  }, 15_000);
  it('stops pausing once the shared budget is spent, so a throttling edge cannot stall the build', async () => {
    process.env.WORKDAY_PAUSE_BUDGET_MS = '0';
    try {
      const fetchImpl = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
      const started = Date.now();
      await expect(fetchJson('https://t.wd1.myworkdayjobs.com/x', { fetchImpl, baseDelayMs: 1, retries: 2 })).rejects.toThrow('429');
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      delete process.env.WORKDAY_PAUSE_BUDGET_MS;
    }
  });
});
