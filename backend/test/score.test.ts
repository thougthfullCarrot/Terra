import { describe, expect, it } from 'vitest';
import { scoreMatch, WEIGHTS } from '../src/matching/score.js';
import { classStanding, parseClassRequirement } from '../src/matching/classYear.js';
import { STRONG_MATCH, type Posting, type Profile } from '../src/types.js';

const now = new Date('2026-09-11T00:00:00Z');

// The prototype's resume: Maya Reyes, UT Austin finance '27, Excel/Argus, Austin.
const maya: Profile = {
  id: 'profile-1',
  name: 'Maya Reyes',
  school: 'UT Austin',
  gradYear: 2027,
  homeCity: 'Austin',
  skills: ['Excel', 'Financial modeling', 'Argus Enterprise'],
  sectors: ['Capital Markets', 'Investment'],
  relocationOpen: true
};

function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: 'j5',
    role: 'Capital Markets Summer Analyst',
    firm: 'Congress Avenue Capital',
    city: 'Austin',
    sector: 'Capital Markets',
    kind: 'Internship',
    pay: '$28/hr',
    deadline: '2026-09-22',
    postedAt: new Date('2026-09-10T00:00:00Z'),
    description:
      'Debt placement and structured finance internship. Build loan sizing models in Excel.',
    reqs: ['Rising senior, finance or economics', 'Excel modeling test as part of interview'],
    applyUrl: 'https://example.com/j5',
    source: 'Posted on the firm careers page',
    ...overrides
  };
}

describe('scoreMatch', () => {
  it('scores the prototype hero posting as a strong match', () => {
    const result = scoreMatch(maya, posting(), now);
    expect(result.score).toBeGreaterThanOrEqual(STRONG_MATCH);
    expect(result.strong).toBe(true);
  });

  it('builds the three-part note the card renders', () => {
    const result = scoreMatch(maya, posting(), now);
    const parts = result.note.split(' · ');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe('Austin');
    // Second part is the strongest skill overlap, third the class standing.
    expect(parts[1]).toBeTruthy();
    expect(parts[2]).toContain('senior');
  });

  it('produces three to four explanatory lines', () => {
    const { lines } = scoreMatch(maya, posting(), now);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(4);
    for (const line of lines) expect(line.endsWith('.')).toBe(true);
  });

  it('weights the four components as the spec states', () => {
    expect(WEIGHTS.skills).toBe(0.4);
    expect(WEIGHTS.location + WEIGHTS.classYear + WEIGHTS.sector).toBeCloseTo(0.6);
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('drops below the strong threshold when the sector is not a declared interest', () => {
    const off = scoreMatch(maya, posting({ sector: 'Property Mgmt' }), now);
    expect(off.score).toBeLessThan(STRONG_MATCH);
  });

  it('penalizes an out-of-town posting less when relocation is open', () => {
    const open = scoreMatch(maya, posting({ city: 'Houston' }), now);
    const closed = scoreMatch({ ...maya, relocationOpen: false }, posting({ city: 'Houston' }), now);
    expect(open.score).toBeGreaterThan(closed.score);
  });

  it('scores a resume with no overlapping skills far lower', () => {
    const novice = scoreMatch({ ...maya, skills: [] }, posting(), now);
    expect(novice.score).toBeLessThan(scoreMatch(maya, posting(), now).score);
  });

  it('never leaves the 0-100 range', () => {
    const empty: Profile = {
      id: 'p',
      name: null,
      school: null,
      gradYear: null,
      homeCity: null,
      skills: [],
      sectors: [],
      relocationOpen: false
    };
    const result = scoreMatch(empty, posting(), now);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('mentions only evidence it actually has', () => {
    const { lines } = scoreMatch({ ...maya, skills: [] }, posting(), now);
    expect(lines.join(' ')).not.toMatch(/on your resume/);
  });
});

describe('classStanding', () => {
  it('treats the academic year as flipping in August', () => {
    // A 2027 graduate is a senior from August 2026 onward.
    expect(classStanding(2027, new Date('2026-09-11T00:00:00Z')).standing).toBe('senior');
    expect(classStanding(2027, new Date('2026-05-11T00:00:00Z')).standing).toBe('junior');
  });

  it('reports the standing a student rises into', () => {
    expect(classStanding(2027, new Date('2026-05-11T00:00:00Z')).rising).toBe('senior');
  });

  it('marks graduates', () => {
    expect(classStanding(2024, new Date('2026-09-11T00:00:00Z')).standing).toBe('graduate');
  });
});

describe('parseClassRequirement', () => {
  it('reads standings and keeps the phrase for the note', () => {
    const requirement = parseClassRequirement('Rising senior, finance or economics');
    expect(requirement.standings).toContain('senior');
    expect(requirement.phrase).toBe('rising senior');
  });

  it('reads explicit graduation years', () => {
    expect(parseClassRequirement('Class of 2027 preferred').years).toEqual([2027]);
  });

  it('returns an empty requirement when the posting says nothing', () => {
    const requirement = parseClassRequirement('Great opportunity for a motivated candidate.');
    expect(requirement.standings).toEqual([]);
    expect(requirement.years).toEqual([]);
  });
});
