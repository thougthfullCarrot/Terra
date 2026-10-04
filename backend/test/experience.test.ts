import { describe, expect, it } from 'vitest';
import { requiredYears, withinExperienceLimit } from '../src/collector/experience.js';
import { normalize } from '../src/collector/normalize.js';

describe('withinExperienceLimit', () => {
  it('keeps postings asking for 0 to 2 years, or for nothing', () => {
    for (const text of [
      '0-2 years of experience',
      '1-2 years of relevant experience',
      '2 years of experience preferred',
      'Up to 2 years of experience',
      '1+ year of experience',
      'No experience required. Strong Excel skills.'
    ]) {
      expect(withinExperienceLimit(text), text).toBe(true);
    }
  });

  it('drops postings whose floor can exceed 2 years', () => {
    for (const text of [
      '2+ years of experience in commercial real estate',
      'At least two (2) years of experience required',
      'Minimum of 3 years experience',
      '3-5 years of CRE experience',
      'Over 2 years of leasing experience',
      'three years of property management experience',
      'Experience: 3+ years'
    ]) {
      expect(withinExperienceLimit(text), text).toBe(false);
    }
  });

  it('ignores year figures that are not about experience', () => {
    expect(requiredYears('Requires a 4-year degree. No experience needed.')).toBeNull();
    expect(requiredYears('A 2-year rotational program for graduates with internship experience')).toBeNull();
    expect(requiredYears('Must graduate within 2 years. Some experience in Argus.')).toBeNull();
    expect(requiredYears('Experience with Argus. 5 years old company.')).toBeNull();
  });
});

describe('normalize with an experience bar', () => {
  const raw = {
    title: 'Investment Analyst',
    firm: 'Lincoln Property Company',
    location: 'Dallas, TX',
    applyUrl: 'https://example.com/1',
    ats: 'greenhouse' as const
  };

  it('rejects an entry-level title that asks for 2+ years', () => {
    const result = normalize({ ...raw, description: 'Requires 2+ years of acquisitions experience.' });
    expect(result).toEqual({ ok: false, reason: 'not-entry-level' });
  });

  it('keeps one that asks for 1-2 years', () => {
    const result = normalize({ ...raw, description: 'Looking for 1-2 years of experience in underwriting.' });
    expect(result.ok).toBe(true);
  });
});
