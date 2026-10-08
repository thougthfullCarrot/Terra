import { describe, expect, it } from 'vitest';
import { buildSnapshot, DESC_LIMIT, toSitePosting } from '../src/site/snapshot.js';
import type { RunReport } from '../src/collector/run.js';
import type { Posting } from '../src/types.js';
import {
  deadlineLabel,
  facet,
  filterJobs,
  initials,
  isNew,
  parseSaved,
  postedLabel,
  readQuery,
  safeUrl,
  sortJobs,
  toggleSaved,
  updatedLabel,
  writeQuery,
  type Job
} from '../../site/feed.js';

const now = new Date('2026-10-04T15:00:00Z');

function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: 'a',
    role: 'Investment Analyst Intern',
    firm: 'Lincoln Property Company',
    city: 'Dallas',
    sector: 'Investment',
    kind: 'Internship',
    pay: '$24/hr',
    deadline: null,
    postedAt: new Date('2026-10-01T12:00:00Z'),
    description: 'Underwriting support.',
    reqs: ['Excel'],
    applyUrl: 'https://boards.greenhouse.io/lincoln/jobs/1',
    source: 'Posted on the firm careers page',
    ...overrides
  };
}

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    firms: 2,
    firmsFailed: 0,
    fetched: 0,
    kept: 0,
    rejected: { 'missing-fields': 0, 'not-texas': 0, 'not-entry-level': 0, 'off-topic': 0 },
    sectorGuessed: 0,
    inserted: 0,
    updated: 0,
    deactivated: 0,
    matchesWritten: 0,
    strongMatches: 0,
    notified: 0,
    errors: [],
    aggregators: [],
    ranAt: now,
    ...overrides
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return { ...toSitePosting(posting()), ...overrides };
}

describe('buildSnapshot', () => {
  it('carries absolute dates and the apply link, newest first', () => {
    const snapshot = buildSnapshot(
      [
        posting({ id: 'old', postedAt: new Date('2026-09-20T00:00:00Z') }),
        posting({ id: 'new', postedAt: new Date('2026-10-03T00:00:00Z'), deadline: '2026-10-20' })
      ],
      report({ firmsFailed: 1 })
    );

    expect(snapshot.generatedAt).toBe('2026-10-04T15:00:00.000Z');
    expect(snapshot.boards).toEqual({ polled: 2, failed: 1 });
    expect(snapshot.cities).toContain('San Antonio');
    expect(snapshot.jobs.map((j) => j.id)).toEqual(['new', 'old']);
    expect(snapshot.jobs[0]).toMatchObject({
      postedAt: '2026-10-03T00:00:00.000Z',
      deadline: '2026-10-20',
      applyUrl: 'https://boards.greenhouse.io/lincoln/jobs/1'
    });
  });

  it('credits Adzuna on postings that came through it, and only those', () => {
    expect(toSitePosting(posting({ applyUrl: 'https://www.adzuna.com/land/ad/123' })).via).toBe('Adzuna');
    expect(toSitePosting(posting()).via).toBeNull();
    expect(toSitePosting(posting({ applyUrl: 'https://notadzuna.com/x' })).via).toBeNull();
  });

  it('shortens a long description on a word boundary', () => {
    const long = `${'word '.repeat(300)}end`;
    const { desc } = toSitePosting(posting({ description: long }));
    expect(desc.length).toBeLessThanOrEqual(DESC_LIMIT + 1);
    expect(desc.endsWith('word…')).toBe(true);
  });
});

describe('site feed rules', () => {
  const jobs = [
    job({ id: '1', role: 'Acquisitions Analyst', firm: 'JLL', city: 'Dallas', kind: 'Entry-level', sector: 'Investment' }),
    job({ id: '2', role: 'Leasing Intern', firm: 'Greystar', city: 'Houston', kind: 'Internship', sector: 'Property Mgmt' }),
    job({ id: '3', role: 'Brokerage Analyst', firm: 'JLL', city: 'Houston', kind: 'Entry-level', sector: 'Brokerage', reqs: ['Argus'] })
  ];

  it('needs every search word to match, across fields', () => {
    expect(filterJobs(jobs, { q: 'analyst houston' }).map((j) => j.id)).toEqual(['3']);
    expect(filterJobs(jobs, { q: 'ARGUS' }).map((j) => j.id)).toEqual(['3']);
    expect(filterJobs(jobs, { q: 'analyst' })).toHaveLength(2);
  });

  it('combines filters, and ignores empty ones', () => {
    expect(filterJobs(jobs, { firm: 'JLL', city: 'Houston' }).map((j) => j.id)).toEqual(['3']);
    expect(filterJobs(jobs, { city: '', kind: '' })).toHaveLength(3);
    expect(filterJobs(jobs, { kind: 'Internship' }).map((j) => j.id)).toEqual(['2']);
  });

  it('counts facet values, most common first', () => {
    expect(facet(jobs, 'firm')).toEqual([
      { value: 'JLL', count: 2 },
      { value: 'Greystar', count: 1 }
    ]);
  });

  it('lists every covered city, even at zero', () => {
    const cities = facet(jobs, 'city', ['Dallas', 'Houston', 'San Antonio']);
    expect(cities).toEqual([
      { value: 'Houston', count: 2 },
      { value: 'Dallas', count: 1 },
      { value: 'San Antonio', count: 0 }
    ]);
  });

  it('puts undated postings after every dated one when sorting by deadline', () => {
    const list = [
      job({ id: 'none-new', deadline: null, postedAt: '2026-10-03T00:00:00Z' }),
      job({ id: 'late', deadline: '2026-11-01' }),
      job({ id: 'none-old', deadline: null, postedAt: '2026-09-01T00:00:00Z' }),
      job({ id: 'soon', deadline: '2026-10-08' })
    ];
    expect(sortJobs(list, 'deadline').map((j) => j.id)).toEqual(['soon', 'late', 'none-new', 'none-old']);
    expect(sortJobs(list, 'newest')[0]?.id).toBe('none-new');
  });

  it('counts days in UTC calendar terms', () => {
    expect(postedLabel('2026-10-04T01:00:00Z', now)).toBe('Posted today');
    expect(postedLabel('2026-10-03T23:00:00Z', now)).toBe('Posted yesterday');
    expect(postedLabel('2026-09-30T00:00:00Z', now)).toBe('Posted 4 days ago');
    // A posting dated in the future by a board's clock is not "-1 days ago".
    expect(postedLabel('2026-10-06T00:00:00Z', now)).toBe('Posted today');
  });

  it('flags a deadline inside a week, and a passed one', () => {
    expect(deadlineLabel(null, now)).toBeNull();
    expect(deadlineLabel('2026-10-09', now)).toEqual({ text: 'Closes Oct 9 · 5d left', urgent: true });
    expect(deadlineLabel('2026-11-04', now)).toEqual({ text: 'Closes Nov 4 · 31d left', urgent: false });
    expect(deadlineLabel('2026-10-04', now)).toEqual({ text: 'Closes today', urgent: true });
    expect(deadlineLabel('2026-10-01', now)).toEqual({ text: 'Closed Oct 1', urgent: true });
  });

  it('says how old the snapshot is', () => {
    expect(updatedLabel('2026-10-04T14:59:50Z', now)).toBe('Updated just now');
    expect(updatedLabel('2026-10-04T14:20:00Z', now)).toBe('Updated 40 min ago');
    expect(updatedLabel('2026-10-04T14:00:00Z', now)).toBe('Updated 1 hour ago');
    expect(updatedLabel('2026-10-01T15:00:00Z', now)).toBe('Updated 3 days ago');
  });

  it('only lets http(s) links through', () => {
    expect(safeUrl('https://jll.wd1.myworkdayjobs.com/x')).toBe('https://jll.wd1.myworkdayjobs.com/x');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('not a url')).toBeNull();
  });

  it('shows only saved jobs when asked, and nothing when none are saved', () => {
    expect(filterJobs(jobs, { saved: true, savedIds: new Set(['3', 'gone']) }).map((j) => j.id)).toEqual(['3']);
    expect(filterJobs(jobs, { saved: true, savedIds: new Set() })).toEqual([]);
    expect(filterJobs(jobs, { saved: true })).toEqual([]);
    // The saved set alone filters nothing; only the toggle does.
    expect(filterJobs(jobs, { savedIds: new Set(['3']) })).toHaveLength(3);
  });

  it('reads saved ids defensively and toggles without mutating', () => {
    expect([...parseSaved('["a","b",3]')]).toEqual(['a', 'b']);
    expect(parseSaved('not json').size).toBe(0);
    expect(parseSaved('{"a":1}').size).toBe(0);
    expect(parseSaved(null).size).toBe(0);
    const before = new Set(['a']);
    expect([...toggleSaved(before, 'b')]).toEqual(['a', 'b']);
    expect([...toggleSaved(before, 'a')]).toEqual([]);
    expect([...before]).toEqual(['a']);
  });

  it('tags postings from the last two days as new', () => {
    expect(isNew('2026-10-04T01:00:00Z', now)).toBe(true);
    expect(isNew('2026-10-02T23:00:00Z', now)).toBe(true);
    expect(isNew('2026-10-01T12:00:00Z', now)).toBe(false);
  });

  it('builds firm monograms', () => {
    expect(initials('Lincoln Property Company')).toBe('LP');
    expect(initials('Cushman & Wakefield')).toBe('CW');
    expect(initials('JLL')).toBe('JLL');
    expect(initials('CBRE')).toBe('CBRE');
    expect(initials('Greystar')).toBe('GR');
    expect(initials('')).toBe('?');
  });

  it('round-trips filter state through the query string', () => {
    const state = {
      q: 'analyst',
      city: 'Fort Worth',
      firm: '',
      kind: 'Internship',
      sector: '',
      sort: 'deadline' as const,
      saved: true,
      job: 'abc'
    };
    expect(readQuery(writeQuery(state))).toEqual(state);
    expect(writeQuery({ q: '', city: '', firm: '', kind: '', sector: '', sort: 'newest', saved: false, job: '' })).toBe('');
    expect(readQuery('?sort=bogus').sort).toBe('newest');
  });
});
