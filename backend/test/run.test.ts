import { describe, expect, it, vi } from 'vitest';
import { runCollector, type Notifier } from '../src/collector/run.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import type { Posting, Profile, RawJob } from '../src/types.js';

const now = new Date('2026-09-11T00:00:00Z');

const firms: FirmRow[] = [
  { id: 1, name: 'Lone Star Capital Partners', ats: 'greenhouse', atsSlug: 'lonestar', active: true, slugVerified: true },
  { id: 2, name: 'Bayou Ridge Development', ats: 'lever', atsSlug: 'bayou', active: true, slugVerified: true }
];

const maya: Profile = {
  id: 'profile-1',
  name: 'Maya Reyes',
  school: 'UT Austin',
  gradYear: 2027,
  homeCity: 'Austin',
  skills: ['Excel', 'Argus Enterprise', 'Financial modeling'],
  sectors: ['Investment', 'Capital Markets'],
  relocationOpen: true,
  pushToken: 'ExponentPushToken[maya]',
  alerts: { digest: true, deadlines: true, internsOnly: false, market: true }
};

function job(overrides: Partial<RawJob> = {}): RawJob {
  return {
    title: 'Investment Analyst Intern',
    firm: 'Lone Star Capital Partners',
    location: 'Dallas, TX',
    description:
      'Acquisitions internship. Rising senior. Excel modeling and Argus Enterprise preferred. The rate is $24/hr.',
    applyUrl: 'https://example.com/1',
    postedAt: new Date('2026-09-10T00:00:00Z'),
    ats: 'greenhouse',
    ...overrides
  };
}

describe('runCollector', () => {
  it('runs the whole pipeline and reports every stage', async () => {
    const store = new MemoryStore(firms, [maya]);

    const report = await runCollector({
      store,
      now,
      fetcher: async (firm) =>
        firm.ats === 'greenhouse'
          ? [
              job(),
              job({ title: 'Senior Investment Analyst' }),      // above entry level
              job({ location: 'New York, NY' }),                // not Texas
              job({ title: '  ', applyUrl: '' })                // unusable
            ]
          : [job({ firm: 'Bayou Ridge Development', title: 'Development Intern', location: 'Houston, TX' })]
    });

    expect(report.firms).toBe(2);
    expect(report.fetched).toBe(5);
    expect(report.kept).toBe(2);
    expect(report.rejected).toEqual({
      'missing-fields': 1,
      'not-texas': 1,
      'not-entry-level': 1
    });
    expect(report.inserted).toBe(2);
    expect(report.updated).toBe(0);
    expect(store.postings.size).toBe(2);
  });

  it('dedupes the same seat seen twice, including across firms', async () => {
    const store = new MemoryStore(firms, []);
    const report = await runCollector({
      store,
      now,
      fetcher: async () => [job(), job(), job({ applyUrl: 'https://other.example/1' })]
    });

    expect(report.fetched).toBe(6);
    expect(report.kept).toBe(1);
  });

  it('updates rather than reinserts on the next pass', async () => {
    const store = new MemoryStore(firms, [maya]);
    const fetcher = async (firm: FirmRow) => (firm.id === 1 ? [job()] : []);

    const first = await runCollector({ store, now, fetcher });
    const second = await runCollector({
      store,
      now: new Date('2026-09-11T02:00:00Z'),
      fetcher
    });

    expect(first.inserted).toBe(1);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(1);
    // Only new rows are scored, so the second pass writes no matches.
    expect(second.matchesWritten).toBe(0);
  });

  it('keeps the original first_seen when a posting is seen again', async () => {
    const store = new MemoryStore(firms, []);
    const fetcher = async (firm: FirmRow) => (firm.id === 1 ? [job()] : []);

    await runCollector({ store, now, fetcher });
    const firstSeen = [...store.postings.values()][0]?.firstSeen;

    await runCollector({ store, now: new Date('2026-09-13T00:00:00Z'), fetcher });
    const posting = [...store.postings.values()][0] as Posting;

    expect(posting.firstSeen).toEqual(firstSeen);
    expect(posting.lastSeen).toEqual(new Date('2026-09-13T00:00:00Z'));
  });

  it('deactivates postings not seen for 14 days', async () => {
    const store = new MemoryStore(firms, []);
    await runCollector({ store, now, fetcher: async (f) => (f.id === 1 ? [job()] : []) });

    // 15 days later the board no longer carries it.
    const later = new Date('2026-09-26T00:00:00Z');
    const report = await runCollector({ store, now: later, fetcher: async () => [] });

    expect(report.deactivated).toBe(1);
    expect([...store.postings.values()][0]?.active).toBe(false);
  });

  it('scores new postings against every profile', async () => {
    const other: Profile = { ...maya, id: 'profile-2', pushToken: null };
    const store = new MemoryStore(firms, [maya, other]);

    const report = await runCollector({
      store,
      now,
      fetcher: async (f) => (f.id === 1 ? [job()] : [])
    });

    expect(report.matchesWritten).toBe(2);
    expect(store.matches.get(`profile-1:${[...store.postings.keys()][0]}`)?.score).toBeGreaterThan(0);
  });

  it('pushes only for strong matches, and only to opted-in profiles', async () => {
    const optedOut: Profile = {
      ...maya,
      id: 'profile-2',
      alerts: { digest: false, deadlines: true, internsOnly: false, market: true }
    };
    const store = new MemoryStore(firms, [maya, optedOut]);
    const notify = vi.fn<Notifier['notify']>(async () => {});

    const report = await runCollector({
      store,
      now,
      notifier: { notify },
      fetcher: async (f) => (f.id === 1 ? [job()] : [])
    });

    expect(report.strongMatches).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0].id).toBe('profile-1');
  });

  it('respects the internships-only alert preference', async () => {
    const internsOnly: Profile = {
      ...maya,
      alerts: { digest: true, deadlines: true, internsOnly: true, market: true }
    };
    const store = new MemoryStore(firms, [internsOnly]);
    const notify = vi.fn<Notifier['notify']>(async () => {});

    await runCollector({
      store,
      now,
      notifier: { notify },
      fetcher: async (f) =>
        f.id === 1
          ? [job({ title: 'Acquisitions Analyst', description: job().description })]
          : []
    });

    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps going when one board fails, and records the error', async () => {
    const store = new MemoryStore(firms, []);

    const report = await runCollector({
      store,
      now,
      fetcher: async (firm) => {
        if (firm.ats === 'greenhouse') throw new Error('GET … returned 404');
        return [job({ firm: 'Bayou Ridge Development', location: 'Houston, TX' })];
      }
    });

    expect(report.firmsFailed).toBe(1);
    expect(report.errors[0]?.firm).toBe('Lone Star Capital Partners');
    expect(report.kept).toBe(1);
    expect(store.polls).toContainEqual({ id: 1, ok: false, error: 'GET … returned 404' });
    expect(store.polls).toContainEqual({ id: 2, ok: true });
  });

  it('reports an empty run instead of failing silently', async () => {
    const store = new MemoryStore(firms, [maya]);
    const report = await runCollector({ store, now, fetcher: async () => [] });

    expect(report.fetched).toBe(0);
    expect(report.kept).toBe(0);
    expect(report.errors).toEqual([]);
  });
});
