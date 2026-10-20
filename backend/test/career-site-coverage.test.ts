/**
 * Regression tests for the official-career-site coverage work (2026-10-20):
 * the RCLCO trace, Greenhouse office locations and completeness, board
 * failures kept apart from closed jobs, and distinct openings that share a
 * title and city.
 */
import { describe, expect, it } from 'vitest';
import { fetchGreenhouse, location, parseGreenhouse } from '../src/collector/sources/greenhouse.js';
import { IncompleteBoardError } from '../src/collector/sources/incomplete.js';
import { normalize } from '../src/collector/normalize.js';
import { runCollector } from '../src/collector/run.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import { retainUnverified, RETAIN_DAYS } from '../src/site/retain.js';
import { buildSnapshot } from '../src/site/snapshot.js';
import type { RawJob } from '../src/types.js';

const now = new Date('2026-10-20T15:00:00Z');

/** The posting Rod traced, as the Greenhouse job board API returns it. */
const rclco = {
  id: 8266046,
  title: '2027 Summer Intern, Real Estate Economics & Consulting',
  absolute_url: 'https://job-boards.greenhouse.io/rclco/jobs/8266046',
  location: { name: 'Austin / Los Angeles / Washington, D.C.' },
  first_published: '2026-10-14T16:00:00-04:00',
  content:
    '&lt;p&gt;RCLCO&#39;s Real Estate Economics (REE) team advises developers and investors on market feasibility. Students in the last year of an undergraduate or graduate program.&lt;/p&gt;'
};

describe('RCLCO 2027 Summer Intern (job-boards.greenhouse.io/rclco/jobs/8266046)', () => {
  it('publishes as an Austin internship once the board is on the firm list', () => {
    const [raw] = parseGreenhouse('RCLCO', { jobs: [rclco] });
    expect(raw).toMatchObject({ sourceId: '8266046', applyUrl: rclco.absolute_url, location: 'Austin / Los Angeles / Washington, D.C.' });
    expect(raw!.postedAt?.toISOString()).toBe('2026-10-14T20:00:00.000Z');
    const result = normalize(raw!, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.posting).toMatchObject({ firm: 'RCLCO', city: 'Austin', kind: 'Internship', sourceId: '8266046' });
  });

  it('was missed before only because no RCLCO board was polled', async () => {
    // The pipeline reads only the firm list; a firm missing from it is never fetched.
    const store = new MemoryStore([{ id: 1, name: 'Lincoln Property Company', ats: 'greenhouse', atsSlug: 'lincoln', active: true, slugVerified: true }]);
    const asked: string[] = [];
    await runCollector({ store, now, fetcher: async (firm) => (asked.push(firm.atsSlug), []) });
    expect(asked).toEqual(['lincoln']);
  });
});

describe('Greenhouse locations', () => {
  it('reads the offices too when the location line is not a Texas place', () => {
    expect(location({ location: { name: 'Multiple Locations' }, offices: [{ name: 'Dallas', location: 'Dallas, TX' }, { name: 'Denver' }] })).toBe('Multiple Locations; Dallas, TX; Denver');
    expect(location({ location: { name: 'Remote' }, offices: [{ name: 'Houston' }] })).toBe('Remote; Houston');
  });

  it('does not repeat the location line when an office says the same', () => {
    expect(location({ location: { name: 'Austin, TX' }, offices: [{ name: 'Austin', location: 'Austin, TX' }] })).toBe('Austin, TX');
  });

  it('turns a "Multiple Locations" posting with a Dallas office into a Dallas job', () => {
    const [raw] = parseGreenhouse('Firm', {
      jobs: [{ id: 1, title: 'Acquisitions Analyst', absolute_url: 'https://x/1', location: { name: 'Multiple Locations' }, offices: [{ name: 'Dallas' }], content: 'Entry level. 0-2 years of experience.' }]
    });
    const result = normalize(raw!, now);
    expect(result.ok && result.posting.city).toBe('Dallas');
  });
});

describe('Greenhouse completeness', () => {
  it('flags a board that lists fewer jobs than it says it holds', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ jobs: [rclco], meta: { total: 3 } }), { status: 200 })) as typeof fetch;
    const error = await fetchGreenhouse('RCLCO', 'rclco', { fetchImpl, retries: 0 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IncompleteBoardError);
    expect((error as IncompleteBoardError).jobs).toHaveLength(1);
  });

  it('accepts a board whose list matches its total', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ jobs: [rclco], meta: { total: 1 } }), { status: 200 })) as typeof fetch;
    await expect(fetchGreenhouse('RCLCO', 'rclco', { fetchImpl, retries: 0 })).resolves.toHaveLength(1);
  });
});

const firms: FirmRow[] = [
  { id: 1, name: 'RCLCO', ats: 'greenhouse', atsSlug: 'rclco', active: true, slugVerified: true },
  { id: 2, name: 'JLL', ats: 'workday', atsSlug: 'jll/jllcareers', atsHost: 'jll.wd1.myworkdayjobs.com', active: true, slugVerified: true }
];

function job(overrides: Partial<RawJob> = {}): RawJob {
  return {
    title: 'Real Estate Analyst',
    firm: 'JLL',
    location: 'Dallas, TX',
    description: 'Entry level analyst. 0-2 years of experience in commercial real estate.',
    applyUrl: 'https://jll.wd1.myworkdayjobs.com/jllcareers/job/1',
    ats: 'workday',
    ...overrides
  };
}

describe('board status in the run', () => {
  it('publishes what an incomplete board did read and reports it as read in part, not failed', async () => {
    const store = new MemoryStore(firms);
    const report = await runCollector({
      store,
      now,
      fetcher: async (firm) => {
        if (firm.name === 'JLL') throw new IncompleteBoardError('Workday jll/jllcareers: page 4 failed', [job({ sourceId: 'R1' })]);
        return parseGreenhouse('RCLCO', { jobs: [rclco] });
      }
    });
    expect(report.firmsFailed).toBe(0);
    expect(report.firmsIncomplete).toBe(1);
    expect(report.kept).toBe(2);
    expect(report.boards.map((board) => [board.firm, board.status, board.kept])).toEqual([['RCLCO', 'ok', 1], ['JLL', 'incomplete', 1]]);
  });

  it('keeps two openings with the same title and city when the board gives them different ids', async () => {
    const store = new MemoryStore([firms[1]!]);
    const report = await runCollector({
      store,
      now,
      fetcher: async () => [
        job({ sourceId: 'R1', applyUrl: 'https://x/R1' }),
        job({ sourceId: 'R2', applyUrl: 'https://x/R2' }),
        // The same requisition listed again (another location page): one opening.
        job({ sourceId: 'R1', applyUrl: 'https://x/R1' })
      ]
    });
    expect(report.kept).toBe(2);
    expect(report.distinctOpenings).toBe(1);
    expect([...store.postings.values()].map((p) => p.sourceId).sort()).toEqual(['R1', 'R2']);
  });

  it('keeps the first opening\'s id unchanged, so existing ids and history stay stable', async () => {
    const store = new MemoryStore([firms[1]!]);
    await runCollector({ store, now, fetcher: async () => [job({ sourceId: 'R1' })] });
    const before = [...store.postings.keys()];
    const again = new MemoryStore([firms[1]!]);
    await runCollector({ store: again, now, fetcher: async () => [job({ sourceId: 'R1' }), job({ sourceId: 'R2' })] });
    expect([...again.postings.keys()]).toContain(before[0]);
  });
});

describe('retained jobs', () => {
  async function build(fetcher: Parameters<typeof runCollector>[0]['fetcher'], at: Date) {
    const store = new MemoryStore(firms);
    const report = await runCollector({ store, now: at, fetcher });
    return { report, postings: [...store.postings.values()] };
  }
  const good: Parameters<typeof runCollector>[0]['fetcher'] = async (firm) =>
    firm.name === 'JLL' ? [job({ sourceId: 'R1' })] : parseGreenhouse('RCLCO', { jobs: [rclco] });

  it('keeps a failed board\'s jobs, marked with their last verified time, instead of dropping them', async () => {
    const first = await build(good, now);
    const kept = retainUnverified(null, first.report.boards, first.postings, now);
    const later = new Date(now.getTime() + 2 * 3_600_000);
    const second = await build(async (firm) => {
      if (firm.name === 'JLL') throw new Error('POST https://jll.wd1.myworkdayjobs.com/... returned 502');
      return parseGreenhouse('RCLCO', { jobs: [rclco] });
    }, later);
    const result = retainUnverified(kept.next, second.report.boards, second.postings, later);
    expect(result.postings).toHaveLength(2);
    const jll = result.postings.find((p) => p.firm === 'JLL')!;
    expect(result.verification.get(jll.id)).toEqual({ verifiedAt: now.toISOString(), retained: true });
    expect(result.closed).toBe(0);

    const snapshot = buildSnapshot(result.postings, second.report, undefined, result.verification);
    const site = snapshot.jobs.find((j) => j.firm === 'JLL')!;
    expect(site).toMatchObject({ retained: true, verifiedAt: now.toISOString(), sourceId: 'R1' });
    const fresh = snapshot.jobs.find((j) => j.firm === 'RCLCO')!;
    expect(fresh.retained).toBeUndefined();
    expect(fresh.verifiedAt).toBe(later.toISOString());
  });

  it('drops a job its board, read in full, no longer lists, and counts it closed', async () => {
    const first = await build(good, now);
    const kept = retainUnverified(null, first.report.boards, first.postings, now);
    const second = await build(async (firm) => (firm.name === 'JLL' ? [] : parseGreenhouse('RCLCO', { jobs: [rclco] })), now);
    const result = retainUnverified(kept.next, second.report.boards, second.postings, now);
    expect(result.postings.map((p) => p.firm)).toEqual(['RCLCO']);
    expect(result.closed).toBe(1);
  });

  it(`stops retaining after ${RETAIN_DAYS} days without a good read`, async () => {
    const first = await build(good, now);
    const kept = retainUnverified(null, first.report.boards, first.postings, now);
    const muchLater = new Date(now.getTime() + (RETAIN_DAYS + 1) * 86_400_000);
    const second = await build(async (firm) => {
      if (firm.name === 'JLL') throw new Error('timeout');
      return parseGreenhouse('RCLCO', { jobs: [rclco] });
    }, muchLater);
    const result = retainUnverified(kept.next, second.report.boards, second.postings, muchLater);
    expect(result.postings.map((p) => p.firm)).toEqual(['RCLCO']);
    expect(result.expired).toBe(1);
  });

  it('keeps the unread part of a board read in part, and refreshes the part it read', async () => {
    const first = await build(async (firm) => (firm.name === 'JLL' ? [job({ sourceId: 'R1' }), job({ title: 'Leasing Analyst', sourceId: 'R2' })] : []), now);
    const kept = retainUnverified(null, first.report.boards, first.postings, now);
    const later = new Date(now.getTime() + 3_600_000);
    const second = await build(async (firm) => {
      if (firm.name === 'JLL') throw new IncompleteBoardError('page 2 failed', [job({ sourceId: 'R1' })]);
      return [];
    }, later);
    const result = retainUnverified(kept.next, second.report.boards, second.postings, later);
    const byRole = new Map(result.postings.map((p) => [p.role, result.verification.get(p.id)]));
    expect(byRole.get('Real Estate Analyst')).toEqual({ verifiedAt: later.toISOString(), retained: false });
    expect(byRole.get('Leasing Analyst')).toEqual({ verifiedAt: now.toISOString(), retained: true });
  });
});
