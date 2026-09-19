import { describe, expect, it } from 'vitest';
import {
  filterFeed,
  nextStage,
  sortByDeadline,
  stageNote,
  toggleFilter,
  urgencyOf
} from '../src/logic/feed';
import type { Posting } from '../src/data/types';

function job(overrides: Partial<Posting> = {}): Posting {
  return {
    id: 'j1',
    role: 'Investment Analyst Intern',
    firm: 'Lone Star Capital Partners',
    city: 'Dallas',
    sector: 'Investment',
    kind: 'Internship',
    pay: '$24/hr',
    posted: 1,
    deadline: 'Oct 3, 2026',
    days: 22,
    desc: '',
    reqs: [],
    source: '',
    ...overrides
  };
}

const scores: Record<string, number> = { high: 96, mid: 71, low: 52 };
const scoreOf = (id: string) => scores[id] ?? 0;
const isStrong = (id: string) => scoreOf(id) >= 92;

describe('filterFeed', () => {
  const jobs = [
    job({ id: 'low', city: 'Houston', kind: 'Entry-level' }),
    job({ id: 'high', city: 'Austin', kind: 'Internship' }),
    job({ id: 'mid', city: 'Dallas', kind: 'Internship' })
  ];
  const all = { city: 'All Texas', type: 'All roles', matchOnly: false };

  it('orders by match score, best first', () => {
    const feed = filterFeed(jobs, all, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['high', 'mid', 'low']);
  });

  it('filters by city', () => {
    const feed = filterFeed(jobs, { ...all, city: 'Austin' }, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['high']);
  });

  it('filters by role type', () => {
    const feed = filterFeed(jobs, { ...all, type: 'Internship' }, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['high', 'mid']);
  });

  it('combines both filters', () => {
    const feed = filterFeed(jobs, { city: 'Dallas', type: 'Internship', matchOnly: false }, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['mid']);
  });

  it('narrows to strong matches when matchOnly is on', () => {
    const feed = filterFeed(jobs, { ...all, matchOnly: true }, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['high']);
  });

  it('keeps unscored postings rather than hiding them', () => {
    // A posting with no match entry scores 0. It belongs at the bottom of the
    // feed, not missing from it — the user has not been scored against it yet.
    const feed = filterFeed([...jobs, job({ id: 'unscored' })], all, scoreOf, isStrong);
    expect(feed.map((j) => j.id)).toEqual(['high', 'mid', 'low', 'unscored']);
  });

  it('returns nothing when the filters exclude everything', () => {
    const feed = filterFeed(jobs, { city: 'El Paso', type: 'All roles', matchOnly: false }, scoreOf, isStrong);
    expect(feed).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [...jobs];
    filterFeed(input, all, scoreOf, isStrong);
    expect(input.map((j) => j.id)).toEqual(['low', 'high', 'mid']);
  });
});

describe('sortByDeadline', () => {
  it('puts the soonest deadline first', () => {
    const sorted = sortByDeadline([
      job({ id: 'later', days: 34 }),
      job({ id: 'soonest', days: 3 }),
      job({ id: 'middle', days: 15 })
    ]);
    expect(sorted.map((j) => j.id)).toEqual(['soonest', 'middle', 'later']);
  });

  it('sorts a posting with no deadline last, not first', () => {
    const sorted = sortByDeadline([job({ id: 'open', days: null }), job({ id: 'closing', days: 5 })]);
    expect(sorted.map((j) => j.id)).toEqual(['closing', 'open']);
  });

  it('does not mutate the input', () => {
    const input = [job({ id: 'b', days: 30 }), job({ id: 'a', days: 1 })];
    sortByDeadline(input);
    expect(input.map((j) => j.id)).toEqual(['b', 'a']);
  });
});

describe('toggleFilter', () => {
  it('selects a value that was not active', () => {
    expect(toggleFilter('All Texas', 'Austin', 'All Texas')).toBe('Austin');
  });

  it('clears back to the default when the active value is re-tapped', () => {
    // The handoff calls for this specifically: re-tapping an active chip
    // returns the feed to all of Texas.
    expect(toggleFilter('Austin', 'Austin', 'All Texas')).toBe('All Texas');
  });

  it('switches directly between two values', () => {
    expect(toggleFilter('Austin', 'Dallas', 'All Texas')).toBe('Dallas');
  });
});

describe('nextStage', () => {
  it('advances through the pipeline in order', () => {
    expect(nextStage('Applied')).toBe('Interview');
    expect(nextStage('Interview')).toBe('Offer');
  });

  it('stops at Offer', () => {
    expect(nextStage('Offer')).toBeNull();
  });
});

describe('stageNote', () => {
  it('matches the copy in the prototype', () => {
    expect(stageNote('Applied')).toBe('Applied today');
    expect(stageNote('Interview')).toBe('Interview scheduled');
    expect(stageNote('Offer')).toBe('Offer received');
  });
});

describe('urgencyOf', () => {
  it('uses the handoff thresholds', () => {
    expect(urgencyOf(15)).toBe('closing');
    expect(urgencyOf(16)).toBe('soon');
    expect(urgencyOf(25)).toBe('soon');
    expect(urgencyOf(26)).toBe('later');
  });

  it('treats a passed deadline as closing, not as later', () => {
    expect(urgencyOf(0)).toBe('closing');
    expect(urgencyOf(-3)).toBe('closing');
  });

  it('marks a posting with no deadline as open', () => {
    expect(urgencyOf(null)).toBe('open');
  });
});
