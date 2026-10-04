import { describe, expect, it, vi } from 'vitest';
import {
  adzunaAggregators,
  adzunaCredentials,
  adzunaUrl,
  fetchAdzuna,
  isRealEstate,
  PAGE_SIZE,
  parseAdzuna
} from '../src/collector/sources/adzuna.js';
import { runCollector } from '../src/collector/run.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import type { RawJob } from '../src/types.js';

const credentials = { appId: 'id', appKey: 'key' };
const now = new Date('2026-10-04T00:00:00Z');

function hit(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    title: '<strong>Commercial Real Estate</strong> Analyst Intern',
    description: 'Support acquisitions underwriting for our <strong>commercial real estate</strong> fund.',
    created: '2026-10-02T10:00:00Z',
    redirect_url: 'https://www.adzuna.com/land/ad/1',
    company: { display_name: 'Stonebriar Capital' },
    location: { display_name: 'Dallas, Dallas County', area: ['US', 'Texas', 'Dallas County', 'Dallas'] },
    ...overrides
  };
}

describe('parseAdzuna', () => {
  it('maps a hit to a RawJob with a Texas location the filter can read', () => {
    const [job] = parseAdzuna({ results: [hit()] });
    expect(job).toMatchObject({
      title: 'Commercial Real Estate Analyst Intern',
      firm: 'Stonebriar Capital',
      location: 'Dallas, Dallas County, Texas',
      applyUrl: 'https://www.adzuna.com/land/ad/1',
      ats: 'aggregator'
    });
    expect(job!.description).not.toContain('<strong>');
    expect(job!.postedAt?.toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });

  it('drops hits with no title, firm or link, and off-topic hits', () => {
    const jobs = parseAdzuna({
      results: [
        hit({ redirect_url: undefined }),
        hit({ company: {} }),
        hit({ title: 'Mortgage Loan Officer', description: 'Help buyers finance real estate.' }),
        hit({ title: 'Talent Acquisitions Coordinator', description: 'Recruit nurses.' })
      ]
    });
    expect(jobs).toEqual([]);
  });

  it('tolerates an empty or malformed payload', () => {
    expect(parseAdzuna({})).toEqual([]);
    expect(parseAdzuna(null as never)).toEqual([]);
  });
});

describe('isRealEstate', () => {
  it('needs a strong real estate signal and rejects residential sales', () => {
    expect(isRealEstate('Leasing Associate', 'Lease office space in a REIT portfolio.')).toBe(true);
    expect(isRealEstate('Leasing Consultant', 'Car dealership leasing desk.')).toBe(false);
    expect(isRealEstate('Real Estate Agent', 'Commercial real estate experience a plus.')).toBe(false);
  });
});

describe('fetchAdzuna', () => {
  it('searches Texas, pages until a short page, and stays within the request budget', async () => {
    const full = { results: Array.from({ length: PAGE_SIZE }, (_, i) => hit({ redirect_url: `https://a/${i}` })) };
    const short = { results: [hit({ redirect_url: 'https://a/short' })] };
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      const body = urls.length === 1 ? full : short;
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const jobs = await fetchAdzuna(credentials, {
      queries: [{ what: 'a' }, { what: 'b' }, { what: 'c' }],
      maxRequests: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    // Query a: page 1 full, page 2 short. Query b: page 1 short. Query c: over budget.
    expect(urls).toHaveLength(3);
    expect(urls[0]).toContain('/search/1?');
    expect(urls[1]).toContain('/search/2?');
    expect(new URL(urls[0]!).searchParams.get('where')).toBe('Texas');
    // Duplicate links across queries collapse to one.
    expect(jobs).toHaveLength(PAGE_SIZE + 1);
  });

  it('puts the credentials in the query string, not anywhere else', () => {
    const url = new URL(adzunaUrl(credentials, { what_phrase: 'commercial real estate' }, 1, 30));
    expect(url.searchParams.get('app_id')).toBe('id');
    expect(url.searchParams.get('app_key')).toBe('key');
    expect(url.searchParams.get('what_phrase')).toBe('commercial real estate');
  });
});

describe('adzuna credentials', () => {
  it('is off unless both values are set', () => {
    expect(adzunaCredentials({})).toBeNull();
    expect(adzunaCredentials({ ADZUNA_APP_ID: 'x', ADZUNA_APP_KEY: ' ' })).toBeNull();
    expect(adzunaAggregators({})).toEqual([]);
    expect(adzunaAggregators({ ADZUNA_APP_ID: 'x', ADZUNA_APP_KEY: 'y' })).toHaveLength(1);
  });
});

describe('runCollector with an aggregator', () => {
  const firms: FirmRow[] = [
    { id: 1, name: 'CBRE', ats: 'greenhouse', atsSlug: 'cbre', active: true, slugVerified: true }
  ];

  function board(overrides: Partial<RawJob> = {}): RawJob {
    return {
      title: 'Investment Analyst Intern',
      firm: 'CBRE',
      location: 'Dallas, TX',
      description: 'Acquisitions underwriting for commercial real estate.',
      applyUrl: 'https://boards.greenhouse.io/cbre/1',
      ats: 'greenhouse',
      ...overrides
    };
  }

  it('adds new seats, skips ones a board already listed, and keeps the board copy', async () => {
    const store = new MemoryStore(firms);
    const report = await runCollector({
      store,
      now,
      fetcher: async () => [board()],
      aggregators: [
        {
          name: 'adzuna',
          fetch: async () => [
            board({ firm: 'CBRE Group, Inc.', applyUrl: 'https://adzuna/dup', ats: 'aggregator' }),
            board({ firm: 'Stonebriar Capital', applyUrl: 'https://adzuna/new', ats: 'aggregator' }),
            board({ title: 'Analyst Intern', description: 'Real estate office, filing.', applyUrl: 'https://adzuna/vague', ats: 'aggregator' })
          ]
        }
      ]
    });

    expect(report.kept).toBe(2);
    expect(report.aggregators).toEqual([
      { name: 'adzuna', fetched: 3, kept: 1, duplicates: 1, rejected: 1 }
    ]);
    const links = [...store.postings.values()].map((p) => p.applyUrl).sort();
    expect(links).toEqual(['https://adzuna/new', 'https://boards.greenhouse.io/cbre/1']);
  });

  it('records an aggregator failure without failing the pass', async () => {
    const store = new MemoryStore(firms);
    const report = await runCollector({
      store,
      now,
      fetcher: async () => [board()],
      aggregators: [{ name: 'adzuna', fetch: async () => { throw new Error('401'); } }]
    });

    expect(report.kept).toBe(1);
    expect(report.aggregators[0]).toMatchObject({ name: 'adzuna', fetched: 0, error: '401' });
  });
});
