import { describe, expect, it } from 'vitest';
import { detectAts } from '../src/collector/atsDetect.js';
import { domainCandidates } from '../src/collector/domainCandidates.js';
import { careersCandidates, extractLinks } from '../src/collector/careersLinks.js';

describe('detectAts', () => {
  it('reads a Greenhouse board slug', () => {
    expect(detectAts('https://boards.greenhouse.io/streamrealty')).toMatchObject({
      ats: 'greenhouse',
      supported: true,
      slug: 'streamrealty'
    });
  });

  it('reads the slug out of a Greenhouse embed, where it is a query parameter', () => {
    expect(
      detectAts('https://boards.greenhouse.io/embed/job_board?for=griffinpartners&b=1')
    ).toMatchObject({ ats: 'greenhouse', slug: 'griffinpartners' });
  });

  it('handles the newer job-boards and EU Greenhouse hosts', () => {
    expect(detectAts('https://job-boards.greenhouse.io/cortland/jobs/123')?.slug).toBe('cortland');
    expect(detectAts('https://boards.eu.greenhouse.io/someco')?.slug).toBe('someco');
  });

  it('reads a Lever slug', () => {
    expect(detectAts('https://jobs.lever.co/velocis/abc-123')).toMatchObject({
      ats: 'lever',
      supported: true,
      slug: 'velocis'
    });
  });

  it('reads a Workday tenant and site, which is what the fetcher needs', () => {
    const match = detectAts(
      'https://cbre.wd1.myworkdayjobs.com/en-US/CBRE_Careers/job/Dallas/Analyst_R1'
    );
    expect(match).toMatchObject({
      ats: 'workday',
      supported: true,
      slug: 'cbre/CBRE_Careers',
      host: 'cbre.wd1.myworkdayjobs.com'
    });
  });

  it('handles a Workday url with no locale segment', () => {
    expect(detectAts('https://greystar.wd5.myworkdayjobs.com/Greystar_Careers')?.slug).toBe(
      'greystar/Greystar_Careers'
    );
  });

  it('reads an iCIMS tenant', () => {
    expect(detectAts('https://careers-hillwood.icims.com/jobs/1234/analyst')).toMatchObject({
      ats: 'icims',
      supported: true
    });
  });

  it('flags a platform with no fetcher rather than ignoring it', () => {
    // These counts are the whole point: an unsupported platform that shows up
    // ten times is the next fetcher worth writing.
    expect(detectAts('https://someco.jobvite.com/careers')).toMatchObject({ ats: 'jobvite', supported: false });
    expect(detectAts('https://someco.bamboohr.com/careers')?.ats).toBe('bamboohr');
    expect(detectAts('https://sjobs.brassring.com/x')).toBeNull(); // unknown, not guessed
  });

  it('returns null for ordinary links and for junk', () => {
    expect(detectAts('https://griffinpartners.com/about')).toBeNull();
    expect(detectAts('not a url')).toBeNull();
    expect(detectAts('')).toBeNull();
  });
});

describe('domainCandidates', () => {
  it('leads with the whole name run together', () => {
    expect(domainCandidates('Griffin Partners')[0]).toBe('griffinpartners.com');
  });

  it('offers the shortened form firms actually use', () => {
    // Stream Realty Partners is streamrealty.com.
    expect(domainCandidates('Stream Realty Partners')).toContain('streamrealty.com');
  });

  it('drops corporate suffixes from the domain', () => {
    expect(domainCandidates('Midway Companies')).toContain('midway.com');
  });

  it('spells out an ampersand', () => {
    expect(domainCandidates('Barshop & Oles')).toContain('barshopandoles.com');
  });

  it('returns nothing for an empty name', () => {
    expect(domainCandidates('')).toEqual([]);
  });
});

describe('extractLinks', () => {
  it('resolves relative hrefs against the page', () => {
    const links = extractLinks('<a href="/careers">Careers</a>', 'https://example.com/about');
    expect(links).toContain('https://example.com/careers');
  });

  it('handles single quotes and bare hrefs', () => {
    const links = extractLinks(
      "<a href='/a'>a</a><a href=/b>b</a>",
      'https://example.com/'
    );
    expect(links).toEqual(
      expect.arrayContaining(['https://example.com/a', 'https://example.com/b'])
    );
  });

  it('skips anchors, mailto and javascript links', () => {
    const links = extractLinks(
      '<a href="#top">t</a><a href="mailto:a@b.c">m</a><a href="javascript:void(0)">j</a>',
      'https://example.com/'
    );
    expect(links).toEqual([]);
  });
});

describe('careersCandidates', () => {
  const origin = 'https://example.com';

  it('prefers a bare careers path over a deep one', () => {
    const ranked = careersCandidates(
      [
        'https://example.com/about/team/jobs/senior-analyst-posting',
        'https://example.com/careers'
      ],
      origin
    );
    expect(ranked[0]).toBe('https://example.com/careers');
  });

  it('keeps a careers subdomain', () => {
    expect(careersCandidates(['https://careers.example.com/jobs'], origin)).toHaveLength(1);
  });

  it('drops links to other sites', () => {
    expect(careersCandidates(['https://linkedin.com/company/example/jobs'], origin)).toEqual([]);
  });

  it('drops links that are not about jobs', () => {
    expect(careersCandidates(['https://example.com/properties'], origin)).toEqual([]);
  });
});

describe('domain confirmation', () => {
  /**
   * The rule a single-word match broke. `domainCandidates('Jackson-Shaw')`
   * offers `jackson.com`, which belongs to Jackson National Life — and on a
   * one-word match the crawler reported their Workday tenant as the Dallas
   * developer Jackson-Shaw's. A domain is a shared namespace like any other.
   */
  it('offers a first-word domain that could belong to anyone', () => {
    // The candidate itself is fine to try; what matters is that confirming it
    // requires every distinctive word, which discover-ats now does.
    expect(domainCandidates('Jackson-Shaw')).toContain('jackson.com');
    expect(domainCandidates('Jackson-Shaw')).toContain('jacksonshaw.com');
  });

  it('keeps both words available to confirm against', () => {
    // A page would have to contain 'jackson' AND 'shaw' to be accepted.
    const words = domainCandidates('Jackson-Shaw');
    expect(words[0]).toBe('jacksonshaw.com');
  });
});
