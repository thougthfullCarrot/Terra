import { describe, expect, it, vi } from 'vitest';
import {
  applyUrl,
  detailUrl,
  fetchWorkday,
  listUrl,
  parsePostedOn,
  parseTenant,
  worthFetching
} from '../src/collector/sources/workday.js';

const tenant = parseTenant('cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers');

/** A fake tenant: one list page plus a detail document per posting. */
function fakeWorkday(listings: unknown[], details: Record<string, unknown> = {}) {
  const calls: { url: string; method: string; body: unknown }[] = [];

  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({
      url: href,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    });

    if (href.endsWith('/jobs')) {
      const offset = (JSON.parse(String(init?.body ?? '{}')).offset as number) ?? 0;
      return new Response(
        JSON.stringify({ total: listings.length, jobPostings: listings.slice(offset, offset + 20) }),
        { status: 200 }
      );
    }

    const path = href.replace(`https://cbre.wd1.myworkdayjobs.com/wday/cxs/cbre/CBRE_Careers`, '');
    const detail = details[path];
    return detail
      ? new Response(JSON.stringify(detail), { status: 200 })
      : new Response('not found', { status: 404 });
  });

  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('parseTenant', () => {
  it('splits host and tenant/site', () => {
    expect(tenant).toEqual({
      host: 'cbre.wd1.myworkdayjobs.com',
      tenant: 'cbre',
      site: 'CBRE_Careers'
    });
  });

  it('tolerates a scheme and a trailing slash on the host', () => {
    expect(parseTenant('https://cbre.wd1.myworkdayjobs.com/', 'cbre/CBRE_Careers').host).toBe(
      'cbre.wd1.myworkdayjobs.com'
    );
  });

  it('fails loudly on a half-configured firm rather than returning nothing', () => {
    expect(() => parseTenant(null, 'cbre/CBRE_Careers')).toThrow(/ats_host/);
    expect(() => parseTenant('host', 'cbre')).toThrow(/tenant.*site/i);
  });
});

describe('urls', () => {
  it('builds the CXS endpoints', () => {
    expect(listUrl(tenant)).toBe(
      'https://cbre.wd1.myworkdayjobs.com/wday/cxs/cbre/CBRE_Careers/jobs'
    );
    expect(detailUrl(tenant, '/job/Dallas/Analyst_R1')).toBe(
      'https://cbre.wd1.myworkdayjobs.com/wday/cxs/cbre/CBRE_Careers/job/Dallas/Analyst_R1'
    );
  });

  it('points apply_url at the human-facing page, not the JSON one', () => {
    expect(applyUrl(tenant, '/job/Dallas/Analyst_R1')).toBe(
      'https://cbre.wd1.myworkdayjobs.com/en-US/CBRE_Careers/job/Dallas/Analyst_R1'
    );
  });
});

describe('worthFetching', () => {
  const base = { title: 'Investment Analyst', externalPath: '/job/x', locationsText: 'Dallas, TX' };

  it('keeps Texas entry-level listings', () => {
    expect(worthFetching(base)).toBe(true);
  });

  it('drops senior titles without spending a detail request', () => {
    expect(worthFetching({ ...base, title: 'Senior Investment Analyst' })).toBe(false);
  });

  it('drops out-of-state listings', () => {
    expect(worthFetching({ ...base, locationsText: 'New York, NY' })).toBe(false);
  });

  it('opens multi-site listings, since the count hides the real locations', () => {
    expect(worthFetching({ ...base, locationsText: '5 Locations' })).toBe(true);
  });

  it('drops listings with nothing to fetch', () => {
    expect(worthFetching({ title: 'Analyst' })).toBe(false);
    expect(worthFetching({ externalPath: '/job/x' })).toBe(false);
  });
});

describe('parsePostedOn', () => {
  const now = new Date('2026-09-11T00:00:00Z');

  it('reads the prose Workday actually sends', () => {
    expect(parsePostedOn('Posted Today', now)).toEqual(now);
    expect(parsePostedOn('Posted Yesterday', now)?.toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(parsePostedOn('Posted 3 Days Ago', now)?.toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });

  it('treats "30+ Days Ago" as 30 days', () => {
    expect(parsePostedOn('Posted 30+ Days Ago', now)?.toISOString()).toBe(
      '2026-08-12T00:00:00.000Z'
    );
  });

  it('falls back to a real date string when one is sent', () => {
    expect(parsePostedOn('2026-09-01T00:00:00Z', now)?.toISOString()).toBe(
      '2026-09-01T00:00:00.000Z'
    );
  });

  it('returns undefined rather than inventing a date', () => {
    expect(parsePostedOn(undefined, now)).toBeUndefined();
    expect(parsePostedOn('Posted recently', now)).toBeUndefined();
  });
});

describe('fetchWorkday', () => {
  it('posts the paging body the API expects', async () => {
    const { fetchImpl, calls } = fakeWorkday([]);
    await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', { fetchImpl });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.body).toEqual({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' });
  });

  it('pages until the board runs out', async () => {
    const listings = Array.from({ length: 45 }, (_, i) => ({
      title: 'Senior Director',      // rejected, so no detail requests
      externalPath: `/job/${i}`,
      locationsText: 'Dallas, TX'
    }));
    const { fetchImpl, calls } = fakeWorkday(listings);

    await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', { fetchImpl });

    expect(calls.map((call) => call.body?.offset)).toEqual([0, 20, 40]);
  });

  it('spends a detail request only on listings that survive the cheap filters', async () => {
    const listings = [
      { title: 'Investment Analyst', externalPath: '/job/keep', locationsText: 'Dallas, TX' },
      { title: 'Senior Investment Analyst', externalPath: '/job/senior', locationsText: 'Dallas, TX' },
      { title: 'Investment Analyst', externalPath: '/job/ny', locationsText: 'New York, NY' }
    ];
    const { fetchImpl, calls } = fakeWorkday(listings, {
      '/job/keep': {
        jobPostingInfo: {
          title: 'Investment Analyst',
          jobDescription: '<p>Underwriting support.</p><ul><li>Excel</li></ul>',
          location: 'Dallas, TX',
          postedOn: 'Posted 2 Days Ago',
          externalUrl: 'https://cbre.wd1.myworkdayjobs.com/en-US/CBRE_Careers/job/keep'
        }
      }
    });

    const jobs = await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', {
      fetchImpl
    });

    // One list page plus exactly one detail request, not three.
    expect(calls).toHaveLength(2);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.description).toContain('- Excel');
    expect(jobs[0]?.applyUrl).toBe(
      'https://cbre.wd1.myworkdayjobs.com/en-US/CBRE_Careers/job/keep'
    );
    expect(jobs[0]?.ats).toBe('workday');
  });

  it('joins the detail locations so multi-site postings can be resolved', async () => {
    const { fetchImpl } = fakeWorkday(
      [{ title: 'Analyst', externalPath: '/job/multi', locationsText: '3 Locations' }],
      {
        '/job/multi': {
          jobPostingInfo: {
            title: 'Analyst',
            jobDescription: '<p>Work.</p>',
            location: 'New York, NY',
            additionalLocations: ['Austin, TX', 'Chicago, IL']
          }
        }
      }
    );

    const jobs = await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', {
      fetchImpl
    });
    expect(jobs[0]?.location).toBe('New York, NY; Austin, TX; Chicago, IL');
  });

  it('drops a posting whose detail fails without failing the firm', async () => {
    const { fetchImpl } = fakeWorkday([
      { title: 'Investment Analyst', externalPath: '/job/gone', locationsText: 'Dallas, TX' },
      { title: 'Development Analyst', externalPath: '/job/ok', locationsText: 'Austin, TX' }
    ], {
      '/job/ok': {
        jobPostingInfo: { title: 'Development Analyst', jobDescription: '<p>x</p>', location: 'Austin, TX' }
      }
    });

    const jobs = await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', {
      fetchImpl,
      retries: 0
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.title).toBe('Development Analyst');
  });

  it('respects the page cap', async () => {
    const listings = Array.from({ length: 200 }, (_, i) => ({
      title: 'Director',
      externalPath: `/job/${i}`,
      locationsText: 'Dallas, TX'
    }));
    const { fetchImpl, calls } = fakeWorkday(listings);

    await fetchWorkday('CBRE', 'cbre.wd1.myworkdayjobs.com', 'cbre/CBRE_Careers', {
      fetchImpl,
      maxPages: 2
    });

    expect(calls).toHaveLength(2);
  });
});
