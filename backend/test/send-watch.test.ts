import { describe, expect, it } from 'vitest';
import type { HistoryDay } from '../src/alerts/history.js';
import {
  MAX_ATTEMPTS,
  baselineDay,
  comparisonDays,
  isDue,
  runWatchDigests,
  type Mailer,
  type SendRow,
  type WatchRecipient,
  type WatchStore
} from '../src/alerts/sendWatch.js';
import { unsubscribeToken, unsubscribeUrl, validToken } from '../src/alerts/unsubscribe.js';

const SECRET = 'ab'.repeat(32);
const TODAY = '2026-10-12';

function day(d: string, rent: number, period: string): HistoryDay {
  return {
    v: 1,
    day: d,
    generatedAt: `${d}T12:00:00Z`,
    metricInfo: { aptRent: ['Apartment rent', 'usd'] },
    metrics: { Austin: { aptRent: { v: rent, p: period } } },
    behind: [],
    projects: {},
    registrations: { days: 10, items: [], coverage: [] }
  };
}

const HISTORY = [day('2026-10-04', 1500, 'Aug 2026'), day('2026-10-05', 1500, 'Aug 2026'), day('2026-10-11', 1520, 'Sep 2026'), day(TODAY, 1520, 'Sep 2026')];

function member(over: Partial<WatchRecipient> = {}): WatchRecipient {
  return {
    user_id: '00000000-0000-4000-8000-000000000001',
    email: 'sam@utexas.edu',
    digest_frequency: 'weekly',
    last_day: '2026-10-05',
    items: [{ id: 'i1', kind: 'market', city: 'Austin', ref: '', filters: {} }],
    ...over
  };
}

/** An in-memory send log and history, recording every call in order. */
function fakeStore(history = HISTORY, fail: Partial<Record<keyof WatchStore, boolean>> = {}) {
  const rows = new Map<string, SendRow & { error?: string }>();
  const digestDays = new Map<string, string>();
  const calls: string[] = [];
  const maybeFail = (name: keyof WatchStore) => {
    calls.push(name);
    if (fail[name]) throw new Error(`${name} is down`);
  };
  const store: WatchStore = {
    async history(from, to) {
      maybeFail('history');
      return history.filter((h) => h.day >= from && h.day <= to);
    },
    async sends(_user, ids) {
      maybeFail('sends');
      return ids.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : []));
    },
    async claim(_user, claimed) {
      maybeFail('claim');
      for (const c of claimed) rows.set(c.event_id, { event_id: c.event_id, state: 'pending', attempts: c.attempts });
    },
    async markSent(_user, ids) {
      maybeFail('markSent');
      for (const id of ids) rows.get(id)!.state = 'sent';
    },
    async markFailed(_user, ids, error, giveUp) {
      maybeFail('markFailed');
      for (const id of ids) Object.assign(rows.get(id) ?? rows.set(id, { event_id: id, state: 'pending', attempts: MAX_ATTEMPTS }).get(id)!, { error, ...(giveUp ? { state: 'failed' } : {}) });
    },
    async setDigestDay(user, d) {
      maybeFail('setDigestDay');
      digestDays.set(user, d);
    }
  };
  return { store, rows, digestDays, calls };
}

function fakeMailer(failTimes = 0) {
  const sent: Parameters<Mailer['send']>[0][] = [];
  let failures = failTimes;
  const mailer: Mailer = {
    async send(message) {
      if (failures-- > 0) throw new Error('421 try again later');
      sent.push(message);
    }
  };
  return { mailer, sent };
}

const run = (store: WatchStore, mailer: Mailer | null, recipients = [member()], budget = 300) =>
  runWatchDigests({ recipients, store, mailer, today: TODAY, siteUrl: 'https://example.org/Terra/', linkSecret: SECRET, budget });

describe('when a digest is due', () => {
  it('goes daily or weekly, and right away for a first digest', () => {
    expect(isDue({ digest_frequency: 'weekly', last_day: null }, TODAY)).toBe(true);
    expect(isDue({ digest_frequency: 'weekly', last_day: '2026-10-06' }, TODAY)).toBe(false);
    expect(isDue({ digest_frequency: 'weekly', last_day: '2026-10-05' }, TODAY)).toBe(true);
    expect(isDue({ digest_frequency: 'daily', last_day: TODAY }, TODAY)).toBe(false);
    expect(isDue({ digest_frequency: 'daily', last_day: '2026-10-11' }, TODAY)).toBe(true);
    expect(baselineDay({ digest_frequency: 'weekly', last_day: null }, TODAY)).toBe('2026-10-05');
    expect(baselineDay({ digest_frequency: 'daily', last_day: null }, TODAY)).toBe('2026-10-11');
  });

  it('compares from the newest stored day on or before the baseline, or the oldest kept', () => {
    expect(comparisonDays(HISTORY, '2026-10-07', TODAY).map((d) => d.day)).toEqual(['2026-10-05', '2026-10-11', TODAY]);
    expect(comparisonDays(HISTORY, '2026-09-01', TODAY)[0]!.day).toBe('2026-10-04');
    expect(comparisonDays([day(TODAY, 1, 'x')], '2026-10-05', TODAY)).toEqual([]);
  });
});

describe('sending watchlist digests', () => {
  it('claims the changes before sending, then marks them sent and moves the digest day', async () => {
    const { store, rows, digestDays, calls } = fakeStore();
    const { mailer, sent } = fakeMailer();
    const summary = await run(store, mailer);
    expect(summary).toMatchObject({ due: 1, sent: 1, events: 1, failed: 0 });
    expect(calls).toEqual(['history', 'sends', 'claim', 'markSent', 'setDigestDay']);
    expect([...rows.values()]).toEqual([{ event_id: 'market:Austin:aptRent:Sep 2026:1520', state: 'sent', attempts: 1 }]);
    expect(digestDays.get(member().user_id)).toBe(TODAY);
    expect(sent[0]!.headers['List-Unsubscribe']).toContain(unsubscribeToken(SECRET, member().user_id, 'watch'));
    expect(sent[0]!.subject).toBe('Terra watchlist: Austin: Apartment rent rose');
  });

  it('never sends the same change twice', async () => {
    const { store } = fakeStore();
    const { mailer, sent } = fakeMailer();
    await run(store, mailer);
    // Same baseline again (as if the digest day had not moved): the log stops a repeat.
    const again = await run(store, mailer);
    expect(sent).toHaveLength(1);
    expect(again).toMatchObject({ sent: 0, nothingNew: 1 });
  });

  it('sends nothing to a member whose claim cannot be written', async () => {
    const { store, digestDays } = fakeStore(HISTORY, { claim: true });
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer)).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    expect(digestDays.size).toBe(0);
  });

  it('retries a refused send on the next run, then gives up after the limit', async () => {
    const { store, rows, digestDays } = fakeStore();
    const { mailer, sent } = fakeMailer(MAX_ATTEMPTS);
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      expect(await run(store, mailer)).toMatchObject({ sent: 0, failed: 1 });
      expect([...rows.values()][0]).toMatchObject({ attempts: i, state: i === MAX_ATTEMPTS ? 'failed' : 'pending', error: '421 try again later' });
    }
    expect(digestDays.size).toBe(0);
    expect(await run(store, mailer)).toMatchObject({ sent: 0, nothingNew: 1 });
    expect(sent).toHaveLength(0);
  });

  it('does not assume a change left pending by a stopped run was delivered: it retries it', async () => {
    const { store, rows } = fakeStore();
    rows.set('market:Austin:aptRent:Sep 2026:1520', { event_id: 'market:Austin:aptRent:Sep 2026:1520', state: 'pending', attempts: 1 });
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer)).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect([...rows.values()][0]).toMatchObject({ state: 'sent', attempts: 2 });
  });

  it('gives up on a change still pending after the retry limit, without sending it', async () => {
    const { store, rows } = fakeStore();
    rows.set('market:Austin:aptRent:Sep 2026:1520', { event_id: 'market:Austin:aptRent:Sep 2026:1520', state: 'pending', attempts: MAX_ATTEMPTS });
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer)).toMatchObject({ sent: 0, gaveUp: 1, nothingNew: 1 });
    expect(sent).toHaveLength(0);
    expect([...rows.values()][0]!.state).toBe('failed');
  });

  it('moves the digest day after a send it could not confirm, so the same changes are not rebuilt', async () => {
    const { store, rows, digestDays } = fakeStore(HISTORY, { markSent: true });
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer)).toMatchObject({ sent: 1, unconfirmed: 1 });
    expect([...rows.values()][0]!.state).toBe('pending');
    expect(digestDays.get(member().user_id)).toBe(TODAY);
    expect(await run(store, mailer, [member({ last_day: TODAY })])).toMatchObject({ due: 0 });
    expect(sent).toHaveLength(1);
  });

  it('sends and records nothing on a dry run', async () => {
    const { store, rows, digestDays, calls } = fakeStore();
    expect(await run(store, null)).toMatchObject({ sent: 1, events: 1 });
    expect(rows.size).toBe(0);
    expect(digestDays.size).toBe(0);
    expect(calls).not.toContain('claim');
  });

  it('holds digests over the shared daily cap for the next run', async () => {
    const { store, digestDays } = fakeStore();
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer, [member()], 0)).toMatchObject({ deferred: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    expect(digestDays.size).toBe(0);
  });

  it('starts the comparison on a first digest with no earlier day, without emailing', async () => {
    const { store, digestDays } = fakeStore([day(TODAY, 1520, 'Sep 2026')]);
    const { mailer, sent } = fakeMailer();
    expect(await run(store, mailer, [member({ last_day: null })])).toMatchObject({ baseline: 1, sent: 0 });
    expect(sent).toHaveLength(0);
    expect(digestDays.get(member().user_id)).toBe(TODAY);
  });

  it('skips members who are not due or follow nothing', async () => {
    const { store } = fakeStore();
    const { mailer, sent } = fakeMailer();
    const summary = await run(store, mailer, [member({ last_day: '2026-10-10' }), member({ items: [] }), member({ items: null })]);
    expect(summary.due).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('unsubscribe links', () => {
  const user = '00000000-0000-4000-8000-000000000001';

  it('signs each member and kind of email separately', () => {
    const token = unsubscribeToken(SECRET, user, 'watch');
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(validToken(SECRET, user, 'watch', token)).toBe(true);
    expect(validToken(SECRET, user, 'jobs', token)).toBe(false);
    expect(validToken(SECRET, '00000000-0000-4000-8000-000000000002', 'watch', token)).toBe(false);
    expect(validToken('cd'.repeat(32), user, 'watch', token)).toBe(false);
    expect(validToken(SECRET, user, 'watch', 'not hex')).toBe(false);
  });

  it('builds a link to the site that the page can read', () => {
    const link = new URL(unsubscribeUrl('https://example.org/Terra/?job=1#tracker', SECRET, user, 'jobs'));
    expect(link.origin + link.pathname).toBe('https://example.org/Terra/');
    expect(link.hash).toBe('');
    expect(Object.fromEntries(link.searchParams)).toEqual({ unsubscribe: 'jobs', u: user, t: unsubscribeToken(SECRET, user, 'jobs') });
  });
});
