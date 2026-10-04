import { describe, expect, it, vi } from 'vitest';
import {
  applyUrl,
  fetchIcims,
  jobUrl,
  locationCodes,
  pageCount,
  parseJobPage,
  parseSearchPage,
  portalHost,
  searchUrl,
  worthFetching,
  type IcimsStats
} from '../src/collector/sources/icims.js';

const HOST = 'careers-hines.icims.com';

/** One row as the iCIMS portal renders it, trimmed to what the parser reads. */
function row(id: number, slug: string, title: string, locations: string): string {
  return `
    <div class="row">
      <div class="col-xs-12 title">
        <a href="https://${HOST}/jobs/${id}/${slug}/job?in_iframe=1" class="iCIMS_Anchor" title="${id} - ${title}">
          <h3>${title}</h3>
        </a>
      </div>
      <div class="col-xs-6 header left">
        <span class="sr-only field-label">Job Locations</span>
        <span>${locations}</span>
      </div>
      <div class="col-xs-6 header right">
        <span class="sr-only field-label">ID</span>
        <span>2026-${id}</span>
      </div>
    </div>`;
}

function searchPage(rows: string[], page: number, pages: number): string {
  return `<html><body><div class="iCIMS_JobsTable">${rows.join('')}</div>
    <div class="iCIMS_Paging">Page <span>${page + 1}</span> of <span>${pages}</span></div>
    </body></html>`;
}

function jobPage(ld: Record<string, unknown> | null, extra = ''): string {
  const script = ld
    ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...ld })}</script>`
    : '';
  return `<html><head>
    <meta property="og:title" content="Leasing Analyst in Dallas, Texas | Careers at Hines" />
    ${script}</head><body>${extra}</body></html>`;
}

describe('portalHost', () => {
  it('uses ats_host when given, without scheme or path', () => {
    expect(portalHost('https://careers-hines.icims.com/jobs', 'careers-hines')).toBe(HOST);
  });

  it('falls back to <slug>.icims.com', () => {
    expect(portalHost(null, 'careers-hines')).toBe(HOST);
  });

  it('fails loudly on a firm row with neither', () => {
    expect(() => portalHost(null, '')).toThrow(/ats_host or ats_slug/);
  });
});

describe('urls', () => {
  const listing = { id: '14614', slug: 'leasing-analyst' };

  it('asks for the bare portal on list and job pages', () => {
    expect(searchUrl(HOST, 2)).toBe(`https://${HOST}/jobs/search?pr=2&in_iframe=1`);
    expect(jobUrl(HOST, listing)).toBe(`https://${HOST}/jobs/14614/leasing-analyst/job?in_iframe=1`);
  });

  it('applies through the public page, not the iframe one', () => {
    expect(applyUrl(HOST, listing)).toBe(`https://${HOST}/jobs/14614/leasing-analyst/job`);
  });
});

describe('locationCodes', () => {
  it('rewrites country-state-city codes the way resolveCity reads them', () => {
    expect(locationCodes('<span>US-TX-Houston | US-IL-Chicago</span>')).toBe(
      'Houston, TX; Chicago, IL'
    );
  });

  it('keeps multi-word cities whole and stops at the next field', () => {
    expect(locationCodes('<span>US-TX-Fort Worth</span><span>ID</span><span>2026-1</span>')).toBe(
      'Fort Worth, TX'
    );
  });

  it('keeps codes with no state', () => {
    expect(locationCodes('<span>UK-London</span>')).toBe('London, UK');
  });

  it('reads numeric regions and hyphenated cities outside the US', () => {
    expect(locationCodes('<span>FR-92-Neuilly-sur-Seine cedex | JP-13-Tokyo</span>')).toBe(
      'Neuilly-sur-Seine cedex, FR; Tokyo, JP'
    );
  });

  it('returns nothing when the row names no place', () => {
    expect(locationCodes('<span>ID</span> <span>2026-14614</span>')).toBe('');
  });
});

describe('parseSearchPage', () => {
  it('reads id, slug, title and location from each row', () => {
    const html = searchPage(
      [
        row(14633, 'leasing-professional---talisman', 'Leasing Professional - Talisman', 'US-WA-Redmond'),
        row(14632, 'senior-director', 'Senior Director - Finance', 'US-TX-Houston | US-IL-Chicago')
      ],
      0,
      1
    );

    expect(parseSearchPage(html)).toEqual([
      {
        id: '14633',
        slug: 'leasing-professional---talisman',
        title: 'Leasing Professional - Talisman',
        location: 'Redmond, WA'
      },
      {
        id: '14632',
        slug: 'senior-director',
        title: 'Senior Director - Finance',
        location: 'Houston, TX; Chicago, IL'
      }
    ]);
  });

  it('counts a job linked twice in its row once', () => {
    const html = row(1, 'analyst', 'Analyst', 'US-TX-Dallas').replace(
      '</div>\n    </div>',
      `</div><a href="/jobs/1/analyst/job?mode=apply">Apply</a></div>`
    );
    const listings = parseSearchPage(html);
    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe('Analyst');
  });

  it('falls back to the title attribute when the link has no text', () => {
    const html = `<a href="/jobs/7/x/job" title="7 - Development Associate"><img src="x.png"></a>`;
    expect(parseSearchPage(html)[0]?.title).toBe('Development Associate');
  });
});

describe('parseSearchPage on the live Hines layout', () => {
  /** Hines' real row order: location label first, then the title link, snippet, ID, category. */
  function liveRow(id: number, slug: string, title: string, locations: string): string {
    return `
      <li class="iCIMS_JobCardItem">
        <div class="col-xs-12 header left"><span class="sr-only field-label">Job Locations</span>
          <span>${locations}</span></div>
        <div class="col-xs-12 title">
          <a href="https://${HOST}/jobs/${id}/${slug}/job?in_iframe=1" title="${id} - ${title.replace('&', '&amp;')}">
            <span class="sr-only field-label">Title</span><h3>${title}</h3>
          </a>
        </div>
        <div class="col-xs-12 description">Backed by Hines, a global real estate firm…</div>
        <dl><dt>Job ID</dt><dd>2026-${id}</dd><dt>Category</dt><dd>Property Management</dd></dl>
      </li>`;
  }

  it('credits each row with its own location, not the next row\'s', () => {
    const html = `<div>Sort By... Job ID (Ascending) Title (Descending)</div><ul>${[
      liveRow(14633, 'leasing-professional---talisman', 'Leasing Professional - Talisman', 'US-WA-Redmond'),
      liveRow(14632, 'senior-director', 'Senior Director - Finance Strategy & Operations', 'US-TX-Houston | US-IL-Chicago'),
      liveRow(14631, 'operations-engineer', 'Operations Engineer', 'US-OH-Columbus')
    ].join('')}</ul>`;

    expect(parseSearchPage(html).map((l) => [l.title, l.location])).toEqual([
      ['Leasing Professional - Talisman', 'Redmond, WA'],
      ['Senior Director - Finance Strategy & Operations', 'Houston, TX; Chicago, IL'],
      ['Operations Engineer', 'Columbus, OH']
    ]);
  });
});

describe('pageCount', () => {
  it('reads "Page 1 of 10" through the spans around it', () => {
    expect(pageCount(searchPage([], 0, 10))).toBe(10);
  });

  it('is undefined when the page does not say', () => {
    expect(pageCount('<html></html>')).toBeUndefined();
  });
});

describe('worthFetching', () => {
  const base = { id: '1', slug: 's' };

  it('keeps an entry-level Texas listing', () => {
    expect(worthFetching({ ...base, title: 'Investment Analyst', location: 'Dallas, TX' })).toBe(true);
  });

  it('keeps an entry-level listing with no location yet, to judge on the detail page', () => {
    expect(worthFetching({ ...base, title: 'Investment Analyst', location: '' })).toBe(true);
  });

  it('drops senior titles and out-of-state locations before spending a request', () => {
    expect(worthFetching({ ...base, title: 'Senior Director', location: 'Houston, TX' })).toBe(false);
    expect(worthFetching({ ...base, title: 'Leasing Associate', location: 'Redmond, WA' })).toBe(false);
  });
});

describe('parseJobPage', () => {
  const listing = { id: '14614', slug: 'leasing-analyst', title: 'Leasing Analyst', location: 'Dallas, TX' };

  it('prefers the JobPosting JSON-LD', () => {
    const job = parseJobPage(
      'Hines',
      HOST,
      listing,
      jobPage({
        '@type': 'JobPosting',
        title: 'Leasing Analyst',
        datePosted: '2026-09-30T00:00:00Z',
        employmentType: ['INTERN'],
        description: '<p>Support the leasing team.</p><ul><li>Excel</li><li>Argus</li></ul>',
        jobLocation: [
          { '@type': 'Place', address: { addressLocality: 'Dallas', addressRegion: 'TX', addressCountry: 'US' } }
        ]
      })
    );

    expect(job).toEqual({
      title: 'Leasing Analyst',
      firm: 'Hines',
      location: 'Dallas, TX',
      description: 'Support the leasing team.\n- Excel\n- Argus',
      applyUrl: `https://${HOST}/jobs/14614/leasing-analyst/job`,
      postedAt: new Date('2026-09-30T00:00:00Z'),
      level: 'INTERN',
      ats: 'icims'
    });
  });

  it('reads an entity-escaped description', () => {
    const job = parseJobPage(
      'Hines',
      HOST,
      listing,
      jobPage({ '@type': 'JobPosting', title: 'Leasing Analyst', description: '&lt;p&gt;Hello&lt;/p&gt;' })
    );
    expect(job?.description).toBe('Hello');
  });

  it('finds a JobPosting inside an @graph', () => {
    const html = jobPage({ '@graph': [{ '@type': 'Organization' }, { '@type': 'JobPosting', title: 'Analyst' }] });
    expect(parseJobPage('Hines', HOST, listing, html)?.title).toBe('Analyst');
  });

  it('falls back to the portal markup and the list row without JSON-LD', () => {
    const job = parseJobPage(
      'Hines',
      HOST,
      { ...listing, location: '' },
      jobPage(
        null,
        `<div class="iCIMS_InfoMsg iCIMS_InfoMsg_Job"><h2>Overview</h2><p>Underwrite deals.</p></div>
         <div class="iCIMS_JobOptions"><a>Apply</a></div>`
      )
    );

    expect(job).toMatchObject({
      title: 'Leasing Analyst',
      location: 'Dallas, Texas',
      description: 'Overview\nUnderwrite deals.',
      postedAt: undefined,
      level: undefined
    });
  });
});

describe('fetchIcims', () => {
  /** A fake portal: list pages by `pr`, plus job pages by id. */
  function fakePortal(pages: string[][], jobs: Record<string, string>) {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url);
      urls.push(href);

      const pr = /[?&]pr=(\d+)/.exec(href)?.[1];
      if (pr !== undefined) {
        const rows = pages[Number(pr)] ?? [];
        return new Response(searchPage(rows, Number(pr), pages.length), { status: 200 });
      }

      const id = /\/jobs\/(\d+)\//.exec(href)?.[1] ?? '';
      return jobs[id]
        ? new Response(jobs[id], { status: 200 })
        : new Response('gone', { status: 410 });
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, urls };
  }

  const posting = (title: string, city: string) =>
    jobPage({
      '@type': 'JobPosting',
      title,
      description: `<p>${title}</p>`,
      jobLocation: { address: { addressLocality: city, addressRegion: 'TX' } }
    });

  it('pages through the board, filters on the list, and only opens survivors', async () => {
    const { fetchImpl, urls } = fakePortal(
      [
        [
          row(1, 'acquisitions-analyst', 'Acquisitions Analyst', 'US-TX-Houston'),
          row(2, 'senior-director', 'Senior Director', 'US-TX-Houston')
        ],
        [
          row(3, 'leasing-associate', 'Leasing Associate', 'US-WA-Redmond'),
          row(4, 'development-intern', 'Development Intern', 'US-TX-Austin')
        ]
      ],
      { '1': posting('Acquisitions Analyst', 'Houston'), '4': posting('Development Intern', 'Austin') }
    );
    const stats: IcimsStats = { listed: 0, considered: 0, fetched: 0 };

    const jobs = await fetchIcims('Hines', HOST, 'careers-hines', { fetchImpl, stats, retries: 0 });

    expect(jobs.map((job) => [job.title, job.location])).toEqual([
      ['Acquisitions Analyst', 'Houston, TX'],
      ['Development Intern', 'Austin, TX']
    ]);
    expect(stats).toMatchObject({ listed: 4, considered: 2, fetched: 2 });
    // Two list pages and two detail pages; the senior and out-of-state rows cost nothing.
    expect(urls).toHaveLength(4);
  });

  it('stops when a page adds nothing new, even if the page count is missing', async () => {
    const same = [row(1, 'analyst', 'Analyst', 'US-TX-Dallas')];
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).includes('/jobs/search')
        ? new Response(`<html>${same.join('')}</html>`, { status: 200 })
        : new Response(posting('Analyst', 'Dallas'), { status: 200 })
    ) as unknown as typeof fetch;

    const jobs = await fetchIcims('Hines', HOST, 'careers-hines', { fetchImpl, retries: 0 });

    expect(jobs).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('keeps walking past a page of repeats when the portal gives a page count', async () => {
    const { fetchImpl } = fakePortal(
      [
        [row(1, 'analyst', 'Analyst', 'US-TX-Dallas')],
        [row(1, 'analyst', 'Analyst', 'US-TX-Dallas')],
        [row(2, 'leasing-intern', 'Leasing Intern', 'US-TX-Austin')]
      ],
      { '1': posting('Analyst', 'Dallas'), '2': posting('Leasing Intern', 'Austin') }
    );

    const jobs = await fetchIcims('Hines', HOST, 'careers-hines', { fetchImpl, retries: 0 });
    expect(jobs.map((job) => job.title)).toEqual(['Analyst', 'Leasing Intern']);
  });

  it('drops a posting that closed between the list and the detail request', async () => {
    const { fetchImpl } = fakePortal([[row(9, 'analyst', 'Analyst', 'US-TX-Dallas')]], {});
    const stats: IcimsStats = { listed: 0, considered: 0, fetched: 0 };

    await expect(
      fetchIcims('Hines', HOST, 'careers-hines', { fetchImpl, stats, retries: 0 })
    ).resolves.toEqual([]);
    expect(stats).toMatchObject({ listed: 1, considered: 1, fetched: 0 });
  });

  it('fails the firm when the list page itself is missing', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchIcims('Hines', HOST, 'careers-hines', { fetchImpl, retries: 0 })).rejects.toThrow(
      /404/
    );
  });
});
