/**
 * PR #90 review: stable opening identity and strict Greenhouse responses.
 */
import { describe, expect, it } from 'vitest';
import { fetchGreenhouse, validateGreenhouse } from '../src/collector/sources/greenhouse.js';
import { IncompleteBoardError } from '../src/collector/sources/incomplete.js';
import { runCollector, type Fetcher } from '../src/collector/run.js';
import { openingId, postingId } from '../src/collector/id.js';
import { MemoryStore, type FirmRow } from '../src/db/store.js';
import { resolveIdentity, type IdentityState } from '../src/site/identity.js';
import { retainUnverified, type RetainFile } from '../src/site/retain.js';
import type { Posting, RawJob } from '../src/types.js';

const t0 = new Date('2026-10-20T12:00:00Z');
const hours = (n: number) => new Date(t0.getTime() + n * 3_600_000);

const jll: FirmRow = { id: 1, name: 'JLL', ats: 'workday', atsSlug: 'jll/jllcareers', atsHost: 'jll.wd1.myworkdayjobs.com', active: true, slugVerified: true };
const rclco: FirmRow = { id: 2, name: 'RCLCO', ats: 'greenhouse', atsSlug: 'rclco', active: true, slugVerified: true };

function opening(sourceId: string): RawJob {
  return {
    title: 'Leasing Analyst',
    firm: 'JLL',
    location: 'Dallas, TX',
    description: 'Entry level. 0-2 years of experience in commercial real estate leasing.',
    applyUrl: `https://jll.wd1.myworkdayjobs.com/jllcareers/job/Dallas/Leasing-Analyst_${sourceId}`,
    ats: 'workday',
    sourceId
  };
}

async function pass(fetcher: Fetcher, at: Date, firms: FirmRow[] = [jll]) {
  const store = new MemoryStore(firms);
  const report = await runCollector({ store, now: at, fetcher });
  return { report, postings: [...store.postings.values()] };
}

/** One build as export-site runs it: retain, then resolve the published ids. */
async function build(previous: RetainFile | null, fetcher: Fetcher, at: Date, firms: FirmRow[] = [jll]) {
  const { report, postings } = await pass(fetcher, at, firms);
  const retained = retainUnverified(previous, report.boards, postings, at);
  const identity = resolveIdentity(previous?.identity ?? null, retained.postings, at);
  const next: RetainFile = { ...retained.next, identity: identity.next };
  const published = new Map(retained.postings.map((p) => [p.sourceId ?? p.id, identity.published.get(p.id)!]));
  return { report, retained, identity, next, published };
}

const legacy = postingId('JLL', 'Leasing Analyst', 'Dallas');
const idR1 = openingId('workday', 'jll.wd1.myworkdayjobs.com/jll/jllcareers', 'R1');
const idR2 = openingId('workday', 'jll.wd1.myworkdayjobs.com/jll/jllcareers', 'R2');

describe('opening ids', () => {
  it('come from ATS, board and job id, whatever order the board lists them in', async () => {
    const a = await pass(async () => [opening('R1'), opening('R2')], t0);
    const b = await pass(async () => [opening('R2'), opening('R1')], t0);
    const ids = (r: typeof a) => new Map(r.postings.map((p) => [p.sourceId, p.id]));
    expect(ids(a)).toEqual(ids(b));
    expect(ids(a).get('R1')).toBe(idR1);
    expect(ids(a).get('R2')).toBe(idR2);
    expect(a.postings.every((p) => p.legacyId === legacy)).toBe(true);
    expect(a.report.distinctOpenings).toBe(1);
  });

  it('do not change with the title or city wording', async () => {
    const a = await pass(async () => [opening('R1')], t0);
    const b = await pass(async () => [{ ...opening('R1'), title: 'Leasing Analyst - Dallas Office' }], t0);
    expect(a.postings[0]!.id).toBe(b.postings[0]!.id);
  });

  it('are scoped to the board, so the same job id on another board is another opening', () => {
    expect(openingId('greenhouse', 'rclco', '1')).not.toBe(openingId('greenhouse', 'lincoln', '1'));
    expect(openingId('greenhouse', 'rclco', '1')).not.toBe(openingId('workday', 'rclco', '1'));
  });
});

describe('carrying over the old firm + title + city ids', () => {
  it('binds an old id held by exactly one opening, and keeps publishing under it', async () => {
    const first = await build(null, async () => [opening('R1')], t0);
    expect(first.published.get('R1')).toBe(legacy);
    expect(first.identity.bound).toBe(1);
    const second = await build(first.next, async () => [opening('R1')], hours(2));
    expect(second.published.get('R1')).toBe(legacy);
  });

  it('gives a shared old id to neither opening, and says so', async () => {
    const first = await build(null, async () => [opening('R1'), opening('R2')], t0);
    expect(first.identity.ambiguous).toBe(1);
    expect(first.published.get('R1')).toBe(idR1);
    expect(first.published.get('R2')).toBe(idR2);
  });

  it('is the same in reversed order', async () => {
    const a = await build(null, async () => [opening('R1'), opening('R2')], t0);
    const b = await build(null, async () => [opening('R2'), opening('R1')], t0);
    expect(b.published).toEqual(new Map([...a.published].reverse()));
  });

  it('never moves the old id to the second opening when the first closes', async () => {
    const first = await build(null, async () => [opening('R1')], t0);
    expect(first.published.get('R1')).toBe(legacy);
    // R2 is posted with the same title and city; R1 is still up.
    const second = await build(first.next, async () => [opening('R1'), opening('R2')], hours(2));
    expect(second.published.get('R1')).toBe(legacy);
    expect(second.published.get('R2')).toBe(idR2);
    // R1 closes, the board read in full.
    const third = await build(second.next, async () => [opening('R2')], hours(4));
    expect(third.retained.closed).toBe(1);
    expect(third.identity.retiredClosed).toBe(1);
    expect(third.published.get('R2')).toBe(idR2);
    expect(third.next.identity!.aliases[legacy]).toBeUndefined();
    // And it stays retired even when R2 is later alone under that title.
    const fourth = await build(third.next, async () => [opening('R2')], hours(6));
    expect(fourth.published.get('R2')).toBe(idR2);
  });

  it('keeps the first opening, retained and bound, when a partial read returns only the second', async () => {
    const first = await build(null, async () => [opening('R1')], t0);
    const second = await build(first.next, async () => [opening('R1'), opening('R2')], hours(2));
    const partial = await build(second.next, async () => {
      throw new IncompleteBoardError('Workday jll/jllcareers: page 2 failed', [opening('R2')]);
    }, hours(4));
    expect(partial.report.boards[0]!.status).toBe('incomplete');
    expect(partial.retained.closed).toBe(0);
    expect(partial.published.get('R1')).toBe(legacy);
    expect(partial.published.get('R2')).toBe(idR2);
    const r1 = partial.retained.postings.find((p) => p.sourceId === 'R1')!;
    expect(partial.retained.verification.get(r1.id)).toEqual({ verifiedAt: hours(2).toISOString(), retained: true });
  });

  it('forgets nothing it was not asked to: a retired id stays retired across builds', () => {
    const state: IdentityState = { aliases: {}, retired: { [legacy]: '2026-10-20' } };
    const posting = { id: idR1, legacyId: legacy } as Posting;
    const result = resolveIdentity(state, [posting], t0);
    expect(result.published.get(idR1)).toBe(idR1);
  });
});

const job = (id: number) => ({ id, title: '2027 Summer Intern, Real Estate Economics', absolute_url: `https://job-boards.greenhouse.io/rclco/jobs/${id}`, location: { name: 'Austin, TX' }, content: 'Internship for students.' });
const reply = (body: unknown, status = 200) => (async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('malformed Greenhouse responses', () => {
  for (const [name, body] of [
    ['an empty object', {}],
    ['jobs: null', { jobs: null }],
    ['jobs as an object', { jobs: { 1: job(1) } }],
    ['a job without an id', { jobs: [{ title: 'x' }] }],
    ['a non-numeric total', { jobs: [], meta: { total: 'many' } }],
    ['an array', [job(1)]]
  ] as const) {
    it(`rejects ${name}`, async () => {
      await expect(fetchGreenhouse('RCLCO', 'rclco', { fetchImpl: reply(body), retries: 0 })).rejects.toThrow(/malformed/);
    });
  }

  it('accepts a valid empty board', () => {
    expect(validateGreenhouse('rclco', { jobs: [], meta: { total: 0 } }).jobs).toEqual([]);
    expect(validateGreenhouse('rclco', { jobs: [] }).jobs).toEqual([]);
  });

  async function withBoard(fetchImpl: typeof fetch, at: Date, previous: RetainFile | null) {
    return build(previous, (firm) => fetchGreenhouse(firm.name, firm.atsSlug, { fetchImpl, retries: 0 }), at, [rclco]);
  }

  it('keeps the previous jobs, with their original last verified time, after a malformed response', async () => {
    const first = await withBoard(reply({ jobs: [job(8266046)], meta: { total: 1 } }), t0, null);
    expect(first.retained.postings).toHaveLength(1);
    for (const body of [{}, { jobs: null }, '<html>Service unavailable</html>']) {
      const later = await withBoard(reply(body), hours(2), first.next);
      expect(later.report.boards[0]!.status).toBe('failed');
      expect(later.retained.postings).toHaveLength(1);
      const kept = later.retained.postings[0]!;
      expect(later.retained.verification.get(kept.id)).toEqual({ verifiedAt: t0.toISOString(), retained: true });
      expect(later.retained.closed).toBe(0);
    }
  });

  it('closes them when the board answers validly and completely with no jobs', async () => {
    const first = await withBoard(reply({ jobs: [job(8266046)], meta: { total: 1 } }), t0, null);
    const later = await withBoard(reply({ jobs: [], meta: { total: 0 } }), hours(2), first.next);
    expect(later.report.boards[0]!.status).toBe('ok');
    expect(later.retained.postings).toHaveLength(0);
    expect(later.retained.closed).toBe(1);
  });
});
