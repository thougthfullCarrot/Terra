import { describe, expect, it } from 'vitest';
import { buildFeed, daysBetween, toUiPosting } from '../src/api/serialize.js';
import type { Match, Posting } from '../src/types.js';

const now = new Date('2026-09-11T14:30:00Z');

function posting(overrides: Partial<Posting> = {}): Posting {
  return {
    id: 'j1',
    role: 'Investment Analyst Intern',
    firm: 'Lone Star Capital Partners',
    city: 'Dallas',
    sector: 'Investment',
    kind: 'Internship',
    pay: '$24/hr',
    deadline: '2026-10-03',
    postedAt: new Date('2026-09-10T09:00:00Z'),
    description: 'Summer 2027 analyst internship.',
    reqs: ['Rising junior or senior'],
    applyUrl: 'https://example.com/j1',
    source: 'Posted on the firm careers page',
    lastSeen: new Date('2026-09-10T09:00:00Z'),
    ...overrides
  };
}

describe('toUiPosting', () => {
  it('resolves timestamps into the relative numbers the cards render', () => {
    const ui = toUiPosting(posting(), now);
    expect(ui.posted).toBe(1);
    expect(ui.days).toBe(22);
    expect(ui.deadline).toBe('Oct 3, 2026');
  });

  it('counts whole days regardless of the time of day', () => {
    const morning = toUiPosting(posting(), new Date('2026-09-11T00:01:00Z'));
    const evening = toUiPosting(posting(), new Date('2026-09-11T23:59:00Z'));
    expect(morning.posted).toBe(evening.posted);
    expect(morning.days).toBe(evening.days);
  });

  it('appends verification recency to the stored provenance stem', () => {
    expect(toUiPosting(posting(), now).source).toBe(
      'Posted on the firm careers page, verified 1 day ago.'
    );
    expect(toUiPosting(posting({ lastSeen: now }), now).source).toBe(
      'Posted on the firm careers page, verified today.'
    );
    expect(
      toUiPosting(posting({ lastSeen: new Date('2026-09-06T00:00:00Z') }), now).source
    ).toBe('Posted on the firm careers page, verified 5 days ago.');
  });

  it('carries a missing deadline through as null rather than inventing one', () => {
    const ui = toUiPosting(posting({ deadline: null }), now);
    expect(ui.deadline).toBeNull();
    expect(ui.days).toBeNull();
  });

  it('never reports a negative age', () => {
    const ui = toUiPosting(posting({ postedAt: new Date('2026-09-12T00:00:00Z') }), now);
    expect(ui.posted).toBe(0);
  });
});

describe('buildFeed', () => {
  it('sorts by match score descending', () => {
    const postings = [
      posting({ id: 'low' }),
      posting({ id: 'high' }),
      posting({ id: 'none' })
    ];
    const matches: Match[] = [
      { profileId: 'p', postingId: 'low', score: 64, note: '', lines: [] },
      { profileId: 'p', postingId: 'high', score: 96, note: 'Austin · modeling', lines: ['x'] }
    ];

    const feed = buildFeed({ postings, matches, markets: {}, now });
    expect(feed.jobs.map((job) => job.id)).toEqual(['high', 'low', 'none']);
  });

  it('indexes matches by posting id for the UI', () => {
    const matches: Match[] = [
      { profileId: 'p', postingId: 'j1', score: 96, note: 'Austin · modeling', lines: ['a', 'b'] }
    ];
    const feed = buildFeed({ postings: [posting()], matches, markets: {}, now });

    expect(feed.match.j1).toEqual({ score: 96, note: 'Austin · modeling', lines: ['a', 'b'] });
  });

  it('returns the contract shape exactly', () => {
    const feed = buildFeed({ postings: [posting()], matches: [], markets: {}, now });
    expect(Object.keys(feed).sort()).toEqual(['jobs', 'markets', 'match', 'syncedAt']);
    expect(feed.syncedAt).toBeInstanceOf(Date);
  });

  it('serves an empty feed without throwing', () => {
    const feed = buildFeed({ postings: [], matches: [], markets: {}, now });
    expect(feed.jobs).toEqual([]);
    expect(feed.match).toEqual({});
  });
});

describe('daysBetween', () => {
  it('counts calendar days in UTC', () => {
    expect(daysBetween(new Date('2026-09-10T23:00:00Z'), new Date('2026-09-11T01:00:00Z'))).toBe(1);
    expect(daysBetween(new Date('2026-09-11T01:00:00Z'), new Date('2026-09-10T23:00:00Z'))).toBe(-1);
  });
});
