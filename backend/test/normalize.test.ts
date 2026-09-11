import { describe, expect, it } from 'vitest';
import { normalize } from '../src/collector/normalize.js';
import { postingId } from '../src/collector/id.js';
import type { RawJob } from '../src/types.js';

const now = new Date('2026-09-11T00:00:00Z');

const base: RawJob = {
  title: 'Investment Analyst Intern',
  firm: 'Lone Star Capital Partners',
  location: 'Dallas, TX',
  description: [
    'Summer 2027 analyst internship supporting the acquisitions team on multifamily deals.',
    'The rate is $24/hr. Applications close October 3, 2026.',
    '',
    'Qualifications',
    '- Rising junior or senior, finance or real estate coursework',
    '- Argus Enterprise exposure preferred, not required',
    '- Strong Excel modeling fundamentals'
  ].join('\n'),
  applyUrl: 'https://boards.greenhouse.io/lonestar/jobs/4567',
  postedAt: new Date('2026-09-10T00:00:00Z'),
  ats: 'greenhouse'
};

describe('normalize', () => {
  it('produces a complete posting row', () => {
    const result = normalize(base, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { posting } = result;
    expect(posting.id).toBe(
      postingId('Lone Star Capital Partners', 'Investment Analyst Intern', 'Dallas')
    );
    expect(posting.city).toBe('Dallas');
    expect(posting.kind).toBe('Internship');
    expect(posting.sector).toBe('Investment');
    expect(posting.pay).toBe('$24/hr');
    expect(posting.deadline).toBe('2026-10-03');
    expect(posting.reqs).toHaveLength(3);
    expect(posting.source).toBe('Posted on the firm careers page');
    expect(result.sectorGuessed).toBe(false);
  });

  it('drops postings outside Texas', () => {
    const result = normalize({ ...base, location: 'New York, NY' }, now);
    expect(result).toEqual({ ok: false, reason: 'not-texas' });
  });

  it('drops postings above entry level', () => {
    const result = normalize({ ...base, title: 'Senior Investment Analyst' }, now);
    expect(result).toEqual({ ok: false, reason: 'not-entry-level' });
  });

  it('drops postings missing the fields the UI requires', () => {
    expect(normalize({ ...base, applyUrl: '' }, now)).toEqual({
      ok: false,
      reason: 'missing-fields'
    });
    expect(normalize({ ...base, title: '   ' }, now)).toEqual({
      ok: false,
      reason: 'missing-fields'
    });
  });

  it('flags a fallback sector rather than hiding it', () => {
    const result = normalize(
      { ...base, title: 'Analyst', description: 'A great place to work.' },
      now
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sectorGuessed).toBe(true);
    expect(result.posting.sector).toBe('Investment');
  });

  it('marks aggregator provenance differently from a firm board', () => {
    const result = normalize({ ...base, ats: 'aggregator' }, now);
    expect(result.ok && result.posting.source).toBe('Aggregated from a Texas jobs board');
  });

  it('defaults postedAt to now when the board omits it', () => {
    const { postedAt, ...rest } = base;
    const result = normalize(rest as RawJob, now);
    expect(result.ok && result.posting.postedAt).toEqual(now);
  });

  it('gives the same id to the same seat seen on two boards', () => {
    const a = normalize(base, now);
    const b = normalize({ ...base, ats: 'aggregator', applyUrl: 'https://indeed.example/x' }, now);
    expect(a.ok && b.ok && a.posting.id).toBe(b.ok ? b.posting.id : '');
  });
});
