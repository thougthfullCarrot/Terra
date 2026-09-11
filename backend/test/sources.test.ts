import { describe, expect, it, vi } from 'vitest';
import { fetchGreenhouse, greenhouseUrl, parseGreenhouse } from '../src/collector/sources/greenhouse.js';
import { fetchLever, leverUrl, parseLever } from '../src/collector/sources/lever.js';
import { fetchJson, HttpError } from '../src/lib/http.js';

const greenhousePayload = {
  jobs: [
    {
      id: 4567,
      title: 'Investment Analyst Intern',
      updated_at: '2026-09-09T12:00:00Z',
      first_published: '2026-09-10T08:00:00Z',
      location: { name: 'Dallas, TX' },
      content:
        '<p>Summer 2027 analyst internship.</p><p>Qualifications</p><ul><li>Rising junior or senior</li><li>Argus Enterprise exposure preferred</li></ul>',
      absolute_url: 'https://boards.greenhouse.io/lonestar/jobs/4567',
      metadata: [{ name: 'Seniority Level', value: 'Internship' }]
    },
    {
      id: 4568,
      title: 'Missing url',
      location: { name: 'Austin, TX' },
      content: '<p>No apply link.</p>'
    }
  ]
};

const leverPayload = [
  {
    id: 'abc',
    text: 'Development Analyst',
    createdAt: 1_757_500_000_000,
    categories: { location: 'Houston, TX', commitment: 'Full-time', team: 'Development' },
    descriptionPlain: 'Work alongside project managers on mixed-use developments.',
    lists: [
      {
        text: 'Requirements',
        content: '<ul><li>Real estate or construction management student</li><li>Reads site plans</li></ul>'
      }
    ],
    hostedUrl: 'https://jobs.lever.co/bayou/abc'
  }
];

describe('greenhouse', () => {
  it('builds the documented board url', () => {
    expect(greenhouseUrl('lonestar')).toBe(
      'https://boards-api.greenhouse.io/v1/boards/lonestar/jobs?content=true'
    );
  });

  it('maps a board payload to raw jobs', () => {
    const jobs = parseGreenhouse('Lone Star Capital Partners', greenhousePayload);

    expect(jobs).toHaveLength(1); // the entry with no apply url is dropped
    const job = jobs[0]!;
    expect(job.title).toBe('Investment Analyst Intern');
    expect(job.firm).toBe('Lone Star Capital Partners');
    expect(job.location).toBe('Dallas, TX');
    expect(job.applyUrl).toBe('https://boards.greenhouse.io/lonestar/jobs/4567');
    expect(job.level).toBe('Internship');
    expect(job.ats).toBe('greenhouse');
    // first_published wins over updated_at.
    expect(job.postedAt?.toISOString()).toBe('2026-09-10T08:00:00.000Z');
    expect(job.description).toContain('- Rising junior or senior');
  });

  it('falls back to offices when location is absent', () => {
    const jobs = parseGreenhouse('Firm', {
      jobs: [
        {
          id: 1,
          title: 'Analyst',
          offices: [{ name: 'Austin', location: 'Austin, TX' }],
          absolute_url: 'https://example.com/1'
        }
      ]
    });
    expect(jobs[0]?.location).toBe('Austin, TX');
  });

  it('tolerates an empty board', () => {
    expect(parseGreenhouse('Firm', {})).toEqual([]);
    expect(parseGreenhouse('Firm', { jobs: [] })).toEqual([]);
  });

  it('fetches through the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(greenhousePayload), { status: 200 }));
    const jobs = await fetchGreenhouse('Lone Star Capital Partners', 'lonestar', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(jobs).toHaveLength(1);
  });
});

describe('lever', () => {
  it('builds the documented postings url', () => {
    expect(leverUrl('bayou')).toBe('https://api.lever.co/v0/postings/bayou?mode=json');
  });

  it('maps a postings payload to raw jobs', () => {
    const jobs = parseLever('Bayou Ridge Development', leverPayload);
    const job = jobs[0]!;

    expect(job.title).toBe('Development Analyst');
    expect(job.location).toBe('Houston, TX');
    expect(job.level).toBe('Full-time');
    expect(job.applyUrl).toBe('https://jobs.lever.co/bayou/abc');
    // Lists are reassembled with their headings so requirements stay findable.
    expect(job.description).toContain('Requirements');
    expect(job.description).toContain('- Reads site plans');
  });

  it('prefers allLocations when a posting lists several', () => {
    const jobs = parseLever('Firm', [
      {
        text: 'Analyst',
        categories: { allLocations: ['New York, NY', 'Dallas, TX'] },
        hostedUrl: 'https://example.com/x'
      }
    ]);
    expect(jobs[0]?.location).toBe('New York, NY; Dallas, TX');
  });

  it('fetches through the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(leverPayload), { status: 200 }));
    const jobs = await fetchLever('Bayou Ridge Development', 'bayou', {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(jobs).toHaveLength(1);
  });
});

describe('fetchJson', () => {
  it('does not retry a 404, because a wrong slug will not fix itself', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(
      fetchJson('https://example.com/x', { fetchImpl: fetchImpl as unknown as typeof fetch, retries: 3 })
    ).rejects.toBeInstanceOf(HttpError);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 500 and succeeds', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      return calls < 2
        ? new Response('boom', { status: 500 })
        : new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await fetchJson<{ ok: boolean }>('https://example.com/x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 2,
      baseDelayMs: 1
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 503 }));
    await expect(
      fetchJson('https://example.com/x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        retries: 1,
        baseDelayMs: 1
      })
    ).rejects.toThrow(/503/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
