import { describe, expect, it } from 'vitest';
import { DETAILS_EVERY_DAYS, refreshFollowed, type FollowedFetchers, type FollowedProject } from '../src/alerts/followed.js';
import type { HistoryDay, HistoryProject } from '../src/alerts/history.js';
import { MAX_ATTEMPTS, runWatchDigests, type Mailer, type SendRow, type WatchRecipient, type WatchStore } from '../src/alerts/sendWatch.js';
import { watchEvents, type WatchItem } from '../src/alerts/watch.js';
import { currentDevelopments, parseProjectPage, projectDetails, type TabsRow } from '../src/market/developments.js';

/**
 * Followed projects tracked on their own (improvements 1-3 of the Development
 * Watch audit). Roadrunner Way - UTSA is the real project Rod follows; its
 * values below are what TABS showed on 2026-10-12.
 */

const RR = 'TABS2025026208';
const RR_ROW: TabsRow = {
  ProjectNumber: RR,
  ProjectName: 'Roadrunner Way - UTSA (Student Housing)',
  ProjectCreatedOn: '2025-08-19T15:25:19.65',
  ProjectStatus: 3009,
  FacilityName: 'Roadrunner Way - UTSA (Student Housing)',
  City: 1537,
  County: 2015,
  TypeOfWork: 9001,
  EstimatedCost: 27102384,
  EstimatedStartDate: '2025-11-15T00:00:00',
  EstimatedEndDate: '2026-07-01T00:00:00'
};

/** The project page as TABS serves it (text cut to the parts the parser reads). */
function rrPage(over: { owner?: string; firm?: string; feet?: string; scope?: string } = {}): string {
  const f = (label: string, ...values: string[]) => `<dt>${label}</dt><dd>${values.map((v) => `<span>${v}</span>`).join('<br/>')}</dd>`;
  return `<html><body><h3>Project #:</h3><p>${RR}</p>
    <h4>PROJECT</h4><dl>${f('Project Name:', RR_ROW.ProjectName)}${f('Location Address:', '14440 Roadrunner Way', 'San Antonio, TX 78249')}${f('Start Date:', '11/15/2025')}${f('Completion Date:', '7/1/2026')}${f('Estimated Cost:', '$27,102,384')}${f('Type of Funds:', 'This project is privately funded, on private land for private use.')}${f(
      'Scope of Work:',
      over.scope ?? 'NEW TYPE VA 4-STORY (&amp; BASEMENT) R-2 MULTI-FAMILY BUILDING WITH A TOTAL OF 163 UNITS.'
    )}${f('Square Footage:', over.feet ?? '188,301 ft', '2')}${f('Current Status:', 'Review Complete')}</dl>
    <h4>OWNER</h4><dl>${f('Owner Name:', over.owner ?? 'Roadrunner Way Realty, LLC')}</dl>
    <h4>TENANT</h4><dl><dt>Not Assigned</dt></dl>
    <h4>DESIGN FIRM</h4><dl>${f('Design Firm Name:', over.firm ?? 'Waldon Studio Architects, A Michael Graves Company, Inc.')}</dl>
    <p>Registered accessibility specialists (RAS) set and collect the fees.</p></body></html>`;
}

function fakeTabs(rows: Record<string, TabsRow | null | Error>, pages: Record<string, string | Error> = {}) {
  const calls: string[] = [];
  const fetchers: FollowedFetchers = {
    async search(number) {
      calls.push(`search:${number}`);
      const r = rows[number];
      if (r instanceof Error) throw r;
      return r ?? null;
    },
    async page(number) {
      calls.push(`page:${number}`);
      const p = pages[number] ?? rrPage();
      if (p instanceof Error) throw p;
      return p;
    }
  };
  return { fetchers, calls };
}

const at = (iso: string) => new Date(iso);
const noPause = { pauseMs: 0, pause: async () => {} };

describe('reading followed projects from TABS', () => {
  it('parses the real Roadrunner Way page fields', () => {
    const d = projectDetails(parseProjectPage(rrPage()));
    expect(d.owner).toBe('Roadrunner Way Realty, LLC');
    expect(d.designFirm).toBe('Waldon Studio Architects, A Michael Graves Company, Inc.');
    expect(d.squareFeet).toBe(188301);
    expect(d.scope).toMatch(/^NEW TYPE VA 4-STORY \(& BASEMENT\)/);
  });

  it('reads each followed TABS number by its official id, plus the page on the first check', async () => {
    const { fetchers, calls } = fakeTabs({ [RR]: RR_ROW });
    const { followed, summary } = await refreshFollowed([RR, RR, 'CITY-SanAntonio-123', 'not a ref'], {}, { fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause });
    expect(calls).toEqual([`search:${RR}`, `page:${RR}`]);
    expect(followed[RR]).toMatchObject({
      state: 'ok',
      checked: '2026-10-13T11:00:00.000Z',
      code: 3009,
      st: 'Plans reviewed',
      cost: 27102384,
      start: '2025-11-15',
      end: '2026-07-01',
      url: `https://www.tdlr.texas.gov/TABS/Projects/${RR}`,
      details: { owner: 'Roadrunner Way Realty, LLC', squareFeet: 188301, checked: '2026-10-13T11:00:00.000Z' }
    });
    expect(summary).toMatchObject({ checked: 1, ok: 1, pages: 1, requests: 2 });
  });

  it('re-reads the page about weekly, not every day', async () => {
    const first = (await refreshFollowed([RR], {}, { fetchers: fakeTabs({ [RR]: RR_ROW }).fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause })).followed;
    const next = fakeTabs({ [RR]: RR_ROW });
    await refreshFollowed([RR], first, { fetchers: next.fetchers, now: at('2026-10-16T11:00:00Z'), ...noPause });
    expect(next.calls).toEqual([`search:${RR}`]);
    const week = fakeTabs({ [RR]: RR_ROW });
    await refreshFollowed([RR], first, { fetchers: week.fetchers, now: at(`2026-10-${13 + DETAILS_EVERY_DAYS}T11:00:00Z`), ...noPause });
    expect(week.calls).toEqual([`search:${RR}`, `page:${RR}`]);
  });

  it('does not ask TABS again once a project was read on the same Texas day', async () => {
    const first = (await refreshFollowed([RR], {}, { fetchers: fakeTabs({ [RR]: RR_ROW }).fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause })).followed;
    const again = fakeTabs({ [RR]: RR_ROW });
    const { summary } = await refreshFollowed([RR], first, { fetchers: again.fetchers, now: at('2026-10-13T19:00:00Z'), today: '2026-10-13', ...noPause });
    expect(again.calls).toEqual([]);
    expect(summary.reused).toBe(1);
  });

  it('keeps the last good values when TABS is down, and says so', async () => {
    const first = (await refreshFollowed([RR], {}, { fetchers: fakeTabs({ [RR]: RR_ROW }).fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause })).followed;
    const { followed } = await refreshFollowed([RR], first, { fetchers: fakeTabs({ [RR]: new Error('fetch failed') }).fetchers, now: at('2026-10-14T11:00:00Z'), ...noPause });
    expect(followed[RR]).toMatchObject({ state: 'error', checked: '2026-10-13T11:00:00.000Z', failedAt: '2026-10-14T11:00:00.000Z', error: 'fetch failed', cost: 27102384, end: '2026-07-01' });
  });

  it('keeps earlier page details when the page fails or comes back empty', async () => {
    const first = (await refreshFollowed([RR], {}, { fetchers: fakeTabs({ [RR]: RR_ROW }).fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause })).followed;
    for (const page of [new Error('502'), '<html><body>Maintenance</body></html>']) {
      const { followed } = await refreshFollowed([RR], first, { fetchers: fakeTabs({ [RR]: RR_ROW }, { [RR]: page }).fetchers, now: at('2026-10-21T11:00:00Z'), ...noPause });
      expect(followed[RR]!.details).toEqual(first[RR]!.details);
      expect(followed[RR]!.detailsError).toBeTruthy();
      expect(followed[RR]!.state).toBe('ok');
    }
  });

  it('marks a project TABS answers for without listing it as not found, keeping its values', async () => {
    const first = (await refreshFollowed([RR], {}, { fetchers: fakeTabs({ [RR]: RR_ROW }).fetchers, now: at('2026-10-13T11:00:00Z'), ...noPause })).followed;
    const { followed } = await refreshFollowed([RR], first, { fetchers: fakeTabs({ [RR]: null }).fetchers, now: at('2026-10-14T11:00:00Z'), ...noPause });
    expect(followed[RR]).toMatchObject({ state: 'not_found', n: RR_ROW.ProjectName, cost: 27102384 });
  });
});

// ---------------------------------------------------------------------------
// History days and change detection
// ---------------------------------------------------------------------------

const RR_MAP: HistoryProject = { c: 'San Antonio', n: RR_ROW.ProjectName, st: 'Plans reviewed', cost: 27102384, end: '2026-07-01', src: 'tabs', url: `https://www.tdlr.texas.gov/TABS/Projects/${RR}` };

function rec(day: string, over: Partial<FollowedProject> = {}, details: Partial<NonNullable<FollowedProject['details']>> = {}): FollowedProject {
  return {
    state: 'ok',
    checked: `${day}T11:00:00.000Z`,
    n: RR_ROW.ProjectName,
    code: 3009,
    st: 'Plans reviewed',
    cost: 27102384,
    start: '2025-11-15',
    end: '2026-07-01',
    url: RR_MAP.url,
    details: { owner: 'Roadrunner Way Realty, LLC', designFirm: 'Waldon Studio Architects', squareFeet: 188301, scope: 'NEW 4-STORY R-2, 163 UNITS', checked: '2026-10-13T11:00:00.000Z', ...details },
    ...over
  };
}

function day(d: string, followed?: FollowedProject | null, onMap = false): HistoryDay {
  return {
    v: followed === undefined ? 1 : 2,
    day: d,
    generatedAt: `${d}T11:00:00Z`,
    metricInfo: {},
    metrics: {},
    behind: [],
    projects: onMap ? { [RR]: RR_MAP } : {},
    registrations: null,
    ...(followed === undefined ? {} : { followed: followed ? { [RR]: followed } : {} })
  };
}

const WATCH: WatchItem = { id: 'w1', kind: 'project', city: 'San Antonio', ref: RR, filters: {} };
const ids = (days: HistoryDay[]) => watchEvents([WATCH], days).events.map((e) => e.id.split(':').slice(2, 4).join(':'));

describe('Roadrunner Way past its estimated finish', () => {
  it('drops off the map after Oct 29, 2026 but keeps being tracked', () => {
    expect(currentDevelopments([RR_ROW], at('2026-10-28T12:00:00Z'))).toHaveLength(1);
    expect(currentDevelopments([RR_ROW], at('2026-10-30T12:00:00Z'))).toHaveLength(0);

    // Oct 12: on the map (v1 row). Nov 5: off the map, followed check still reads it.
    const days = [day('2026-10-12', undefined, true), day('2026-11-05', rec('2026-11-05')), day('2026-11-12', rec('2026-11-12', { code: 3001, st: 'Inspection complete' }))];
    const result = watchEvents([WATCH], days);
    expect(result.events.map((e) => e.title)).toEqual(['Roadrunner Way - UTSA (Student Housing): TABS lists it as Inspection complete']);
    expect(result.events[0]!.detail).toMatch(/Status was Plans reviewed\. TABS marks the project finished or closed\. Source: TDLR TABS, checked Nov 12, 2026\./);
    expect(result.events.some((e) => /off the (development )?map/i.test(e.title))).toBe(false);
  });

  it('reports a new finish date filed after the old one passed', () => {
    expect(ids([day('2026-11-05', rec('2026-11-05')), day('2026-11-06', rec('2026-11-06', { end: '2027-01-15' }))])).toEqual(['end:2026-11-06']);
  });
});

describe('what counts as a change', () => {
  const base = day('2026-10-13', rec('2026-10-13'));

  it('reports cost, start, finish, status and name changes with their source and check time', () => {
    const next = day('2026-10-14', rec('2026-10-14', { cost: 29_500_000, start: '2025-12-01', end: '2026-12-15', code: 3002, st: 'Inspection under way', n: 'Roadrunner Way Phase I' }));
    const r = watchEvents([WATCH], [base, next]);
    expect(r.events.map((e) => e.id.split(':')[2])).toEqual(['status', 'cost', 'end', 'start', 'name']);
    for (const e of r.events) expect(e.detail).toMatch(/Source: TDLR TABS, checked Oct 14, 2026\.$/);
  });

  it('reports owner, design firm, size and scope only when the page was read again', () => {
    const changed = { owner: 'UTSA Housing LLC', designFirm: 'Other Architects', squareFeet: 190000, scope: 'NEW 5-STORY R-2, 180 UNITS', checked: '2026-10-20T11:00:00.000Z' };
    const r = watchEvents([WATCH], [base, day('2026-10-20', rec('2026-10-20', {}, changed))]);
    expect(r.events.map((e) => e.id.split(':')[2])).toEqual(['owner', 'design', 'size', 'scope']);
    expect(r.events[0]!.detail).toBe('Was Roadrunner Way Realty, LLC. Source: TDLR TABS project page, read Oct 20, 2026.');
    // Same page read (same checked time) carried forward: nothing new.
    expect(ids([base, day('2026-10-14', rec('2026-10-14'))])).toEqual([]);
  });

  it('treats blank values and capitalization or spacing as no change', () => {
    const blank = rec('2026-10-14', { cost: null, start: null, end: null }, { owner: null, designFirm: null, squareFeet: null, scope: null, checked: '2026-10-14T11:00:00.000Z' });
    expect(ids([base, day('2026-10-14', blank)])).toEqual([]);
    const spaced = rec('2026-10-15', {}, { owner: 'ROADRUNNER  WAY REALTY, LLC', checked: '2026-10-15T11:00:00.000Z' });
    expect(ids([base, day('2026-10-15', spaced)])).toEqual([]);
  });

  it('never reads an outage as a change, and compares across it', () => {
    const down = rec('2026-10-13', { state: 'error', failedAt: '2026-10-14T11:00:00Z', error: 'fetch failed' });
    expect(ids([base, day('2026-10-14', down)])).toEqual([]);
    expect(ids([base, day('2026-10-14', down), day('2026-10-15', rec('2026-10-15', { cost: 3e7 }))])).toEqual(['cost:2026-10-15']);
    // A day with no followed record and no map entry is unknown, not gone.
    expect(ids([base, day('2026-10-14', null), day('2026-10-15', rec('2026-10-15'))])).toEqual([]);
  });

  it('notes an outage on the newest day without making it an event', () => {
    const r = watchEvents([WATCH], [base, day('2026-10-14', rec('2026-10-13', { state: 'error', failedAt: '2026-10-14T11:00:00Z' }))]);
    expect(r.events).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/couldn't be checked for Roadrunner Way - UTSA \(Student Housing\) on the latest build; it was last checked Oct 13, 2026/);
  });

  it('reports "no longer listed" only after two not-found checks, once', () => {
    const gone = (d: string) => day(d, rec('2026-10-13', { state: 'not_found', checked: `${d}T11:00:00Z` }));
    expect(ids([base, gone('2026-10-14')])).toEqual([]);
    expect(ids([base, gone('2026-10-14'), gone('2026-10-15'), gone('2026-10-16')])).toEqual(['notfound:2026-10-14']);
    expect(ids([base, gone('2026-10-14'), day('2026-10-15', rec('2026-10-15'))])).toEqual([]);
  });

  it('reports a change that is undone during the period, both ways', () => {
    const days = [base, day('2026-10-14', rec('2026-10-14', { cost: 3e7 })), day('2026-10-15', rec('2026-10-15'))];
    const r = watchEvents([WATCH], days);
    expect(r.events.map((e) => e.title)).toEqual([
      'Roadrunner Way - UTSA (Student Housing): estimated cost now $30.0M',
      'Roadrunner Way - UTSA (Student Housing): estimated cost now $27.1M'
    ]);
    expect(new Set(r.events.map((e) => e.id)).size).toBe(2);
  });

  it('does not invent a status change between map rows and TABS checks', () => {
    // v1 map row (no code) then a v2 followed check with the same label.
    expect(ids([day('2026-10-12', undefined, true), day('2026-10-13', rec('2026-10-13'))])).toEqual([]);
    // An unlisted TABS code reads "Status 3011" from the check, "Registered" on the map: not comparable.
    expect(ids([day('2026-10-12', undefined, true), day('2026-10-13', rec('2026-10-13', { code: 3011, st: 'Status 3011' }))])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Digests over these days
// ---------------------------------------------------------------------------

function memStore(history: HistoryDay[]) {
  const rows = new Map<string, SendRow>();
  const digest = new Map<string, string>();
  const store: WatchStore = {
    history: async (from, to) => history.filter((h) => h.day >= from && h.day <= to),
    sends: async (_u, list) => list.flatMap((id) => (rows.has(id) ? [rows.get(id)!] : [])),
    claim: async (_u, c) => c.forEach((r) => rows.set(r.event_id, { event_id: r.event_id, state: 'pending', attempts: r.attempts })),
    markSent: async (_u, list) => list.forEach((id) => (rows.get(id)!.state = 'sent')),
    markFailed: async () => {},
    setDigestDay: async (u, d) => void digest.set(u, d)
  };
  return { store, rows, digest };
}

function mail() {
  const sent: { subject: string; text: string }[] = [];
  const mailer: Mailer = { send: async (m) => void sent.push(m) };
  return { mailer, sent };
}

const member = (over: Partial<WatchRecipient> = {}): WatchRecipient => ({
  user_id: '00000000-0000-4000-8000-0000000000aa',
  email: 'tester@my.utsa.edu',
  digest_frequency: 'weekly',
  last_day: '2026-10-13',
  items: [WATCH],
  ...over
});

const go = (store: WatchStore, mailer: Mailer | null, today: string, r = member()) =>
  runWatchDigests({ recipients: [r], store, mailer, today, siteUrl: 'https://example.org/Terra/', linkSecret: 'ab'.repeat(32), budget: 10 });

describe('watch digests for a followed project', () => {
  it('weekly: one email with a mid-week change and its reversal; nothing the next week', async () => {
    const history = [
      day('2026-10-13', rec('2026-10-13')),
      day('2026-10-15', rec('2026-10-15', { cost: 3e7 })),
      day('2026-10-17', rec('2026-10-17')),
      day('2026-10-20', rec('2026-10-20')),
      day('2026-10-27', rec('2026-10-27'))
    ];
    const { store } = memStore(history);
    const { mailer, sent } = mail();
    expect(await go(store, mailer, '2026-10-20')).toMatchObject({ sent: 1, events: 2 });
    expect(sent[0]!.subject).toBe('Terra watchlist: 2 changes this week');
    expect(await go(store, mailer, '2026-10-27', member({ last_day: '2026-10-20' }))).toMatchObject({ sent: 0, nothingNew: 1 });
  });

  it('weekly is not due mid-week; daily is', async () => {
    const { store } = memStore([day('2026-10-13', rec('2026-10-13')), day('2026-10-14', rec('2026-10-14', { cost: 3e7 }))]);
    expect((await go(store, null, '2026-10-14')).due).toBe(0);
    expect(await go(store, null, '2026-10-14', member({ digest_frequency: 'daily' }))).toMatchObject({ due: 1, sent: 1, events: 1 });
  });

  it('keeps the first-digest baseline: no email until there are two days to compare', async () => {
    const { store, digest } = memStore([day('2026-10-13', rec('2026-10-13'))]);
    const { mailer, sent } = mail();
    expect(await go(store, mailer, '2026-10-13', member({ last_day: null }))).toMatchObject({ baseline: 1, sent: 0 });
    expect(sent).toEqual([]);
    expect(digest.get(member().user_id)).toBe('2026-10-13');
  });

  it('no-change days and outage days send nothing', async () => {
    const down = rec('2026-10-13', { state: 'error', failedAt: '2026-10-14T11:00:00Z' });
    const { store } = memStore([day('2026-10-13', rec('2026-10-13')), day('2026-10-14', down), day('2026-10-15', rec('2026-10-15'))]);
    const { mailer, sent } = mail();
    expect(await go(store, mailer, '2026-10-14', member({ digest_frequency: 'daily' }))).toMatchObject({ sent: 0, nothingNew: 1 });
    expect(await go(store, mailer, '2026-10-15', member({ digest_frequency: 'daily', last_day: '2026-10-14' }))).toMatchObject({ sent: 0, nothingNew: 1 });
    expect(sent).toEqual([]);
  });

  it('never repeats a sent change, but catches a change stored later on the digest day', async () => {
    const history = [day('2026-10-13', rec('2026-10-13')), day('2026-10-14', rec('2026-10-14', { cost: 3e7 }))];
    const { store, rows } = memStore(history);
    const { mailer, sent } = mail();
    const daily = (today: string, last: string) => go(store, mailer, today, member({ digest_frequency: 'daily', last_day: last }));
    expect(await daily('2026-10-14', '2026-10-13')).toMatchObject({ sent: 1 });
    // A later build on Oct 14 changes the row after the digest went out.
    history[1] = day('2026-10-14', rec('2026-10-14', { cost: 3.1e7 }));
    history.push(day('2026-10-15', rec('2026-10-15', { cost: 3.1e7 })));
    expect(await daily('2026-10-15', '2026-10-14')).toMatchObject({ sent: 1, events: 1 });
    expect(sent[1]!.text).toMatch(/estimated cost now \$31\.0M/);
    // And again the next day: nothing is repeated.
    history.push(day('2026-10-16', rec('2026-10-16', { cost: 3.1e7 })));
    expect(await daily('2026-10-16', '2026-10-15')).toMatchObject({ sent: 0, nothingNew: 1 });
    expect([...rows.values()].every((r) => r.state === 'sent' && r.attempts < MAX_ATTEMPTS)).toBe(true);
  });

  it('a dry run sends and records nothing', async () => {
    const { store, rows, digest } = memStore([day('2026-10-13', rec('2026-10-13')), day('2026-10-20', rec('2026-10-20', { cost: 3e7 }))]);
    expect(await go(store, null, '2026-10-20')).toMatchObject({ sent: 1, events: 1 });
    expect(rows.size).toBe(0);
    expect(digest.size).toBe(0);
  });
});
