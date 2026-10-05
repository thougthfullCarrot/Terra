import { describe, expect, it } from 'vitest';
import { detectAts } from '../src/collector/atsDetect.js';
import { ashbyUrl, parseAshby } from '../src/collector/sources/ashby.js';
import {
  fetchSmartRecruiters,
  parseSmartRecruiters,
  smartRecruitersListUrl,
  srLocation
} from '../src/collector/sources/smartrecruiters.js';

describe('Ashby', () => {
  it('reads the public board API', () => {
    expect(ashbyUrl('stackline')).toBe('https://api.ashbyhq.com/posting-api/job-board/stackline');
    const jobs = parseAshby('Acme RE', {
      jobs: [
        {
          title: ' Acquisitions Analyst ',
          location: 'Dallas, TX',
          secondaryLocations: [{ location: 'Remote', address: { postalAddress: { addressLocality: 'Austin', addressRegion: 'Texas' } } }],
          employmentType: 'FullTime',
          publishedAt: '2026-09-30T12:00:00.000+00:00',
          jobUrl: 'https://jobs.ashbyhq.com/acme/123',
          descriptionPlain: 'Underwrite deals.'
        },
        { title: 'Hidden', jobUrl: 'https://jobs.ashbyhq.com/acme/9', isListed: false },
        { title: 'No link' }
      ]
    });
    expect(jobs).toEqual([
      {
        title: 'Acquisitions Analyst',
        firm: 'Acme RE',
        location: 'Dallas, TX; Remote (Austin, Texas)',
        description: 'Underwrite deals.',
        applyUrl: 'https://jobs.ashbyhq.com/acme/123',
        postedAt: new Date('2026-09-30T12:00:00Z'),
        level: 'FullTime',
        ats: 'ashby'
      }
    ]);
  });

  it('is detected from a careers page link', () => {
    expect(detectAts('https://jobs.ashbyhq.com/acme/123')).toMatchObject({ ats: 'ashby', supported: true, slug: 'acme' });
  });
});

describe('SmartRecruiters', () => {
  it('formats locations', () => {
    expect(srLocation({ city: 'Houston', region: 'TX', country: 'us' })).toBe('Houston, TX, US');
    expect(srLocation({ fullLocation: 'Dallas, TX, United States' })).toBe('Dallas, TX, United States');
    expect(srLocation(undefined)).toBe('');
  });

  it('builds a description from the job ad sections', () => {
    const [job] = parseSmartRecruiters('Acme RE', 'AcmeRE', [
      {
        id: '744000',
        name: 'Leasing Coordinator',
        releasedDate: '2026-09-01T10:00:00.000Z',
        location: { city: 'Austin', region: 'TX', country: 'us' },
        experienceLevel: { label: 'Entry Level' },
        jobAd: {
          sections: {
            companyDescription: { title: 'About us', text: '<p>We build.</p>' },
            jobDescription: { title: 'Job Description', text: '<p>Lease space.</p>' },
            qualifications: { title: 'Qualifications', text: '<ul><li>BA</li></ul>' }
          }
        }
      }
    ]);
    expect(job).toMatchObject({
      title: 'Leasing Coordinator',
      location: 'Austin, TX, US',
      applyUrl: 'https://jobs.smartrecruiters.com/AcmeRE/744000',
      level: 'Entry Level',
      ats: 'smartrecruiters'
    });
    expect(job!.description).toContain('Lease space.');
    expect(job!.description).toContain('Qualifications');
    expect(job!.description).not.toContain('We build.');
  });

  it('pages the list and reads details only for Texas postings', async () => {
    const calls: string[] = [];
    const page = (n: number, region: string) =>
      Array.from({ length: n }, (_, i) => ({ id: `${region}${i}`, name: `Role ${i}`, location: { city: 'X', region, country: 'us' } }));
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === smartRecruitersListUrl('Acme', 0)) return new Response(JSON.stringify({ totalFound: 102, content: [...page(99, 'CA'), ...page(1, 'TX')] }));
      if (url === smartRecruitersListUrl('Acme', 100)) return new Response(JSON.stringify({ totalFound: 102, content: page(2, 'Texas') }));
      if (url.includes('/postings/')) return new Response(JSON.stringify({ id: url.split('/').pop(), name: 'Detail', location: { city: 'Dallas', region: 'TX' } }));
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const jobs = await fetchSmartRecruiters('Acme', 'Acme', { fetchImpl });
    expect(jobs).toHaveLength(3);
    expect(calls.filter((c) => c.includes('/postings/'))).toHaveLength(3);
  });

  it('is detected from a careers page link', () => {
    expect(detectAts('https://jobs.smartrecruiters.com/AcmeRE/744000-leasing')).toMatchObject({
      ats: 'smartrecruiters',
      supported: true,
      slug: 'AcmeRE'
    });
  });
});
