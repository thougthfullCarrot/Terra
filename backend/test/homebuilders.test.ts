import { describe, expect, it, vi } from 'vitest';
import { classifyKind } from '../src/collector/seniority.js';
import { classifySector } from '../src/collector/sector.js';
import { normalize } from '../src/collector/normalize.js';
import { runCollector } from '../src/collector/run.js';
import { loadFirmSeed, SEED_PATHS } from '../src/collector/firmSeed.js';
import { detectAts } from '../src/collector/atsDetect.js';
import { fetchWorkable, parseWorkable, workableUrl, type WorkableResponse } from '../src/collector/sources/workable.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import type { RawJob } from '../src/types.js';

const now = new Date('2026-10-05T00:00:00Z');

describe('homebuilder titles', () => {
  it('lets the entry-level builder seats through', () => {
    for (const title of [
      'Assistant Superintendent',
      'New Home Sales Associate',
      'Construction Coordinator',
      'Land Analyst',
      'Land Acquisition Analyst',
      'Purchasing Coordinator',
      'Assistant Construction Manager',
      'Superintendent in Training',
      'Construction Manager Trainee',
      'Early Career Construction Program',
      'Sales Assistant'
    ]) {
      expect(classifyKind(title), title).toBe('Entry-level');
    }
    expect(classifyKind('2027 Summer Construction Management Internship - Austin, TX')).toBe('Internship');
  });

  it('keeps the senior builder seats out', () => {
    for (const title of ['Superintendent', 'Construction Manager', 'Senior Land Analyst', 'Division President', 'Area Sales Manager']) {
      expect(classifyKind(title), title).toBeNull();
    }
  });

  it('files builder roles from search sources under Homebuilder by keyword', () => {
    expect(classifySector('Assistant Superintendent', 'Build new homes for a production builder.').sector).toBe('Homebuilder');
    expect(classifySector('New Home Sales Associate', 'Show model homes to homebuyers.').sector).toBe('Homebuilder');
  });
});

describe('a firm row that pins a sector', () => {
  const raw: RawJob = {
    title: 'Land Acquisition Analyst',
    firm: 'Perry Homes',
    location: 'Houston, Texas',
    description: 'Underwriting for land acquisitions and due diligence.',
    applyUrl: 'https://apply.workable.com/j/ABC',
    ats: 'workable'
  };

  it('wins over the keyword guess', () => {
    const guessed = normalize(raw, now);
    expect(guessed.ok && guessed.posting.sector).toBe('Investment');

    const pinned = normalize({ ...raw, sector: 'Homebuilder' }, now);
    expect(pinned.ok && pinned.posting.sector).toBe('Homebuilder');
    expect(pinned.ok && pinned.sectorGuessed).toBe(false);
  });

  it('is applied by the collector to every posting from that firm', async () => {
    const firms: FirmRow[] = [
      { id: 1, name: 'Perry Homes', ats: 'workable', atsSlug: 'perryhomes', active: true, slugVerified: true, sector: 'Homebuilder' }
    ];
    const store = new MemoryStore(firms);
    await runCollector({ store, now, fetcher: async () => [raw] });
    expect([...store.postings.values()].map((posting) => posting.sector)).toEqual(['Homebuilder']);
  });
});

describe('workable', () => {
  const payload: WorkableResponse = {
    name: 'Perry Homes',
    jobs: [
      {
        title: '2027 Summer Construction Management Internship - Austin, TX',
        shortcode: '27EC52A0A7',
        url: 'https://apply.workable.com/j/27EC52A0A7',
        published_on: '2026-09-16',
        city: 'Austin',
        state: 'Texas',
        country: 'United States',
        experience: 'Internship',
        description: '<p>Provides general support to the Construction Management Team.</p>'
      },
      {
        title: 'Area Sales Manager',
        url: 'https://apply.workable.com/j/5624C6A06F',
        experience: 'Associate',
        locations: [{ city: 'Sarasota', region: 'Florida', country: 'United States' }]
      },
      { title: 'No link' }
    ]
  };

  it('builds the widget url', () => {
    expect(workableUrl('mi-homes')).toBe('https://apply.workable.com/api/v1/widget/accounts/mi-homes?details=true');
  });

  it('maps the board to raw jobs', () => {
    const jobs = parseWorkable('Perry Homes', payload);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      title: '2027 Summer Construction Management Internship - Austin, TX',
      firm: 'Perry Homes',
      location: 'Austin, Texas',
      description: 'Provides general support to the Construction Management Team.',
      applyUrl: 'https://apply.workable.com/j/27EC52A0A7',
      level: 'Internship',
      ats: 'workable'
    });
    expect(jobs[0]!.postedAt?.toISOString()).toBe('2026-09-16T00:00:00.000Z');
    // 'Associate' is above entry level on Workable's ladder, so the title decides.
    expect(jobs[1]).toMatchObject({ location: 'Sarasota, Florida', level: undefined });
  });

  it('keeps Texas internships and drops the rest', () => {
    const kept = parseWorkable('Perry Homes', payload).map((job) => normalize(job, now));
    expect(kept.map((result) => result.ok)).toEqual([true, false]);
  });

  it('fetches through the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 }));
    const jobs = await fetchWorkable('Perry Homes', 'perryhomes', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(jobs).toHaveLength(2);
    expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toBe(workableUrl('perryhomes'));
  });

  it('is detected from a careers page link', () => {
    expect(detectAts('https://apply.workable.com/perryhomes/')).toMatchObject({ ats: 'workable', supported: true, slug: 'perryhomes' });
    expect(detectAts('https://apply.workable.com/j/27EC52A0A7')).toMatchObject({ ats: 'workable', slug: null });
  });
});

describe('the homebuilder seed', () => {
  it('pins every builder to the Homebuilder sector', async () => {
    const firms = await loadFirmSeed(SEED_PATHS);
    const builders = firms.filter((firm) => firm.sector === 'Homebuilder');
    expect(builders.map((firm) => firm.name)).toContain('Lennar');
    expect(builders.map((firm) => firm.name)).toContain('Perry Homes');
    // The CRE firms are untouched, and ids run on across files.
    expect(firms.find((firm) => firm.name === 'JLL')?.sector).toBeNull();
    expect(new Set(firms.map((firm) => firm.id)).size).toBe(firms.length);
    for (const firm of builders) {
      if (firm.ats === 'workday' || firm.ats === 'icims') expect(firm.atsHost, firm.name).toBeTruthy();
    }
  });
});
