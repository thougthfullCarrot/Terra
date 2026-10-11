import { describe, expect, it } from 'vitest';
import { resolveCity, STATEWIDE } from '../src/collector/texas.js';
import { entryLevelEvident, experienceRequirement, withinExperienceLimit } from '../src/collector/experience.js';
import { classifyKind } from '../src/collector/seniority.js';
import { classifySector } from '../src/collector/sector.js';
import { creRelevance } from '../src/collector/relevance.js';
import { normalize } from '../src/collector/normalize.js';
import { level, parseUsajobs, usajobsCredentials, usajobsUrl, type UsajobsJob } from '../src/collector/sources/usajobs.js';
import { embeddedUrls, detectAts } from '../src/collector/atsDetect.js';
import { parseCandidates, parseFirmCandidates } from '../src/collector/firmCandidates.js';
import { buildSnapshot } from '../src/site/snapshot.js';
import { runCollector } from '../src/collector/run.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import type { RawJob } from '../src/types.js';

const now = new Date('2026-10-11T00:00:00Z');

describe('jobs anywhere in Texas', () => {
  it('keeps towns outside the tracked metros under their own name', () => {
    expect(resolveCity('Corpus Christi, TX')).toBe('Corpus Christi');
    expect(resolveCity('Tyler, Texas')).toBe('Tyler');
    expect(resolveCity('McAllen, TX 78501')).toBe('McAllen');
    expect(resolveCity('Waco')).toBe('Waco');
    expect(resolveCity('Big Spring, TX')).toBe('Big Spring');
    expect(resolveCity('Kountze, TX')).toBe('Kountze');
    expect(resolveCity('US-TX-Amarillo')).toBe('Amarillo');
  });

  it('rolls the new suburbs up to their metro', () => {
    expect(resolveCity('Cypress, TX')).toBe('Houston');
    expect(resolveCity('Prosper, TX')).toBe('Dallas');
    expect(resolveCity('Leander, TX')).toBe('Austin');
    expect(resolveCity('Mansfield, TX')).toBe('Fort Worth');
  });

  it('labels a Texas seat with no town as statewide', () => {
    expect(resolveCity('Texas')).toBe(STATEWIDE);
    expect(resolveCity('Remote - TX')).toBe(STATEWIDE);
    expect(resolveCity('Multiple Locations, Texas, United States')).toBe(STATEWIDE);
  });

  it('still rejects other states and bare remote', () => {
    expect(resolveCity('Paris, France')).toBeNull();
    expect(resolveCity('Paris')).toBeNull();
    expect(resolveCity('Richmond, VA')).toBeNull();
    expect(resolveCity('Mansfield, OH')).toBeNull();
    expect(resolveCity('Remote')).toBeNull();
    expect(resolveCity('Remote - US')).toBeNull();
    expect(resolveCity('Texarkana, AR')).toBeNull();
    expect(resolveCity('Victoria, BC, Canada')).toBeNull();
  });

  it('trusts an ambiguous town name only with a TX marker', () => {
    expect(resolveCity('Paris, TX')).toBe('Paris');
    expect(resolveCity('Victoria, TX')).toBe('Victoria');
    expect(resolveCity('Victoria')).toBeNull();
  });

  it('lists every town with a job in the city filter, after the tracked ones', () => {
    const job = normalize(
      { title: 'Development Intern', firm: 'X', location: 'Corpus Christi, TX', description: '', applyUrl: 'https://x/1', ats: 'greenhouse' },
      now
    );
    if (!job.ok) throw new Error('expected a posting');
    const snapshot = buildSnapshot([job.posting], { ranAt: now, firms: 1, firmsFailed: 0 } as never);
    expect(snapshot.cities.slice(0, 2)).toEqual(['Dallas', 'Fort Worth']);
    expect(snapshot.cities.at(-1)).toBe('Corpus Christi');
  });
});

describe('required versus preferred experience', () => {
  const cases: [string, number | null, boolean][] = [
    ['0-2 years of experience required. 3+ years preferred.', 2, true],
    ['Required: 1-2 years of experience\nPreferred: 3-5 years of experience in CRE', 2, true],
    ['Requirements\n- Bachelor’s degree\nPreferred Qualifications\n- 3+ years of real estate experience', null, true],
    ['3 years of experience preferred.', null, true],
    ['Minimum of 3 years of experience required, 5 preferred.', 3.5, false],
    ['2+ years of experience in property management.', 2.5, false],
    ['At least two (2) years of underwriting experience is a plus.', null, true],
    ['Qualifications\n3-5 years of acquisitions experience', 5, false],
    ['Experience: 3+ years', 3.5, false],
    ['One year of internship experience required.', null, true],
    ['2 years of academic project experience.', null, true],
    ['Up to 2 years of experience.', 2, true]
  ];

  it.each(cases)('%s', (text, required, ok) => {
    expect(experienceRequirement(text).required).toBe(required);
    expect(withinExperienceLimit(text)).toBe(ok);
  });

  it('records each figure and whether it binds', () => {
    const figures = experienceRequirement('1-2 years of experience required; 4 years of experience preferred.').figures;
    expect(figures.map((f) => [f.years, f.required])).toEqual([
      [2, true],
      [4, false]
    ]);
  });
});

describe('postings with no stated experience', () => {
  const raw: RawJob = {
    title: 'Property Accountant',
    firm: 'Asset Living',
    location: 'Houston, TX',
    description: 'Prepare monthly financials for our multifamily communities.',
    applyUrl: 'https://example.com/lc',
    ats: 'workday'
  };

  it('go to review when nothing says entry level', () => {
    const result = normalize(raw, now);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('needs-review');
  });

  it('publish when the text says entry level or new graduates', () => {
    expect(normalize({ ...raw, description: 'Entry-level role; we will train.' }, now).ok).toBe(true);
    expect(normalize({ ...raw, description: 'Open to recent graduates.' }, now).ok).toBe(true);
  });

  it('publish internships and trainee seats on the title alone', () => {
    expect(normalize({ ...raw, title: 'Real Estate Development Intern', description: '' }, now).ok).toBe(true);
    expect(normalize({ ...raw, title: 'Appraiser Trainee', description: '' }, now).ok).toBe(true);
    expect(entryLevelEvident('Analyst I', '')).toBe(true);
  });

  it('publish when the board itself says entry level', () => {
    expect(normalize({ ...raw, level: 'Entry level' }, now).ok).toBe(true);
  });

  it('reject a required bar above two years with its own reason', () => {
    expect(normalize({ ...raw, description: '3+ years of leasing experience required.' }, now)).toEqual({ ok: false, reason: 'over-experience' });
  });

  it('are counted as review, not published, by the collector', async () => {
    const firms: FirmRow[] = [{ id: 1, name: 'Asset Living', ats: 'workday', atsSlug: 'a/b', active: true, slugVerified: true }];
    const store = new MemoryStore(firms);
    const report = await runCollector({
      store,
      now,
      fetcher: async () => [raw, { ...raw, title: 'Accounting Intern', applyUrl: 'https://example.com/li' }]
    });
    expect(report.kept).toBe(1);
    expect(report.reviewed).toBe(1);
    expect(report.review[0]).toMatchObject({ reason: 'experience-unstated', source: 'workday' });
    expect(report.bySource.workday).toMatchObject({ fetched: 2, kept: 1, review: 1 });
    expect(report.kinds).toEqual({ Internship: 1, 'Entry-level': 0 });
    expect(report.firmsWithOpenings).toBe(1);
    expect(store.postings.size).toBe(1);
  });
});

describe('wider CRE title recognition', () => {
  it.each([
    'Leasing Consultant',
    'Leasing Agent',
    'Property Accountant',
    'Staff Accountant',
    'Property Administrator',
    'Land Acquisition Specialist',
    'Development Coordinator',
    'Acquisitions Analyst',
    'Commercial Credit Analyst',
    'Assistant Property Manager',
    'Construction Manager Trainee',
    'Realty Specialist',
    'Property Tax Consultant',
    'Staff Appraiser',
    'Research Analyst',
    'Analyst, Class of 2027'
  ])('passes the title gate: %s', (title) => {
    expect(classifyKind(title)).not.toBeNull();
  });

  it.each(['Property Manager', 'Leasing Manager', 'Senior Property Accountant', 'Accountant II', 'Analyst 2', 'Director of Development', 'Project Manager'])(
    'still rejects: %s',
    (title) => {
      expect(classifyKind(title)).toBeNull();
    }
  );
});

describe('CRE relevance', () => {
  it('drops unrelated functions at a real estate firm', () => {
    expect(creRelevance('IT Support Intern', '', false)).toBe('off-topic');
    expect(creRelevance('Marketing Coordinator', '', false)).toBe('off-topic');
    expect(creRelevance('Software Engineering Intern', '', false)).toBe('off-topic');
    expect(creRelevance('Maintenance Technician', '', false)).toBe('off-topic');
  });

  it('keeps real estate seats, including generic titles at a real estate firm', () => {
    expect(creRelevance('Leasing Marketing Coordinator', '', false)).toBe('cre');
    expect(creRelevance('Project Coordinator', '', false)).toBe('cre');
    expect(creRelevance('Building Engineer', '', false)).toBe('cre');
  });

  it('asks a bank job to show real estate work in its description', () => {
    expect(creRelevance('Credit Analyst', '', true)).toBe('cre');
    expect(creRelevance('Analyst', 'Supports our commercial real estate lending team on CRE loans.', true)).toBe('cre');
    expect(creRelevance('Analyst', 'Our bank also finances real estate.', true)).toBe('off-topic');
  });
});

describe('USAJOBS', () => {
  const job = (over: Partial<UsajobsJob> = {}, details: Record<string, unknown> = {}): UsajobsJob => ({
    PositionID: 'X-1',
    PositionTitle: 'Realty Specialist',
    PositionURI: 'https://www.usajobs.gov/job/800000001',
    PositionLocation: [{ LocationName: 'Fort Worth, Texas', CountrySubDivisionCode: 'Texas' }],
    OrganizationName: 'U.S. Army Corps of Engineers',
    DepartmentName: 'Department of the Army',
    JobCategory: [{ Name: 'Realty', Code: '1170' }],
    JobGrade: [{ Code: 'GS' }],
    PositionRemuneration: [{ MinimumRange: '47016', MaximumRange: '74935', Description: 'Per Year' }],
    PublicationStartDate: '2026-10-01T00:00:00',
    ApplicationCloseDate: '2026-10-20T23:59:59',
    QualificationSummary: 'One year of specialized experience equivalent to GS-5, or one year of graduate education.',
    UserArea: { Details: { JobSummary: 'Acquire and lease real property.', LowGrade: '5', HighGrade: '9', HiringPath: ['public'], ...details } },
    ...over
  });

  it('needs a free key and the email it was issued to, from the environment', () => {
    expect(usajobsCredentials({})).toBeNull();
    expect(usajobsCredentials({ USAJOBS_API_KEY: 'k', USAJOBS_EMAIL: 'a@b.edu' })).toEqual({ apiKey: 'k', email: 'a@b.edu' });
    expect(usajobsUrl({ JobCategoryCode: '1170;1171;1173', pinned: true })).toContain('LocationName=Texas');
  });

  it('reads the grade as the level', () => {
    expect(level(job())).toBe('Entry level');
    expect(level(job({}, { LowGrade: '11', HighGrade: '12' }))).toBe('Mid-Senior');
    expect(level(job({}, { HiringPath: ['student'] }))).toBe('Internship');
  });

  it('keeps Texas postings, pins the series sector, and publishes GS-5 work', () => {
    const [raw] = parseUsajobs({ SearchResult: { SearchResultItems: [{ MatchedObjectDescriptor: job() }] } });
    expect(raw).toMatchObject({ firm: 'U.S. Army Corps of Engineers', location: 'Fort Worth, Texas', sector: 'Asset Mgmt', ats: 'usajobs' });
    const result = normalize(raw!, now);
    expect(result.ok && result.posting).toMatchObject({ city: 'Fort Worth', kind: 'Entry-level', source: 'Posted on USAJOBS' });
  });

  it('drops GS-11 and out-of-state postings', () => {
    const [senior] = parseUsajobs({ SearchResult: { SearchResultItems: [{ MatchedObjectDescriptor: job({}, { LowGrade: '11' }) }] } });
    expect(normalize(senior!, now)).toEqual({ ok: false, reason: 'not-entry-level' });
    const away = parseUsajobs({
      SearchResult: { SearchResultItems: [{ MatchedObjectDescriptor: job({ PositionLocation: [{ LocationName: 'Denver, Colorado', CountrySubDivisionCode: 'Colorado' }] }) }] }
    });
    expect(away).toEqual([]);
  });

  it('makes keyword hits outside the real estate series prove relevance', () => {
    const [raw] = parseUsajobs(
      { SearchResult: { SearchResultItems: [{ MatchedObjectDescriptor: job({ PositionTitle: 'Program Assistant', JobCategory: [{ Code: '0303' }] }) }] } },
      false
    );
    expect(raw?.creOnly).toBe(true);
  });
});

describe('employer discovery', () => {
  it('finds boards embedded by script, not only by link', () => {
    const html = '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=embreypartners"></script>';
    const [url] = embeddedUrls(html);
    expect(detectAts(url!)).toMatchObject({ ats: 'greenhouse', slug: 'embreypartners' });
  });

  it('reads candidate lines with a website, sector and markets', () => {
    const text = 'Embrey Partners | https://embreydc.com/ | Development | San Antonio; Austin\nHines # comment\nhines';
    expect(parseCandidates(text)).toEqual([
      { name: 'Embrey Partners', domain: 'embreydc.com', sector: 'Development', markets: 'San Antonio; Austin' },
      { name: 'Hines' }
    ]);
    expect(parseFirmCandidates(text)).toEqual(['Embrey Partners', 'Hines']);
  });
});

describe('no stretch category', () => {
  it('has no 3 to 5 year bucket anywhere in the posting kinds', () => {
    const kinds = new Set<string>();
    for (const title of ['Analyst', 'Intern', 'Associate', 'Senior Analyst']) {
      const kind = classifyKind(title);
      if (kind) kinds.add(kind);
    }
    expect([...kinds].sort()).toEqual(['Entry-level', 'Internship']);
  });
});

describe('fixes from the first measured run', () => {
  it('maps counties to their metro, so one seat is not listed twice', () => {
    expect(resolveCity('Bexar County, Texas')).toBe('San Antonio');
    expect(resolveCity('Collin County')).toBe('Dallas');
    expect(resolveCity('Harris County, TX')).toBe('Houston');
  });

  it('does not read Midlothian, Scotland as Texas', () => {
    expect(resolveCity('Edinburgh, Midlothian')).toBeNull();
    expect(resolveCity('Midlothian, TX')).toBe('Midlothian');
  });

  it('takes the town from the last piece before the TX marker', () => {
    expect(resolveCity('Broadstone Baybrook - Webster, TX')).toBe('Webster');
  });

  it('drops service desk, security and legal seats', () => {
    expect(creRelevance('Service Desk Analyst', '', false)).toBe('off-topic');
    expect(creRelevance('Security Analyst', '', false)).toBe('off-topic');
    expect(creRelevance('2027 Summer Internship - Legal Intern', '', false)).toBe('off-topic');
    expect(creRelevance('Assistant General Counsel', '', false)).toBe('off-topic');
  });

  it("recognizes 'Leasing & Sales Consultant'", () => {
    expect(classifyKind('Leasing & Sales Consultant - Cortland Bear Creek')).toBe('Entry-level');
  });
});

describe('on-site apartment leasing with no stated experience', () => {
  const raw: RawJob = { title: 'Leasing Professional - The Ellis', firm: 'Greystar', location: 'Dallas, TX', description: 'Lead tours and process applications.', applyUrl: 'https://example.com/g', ats: 'workday' };

  it('is dropped as off-topic, not held for review', () => {
    expect(normalize(raw, now)).toEqual({ ok: false, reason: 'off-topic' });
    expect(normalize({ ...raw, title: 'Community Assistant - Camber Villas (Student Living)' }, now)).toEqual({ ok: false, reason: 'off-topic' });
  });

  it('is still published when it states 0 to 2 years or says entry level, and leasing internships are kept', () => {
    expect(normalize({ ...raw, description: '0-1 years of experience required.' }, now).ok).toBe(true);
    expect(normalize({ ...raw, description: 'Entry-level role.' }, now).ok).toBe(true);
    expect(normalize({ ...raw, title: 'Leasing Summer 2027 Internship - Dallas, TX', description: '' }, now).ok).toBe(true);
  });
});

describe('regressions Rod found on the live site (2026-10-11)', () => {
  it('Huntington: development-program manager asking 5+ years is excluded and is not "Development"', () => {
    const raw: RawJob = {
      title: 'Commercial Analyst Development Program Manager',
      firm: 'Huntington Bank',
      location: 'Houston, TX',
      description:
        'Lead the Commercial Analyst Development Program, a rotational training program for new commercial banking analysts.\nBasic Qualifications\n5+ years of career program management or commercial banking background.',
      applyUrl: 'https://example.com/hb',
      ats: 'workday',
      creOnly: true
    };
    expect(normalize(raw, now).ok).toBe(false);
    // Each gate rejects it on its own, not only the title rule.
    expect(experienceRequirement(raw.description).required).toBe(5.5);
    expect(normalize({ ...raw, title: 'Commercial Analyst Development Program Coordinator' }, now)).toEqual({ ok: false, reason: 'over-experience' });
    expect(classifySector(raw.title, raw.description).sector).toBeNull();
  });

  it('U.S. Oral Surgery Management: Assistant General Counsel is not a CRE seat', () => {
    const raw: RawJob = {
      title: 'Assistant General Counsel',
      firm: 'U.S. Oral Surgery Management',
      location: 'Dallas, TX',
      description: 'Support the legal team on practice acquisitions, contracts and office leases. JD and bar admission required.',
      applyUrl: 'https://www.adzuna.com/x',
      ats: 'aggregator'
    };
    expect(normalize(raw, now)).toEqual({ ok: false, reason: 'off-topic' });
  });

  it('C&W: Maintenance Assistant is a building-operations trade seat, excluded as not a CRE career track', () => {
    const raw: RawJob = {
      title: 'Maintenance Assistant, Multifamily',
      firm: 'Cushman & Wakefield',
      location: 'San Antonio, TX',
      description: 'Complete make-ready and work orders at an apartment community.',
      applyUrl: 'https://example.com/cw',
      ats: 'workday'
    };
    expect(normalize(raw, now)).toEqual({ ok: false, reason: 'off-topic' });
    expect(classifySector(raw.title, raw.description).sector).not.toBe('Development');
  });

  it('keeps real development work filed under Development', () => {
    expect(classifySector('Development Analyst', 'Underwrite ground-up multifamily development.').sector).toBe('Development');
    expect(classifySector('Land Development Coordinator').sector).toBe('Development');
    expect(classifySector('Business Development Summer 2027 Internship').sector).not.toBe('Development');
  });

  it('reads "background" as a professional experience bar', () => {
    expect(experienceRequirement('3+ years of commercial lending background required.').required).toBe(3.5);
    expect(experienceRequirement('1-2 years of property accounting background.').required).toBe(2);
  });
});

describe('discovery batch 1 firms (migration 0017)', () => {
  const added = ['Fairfield Residential', 'Chesmar Homes', 'Kimco Realty', 'The NRP Group', 'JPI'];

  it('loads the five approved firms from the seed, each once, with a verified board', async () => {
    const { loadFirmSeed } = await import('../src/collector/firmSeed.js');
    const firms = await loadFirmSeed();
    for (const name of added) {
      const rows = firms.filter((firm) => firm.name === name);
      expect(rows, name).toHaveLength(1);
      expect(rows[0]!.atsHost, name).toMatch(/myworkdayjobs\.com$|icims\.com$/);
    }
    const names = firms.map((firm) => firm.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('leaves out the wrong discovery matches', async () => {
    const { loadFirmSeed } = await import('../src/collector/firmSeed.js');
    const names = (await loadFirmSeed()).map((firm) => firm.name);
    expect(names).not.toContain('Avison Young');
    expect(names).not.toContain('Willow Bridge');
  });
});

describe('experience wording beyond "years of experience"', () => {
  it('counts background, industry experience, work history and track record as required years', async () => {
    const { experienceRequirement, withinExperienceLimit } = await import('../src/collector/experience.js');
    for (const text of [
      'Requires 5+ years of banking background.',
      '5+ years of industry experience required.',
      'Must have 3 years of relevant work history.',
      '4 years of proven track record in commercial lending.'
    ]) {
      expect(experienceRequirement(text).required, text).toBeGreaterThanOrEqual(3);
      expect(withinExperienceLimit(text), text).toBe(false);
    }
  });

  it('still keeps preferred years apart from required years', async () => {
    const { experienceRequirement, withinExperienceLimit } = await import('../src/collector/experience.js');
    const text = 'Required: 0-1 years of experience.\nPreferred: 5+ years of industry experience.';
    expect(experienceRequirement(text)).toMatchObject({ required: 1, preferred: 5.5 });
    expect(withinExperienceLimit(text)).toBe(true);
  });
});
