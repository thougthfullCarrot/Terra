import { describe, expect, it } from 'vitest';
import { resumeSkills, scoreJobs, STRONG_MATCH, type SiteProfile } from '../src/site/browserMatch.js';
import { matchInputs, scoreMatch } from '../src/matching/score.js';
import type { Posting, Profile } from '../src/types.js';
import { sortJobs, type Job } from '../../site/feed.js';

const now = new Date('2026-10-04T15:00:00Z');

const posting: Posting = {
  id: 'p1',
  role: 'Acquisitions Analyst Intern',
  firm: 'Hines',
  city: 'Austin',
  sector: 'Investment',
  kind: 'Internship',
  pay: '$25/hr',
  deadline: null,
  postedAt: now,
  description: 'Build Argus and Excel models; rising senior preferred.',
  reqs: ['Financial modeling'],
  applyUrl: 'https://example.com/apply',
  source: 'test'
} as Posting;

const profile: SiteProfile = {
  school: 'UT Austin',
  gradYear: 2027,
  homeCity: 'Austin',
  sectors: ['Investment'],
  relocationOpen: false,
  resumeText: 'Skills: Argus Enterprise, advanced Excel, DCF modeling, CoStar.'
};

describe('browser matcher', () => {
  it('scores a site job exactly as the server scores the posting', () => {
    const job = { id: 'p1', city: 'Austin', sector: 'Investment', kind: 'Internship', pay: '$25/hr', match: matchInputs(posting) };
    const site = scoreJobs(profile, [job], now).get('p1')!;

    const server = scoreMatch(
      { id: 'x', name: null, ...profile, skills: [profile.resumeText!] } as Profile,
      posting,
      now
    );
    expect(site).toEqual({ score: server.score, note: server.note, lines: server.lines, strong: server.strong });
    expect(site.score).toBeGreaterThanOrEqual(STRONG_MATCH);
    expect(site.strong).toBe(true);
  });

  it('scores nothing without a resume', () => {
    const job = { id: 'p1', city: 'Austin', sector: 'Investment', kind: 'Internship', pay: null, match: matchInputs(posting) };
    expect(scoreJobs({ ...profile, resumeText: '  ' }, [job], now).size).toBe(0);
  });

  it('lists the vocabulary skills found on a resume', () => {
    expect(resumeSkills(profile.resumeText)).toEqual(['Argus', 'Excel', 'modeling', 'CoStar']);
  });

  it('sorts by match score, with unscored jobs last by date', () => {
    const job = (id: string, postedAt: string, matchScore?: number) => ({ id, postedAt, matchScore }) as Job;
    const sorted = sortJobs([job('a', '2026-10-01', 70), job('b', '2026-10-03'), job('c', '2026-10-02', 95)], 'match');
    expect(sorted.map((j) => j.id)).toEqual(['c', 'a', 'b']);
  });
});
